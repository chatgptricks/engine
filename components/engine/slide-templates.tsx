"use client";

import {
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from "react";
import { proxied } from "@/lib/engine/util";
import type {
  SlideStyle,
  SlideTemplate,
  Story,
  StoryImage,
} from "@/lib/engine/types";
import { RichTextEl } from "./rich-text";

/**
 * Post layout templates applied to the focal slide of the Instagram preview.
 * `SlideFrame` renders the 4:5 frame for a template; `TEMPLATES` drives the
 * picker; `SlideThumb` is the little abstract layout preview in the picker.
 *
 * Every template is composed of three layers:
 *   1. a background (template default, a solid color, or a darkened blur of
 *      the focal image) — `BgLayer`,
 *   2. the focal media, which can be panned + zoomed inside its box —
 *      `PanMedia`,
 *   3. text / overlays on top.
 * Media editing is always live in the preview (no need to open a panel): drag
 * the media to reposition it, and drag the bottom-right corner handle to resize
 * width + height independently.
 */
export const TEMPLATES: Array<{ id: SlideTemplate; label: string }> = [
  { id: "text", label: "Text only" },
  { id: "plain", label: "Plain" },
  { id: "overlay", label: "Overlay" },
  { id: "fullbleed", label: "Full bleed" },
  { id: "quote", label: "Quote" },
  { id: "stacked", label: "Stacked" },
  { id: "blur", label: "Blur" },
  { id: "split", label: "Split" },
  { id: "masonry", label: "Gallery" },
];

/** Sensible default text placement per template (used by the frame + picker). */
export function defaultAlign(t: SlideTemplate): "top" | "center" | "bottom" {
  if (t === "fullbleed" || t === "split") return "bottom";
  if (t === "masonry") return "top";
  return "center";
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/** Force a grabbing cursor (and suppress selection) for the whole drag. */
function setDragCursor(on: boolean) {
  if (typeof document === "undefined") return;
  document.body.style.cursor = on ? "grabbing" : "";
  document.body.style.userSelect = on ? "none" : "";
}

/** The slide's playback window, from SlideStyle (absent = full clip). */
export function trimOf(
  style?: SlideStyle | null,
): { start: number; end?: number } | undefined {
  if (!style) return undefined;
  const start = Math.max(0, style.mediaStart ?? 0);
  const end = style.mediaEnd;
  if (start <= 0.05 && end == null) return undefined;
  return { start, end: end ?? undefined };
}

function MediaEl({
  img,
  className,
  style,
  trim,
  sound,
}: {
  img: StoryImage;
  className?: string;
  style?: CSSProperties;
  /** Play only this window of the clip (looping within it). */
  trim?: { start: number; end?: number };
  /** Unmuted playback (the IG-style speaker toggle). Default muted. */
  sound?: boolean;
}) {
  const videoRef = useRef<HTMLVideoElement | null>(null);

  // Trimmed playback: start the loop at `start` and wrap back whenever the
  // clip passes `end` (or the native loop wraps to 0 before `start`).
  useEffect(() => {
    const v = videoRef.current;
    if (!v || img.mediaType !== "video" || !trim) return;
    // The export drives currentTime itself (seek-and-encode). Inside the hidden
    // export layer this looper would fight those seeks and corrupt frames, so
    // leave the export's video alone.
    if (v.closest(".gf-export-layer")) return;
    const { start, end } = trim;
    const enter = () => {
      if (v.currentTime < start - 0.25 || (end != null && v.currentTime > end))
        v.currentTime = start;
    };
    const onTime = () => {
      if (end != null && v.currentTime >= end) v.currentTime = start;
      else if (v.currentTime < start - 0.25) v.currentTime = start;
    };
    if (v.readyState >= 1) enter();
    v.addEventListener("loadedmetadata", enter);
    v.addEventListener("timeupdate", onTime);
    return () => {
      v.removeEventListener("loadedmetadata", enter);
      v.removeEventListener("timeupdate", onTime);
    };
  }, [img.mediaType, img.url, trim]);

  if (img.mediaType === "video") {
    // Videos load direct (the img proxy serves images only) — they're either
    // data URLs or our own Blob store, which sends CORS headers. crossOrigin
    // keeps the canvas untainted so video export can read the frames.
    return (
      <video
        ref={videoRef}
        className={className}
        style={style}
        src={img.url}
        crossOrigin="anonymous"
        muted={!sound}
        loop
        autoPlay
        playsInline
        data-trim-start={trim ? String(trim.start) : undefined}
        data-trim-end={trim?.end != null ? String(trim.end) : undefined}
      />
    );
  }
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      className={className}
      style={style}
      src={proxied(img.url)}
      alt=""
      referrerPolicy="no-referrer"
      draggable={false}
    />
  );
}

/** The controllable background behind the media (color / darkened blur). */
function BgLayer({ style, img }: { style: SlideStyle; img: StoryImage }) {
  if (style.bgMode === "color") {
    return (
      <div
        className="gf-tpl-bgfill"
        style={{ background: style.bgColor || "#141417" }}
      />
    );
  }
  if (style.bgMode === "blur") {
    return (
      <>
        <MediaEl img={img} className="gf-tpl-blurbg" trim={trimOf(style)} />
        <div className="gf-tpl-blurtint" />
      </>
    );
  }
  return null;
}

/**
 * The focal media inside a box. Drag it to reposition (always live in preview).
 * With `resizable` the media is a free element (width/height % of the frame,
 * centered + offset) with a bottom-right corner handle that sizes width and
 * height independently; without it the media fills its box (used inside cards,
 * whose own corner handle does the sizing) and only pans.
 */
function PanMedia({
  img,
  style,
  resizable = false,
  onCommit,
  selected,
  onSelect,
  sound,
}: {
  img: StoryImage;
  style: SlideStyle;
  resizable?: boolean;
  onCommit?: (patch: Partial<SlideStyle>) => void;
  selected?: boolean;
  onSelect?: () => void;
  /** Unmuted playback for video media (IG speaker toggle). */
  sound?: boolean;
}) {
  const [live, setLive] = useState<{
    x: number;
    y: number;
    w: number;
    h: number;
    ix: number;
    iy: number;
    sc: number;
  } | null>(null);
  const liveRef = useRef<typeof live>(null);

  const x = live?.x ?? style.mediaX ?? 0;
  const y = live?.y ?? style.mediaY ?? 0;
  const w = live?.w ?? style.mediaW ?? 100;
  const h = live?.h ?? style.mediaH ?? 100;
  const ix = live?.ix ?? style.mediaInX ?? 0;
  const iy = live?.iy ?? style.mediaInY ?? 0;
  const sc = live?.sc ?? style.mediaScale ?? 1;
  // The image INSIDE its box: pan via object-position (bottom-left handle)
  // and zoom via a scale about that same focal point (top-left handle), so
  // panning always chooses what the zoom magnifies. <1 reveals background.
  const objPos: CSSProperties | undefined =
    ix !== 0 || iy !== 0 || sc !== 1
      ? {
          objectPosition: `${50 - ix}% ${50 - iy}%`,
          ...(sc !== 1
            ? {
                transformOrigin: `${50 - ix}% ${50 - iy}%`,
                transform: `scale(${sc})`,
              }
            : {}),
        }
      : undefined;

  // Drag via window listeners so the pointer keeps tracking after it leaves the
  // small handle (setPointerCapture proved unreliable in Safari).
  const beginDrag = (
    e: ReactPointerEvent,
    mode: "move" | "resize" | "inner" | "zoom",
  ) => {
    if (!onCommit) return;
    e.preventDefault();
    e.stopPropagation();
    onSelect?.();
    const target = e.currentTarget as HTMLElement;
    // move/resize are measured against the frame; inner pans relative to the
    // media BOX (frame × its size %), so a full drag across the box spans the
    // whole crop — regardless of whether the drag started on the box, the pan
    // handle, or a card layer.
    const frameEl = target.offsetParent as HTMLElement | null;
    const frameBox = frameEl?.getBoundingClientRect();
    const inBox = mode === "inner" || mode === "zoom";
    const cw = (frameBox?.width || 1) * (inBox ? w / 100 : 1);
    const ch = (frameBox?.height || 1) * (inBox ? h / 100 : 1);
    const sx = x;
    const sy = y;
    const sw = w;
    const sh = h;
    const six = ix;
    const siy = iy;
    const ssc = sc;
    const px = e.clientX;
    const py = e.clientY;
    liveRef.current = { x: sx, y: sy, w: sw, h: sh, ix: six, iy: siy, sc: ssc };
    setLive({ x: sx, y: sy, w: sw, h: sh, ix: six, iy: siy, sc: ssc });
    setDragCursor(true);
    const onMove = (ev: PointerEvent) => {
      const dx = ev.clientX - px;
      const dy = ev.clientY - py;
      const next =
        mode === "move"
          ? {
              x: clamp(sx + (dx / cw) * 100, -120, 120),
              y: clamp(sy + (dy / ch) * 100, -120, 120),
              w: sw,
              h: sh,
              ix: six,
              iy: siy,
              sc: ssc,
            }
          : mode === "resize"
            ? {
                x: sx,
                y: sy,
                w: clamp(sw + (dx / cw) * 200, 20, 320),
                h: clamp(sh + (dy / ch) * 200, 20, 320),
                ix: six,
                iy: siy,
                sc: ssc,
              }
            : mode === "inner"
              ? {
                  x: sx,
                  y: sy,
                  w: sw,
                  h: sh,
                  ix: clamp(six + (dx / cw) * 100, -50, 50),
                  iy: clamp(siy + (dy / ch) * 100, -50, 50),
                  sc: ssc,
                }
              : {
                  // zoom: drag away from the box (up-left) to magnify,
                  // toward it (down-right) to shrink.
                  x: sx,
                  y: sy,
                  w: sw,
                  h: sh,
                  ix: six,
                  iy: siy,
                  sc: clamp(ssc - (dx / cw + dy / ch), 0.4, 4),
                };
      liveRef.current = next;
      setLive(next);
    };
    const onUp = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onUp);
      setDragCursor(false);
      const l = liveRef.current;
      if (l) {
        onCommit(
          mode === "move"
            ? { mediaX: Math.round(l.x), mediaY: Math.round(l.y) }
            : mode === "resize"
              ? { mediaW: Math.round(l.w), mediaH: Math.round(l.h) }
              : mode === "inner"
                ? { mediaInX: Math.round(l.ix), mediaInY: Math.round(l.iy) }
                : { mediaScale: Math.round(l.sc * 100) / 100 },
        );
      }
      liveRef.current = null;
      setLive(null);
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onUp);
  };

  if (!resizable) {
    const transform = x !== 0 || y !== 0 ? `translate(${x}%, ${y}%)` : undefined;
    return (
      <div
        className={`gf-tpl-medialayer${onCommit ? " is-editable" : ""}${
          selected ? " is-selected" : ""
        }`}
        style={{
          ...(transform ? { transform } : {}),
          ...(style.mediaOpacity != null ? { opacity: style.mediaOpacity } : {}),
        }}
        onPointerDown={
          onCommit
            ? (e) => beginDrag(e, e.altKey ? "inner" : "move")
            : undefined
        }
      >
        <MediaEl img={img} className="gf-tpl-bg" style={objPos} trim={trimOf(style)} sound={sound} />
        {onCommit && (
          <>
            <span
              className="gf-tpl-rzhandle gf-tpl-panhandle"
              title="Drag to pan the image inside"
              aria-hidden
              onPointerDown={(e) => beginDrag(e, "inner")}
            />
            <span
              className="gf-tpl-rzhandle gf-tpl-zoomhandle"
              title="Drag to zoom the image inside (up-left bigger, down-right smaller)"
              aria-hidden
              onPointerDown={(e) => beginDrag(e, "zoom")}
            />
          </>
        )}
      </div>
    );
  }

  // Free, resizable element: centered, then offset by x/y; corner handle sizes.
  return (
    <>
      <div
        className={`gf-tpl-mediabox${onCommit ? " is-editable" : ""}${
          selected ? " is-selected" : ""
        }`}
        style={{
          width: `${w}%`,
          height: `${h}%`,
          left: `${50 + x}%`,
          top: `${50 + y}%`,
          ...(style.mediaOpacity != null ? { opacity: style.mediaOpacity } : {}),
          ...(style.mediaRadius ? { borderRadius: `${style.mediaRadius}px` } : {}),
        }}
        onPointerDown={
          onCommit
            ? (e) => beginDrag(e, e.altKey ? "inner" : "move")
            : undefined
        }
      >
        <MediaEl img={img} className="gf-tpl-bg" style={objPos} trim={trimOf(style)} sound={sound} />
      </div>
      {onCommit && (
        <>
          <span
            className="gf-tpl-rzhandle gf-tpl-rzhandle-media"
            style={{ left: `${50 + x + w / 2}%`, top: `${50 + y + h / 2}%` }}
            aria-hidden
            onPointerDown={(e) => beginDrag(e, "resize")}
          />
          <span
            className="gf-tpl-rzhandle gf-tpl-panhandle gf-tpl-panhandle-media"
            style={{ left: `${50 + x - w / 2}%`, top: `${50 + y + h / 2}%` }}
            title="Drag to pan the image inside its box"
            aria-hidden
            onPointerDown={(e) => beginDrag(e, "inner")}
          />
          <span
            className="gf-tpl-rzhandle gf-tpl-zoomhandle gf-tpl-zoomhandle-media"
            style={{ left: `${50 + x - w / 2}%`, top: `${50 + y - h / 2}%` }}
            title="Drag to zoom the image inside (up-left bigger, down-right smaller)"
            aria-hidden
            onPointerDown={(e) => beginDrag(e, "zoom")}
          />
        </>
      )}
    </>
  );
}

/**
 * A media card whose width + height are independently resizable via a
 * bottom-right corner handle (stacked / blur). Width = `baseW% * cardW`;
 * height follows from `aspect-ratio = baseAspect * cardW / cardH`.
 */
function ResizableCard({
  className,
  baseW,
  baseAspect,
  cardW,
  cardH,
  onCommit,
  children,
}: {
  className: string;
  baseW: number;
  baseAspect: number;
  cardW: number;
  cardH: number;
  onCommit?: (patch: Partial<SlideStyle>) => void;
  children: ReactNode;
}) {
  const [live, setLive] = useState<{ w: number; h: number } | null>(null);
  const liveRef = useRef<{ w: number; h: number } | null>(null);
  const w = live?.w ?? cardW;
  const h = live?.h ?? cardH;
  const beginResize = (e: ReactPointerEvent) => {
    if (!onCommit) return;
    e.preventDefault();
    e.stopPropagation();
    const sw = w;
    const sh = h;
    const px = e.clientX;
    const py = e.clientY;
    liveRef.current = { w: sw, h: sh };
    setLive({ w: sw, h: sh });
    setDragCursor(true);
    const onMove = (ev: PointerEvent) => {
      const next = {
        w: clamp(sw + (ev.clientX - px) / 240, 0.4, 1.3),
        h: clamp(sh + (ev.clientY - py) / 240, 0.4, 1.6),
      };
      liveRef.current = next;
      setLive(next);
    };
    const onUp = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onUp);
      setDragCursor(false);
      const l = liveRef.current;
      if (l) {
        onCommit({
          cardW: Number(l.w.toFixed(3)),
          cardH: Number(l.h.toFixed(3)),
        });
      }
      liveRef.current = null;
      setLive(null);
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onUp);
  };
  return (
    <div
      className={className}
      style={{
        width: `${(baseW * w).toFixed(2)}%`,
        aspectRatio: `${(baseAspect * (w / h)).toFixed(3)}`,
      }}
    >
      {children}
      {onCommit && (
        <span className="gf-tpl-rzhandle" aria-hidden onPointerDown={beginResize} />
      )}
    </div>
  );
}

/** Which slide element is selected in the editor (drives the inspector). */
export type SlideElement = "text" | "media" | "background";

/** Map a stored font id to its utility class (legacy "serif"/"sans" included). */
const FONT_IDS = new Set([
  "walsheim",
  "walsheimcond",
  "kyoto",
  "century",
  "libre",
  "geist",
  "playfair",
  "dmserif",
  "lora",
  "cormorant",
  "crimson",
  "inter",
  "space",
  "montserrat",
  "bebas",
  "plexmono",
  "caveat",
]);
export function fontClassOf(font?: string): string {
  if (font === "sans") return "gf-font-geist";
  if (font && FONT_IDS.has(font)) return `gf-font-${font}`;
  return "gf-font-libre"; // default + legacy "serif"
}

/**
 * A template's text container, made free-form: drag it anywhere on the slide
 * (stored as textX/textY, % of its own box, applied via the CSS `translate`
 * property so it composes with the alignment transform) and scaled via the
 * --gf-textscale variable that the font-size rules multiply by.
 */
function TextBlock({
  style,
  onSet,
  selected,
  onSelect,
  className,
  align,
  children,
}: {
  style: SlideStyle;
  onSet?: (patch: Partial<SlideStyle>) => void;
  selected?: boolean;
  onSelect?: () => void;
  className: string;
  align?: "top" | "center" | "bottom";
  children: ReactNode;
}) {
  const [live, setLive] = useState<{ x: number; y: number; s: number } | null>(
    null,
  );
  const liveRef = useRef<typeof live>(null);
  const tx = live?.x ?? style.textX ?? 0;
  const ty = live?.y ?? style.textY ?? 0;
  const ts = live?.s ?? style.textScale ?? 1;

  const begin = (e: ReactPointerEvent, mode: "move" | "scale") => {
    if (!onSet) return;
    e.preventDefault();
    e.stopPropagation();
    onSelect?.();
    const el = (
      mode === "move"
        ? (e.currentTarget as HTMLElement)
        : ((e.currentTarget as HTMLElement).parentElement as HTMLElement)
    ).getBoundingClientRect();
    const bw = el.width || 1;
    const bh = el.height || 1;
    const sx = tx;
    const sy = ty;
    const ss = ts;
    const px = e.clientX;
    const py = e.clientY;
    liveRef.current = { x: sx, y: sy, s: ss };
    setLive({ x: sx, y: sy, s: ss });
    setDragCursor(true);
    const onMove = (ev: PointerEvent) => {
      const dx = ev.clientX - px;
      const dy = ev.clientY - py;
      const next =
        mode === "move"
          ? {
              x: clamp(sx + (dx / bw) * 100, -400, 400),
              y: clamp(sy + (dy / bh) * 100, -400, 400),
              s: ss,
            }
          : {
              x: sx,
              y: sy,
              s: clamp(ss + (dx / bw + dy / bh), 0.5, 2.5),
            };
      liveRef.current = next;
      setLive(next);
    };
    const onUp = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onUp);
      setDragCursor(false);
      const l = liveRef.current;
      if (l) {
        onSet(
          mode === "move"
            ? { textX: Math.round(l.x), textY: Math.round(l.y) }
            : { textScale: Math.round(l.s * 100) / 100 },
        );
      }
      liveRef.current = null;
      setLive(null);
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onUp);
  };

  const css: CSSProperties = {
    ...({ "--gf-textscale": String(ts) } as CSSProperties),
    ...(style.lineHeight != null
      ? ({ "--gf-lhx": String(style.lineHeight) } as CSSProperties)
      : {}),
    ...(style.fontWeight
      ? ({ "--gf-textweight": String(style.fontWeight) } as CSSProperties)
      : {}),
    ...(style.letterSpacing != null
      ? ({
          "--gf-lspace": `${style.letterSpacing}em`,
          letterSpacing: `${style.letterSpacing}em`,
        } as CSSProperties)
      : {}),
    ...(style.textColor ? { color: style.textColor } : {}),
    ...(style.textOpacity != null ? { opacity: style.textOpacity } : {}),
    ...(style.textAlign ? { textAlign: style.textAlign } : {}),
    ...(tx !== 0 || ty !== 0 ? { translate: `${tx}% ${ty}%` } : {}),
  };
  return (
    <div
      className={`${className}${onSet ? " gf-textdrag" : ""}${
        selected ? " is-selected" : ""
      }`}
      {...(align ? { "data-align": align } : {})}
      style={css}
      onPointerDown={onSet ? (e) => begin(e, "move") : undefined}
    >
      {children}
      {onSet && selected && (
        <span
          className="gf-tpl-txthandle"
          title="Drag to resize the text"
          aria-hidden
          onPointerDown={(e) => begin(e, "scale")}
        />
      )}
    </div>
  );
}

/** The image's details, shown under the picture when style.credit is on:
 * its description plus a source citation derived from where it came from.
 * Exported so the Layout panel can prefill its editable override inputs. */
export function creditOf(img: StoryImage): { text: string; source: string } | null {
  let host = "";
  if (img.sourceUrl) {
    try {
      host = new URL(img.sourceUrl).hostname.replace(/^www\./, "");
    } catch {
      /* keep empty */
    }
  }
  const source =
    img.source === "upload"
      ? "curator's own"
      : host
        ? `via ${host}`
        : img.source === "x"
          ? "via X"
          : img.directive
            ? `via ${img.directive}`
            : "";
  const text = (img.description ?? "").trim();
  if (!text && !source) return null;
  return { text, source };
}

function CreditLine({
  img,
  style,
  frame,
}: {
  img: StoryImage;
  style: SlideStyle;
  /** Anchor to the slide frame's bottom edge (full-frame templates). */
  frame?: boolean;
}) {
  const derived = creditOf(img);
  // Curator overrides win (same convention as heading: empty string hides).
  const text = style.creditText !== undefined ? style.creditText : (derived?.text ?? "");
  const source =
    style.creditSource !== undefined ? style.creditSource : (derived?.source ?? "");
  if (!text && !source) return null;
  return (
    <p className={`gf-tpl-credit${frame ? " is-frame" : ""}`}>
      {text && <span className="gf-tpl-credit-desc">{text}</span>}
      {source && <span className="gf-tpl-credit-src">{source}</span>}
    </p>
  );
}

export function SlideFrame({
  img,
  style,
  story,
  gallery,
  index,
  onSet,
  selected,
  onSelect,
  sound,
}: {
  img: StoryImage;
  style: SlideStyle;
  story: Story;
  gallery?: StoryImage[];
  index?: number;
  /** Commit a style patch for the focal slide. */
  onSet?: (patch: Partial<SlideStyle>) => void;
  /** The editor's selected element (drives rings + the inspector). */
  selected?: SlideElement | null;
  onSelect?: (el: SlideElement) => void;
  /** Unmuted playback for the focal video (IG speaker toggle). */
  sound?: boolean;
}) {
  const heading =
    style.heading !== undefined
      ? style.heading
      : story.caption.titleOverImage.text || story.title;
  const body = style.body ?? "";
  const fontClass = fontClassOf(style.font);
  const align = style.align ?? defaultAlign(style.template);
  const cardW = style.cardW ?? style.cardScale ?? 1;
  const cardH = style.cardH ?? style.cardScale ?? 1;

  // Ordered pool for multi-image templates; wraps so the focal slide leads.
  const pool = gallery && gallery.length ? gallery : [img];
  const idx = index ?? 0;
  const pick = (count: number): StoryImage[] =>
    Array.from(
      { length: Math.min(count, pool.length) },
      (_, k) => pool[(idx + k) % pool.length],
    );

  const selMedia = selected === "media";
  const pickMedia = onSelect ? () => onSelect("media") : undefined;
  const pickText = onSelect ? () => onSelect("text") : undefined;
  // Full-frame templates: a free, corner-resizable media element.
  const freeMedia = (
    <PanMedia
      img={img}
      style={style}
      resizable
      onCommit={onSet}
      selected={selMedia}
      onSelect={pickMedia}
      sound={sound}
    />
  );
  // Inside cards: media fills the card (the card's own handle sizes it); pan only.
  const cardMedia = (
    <PanMedia
      img={img}
      style={style}
      onCommit={onSet}
      selected={selMedia}
      onSelect={pickMedia}
      sound={sound}
    />
  );

  if (style.template === "text") {
    return (
      <div className="gf-tpl gf-tpl-textonly" data-align={align}>
        <BgLayer style={style} img={img} />
        <TextBlock style={style} onSet={onSet} selected={selected === "text"} onSelect={pickText} className={`gf-tpl-text ${fontClass}`}>
          <RichTextEl tag="h2" className="gf-tpl-head" text={heading} html={style.headingHtml} field="heading" onSet={onSet} />
          {body && <RichTextEl tag="p" className="gf-tpl-body" text={body} html={style.bodyHtml} field="body" onSet={onSet} />}
        </TextBlock>
      </div>
    );
  }

  if (style.template === "quote") {
    return (
      <div className={`gf-tpl gf-tpl-quote ${fontClass}`} data-align={align}>
        <BgLayer style={style} img={img} />
        <TextBlock style={style} onSet={onSet} selected={selected === "text"} onSelect={pickText} className="gf-tpl-quotebody">
          <span className="gf-tpl-quotemark" aria-hidden>
            &ldquo;
          </span>
          <RichTextEl tag="blockquote" className="gf-tpl-quotetext" text={heading} html={style.headingHtml} field="heading" onSet={onSet} />
          {body && <RichTextEl tag="cite" className="gf-tpl-cite" text={body} html={style.bodyHtml} field="body" onSet={onSet} />}
        </TextBlock>
      </div>
    );
  }

  if (style.template === "overlay") {
    return (
      <div className="gf-tpl gf-tpl-overlay" data-align={align}>
        <BgLayer style={style} img={img} />
        {freeMedia}
        <div className="gf-tpl-darken" />
        <TextBlock style={style} onSet={onSet} selected={selected === "text"} onSelect={pickText} className={`gf-tpl-text ${fontClass}`}>
          <RichTextEl tag="h2" className="gf-tpl-head" text={heading} html={style.headingHtml} field="heading" onSet={onSet} />
          {body && <RichTextEl tag="p" className="gf-tpl-body" text={body} html={style.bodyHtml} field="body" onSet={onSet} />}
        </TextBlock>
        {style.credit && <CreditLine img={img} style={style} frame />}
      </div>
    );
  }

  if (style.template === "fullbleed") {
    return (
      <div className="gf-tpl gf-tpl-fullbleed" data-align={align}>
        <BgLayer style={style} img={img} />
        {freeMedia}
        <div className="gf-tpl-grad" data-align={align} />
        <TextBlock style={style} onSet={onSet} selected={selected === "text"} onSelect={pickText} className={`gf-tpl-text ${fontClass}`}>
          <RichTextEl tag="h2" className="gf-tpl-head" text={heading} html={style.headingHtml} field="heading" onSet={onSet} />
          {body && <RichTextEl tag="p" className="gf-tpl-body" text={body} html={style.bodyHtml} field="body" onSet={onSet} />}
        </TextBlock>
        {style.credit && <CreditLine img={img} style={style} frame />}
      </div>
    );
  }

  if (style.template === "stacked") {
    return (
      <div className="gf-tpl gf-tpl-stacked" data-align={align}>
        {style.bgMode ? (
          <BgLayer style={style} img={img} />
        ) : (
          <>
            <MediaEl img={img} className="gf-tpl-blurbg" trim={trimOf(style)} />
            <div className="gf-tpl-blurtint" />
          </>
        )}
        <div className="gf-tpl-stack">
          <ResizableCard
            className="gf-tpl-card"
            baseW={100}
            baseAspect={4 / 3}
            cardW={cardW}
            cardH={cardH}
            onCommit={onSet}
          >
            {cardMedia}
          </ResizableCard>
          {style.credit && <CreditLine img={img} style={style} />}
          {(heading || body) && (
            <TextBlock
              style={style}
              onSet={onSet}
              selected={selected === "text"}
              onSelect={pickText}
              className={`gf-tpl-stacktext ${fontClass}`}
            >
              {heading && <RichTextEl tag="h2" className="gf-tpl-head" text={heading} html={style.headingHtml} field="heading" onSet={onSet} />}
              {body && <RichTextEl tag="p" className="gf-tpl-body" text={body} html={style.bodyHtml} field="body" onSet={onSet} />}
            </TextBlock>
          )}
        </div>
      </div>
    );
  }

  if (style.template === "blur") {
    return (
      <div className="gf-tpl gf-tpl-blur" data-align={align}>
        {style.bgMode ? (
          <BgLayer style={style} img={img} />
        ) : (
          <>
            <MediaEl img={img} className="gf-tpl-blurbg" trim={trimOf(style)} />
            <div className="gf-tpl-blurtint" />
          </>
        )}
        <div className="gf-tpl-blurstack">
          <ResizableCard
            className="gf-tpl-bcard"
            baseW={78}
            baseAspect={1}
            cardW={cardW}
            cardH={cardH}
            onCommit={onSet}
          >
            {cardMedia}
          </ResizableCard>
          {style.credit && <CreditLine img={img} style={style} />}
          {heading && (
            <TextBlock
              style={style}
              onSet={onSet}
              selected={selected === "text"}
              onSelect={pickText}
              className={`gf-tpl-blurcap ${fontClass}`}
            >
              <RichTextEl tag="h2" className="gf-tpl-head" text={heading} html={style.headingHtml} field="heading" onSet={onSet} />
              {body && <RichTextEl tag="p" className="gf-tpl-body" text={body} html={style.bodyHtml} field="body" onSet={onSet} />}
            </TextBlock>
          )}
        </div>
      </div>
    );
  }

  if (style.template === "split") {
    const [a2, b2] = pick(2);
    return (
      <div className="gf-tpl gf-tpl-split" data-align={align}>
        <BgLayer style={style} img={img} />
        <div className="gf-tpl-splithalf">
          <PanMedia img={a2} style={style} resizable onCommit={onSet} selected={selMedia} onSelect={pickMedia} />
        </div>
        <div className="gf-tpl-splithalf">
          <MediaEl img={b2 ?? a2} className="gf-tpl-bg" />
        </div>
        {heading && (
          <>
            <div className="gf-tpl-grad" data-align={align} />
            <TextBlock style={style} onSet={onSet} selected={selected === "text"} onSelect={pickText} className={`gf-tpl-text ${fontClass}`}>
              <RichTextEl tag="h2" className="gf-tpl-head" text={heading} html={style.headingHtml} field="heading" onSet={onSet} />
              {body && <RichTextEl tag="p" className="gf-tpl-body" text={body} html={style.bodyHtml} field="body" onSet={onSet} />}
            </TextBlock>
          </>
        )}
        {style.credit && <CreditLine img={a2} style={style} frame />}
      </div>
    );
  }

  if (style.template === "masonry") {
    // Editorial "cover" collage: a big title up top, then a hero slide centered
    // with the next images peeking in from the edges. Slot order:
    // [hero, left-top, right-top, bottom-center, left-bottom, right-bottom].
    const slots = pick(6);
    return (
      <div className={`gf-tpl gf-tpl-cover ${fontClass}`} data-align={align}>
        <BgLayer style={style} img={img} />
        <div className="gf-tpl-collage">
          {slots.map((im, k) => (
            <div className={`gf-tpl-slot gf-tpl-slot-${k}`} key={`${im.id}-${k}`}>
              {k === 0 ? (
                <PanMedia img={im} style={style} resizable onCommit={onSet} selected={selMedia} onSelect={pickMedia} />
              ) : (
                <MediaEl img={im} className="gf-tpl-bg" />
              )}
            </div>
          ))}
        </div>
        <TextBlock
          style={style}
          onSet={onSet}
          selected={selected === "text"}
          onSelect={pickText}
          className="gf-tpl-coverhead"
          align={align}
        >
          {heading && <RichTextEl tag="h2" className="gf-tpl-covertitle" text={heading} html={style.headingHtml} field="heading" onSet={onSet} />}
          {body && <RichTextEl tag="p" className="gf-tpl-coversub" text={body} html={style.bodyHtml} field="body" onSet={onSet} />}
          <span className="gf-tpl-coverarrow" aria-hidden>
            &rarr;
          </span>
        </TextBlock>
        {style.credit && <CreditLine img={img} style={style} frame />}
      </div>
    );
  }

  return (
    <div className="gf-tpl gf-tpl-plain">
      <BgLayer style={style} img={img} />
      {freeMedia}
      {style.credit && <CreditLine img={img} style={style} frame />}
    </div>
  );
}

/** A small abstract preview of a template's layout, for the picker. */
export function SlideThumb({ template }: { template: SlideTemplate }) {
  return <span className={`gf-tplthumb gf-tplthumb-${template}`} aria-hidden />;
}
