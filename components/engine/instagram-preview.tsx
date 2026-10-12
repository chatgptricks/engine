"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from "react";
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  arrayMove,
  horizontalListSortingStrategy,
  useSortable,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { useEngine } from "@/lib/engine/store";
import { proxied } from "@/lib/engine/util";
import type { SlideStyle, Story, StoryImage } from "@/lib/engine/types";
import {
  SlideFrame,
  SlideThumb,
  TEMPLATES,
  creditOf,
  defaultAlign,
  type SlideElement,
} from "./slide-templates";
import { ENGINE_FONTS } from "@/app/admin/(tool)/engine/fonts";
import { RICH_WEIGHTS } from "./rich-text";
import {
  ArrowLeftIcon,
  ArrowRightIcon,
  BookmarkIcon,
  ChevronLeftIcon,
  CloseIcon,
  CommentIcon,
  DownloadIcon,
  HeartIcon,
  PlusIcon,
  ShareIcon,
  SpeakerIcon,
} from "./icons";

/**
 * Screen 3 — Instagram preview.
 *
 * The Instagram card is FIXED dead-center. Behind and around it the selected
 * images sit on a rotating cylinder: each image is placed at its own angle on
 * a circle and billboarded to face the viewer, so they recede into depth on
 * the left and right and wrap around behind the card. Navigating spins the
 * cylinder a full 360° loop; the card always shows whichever image is at the
 * front. The single share action copies the caption and opens Instagram — it
 * never auto-posts.
 */

export function InstagramPreview({
  story,
  onFocalChange,
}: {
  story: Story;
  /** Reports the image currently in the card, for the dock's "download slide". */
  onFocalChange?: (imageId: string | null) => void;
}) {
  const {
    getCuration,
    reorderSelection,
    toggleSelect,
    effectiveCaption,
    getSlideStyle,
    setSlideStyle,
  } = useEngine();
  const selectedIds = getCuration(story.id).selectedImageIds;
  const images = selectedIds
    .map((id) => story.images.find((i) => i.id === id))
    .filter((i): i is StoryImage => Boolean(i));

  const n = images.length;
  const step = n > 0 ? 360 / n : 0;
  // Radius sized so the focal image's arc projects to just under the card width
  // — the focal tucks behind the card (no visible copy) and the neighbours
  // flank its edges. Rendering ALL images (focal included, just hidden) means
  // the memo below never rebuilds on navigation, so the rotation stays smooth.
  const radius =
    n > 1 ? Math.min(640, 160 / Math.sin((180 / n) * (Math.PI / 180))) : 320;

  // Slice each image into STRIPS tangent facets that bend it around the
  // cylinder and tile edge-to-edge. Kept low so the 3D scene composites cheaply
  // and the spin stays smooth.
  const STRIPS = n > 0 ? Math.max(5, Math.min(10, Math.round(step / 8))) : 0;
  const subStep = STRIPS > 0 ? step / STRIPS : 0;
  const stripChord = 2 * radius * Math.tan(((subStep / 2) * Math.PI) / 180);
  const stripImgW = STRIPS * stripChord;
  const stripH = Math.round(Math.min(500, Math.max(320, stripImgW * 0.85)));

  // Sound for video slides — like Instagram: posts start muted, the speaker
  // badge toggles audio, and the choice carries across the carousel.
  const [soundOn, setSoundOn] = useState(false);

  // `rot` is an unbounded rotation accumulator (the TARGET angle) so next/prev
  // wrap seamlessly through 360°. The focal index is derived from it.
  const [rot, setRot] = useState(0);
  const focal = n > 0 ? ((Math.round(-rot / step) % n) + n) % n : 0;

  // Strips are memoized and depend ONLY on the image set + geometry — never on
  // `rot`/`focal` — so navigation does not rebuild them at all (the previous
  // rebuild-per-step was stalling the rotation). The ring carries the spin.
  const imgSig = images.map((im) => im.id).join("|");
  const stripEls = useMemo(
    () =>
      images.flatMap((img, i) => {
        const base = i * step - step / 2; // fixed; the ring carries rotation
        const url = proxied(img.url);
        return Array.from({ length: STRIPS }, (_, k) => {
          const a = base + (k + 0.5) * subStep;
          return (
            <div
              key={`${img.id}-${k}`}
              className="gf-ig-strip"
              style={{
                width: `${stripChord + 1}px`,
                height: `${stripH}px`,
                marginLeft: `${-stripChord / 2}px`,
                marginTop: `${-stripH / 2}px`,
                transform: `rotateY(${a}deg) translateZ(${radius}px)`,
                backgroundImage: `url(${url})`,
                backgroundSize: `${stripImgW}px ${stripH}px`,
                backgroundPosition: `${-k * stripChord}px center`,
              }}
            />
          );
        });
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [imgSig, radius, step, STRIPS, subStep, stripChord, stripImgW, stripH],
  );

  // Step by one image; the accumulator wraps seamlessly past 360°.
  const go = useCallback((dir: -1 | 1) => setRot((r) => r - dir * step), [step]);

  // Spin the shortest way round to bring a specific image to the front.
  const jumpTo = useCallback(
    (index: number) =>
      setRot((r) => {
        const base = -index * step;
        const k = Math.round((r - base) / 360);
        return base + 360 * k;
      }),
    [step],
  );

  // Report the focal image up so the dock can offer "download this slide".
  const focalId = n > 0 ? (images[focal]?.id ?? null) : null;
  useEffect(() => {
    onFocalChange?.(focalId);
  }, [focalId, onFocalChange]);

  // The editor's selected element (text / media / background) — drives the
  // selection ring on the slide and which inspector sections show. Resets to
  // text when the focal slide changes.
  const [sel, setSel] = useState<SlideElement>("text");
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- reset selection when the slide changes
    setSel("text");
  }, [focalId]);

  // Arrow-key navigation while this view is mounted.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const t = e.target as HTMLElement | null;
      if (
        t &&
        (t.tagName === "INPUT" ||
          t.tagName === "TEXTAREA" ||
          t.tagName === "SELECT" ||
          t.isContentEditable)
      )
        return; // typing — leave the caret keys alone
      if (e.key === "ArrowLeft") {
        e.preventDefault();
        go(-1);
      } else if (e.key === "ArrowRight") {
        e.preventDefault();
        go(1);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [go]);

  // Threshold swipe anywhere on the stage.
  const [down, setDown] = useState<{ x: number; y: number } | null>(null);

  if (n === 0) {
    return (
      <div className="gf-ig">
        <div className="gf-ig-empty">
          <div className="gf-ig-empty-title">No images selected yet</div>
          <div className="gf-ig-empty-sub">
            Switch back to Gallery and tap images in the order you want them.
            They&rsquo;ll appear here as a carousel.
          </div>
        </div>
      </div>
    );
  }

  const focalImg = images[focal];
  const caption = effectiveCaption(story);
  const focalStyle = getSlideStyle(story.id, focalImg.id);
  const defaultHeading = story.caption.titleOverImage.text || story.title;

  return (
    <div className="gf-ig">
      <LayoutPanel
        style={focalStyle}
        img={focalImg}
        defaultHeading={defaultHeading}
        sel={sel}
        setSel={setSel}
        onSet={(patch) => setSlideStyle(story.id, focalImg.id, patch)}
      />
      <div className="gf-ig-main">
      <div
        className="gf-ig-stage"
        onPointerDown={(e) => setDown({ x: e.clientX, y: e.clientY })}
        onPointerUp={(e) => {
          if (!down) return;
          const dx = e.clientX - down.x;
          const dy = e.clientY - down.y;
          if (Math.abs(dx) > 44 && Math.abs(dx) > Math.abs(dy)) go(dx > 0 ? -1 : 1);
          setDown(null);
        }}
        onPointerCancel={() => setDown(null)}
      >
        {/* Curved 360° cylinder. The focal image tucks behind the card by
            geometry (no visible copy); the strips are memoized so navigating
            only animates the ring's single transform — smooth, not jumpy. */}
        <div className="gf-ig-scene">
          <div
            className="gf-ig-ring"
            style={{ transform: `translateZ(${-radius}px) rotateY(${rot}deg)` }}
          >
            {stripEls}
          </div>
        </div>
        {/* Static depth shade — darkens the curving sides into the background
            and hides the rim where strips turn edge-on. */}
        <div className="gf-ig-shade" aria-hidden />

        <button
          className="gf-arrow gf-arrow-left"
          onClick={() => go(-1)}
          aria-label="Previous image"
        >
          <ArrowLeftIcon />
        </button>

        {/* Fixed card overlay */}
        <div className="gf-ig-card-overlay">
          <PostCard
            story={story}
            focalImg={focalImg}
            images={images}
            focal={focal}
            total={n}
            caption={caption}
            style={focalStyle}
            selected={sel}
            onSelect={setSel}
            onSet={(patch) => setSlideStyle(story.id, focalImg.id, patch)}
            soundOn={soundOn}
            onToggleSound={() => setSoundOn((o) => !o)}
          />
        </div>

        <button
          className="gf-arrow gf-arrow-right"
          onClick={() => go(1)}
          aria-label="Next image"
        >
          <ArrowRightIcon />
        </button>
      </div>

      <ThumbStrip
        story={story}
        images={images}
        selectedIds={selectedIds}
        focal={focal}
        jumpTo={jumpTo}
        reorder={(next) => reorderSelection(story.id, next)}
        onToggle={(id) => toggleSelect(story.id, id)}
      />
      </div>
    </div>
  );
}

/* ─── Fixed Instagram card (shows the focal image) ───────────────────── */

function PostCard({
  story,
  focalImg,
  images,
  focal,
  total,
  caption,
  style,
  selected,
  onSelect,
  onSet,
  soundOn,
  onToggleSound,
}: {
  story: Story;
  focalImg: StoryImage;
  images: StoryImage[];
  focal: number;
  total: number;
  caption: string;
  style: SlideStyle;
  selected: SlideElement;
  onSelect: (el: SlideElement) => void;
  onSet: (patch: Partial<SlideStyle>) => void;
  soundOn?: boolean;
  onToggleSound?: () => void;
}) {
  return (
    <div className="gf-igpost">
      <div className="gf-ig-profile">
        <span className="gf-ig-avatar" aria-hidden />
        <span className="gf-ig-handle">engine</span>
        <span className="gf-ig-more" aria-hidden>
          •••
        </span>
      </div>
      <div
        className="gf-ig-frame"
        onPointerDown={() => onSelect("background")}
      >
        {/* Keyed by TEMPLATE only — navigating between slides (same template)
            updates the image in place (a clean swap) instead of remounting and
            replaying the dim-flash. Only a template change remounts + fades. */}
        <SlideFrame
          key={style.template}
          img={focalImg}
          style={style}
          story={story}
          gallery={images}
          index={focal}
          onSet={onSet}
          selected={selected}
          onSelect={onSelect}
          sound={soundOn}
        />
        <span className="gf-ig-counter">
          {focal + 1}/{total}
        </span>
        {focalImg.mediaType === "video" && onToggleSound && (
          <button
            type="button"
            className="gf-ig-sound"
            aria-label={soundOn ? "Mute" : "Unmute"}
            aria-pressed={soundOn}
            onPointerDown={(e) => e.stopPropagation()}
            onClick={(e) => {
              e.stopPropagation();
              onToggleSound();
            }}
          >
            <SpeakerIcon size={12} off={!soundOn} />
          </button>
        )}
      </div>
      <div className="gf-ig-actions" aria-hidden>
        <HeartIcon />
        <CommentIcon />
        <ShareIcon />
        <span className="gf-ig-save">
          <BookmarkIcon />
        </span>
      </div>
      <div className="gf-ig-caption">
        <b>engine</b>
        {caption}
      </div>
    </div>
  );
}

/* ─── Layout picker (post template + text / font / placement) ─────────── */

/** A Figma-style numeric well: tiny label, value, optional unit. */
function NumField({
  label,
  value,
  step = 1,
  min,
  max,
  suffix,
  onChange,
}: {
  label: string;
  value: number;
  step?: number;
  min?: number;
  max?: number;
  suffix?: string;
  onChange: (v: number) => void;
}) {
  return (
    <label className="gf-insp-field">
      <span>{label}</span>
      <input
        type="number"
        value={Math.round(value * 100) / 100}
        step={step}
        min={min}
        max={max}
        onChange={(e) => {
          const v = Number(e.target.value);
          if (!Number.isFinite(v)) return;
          onChange(
            Math.min(max ?? Infinity, Math.max(min ?? -Infinity, v)),
          );
        }}
      />
      {suffix && <em>{suffix}</em>}
    </label>
  );
}

/** "1:23.4" — trim readout format. */
function fmtSecs(t: number): string {
  const m = Math.floor(t / 60);
  const s = t - m * 60;
  return `${m}:${s < 10 ? "0" : ""}${s.toFixed(1)}`;
}

/**
 * Video trim control: a track with two draggable handles choosing the slice
 * of the clip the slide plays (and exports). Times in seconds on SlideStyle
 * (mediaStart/mediaEnd); dragging a handle to its end of the track clears it.
 */
function TrimBar({
  url,
  start,
  end,
  onChange,
}: {
  url: string;
  start?: number;
  end?: number;
  onChange: (start?: number, end?: number) => void;
}) {
  const [dur, setDur] = useState(0);
  const [live, setLive] = useState<{ s: number; e: number } | null>(null);
  const trackRef = useRef<HTMLDivElement | null>(null);

  // The clip's duration, from metadata only (no body download).
  useEffect(() => {
    let gone = false;
    const v = document.createElement("video");
    v.preload = "metadata";
    v.onloadedmetadata = () => {
      if (!gone && Number.isFinite(v.duration)) setDur(v.duration);
    };
    v.src = url;
    return () => {
      gone = true;
      v.removeAttribute("src");
    };
  }, [url]);

  const s = live?.s ?? Math.max(0, start ?? 0);
  const e = live?.e ?? Math.min(dur || Infinity, end ?? dur);
  const pct = (t: number) => (dur > 0 ? (t / dur) * 100 : 0);

  const drag = (which: "s" | "e") => (ev: ReactPointerEvent) => {
    if (dur <= 0) return;
    ev.preventDefault();
    ev.stopPropagation();
    const rect = trackRef.current?.getBoundingClientRect();
    if (!rect || rect.width === 0) return;
    const at = (x: number) =>
      Math.min(dur, Math.max(0, ((x - rect.left) / rect.width) * dur));
    let next = { s, e };
    const onMove = (m: PointerEvent) => {
      const t = at(m.clientX);
      next =
        which === "s"
          ? { s: Math.min(t, e - 0.2), e }
          : { s, e: Math.max(t, s + 0.2) };
      setLive(next);
    };
    const onUp = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onUp);
      setLive(null);
      // Handles parked at the very ends mean "no trim" on that side.
      onChange(
        next.s > 0.05 ? Math.round(next.s * 10) / 10 : undefined,
        next.e < dur - 0.05 ? Math.round(next.e * 10) / 10 : undefined,
      );
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onUp);
  };

  const trimmed = (start ?? 0) > 0.05 || (end != null && dur > 0 && end < dur - 0.05);

  return (
    <div className="gf-trim">
      <div className="gf-trim-track" ref={trackRef}>
        <div
          className="gf-trim-fill"
          style={{ left: `${pct(s)}%`, width: `${Math.max(0, pct(e) - pct(s))}%` }}
        />
        <span
          className="gf-trim-handle"
          style={{ left: `${pct(s)}%` }}
          title="Drag to set the start"
          onPointerDown={drag("s")}
        />
        <span
          className="gf-trim-handle"
          style={{ left: `${pct(e)}%` }}
          title="Drag to set the end"
          onPointerDown={drag("e")}
        />
      </div>
      <div className="gf-trim-times">
        <span>
          {dur > 0
            ? `${fmtSecs(s)} – ${fmtSecs(e)} · plays ${fmtSecs(Math.max(0, e - s))}`
            : "Loading clip…"}
        </span>
        {trimmed && (
          <button
            className="gf-layout-reset"
            onClick={() => onChange(undefined, undefined)}
          >
            Full clip
          </button>
        )}
      </div>
    </div>
  );
}

function LayoutPanel({
  style,
  img,
  defaultHeading,
  sel,
  setSel,
  onSet,
}: {
  style: SlideStyle;
  /** The focal image — for the details inputs' derived defaults. */
  img: StoryImage;
  defaultHeading: string;
  sel: SlideElement;
  setSel: (el: SlideElement) => void;
  onSet: (patch: Partial<SlideStyle>) => void;
}) {
  const [collapsed, setCollapsed] = useState(false);
  // Collapse animates; resize must not (a standing width transition freezes
  // in throttled tabs and fights the drag). The class lives ~one animation.
  const [animating, setAnimating] = useState(false);
  const animTimer = useRef<number>(0);
  const toggleCollapsed = () => {
    setAnimating(true);
    setCollapsed((c) => !c);
    window.clearTimeout(animTimer.current);
    animTimer.current = window.setTimeout(() => setAnimating(false), 280);
  };
  // Panel width — drag the right edge; persisted.
  const [panelW, setPanelW] = useState(() => {
    if (typeof window === "undefined") return 300;
    const v = Number(window.localStorage.getItem("gf-layout-width"));
    return Number.isFinite(v) && v >= 240 && v <= 480 ? v : 300;
  });
  const [resizing, setResizing] = useState(false);
  const beginResize = (e: ReactPointerEvent) => {
    e.preventDefault();
    const startX = e.clientX;
    const startW = panelW;
    setResizing(true);
    let live = startW;
    const onMove = (m: PointerEvent) => {
      live = Math.min(480, Math.max(240, startW + (m.clientX - startX)));
      setPanelW(live);
    };
    const onUp = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onUp);
      setResizing(false);
      try {
        window.localStorage.setItem("gf-layout-width", String(Math.round(live)));
      } catch {
        /* noop */
      }
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onUp);
  };
  const derivedCredit = creditOf(img);
  const hasText = style.template !== "plain";
  const hasMedia = style.template !== "quote"; // quote is text-only
  const align = style.align ?? defaultAlign(style.template);
  const framed =
    (style.mediaX ?? 0) !== 0 ||
    (style.mediaY ?? 0) !== 0 ||
    (style.mediaW ?? 100) !== 100 ||
    (style.mediaH ?? 100) !== 100 ||
    (style.cardW ?? 1) !== 1 ||
    (style.cardH ?? 1) !== 1 ||
    (style.cardScale ?? 1) !== 1 ||
    (style.mediaInX ?? 0) !== 0 ||
    (style.mediaInY ?? 0) !== 0 ||
    (style.mediaScale ?? 1) !== 1 ||
    (style.mediaOpacity ?? 1) !== 1 ||
    (style.mediaRadius ?? 0) !== 0;
  const textTouched =
    (style.textX ?? 0) !== 0 ||
    (style.textY ?? 0) !== 0 ||
    (style.textScale ?? 1) !== 1 ||
    style.textAlign !== undefined ||
    style.textColor !== undefined ||
    (style.textOpacity ?? 1) !== 1 ||
    style.lineHeight !== undefined ||
    style.letterSpacing !== undefined ||
    style.fontWeight !== undefined;
  // The selected chip falls back sensibly when a template lacks the element.
  const effSel: SlideElement =
    sel === "text" && !hasText
      ? "background"
      : sel === "media" && !hasMedia
        ? "background"
        : sel;
  const fontValue =
    style.font === "sans"
      ? "geist"
      : style.font && style.font !== "serif"
        ? style.font
        : "libre";

  return (
    <div
      className={`gf-layout-wrap${collapsed ? " is-collapsed" : ""}${
        resizing ? " is-resizing" : ""
      }${animating ? " is-animating" : ""}`}
      style={{ width: collapsed ? 56 : panelW }}
    >
      {!collapsed && (
        <button
          type="button"
          className="gf-layout-resize"
          aria-label="Resize panel"
          title="Drag to resize"
          onPointerDown={beginResize}
        />
      )}
      <div className="gf-layout-side">
        {/* Pinned header: collapse chevron + element tabs stay put on scroll */}
        <div className="gf-layout-head">
          <button
            className="gf-layout-toggle"
            onClick={toggleCollapsed}
            aria-expanded={!collapsed}
            aria-label={collapsed ? "Expand layout" : "Collapse layout"}
          >
            <ChevronLeftIcon
              size={15}
              style={{ transform: collapsed ? "rotate(180deg)" : "none" }}
            />
          </button>
          {!collapsed && (
            <div
              className="gf-seg gf-layout-seg gf-insp-chips"
              aria-label="Selected element"
            >
              {hasText && (
                <button
                  className={effSel === "text" ? "is-active" : ""}
                  onClick={() => setSel("text")}
                >
                  Text
                </button>
              )}
              {hasMedia && (
                <button
                  className={effSel === "media" ? "is-active" : ""}
                  onClick={() => setSel("media")}
                >
                  Image
                </button>
              )}
              <button
                className={effSel === "background" ? "is-active" : ""}
                onClick={() => setSel("background")}
              >
                Backdrop
              </button>
            </div>
          )}
        </div>
        {!collapsed && (
          <>
            <div className="gf-layout-section is-first">
              <div className="gf-layout-grouplabel">Template</div>
              <div className="gf-layout-thumbs">
                {TEMPLATES.map((t) => (
                  <button
                    key={t.id}
                    className={`gf-layout-thumb${
                      style.template === t.id ? " is-active" : ""
                    }`}
                    onClick={() => onSet({ template: t.id })}
                  >
                    <SlideThumb template={t.id} />
                    <span className="gf-layout-thumb-label">{t.label}</span>
                  </button>
                ))}
              </div>
            </div>

            {effSel === "text" && hasText && (
              <>
                <div className="gf-layout-edit gf-layout-section">
                  <div className="gf-layout-grouplabel gf-layout-sublabel">
                    Content
                  </div>
                  <input
                    className="gf-layout-input"
                    value={style.heading ?? defaultHeading}
                    placeholder={
                      style.template === "quote" ? "Quote…" : "Heading…"
                    }
                    onChange={(e) =>
                      // Typing here resets per-word styling (the rich sidecar).
                      onSet({ heading: e.target.value, headingHtml: undefined })
                    }
                  />
                  <input
                    className="gf-layout-input"
                    value={style.body ?? ""}
                    placeholder={
                      style.template === "quote" ? "Citation…" : "Description…"
                    }
                    onChange={(e) =>
                      onSet({ body: e.target.value, bodyHtml: undefined })
                    }
                  />
                  <div className="gf-layout-hint">
                    Double-click text on the slide to edit it in place; select
                    words for per-word font and style.
                  </div>
                </div>

                <div className="gf-layout-edit gf-layout-section">
                  <div className="gf-layout-grouplabel gf-layout-sublabel">
                    Typography
                  </div>
                  <select
                    className="gf-layout-select"
                    aria-label="Font"
                    value={fontValue}
                    onChange={(e) => onSet({ font: e.target.value })}
                  >
                    {ENGINE_FONTS.map((f) => (
                      <option key={f.id} value={f.id}>
                        {f.label}
                      </option>
                    ))}
                  </select>
                  <div className="gf-insp-row">
                    <NumField
                      label="Size"
                      value={style.textScale ?? 1}
                      step={0.05}
                      min={0.5}
                      max={2.5}
                      suffix="×"
                      onChange={(v) => onSet({ textScale: v })}
                    />
                    <select
                      className="gf-layout-select gf-layout-weightsel"
                      aria-label="Heading weight"
                      value={String(style.fontWeight ?? 600)}
                      onChange={(e) =>
                        onSet({ fontWeight: Number(e.target.value) })
                      }
                    >
                      {RICH_WEIGHTS.map((w) => (
                        <option key={w.value} value={w.value}>
                          {w.label}
                        </option>
                      ))}
                      {![300, 400, 500, 600, 700, 800].includes(
                        style.fontWeight ?? 600,
                      ) && (
                        <option value={String(style.fontWeight)}>
                          {style.fontWeight}
                        </option>
                      )}
                    </select>
                  </div>
                  <div className="gf-insp-row">
                    <NumField
                      label="Line"
                      value={style.lineHeight ?? 1}
                      step={0.05}
                      min={0.7}
                      max={2}
                      suffix="×"
                      onChange={(v) => onSet({ lineHeight: v })}
                    />
                    <NumField
                      label="Track"
                      value={style.letterSpacing ?? 0}
                      step={0.005}
                      min={-0.1}
                      max={0.3}
                      suffix="em"
                      onChange={(v) => onSet({ letterSpacing: v })}
                    />
                  </div>
                  <div className="gf-layout-controls">
                    <div
                      className="gf-seg gf-layout-seg"
                      aria-label="Text alignment"
                    >
                      {(["left", "center", "right"] as const).map((a) => (
                        <button
                          key={a}
                          className={
                            (style.textAlign ?? "") === a ? "is-active" : ""
                          }
                          onClick={() => onSet({ textAlign: a })}
                        >
                          {a === "left" ? "L" : a === "center" ? "C" : "R"}
                        </button>
                      ))}
                    </div>
                    <div
                      className="gf-seg gf-layout-seg"
                      aria-label="Placement"
                    >
                      {(["top", "center", "bottom"] as const).map((a) => (
                        <button
                          key={a}
                          className={align === a ? "is-active" : ""}
                          onClick={() => onSet({ align: a })}
                        >
                          {a === "top" ? "Top" : a === "center" ? "Mid" : "Btm"}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>

                <div className="gf-layout-edit gf-layout-section">
                  <div className="gf-layout-grouplabel gf-layout-sublabel">
                    Position · or drag the text on the slide
                  </div>
                  <div className="gf-insp-row">
                    <NumField
                      label="X"
                      value={style.textX ?? 0}
                      min={-400}
                      max={400}
                      suffix="%"
                      onChange={(v) => onSet({ textX: v })}
                    />
                    <NumField
                      label="Y"
                      value={style.textY ?? 0}
                      min={-400}
                      max={400}
                      suffix="%"
                      onChange={(v) => onSet({ textY: v })}
                    />
                  </div>
                </div>

                <div className="gf-layout-edit gf-layout-section">
                  <div className="gf-layout-grouplabel gf-layout-sublabel">
                    Appearance
                  </div>
                  <div className="gf-insp-colorrow">
                    <label
                      className="gf-color-swatch"
                      style={{ background: style.textColor || "#ffffff" }}
                      title="Text color"
                    >
                      <input
                        type="color"
                        value={style.textColor || "#ffffff"}
                        onChange={(e) => onSet({ textColor: e.target.value })}
                      />
                    </label>
                    <NumField
                      label="Opacity"
                      value={Math.round((style.textOpacity ?? 1) * 100)}
                      min={0}
                      max={100}
                      suffix="%"
                      onChange={(v) => onSet({ textOpacity: v / 100 })}
                    />
                  </div>
                  <button
                    className="gf-layout-reset gf-layout-resetwide"
                    disabled={!textTouched}
                    onClick={() =>
                      onSet({
                        textX: 0,
                        textY: 0,
                        textScale: 1,
                        textAlign: undefined,
                        textColor: undefined,
                        textOpacity: 1,
                        lineHeight: undefined,
                        letterSpacing: undefined,
                        fontWeight: undefined,
                      })
                    }
                  >
                    Reset text styling
                  </button>
                </div>
              </>
            )}

            {effSel === "media" && hasMedia && (
              <>
                <div className="gf-layout-edit gf-layout-section">
                  <div className="gf-layout-grouplabel gf-layout-sublabel">
                    Position · or drag the image on the slide
                  </div>
                  <div className="gf-insp-row">
                    <NumField
                      label="X"
                      value={style.mediaX ?? 0}
                      min={-120}
                      max={120}
                      suffix="%"
                      onChange={(v) => onSet({ mediaX: v })}
                    />
                    <NumField
                      label="Y"
                      value={style.mediaY ?? 0}
                      min={-120}
                      max={120}
                      suffix="%"
                      onChange={(v) => onSet({ mediaY: v })}
                    />
                  </div>
                  <div className="gf-insp-row">
                    <NumField
                      label="W"
                      value={style.mediaW ?? 100}
                      min={20}
                      max={320}
                      suffix="%"
                      onChange={(v) => onSet({ mediaW: v })}
                    />
                    <NumField
                      label="H"
                      value={style.mediaH ?? 100}
                      min={20}
                      max={320}
                      suffix="%"
                      onChange={(v) => onSet({ mediaH: v })}
                    />
                  </div>
                </div>

                <div className="gf-layout-edit gf-layout-section">
                  <div className="gf-layout-grouplabel gf-layout-sublabel">
                    Inside the box · ↖ zooms · ↙ pans
                  </div>
                  <div className="gf-insp-row">
                    <NumField
                      label="Zoom"
                      value={style.mediaScale ?? 1}
                      step={0.05}
                      min={0.4}
                      max={4}
                      suffix="×"
                      onChange={(v) => onSet({ mediaScale: v })}
                    />
                    <NumField
                      label="Pan X"
                      value={style.mediaInX ?? 0}
                      min={-50}
                      max={50}
                      suffix="%"
                      onChange={(v) => onSet({ mediaInX: v })}
                    />
                  </div>
                  <div className="gf-insp-row">
                    <NumField
                      label="Pan Y"
                      value={style.mediaInY ?? 0}
                      min={-50}
                      max={50}
                      suffix="%"
                      onChange={(v) => onSet({ mediaInY: v })}
                    />
                    <NumField
                      label="Radius"
                      value={style.mediaRadius ?? 0}
                      min={0}
                      max={80}
                      suffix="px"
                      onChange={(v) => onSet({ mediaRadius: v })}
                    />
                  </div>
                  <div className="gf-insp-row">
                    <NumField
                      label="Opacity"
                      value={Math.round((style.mediaOpacity ?? 1) * 100)}
                      min={0}
                      max={100}
                      suffix="%"
                      onChange={(v) => onSet({ mediaOpacity: v / 100 })}
                    />
                    <button
                      className="gf-layout-reset"
                      disabled={!framed}
                      onClick={() =>
                        onSet({
                          mediaX: 0,
                          mediaY: 0,
                          mediaW: 100,
                          mediaH: 100,
                          mediaInX: 0,
                          mediaInY: 0,
                          mediaScale: 1,
                          mediaOpacity: 1,
                          mediaRadius: 0,
                          cardW: 1,
                          cardH: 1,
                          cardScale: 1,
                        })
                      }
                    >
                      Reset framing
                    </button>
                  </div>
                </div>

                {img.mediaType === "video" && (
                  <div className="gf-layout-edit gf-layout-section">
                    <div className="gf-layout-grouplabel gf-layout-sublabel">
                      Trim
                    </div>
                    <TrimBar
                      url={img.url}
                      start={style.mediaStart}
                      end={style.mediaEnd}
                      onChange={(startV, endV) =>
                        onSet({ mediaStart: startV, mediaEnd: endV })
                      }
                    />
                  </div>
                )}

                <div className="gf-layout-edit gf-layout-section">
                  <div className="gf-layout-grouplabel gf-layout-sublabel">
                    Image details
                  </div>
                  <div className="gf-layout-controls">
                    <div
                      className="gf-seg gf-layout-seg"
                      aria-label="Image details under the picture"
                      title="Show the image's description and source citation under the picture"
                    >
                      <button
                        className={!style.credit ? "is-active" : ""}
                        onClick={() => onSet({ credit: undefined })}
                      >
                        No details
                      </button>
                      <button
                        className={style.credit ? "is-active" : ""}
                        onClick={() => onSet({ credit: true })}
                      >
                        Details
                      </button>
                    </div>
                  </div>
                  {style.credit && (
                    <>
                      <input
                        className="gf-layout-input"
                        value={style.creditText ?? derivedCredit?.text ?? ""}
                        placeholder="Details text…"
                        onChange={(e) => onSet({ creditText: e.target.value })}
                      />
                      <input
                        className="gf-layout-input"
                        value={
                          style.creditSource ?? derivedCredit?.source ?? ""
                        }
                        placeholder="Source / citation…"
                        onChange={(e) =>
                          onSet({ creditSource: e.target.value })
                        }
                      />
                    </>
                  )}
                </div>
              </>
            )}

            {effSel === "background" && (
              <div className="gf-layout-edit gf-layout-section">
                <div className="gf-layout-grouplabel gf-layout-sublabel">
                  Background
                </div>
                <div className="gf-layout-bgrow">
                  <div className="gf-seg gf-layout-seg" aria-label="Background">
                    <button
                      className={!style.bgMode ? "is-active" : ""}
                      onClick={() => onSet({ bgMode: undefined })}
                    >
                      Default
                    </button>
                    <button
                      className={style.bgMode === "color" ? "is-active" : ""}
                      onClick={() =>
                        onSet({
                          bgMode: "color",
                          bgColor: style.bgColor ?? "#1c1c1f",
                        })
                      }
                    >
                      Color
                    </button>
                    <button
                      className={style.bgMode === "blur" ? "is-active" : ""}
                      onClick={() => onSet({ bgMode: "blur" })}
                    >
                      Blur image
                    </button>
                  </div>
                  <label
                    className="gf-color-swatch"
                    style={{ background: style.bgColor || "#1c1c1f" }}
                    title="Pick a background color (switches background to Color)"
                  >
                    <input
                      type="color"
                      value={style.bgColor || "#1c1c1f"}
                      onChange={(e) =>
                        onSet({ bgColor: e.target.value, bgMode: "color" })
                      }
                    />
                  </label>
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}

/* ─── Thumbnail reorder strip ────────────────────────────────────────── */

function ThumbStrip({
  story,
  images,
  selectedIds,
  focal,
  jumpTo,
  reorder,
  onToggle,
}: {
  story: Story;
  images: StoryImage[];
  selectedIds: string[];
  focal: number;
  jumpTo: (index: number) => void;
  reorder: (next: string[]) => void;
  /** Select/unselect an image for the carousel, right from this view. */
  onToggle: (imageId: string) => void;
}) {
  const [activeId, setActiveId] = useState<string | null>(null);
  const [trayOpen, setTrayOpen] = useState(false);
  const selectedSet = new Set(selectedIds);
  const unselected = story.images.filter((i) => !selectedSet.has(i.id));
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
  );

  function onDragEnd(e: DragEndEvent) {
    setActiveId(null);
    const { active, over } = e;
    if (!over || active.id === over.id) return;
    const from = selectedIds.indexOf(String(active.id));
    const to = selectedIds.indexOf(String(over.id));
    if (from === -1 || to === -1) return;
    const focalId = images[focal]?.id;
    const next = arrayMove(selectedIds, from, to);
    reorder(next);
    // Keep the same image focal after the reorder.
    if (focalId) {
      const ni = next.indexOf(focalId);
      if (ni >= 0) jumpTo(ni);
    }
  }

  const activeImg = activeId
    ? story.images.find((i) => i.id === activeId)
    : undefined;

  return (
    <div className="gf-thumbs-wrap">
      <DndContext
        sensors={sensors}
        collisionDetection={closestCenter}
        onDragStart={(e) => setActiveId(String(e.active.id))}
        onDragEnd={onDragEnd}
        onDragCancel={() => setActiveId(null)}
      >
        <SortableContext items={selectedIds} strategy={horizontalListSortingStrategy}>
          <div className="gf-thumbs">
            {images.map((img, i) => (
              <SortableThumb
                key={img.id}
                img={img}
                number={i + 1}
                focal={i === focal}
                onJump={() => jumpTo(i)}
                onRemove={() => onToggle(img.id)}
              />
            ))}
            <div className="gf-thumb-addwrap">
              <button
                type="button"
                className={`gf-thumb gf-thumb-add${trayOpen ? " is-open" : ""}`}
                aria-label="Add images to the carousel"
                aria-expanded={trayOpen}
                title="Add images from this story"
                onClick={() => setTrayOpen((o) => !o)}
              >
                <PlusIcon size={16} />
              </button>
              {trayOpen && (
                <>
                  <button
                    className="gf-filter-backdrop"
                    aria-label="Close"
                    onClick={() => setTrayOpen(false)}
                  />
                  <div className="gf-thumb-tray" role="menu">
                    {unselected.length === 0 && (
                      <p className="gf-thumb-tray-empty">
                        Every image is already in the carousel.
                      </p>
                    )}
                    <div className="gf-thumb-tray-grid">
                      {unselected.slice(0, 60).map((img) => (
                        <button
                          key={img.id}
                          type="button"
                          className="gf-thumb-tray-tile"
                          title={img.description || "Add to carousel"}
                          onClick={() => onToggle(img.id)}
                        >
                          {img.mediaType === "video" ? (
                            <video src={img.url} crossOrigin="anonymous" muted playsInline preload="metadata" />
                          ) : (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img
                              src={proxied(img.url)}
                              alt=""
                              loading="lazy"
                              referrerPolicy="no-referrer"
                            />
                          )}
                        </button>
                      ))}
                    </div>
                  </div>
                </>
              )}
            </div>
          </div>
        </SortableContext>
        <DragOverlay>
          {activeImg ? (
            <div className="gf-drag-overlay" style={{ width: 54, height: 54 }}>
              {activeImg.mediaType === "video" ? (
                <video src={activeImg.url} crossOrigin="anonymous" muted playsInline preload="metadata" />
              ) : (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={proxied(activeImg.url)} alt="" referrerPolicy="no-referrer" />
              )}
            </div>
          ) : null}
        </DragOverlay>
      </DndContext>
    </div>
  );
}

function SortableThumb({
  img,
  number,
  focal,
  onJump,
  onRemove,
}: {
  img: StoryImage;
  number: number;
  focal: boolean;
  onJump: () => void;
  onRemove: () => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id: img.id });
  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  };
  return (
    <div
      ref={setNodeRef}
      style={style}
      className={`gf-thumb${focal ? " is-focal" : ""}${isDragging ? " is-dragging" : ""}`}
      onClick={onJump}
      {...attributes}
      {...listeners}
    >
      {img.mediaType === "video" ? (
        <video src={img.url} crossOrigin="anonymous" muted playsInline preload="metadata" />
      ) : (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={proxied(img.url)} alt="" draggable={false} />
      )}
      <span className="gf-thumb-num">{number}</span>
      <button
        type="button"
        className="gf-thumb-x"
        aria-label="Remove from carousel"
        title="Remove from carousel"
        onPointerDown={(e) => e.stopPropagation() /* don't start a drag */}
        onClick={(e) => {
          e.stopPropagation();
          onRemove();
        }}
      >
        <CloseIcon size={10} />
      </button>
    </div>
  );
}

/* ─── Share actions (rendered in the detail dock, Instagram view) ─────── */

// The exported PNG matches the preview card exactly. Render the slide at the
// card width (so the CSS proportions match the preview) and capture at a scale
// that lands on Instagram's 1080×1350 (4:5).
const EXPORT_W = 340;
const EXPORT_SCALE = 1080 / EXPORT_W;

function slugify(s: string): string {
  return (
    (s || "slide")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "")
      .slice(0, 48) || "slide"
  );
}

function saveBlob(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function ShareActions({
  caption,
  images,
  storyId,
  focalId,
  onHandoff,
}: {
  caption: string;
  images: StoryImage[];
  storyId: string;
  /** The image currently shown in the preview card — for "download slide". */
  focalId: string | null;
  onHandoff: () => void;
}) {
  const { getSlideStyle, getStory } = useEngine();
  const story = getStory(storyId);
  const [copied, setCopied] = useState(false);
  const [busy, setBusy] = useState<null | "all" | "one">(null);
  const [recPct, setRecPct] = useState(0);
  // After a video export, a short note on whether the clip's sound made it in.
  const [exportNote, setExportNote] = useState<string | null>(null);
  // The job snapshots everything the export reads (title for filenames,
  // caption for the zip) so the effect depends ONLY on the job. Depending on
  // live store objects restarted the export mid-run: the auto-stories poll
  // rebuilds `story` every 10–30s, which cancelled long (video) exports
  // forever — the "percentage bouncing, nothing downloads" bug.
  const [job, setJob] = useState<{
    slides: StoryImage[];
    mode: "zip" | "single" | "video";
    title: string;
    caption: string;
  } | null>(null);
  const exportRef = useRef<HTMLDivElement | null>(null);
  const empty = images.length === 0;

  async function copyAndOpen() {
    try {
      await navigator.clipboard.writeText(caption);
    } catch {
      /* clipboard blocked */
    }
    onHandoff();
    setCopied(true);
    setTimeout(() => setCopied(false), 2400);
    window.open("https://www.instagram.com/", "_blank", "noopener,noreferrer");
  }

  // Render the chosen slides into hidden full-res frames, capture each as a PNG
  // that matches the Instagram preview exactly (template + text + media edits +
  // background), then download — one slide, or all of them zipped.
  useEffect(() => {
    if (!job) return;
    let cancelled = false;
    (async () => {
      try {
        const container = exportRef.current;
        if (!container) return;
        // Wait for every image in the frames to finish loading.
        const imgs = Array.from(container.querySelectorAll("img"));
        await Promise.all(
          imgs.map((im) =>
            im.complete && im.naturalWidth
              ? Promise.resolve()
              : new Promise<void>((res) => {
                  im.addEventListener("load", () => res(), { once: true });
                  im.addEventListener("error", () => res(), { once: true });
                }),
          ),
        );
        await new Promise((r) => setTimeout(r, 70)); // let layout/fonts settle
        if (cancelled) return;
        const frames = Array.from(
          container.querySelectorAll<HTMLElement>(".gf-export-frame"),
        );
        if (job.mode === "video") {
          // Composited video: static layers + the playing clip, recorded in
          // realtime (a 6s clip takes ~6s). Geometry comes from the live DOM.
          const { exportSlideVideo } = await import(
            "@/lib/engine/export-video"
          );
          const { blob, ext, audioNote } = await exportSlideVideo(frames[0], {
            onProgress: (p) => setRecPct(Math.round(p * 100)),
          });
          if (!cancelled && blob.size > 0) {
            saveBlob(blob, `${slugify(job.title)}.${ext}`);
            if (audioNote) setExportNote(audioNote);
          }
          return;
        }
        const { domToBlob } = await import("modern-screenshot");
        const base = slugify(job.title);
        const total = frames.length;
        // Video slides export as composited VIDEO inside the zip, not stills.
        const hasVideo = job.slides.some((s) => s.mediaType === "video");
        const videoMod = hasVideo
          ? await import("@/lib/engine/export-video")
          : null;
        const outs: Array<{ name: string; blob: Blob }> = [];
        for (let i = 0; i < frames.length; i++) {
          if (cancelled) return;
          const num = String(i + 1).padStart(2, "0");
          if (job.slides[i]?.mediaType === "video" && videoMod) {
            const { blob, ext, audioNote } = await videoMod.exportSlideVideo(
              frames[i],
              {
                onProgress: (p) =>
                  setRecPct(Math.round(((i + p) / total) * 100)),
              },
            );
            if (audioNote) setExportNote(audioNote);
            if (blob.size > 0)
              outs.push({ name: `${num}-${base}.${ext}`, blob });
          } else {
            const blob = await domToBlob(frames[i], {
              scale: EXPORT_SCALE,
              type: "image/jpeg",
              quality: 0.95,
              backgroundColor: "#000",
            });
            if (blob) outs.push({ name: `${num}-${base}.jpg`, blob });
          }
          setRecPct(Math.round(((i + 1) / total) * 100));
        }
        if (cancelled || !outs.length) return;
        if (job.mode === "single") {
          const ext = outs[0].name.split(".").pop();
          saveBlob(outs[0].blob, `${base}.${ext}`);
        } else {
          const JSZip = (await import("jszip")).default;
          const zip = new JSZip();
          for (const o of outs) zip.file(o.name, o.blob);
          // The caption rides along, paste-ready for the IG composer.
          if (job.caption.trim())
            zip.file("caption.txt", job.caption.trim() + "\n");
          const zipped = await zip.generateAsync({ type: "blob" });
          saveBlob(zipped, `${base}-carousel.zip`);
        }
      } catch {
        /* capture failed — nothing downloaded */
      } finally {
        if (!cancelled) {
          setJob(null);
          setBusy(null);
          setRecPct(0);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [job]);

  function downloadAll() {
    if (empty || busy || !story) return;
    setBusy("all");
    setJob({ slides: images, mode: "zip", title: story.title, caption });
  }
  function downloadOne() {
    if (empty || busy) return;
    const img = images.find((i) => i.id === focalId) ?? images[0];
    if (!img) return;
    setBusy("one");
    setJob({
      slides: [img],
      mode: img.mediaType === "video" ? "video" : "single",
      title: story?.title ?? "slide",
      caption,
    });
  }

  // The audio note lingers a few seconds after an export, then fades.
  useEffect(() => {
    if (!exportNote) return;
    const t = setTimeout(() => setExportNote(null), 9000);
    return () => clearTimeout(t);
  }, [exportNote]);

  return (
    <>
      <button
        className="gf-btn gf-btn-solid gf-btn-icon"
        onClick={copyAndOpen}
        disabled={empty}
        title="Copy the caption and open Instagram to paste it"
      >
        <ShareIcon size={14} />
        {copied ? "Copied — opening IG" : "Copy + open IG"}
      </button>
      <button
        className="gf-btn gf-btn-icon"
        onClick={downloadOne}
        disabled={busy !== null || empty}
        title="Download just the slide shown in the preview, with your edits (video slides export as video)"
      >
        <DownloadIcon />
        {busy === "one"
          ? job?.mode === "video"
            ? `Exporting… ${recPct}%`
            : "Rendering…"
          : (images.find((i) => i.id === focalId) ?? images[0])?.mediaType ===
              "video"
            ? "Download video"
            : "Download slide"}
      </button>
      <button
        className="gf-btn gf-btn-icon"
        onClick={downloadAll}
        disabled={busy !== null || empty}
        title="Download all selected slides, with your edits, as one .zip"
      >
        <DownloadIcon />
        {busy === "all" ? `Exporting… ${recPct}%` : "Download all (.zip)"}
      </button>

      {exportNote && (
        <span
          className="gf-export-note"
          title="Audio status of the last video export"
        >
          {exportNote === "sound included" ? "🔊 " : "🔇 "}
          {exportNote}
        </span>
      )}

      {job && story && (
        <div className="gf-export-layer" ref={exportRef} aria-hidden>
          {job.slides.map((img) => (
            <div className="gf-export-frame" key={img.id}>
              <SlideFrame
                img={img}
                style={getSlideStyle(storyId, img.id)}
                story={story}
                gallery={images}
                index={images.findIndex((i) => i.id === img.id)}
              />
            </div>
          ))}
        </div>
      )}
    </>
  );
}
