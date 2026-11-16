"use client";

import { EditorIcon } from "./editor-icons";
import { PaintPicker } from "./paint-picker";
import { RangeRow, ToolbarPopover } from "./text-format-bar";
import type { InspectorSection } from "./element-inspector";
import { IMAGE_BORDER_STYLES, MEDIA_ADJUSTMENTS, VIDEO_FADE_MAX, VIDEO_SPEED_RANGE, VIDEO_VOLUME_MAX, type CanvasElement, type ImageBorder, type ImageElement, type VideoClip } from "@/lib/template-editor/model";
import { CROP_ASPECTS, cropToAspect, flipElement, setImageBorder, type CropAspect } from "@/lib/template-editor/style-commands";
import { photoContent } from "@/lib/template-editor/photo-frames";
import { mediaLook } from "@/lib/template-editor/media-looks";
import { MediaLooksPanel } from "./media-looks-panel";
import { setVideoPlaying, stopVideo, useVideoPlaying } from "./video-player";

type Update = (transform: (element: CanvasElement) => CanvasElement, property?: "style" | "content" | "position", group?: string) => void;

type Props = {
  /** The selected photo and video layers (image layers, or shapes with a photo fill). */
  photos: CanvasElement[];
  disabled: boolean;
  /** The template fixes the look: controls stay visible but disabled, with this reason. */
  fixed?: string;
  outputScale: number;
  update: Update;
  onInspect?: (section: InspectorSection) => void;
};

const BORDER_LABELS: Record<ImageBorder["style"] | "none", string> = { none: "No border", solid: "Solid", "long-dash": "Long dashes", "short-dash": "Short dashes", dots: "Dots" };
const ASPECT_LABELS: Record<CropAspect, string> = { original: "Original", "1:1": "Square 1:1", "4:5": "Portrait 4:5", "3:4": "Portrait 3:4", "16:9": "Wide 16:9", "9:16": "Tall 9:16" };
const SPEEDS = [0.5, 1, 1.5, 2] as const;

const same = <T,>(values: T[]) => values.length && values.every(value => JSON.stringify(value) === JSON.stringify(values[0])) ? values[0] : undefined;
const round = (value: number, places = 2) => Number(value.toFixed(places));

/** The played length of a clip: its trim at its speed. */
export function playedSeconds(clip: VideoClip) {
  return Math.max(0, ((clip.end ?? clip.duration) - (clip.start ?? 0)) / (clip.speed ?? 1));
}

/** Play or pause, and Stop, for one clip on the canvas. Every clip starts stopped when the
 * editor opens; playback is this tab's only, not part of the design. */
export function VideoPlayback({ layerId }: { layerId: string }) {
  const playing = useVideoPlaying(layerId);
  const hold = (event: { preventDefault: () => void }) => event.preventDefault();
  return <>
    <button type="button" className="te-format-button" aria-label={playing ? "Pause" : "Play"} title={playing ? "Pause" : "Play"} aria-pressed={playing} onMouseDown={hold} onClick={() => setVideoPlaying(layerId, !playing)}><EditorIcon name={playing ? "pause" : "play"} /></button>
    <button type="button" className="te-format-button" aria-label="Stop" title="Stop and go back to the start" onMouseDown={hold} onClick={() => stopVideo(layerId)}><EditorIcon name="stop" /></button>
  </>;
}

/** Photo and video controls on the selection toolbar, after Canva's: filters, adjust, border,
 * corners, flip, transparency and crop shape, plus trim, volume and speed for a
 * clip. Each runs a named command from style-commands.ts or sets a field the
 * agent API also sets. */
export function MediaToolbar({ photos, disabled, fixed, outputScale, update, onInspect }: Props) {
  const images = photos.filter((element): element is ImageElement => element.type === "image");
  const off = disabled || Boolean(fixed);
  const hold = (event: { preventDefault: () => void }) => event.preventDefault();
  const border = same(images.map(element => element.border ?? null));
  const borderStyle = images.length ? border === undefined ? undefined : border?.style ?? "none" : undefined;
  const borderWidth = border ? round(border.width * outputScale, 1) : border === null ? 0 : undefined;
  const opacity = same(photos.map(element => Math.round(element.opacity * 100)));
  const corner = same(images.map(element => Math.round(Math.min(100, element.radius / Math.max(1, Math.min(element.width, element.height) / 2) * 100))));
  const clips = images.flatMap(element => element.video ? [element.video] : []);
  const clip = clips.length === 1 && images.length === 1 ? clips[0] : undefined;
  const patchBorder = (patch: Partial<ImageBorder>) => update(element => {
    if (element.type !== "image") return element;
    const base: ImageBorder = element.border ?? { style: "solid", width: 4 / outputScale, color: "#FFFFFF" };
    return setImageBorder(element, { ...base, ...patch });
  }, "style", "image-border");
  const patchClip = (patch: Partial<VideoClip>, group: string) => update(element => {
    const photo = photoContent(element);
    if (element.type !== "image" || !photo?.video) return element;
    return { ...element, video: { ...element.video!, ...patch } };
  }, "content", group);
  // Play and Stop for one selected clip (a video layer or a shape filled with one).
  const videoLayer = photos.length === 1 && photoContent(photos[0])?.video ? photos[0].id : undefined;
  const looks = photos.map(element => mediaLook(element));
  const lookUpdate = (group: string, transform: (element: CanvasElement) => CanvasElement) => update(transform, "style", group);
  return <>
    {videoLayer && <><VideoPlayback layerId={videoLayer} /><span className="te-format-sep" aria-hidden="true" /></>}
    <ToolbarPopover label="Filters" icon="filters" disabled={off} title={fixed ?? "Filters"} pressed={looks.some(look => look?.filter)} wide>
      <MediaLooksPanel photos={photos} disabled={off} update={lookUpdate} part="filters" />
    </ToolbarPopover>
    <ToolbarPopover label="Adjust" icon="adjust" disabled={off} title={fixed ?? "Adjust"} pressed={looks.some(look => MEDIA_ADJUSTMENTS.some(key => look?.[key]))}>
      <MediaLooksPanel photos={photos} disabled={off} update={lookUpdate} part="adjust" />
    </ToolbarPopover>
    {images.length > 0 && <ToolbarPopover label="Border" icon="border" disabled={off} title={fixed ?? "Border"} pressed={Boolean(border)}>
      <div className="te-format-choices" role="group" aria-label="Border style">
        {(["none", ...IMAGE_BORDER_STYLES] as const).map(style => <button key={style} type="button" aria-pressed={borderStyle === style} onClick={() => style === "none" ? update(element => setImageBorder(element, null), "style", "image-border") : patchBorder({ style })}>
          <BorderSwatch style={style} />{BORDER_LABELS[style]}
        </button>)}
      </div>
      <RangeRow label="Border weight" min={0} max={100} step={1} value={borderWidth} onChange={value => value === 0 ? update(element => setImageBorder(element, null), "style", "image-border") : patchBorder({ width: value / outputScale })} />
      <div className="te-format-inline">
        <span>Border color</span>
        <PaintPicker key={`border-color:${images.map(element => element.id).join(":")}`} label="Border color" compact allowGradient={false} value={border ? { type: "solid", color: border.color } : undefined} disabled={off} onChange={paint => { if (paint.type === "solid") patchBorder({ color: paint.color }); }} />
      </div>
    </ToolbarPopover>}
    {images.length > 0 && <ToolbarPopover label="Corner rounding" icon="corners" disabled={off} title={fixed ?? "Corner rounding"}>
      <RangeRow label="Corner rounding" min={0} max={100} step={1} value={corner} onChange={value => update(element => element.type === "image" ? { ...element, radius: value / 100 * Math.min(element.width, element.height) / 2 } : element, "style", "image-corners")} />
    </ToolbarPopover>}
    <ToolbarPopover label="Crop shape" icon="ratio" disabled={disabled} title="Crop to a shape">
      <div className="te-format-choices" role="group" aria-label="Crop shape">
        {CROP_ASPECTS.map(aspect => <button key={aspect} type="button" onClick={() => { try { update(element => cropToAspect(element, aspect), "position", "crop-aspect"); } catch { /* Original without a known size: the button below explains. */ } }} disabled={aspect === "original" && !photos.every(element => { const photo = photoContent(element); return photo?.video || photo?.intrinsicWidth && photo.intrinsicHeight; })}>{ASPECT_LABELS[aspect]}</button>)}
      </div>
    </ToolbarPopover>
    <ToolbarPopover label="Flip" icon="flip" disabled={off} title={fixed ?? "Flip"}>
      <div className="te-format-choices" role="group" aria-label="Flip">
        <button type="button" onMouseDown={hold} onClick={() => update(element => flipElement(element, "horizontal"), "style", "flip-horizontal")}>Flip horizontal</button>
        <button type="button" onMouseDown={hold} onClick={() => update(element => flipElement(element, "vertical"), "style", "flip-vertical")}>Flip vertical</button>
      </div>
    </ToolbarPopover>
    <ToolbarPopover label="Transparency" icon="transparency" disabled={off} title={fixed ?? "Transparency"}>
      <RangeRow label="Transparency" min={0} max={100} step={1} value={opacity} onChange={value => update(element => ({ ...element, opacity: value / 100 }), "style", "opacity")} />
    </ToolbarPopover>
    {clip && <>
      <span className="te-format-sep" aria-hidden="true" />
      <button type="button" className="te-format-button has-text" aria-label={`Trim: plays ${playedSeconds(clip).toFixed(1)} seconds`} title="Trim" disabled={disabled} onClick={() => onInspect?.("photo")}><EditorIcon name="trim" />{playedSeconds(clip).toFixed(1)}s</button>
      <ToolbarPopover label="Volume" icon="volume" disabled={disabled} title="Volume">
        <RangeRow label="Volume (%)" min={0} max={VIDEO_VOLUME_MAX * 100} step={5} value={Math.round((clip.volume ?? 1) * 100)} onChange={value => patchClip({ volume: value / 100 }, "video-volume")} />
        <RangeRow label="Fade in (seconds)" min={0} max={VIDEO_FADE_MAX} step={0.1} value={clip.fadeIn ?? 0} onChange={value => patchClip({ fadeIn: value || undefined }, "video-fade-in")} />
        <RangeRow label="Fade out (seconds)" min={0} max={VIDEO_FADE_MAX} step={0.1} value={clip.fadeOut ?? 0} onChange={value => patchClip({ fadeOut: value || undefined }, "video-fade-out")} />
        <label className="te-format-inline"><span>Play sound in the editor</span><input type="checkbox" checked={clip.muted === false} onChange={event => patchClip({ muted: !event.target.checked }, "video-muted")} /></label>
      </ToolbarPopover>
      <ToolbarPopover label="Speed" icon="speed" text={<span className="te-format-chip-text">{round(clip.speed ?? 1)}×</span>} disabled={disabled} title="Speed">
        <div className="te-format-choices" role="group" aria-label="Speed presets">
          {SPEEDS.map(speed => <button key={speed} type="button" aria-pressed={(clip.speed ?? 1) === speed} onClick={() => patchClip({ speed: speed === 1 ? undefined : speed }, "video-speed")}>{speed}×</button>)}
        </div>
        <RangeRow label="Speed" min={VIDEO_SPEED_RANGE.min} max={VIDEO_SPEED_RANGE.max} step={0.05} value={clip.speed ?? 1} onChange={value => patchClip({ speed: value === 1 ? undefined : value }, "video-speed")} />
      </ToolbarPopover>
    </>}
  </>;
}

function BorderSwatch({ style }: { style: ImageBorder["style"] | "none" }) {
  const dash = style === "long-dash" ? "6 3" : style === "short-dash" ? "2.5 2.5" : style === "dots" ? "0 3.5" : undefined;
  return <svg width="28" height="10" viewBox="0 0 28 10" aria-hidden="true">{style === "none" ? <path d="M4 9 24 1" stroke="currentColor" strokeWidth="1.5" /> : <path d="M2 5h24" stroke="currentColor" strokeWidth="2" strokeDasharray={dash} strokeLinecap={style === "dots" ? "round" : "butt"} />}</svg>;
}
