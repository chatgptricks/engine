"use client";
import {useEffect, useState} from "react";
import {MAX_SLIDE_VIDEO_SECONDS, VIDEO_SPEED_RANGE, VIDEO_VOLUME_MAX, type CanvasElement, type VideoClip} from "@/lib/template-editor/model";
import {clipWindow, coverAt, formatSeconds, loadVideo, seekVideo} from "@/lib/template-editor/client-video";
import {clipSpeed, playWindow} from "@/lib/template-editor/clip-timing";
import {canSplitVideoAt} from "@/lib/template-editor/video-slides";
import {isVideoPaused, setVideoPaused, videoForLayer} from "./video-player";

/** The clip on a layer: an image's own, or the photo in a frame. */
export function layerVideo(element: CanvasElement | undefined): VideoClip | undefined {
  if (!element) return undefined;
  return element.type === "image" ? element.video : element.type === "shape" ? element.imageFill?.video : undefined;
}
/** A layer with its clip changed, or removed with `null` (the cover stays as the photo). */
export function withLayerVideo(element: CanvasElement, video: VideoClip | null, cover?: {src: string; previewSrc: string}): CanvasElement {
  if (element.type === "image") {
    const next = {...element, ...(cover ?? {}), video: video ?? undefined};
    if (!video) delete next.video;
    return next;
  }
  if (element.type === "shape" && element.imageFill) {
    const imageFill = {...element.imageFill, ...(cover ?? {}), video: video ?? undefined};
    if (!video) delete imageFill.video;
    return {...element, imageFill};
  }
  return element;
}

const MIN_LENGTH = 0.5;
const FILMSTRIP_FRAMES = 10;
const FADE_MAX = 5;

/** Small frames across a whole clip, taken once per clip in this tab. */
const filmstrips = new Map<string, Promise<string[]>>();
function filmstrip(clip: VideoClip): Promise<string[]> {
  let frames = filmstrips.get(clip.src);
  if (!frames) {
    frames = (async () => {
      const video = await loadVideo(clip.src);
      try {
        const canvas = document.createElement("canvas"), height = 54;
        canvas.height = height; canvas.width = Math.max(1, Math.round(height * (video.videoWidth || clip.width) / (video.videoHeight || clip.height)));
        const context = canvas.getContext("2d")!;
        const out: string[] = [];
        for (let i = 0; i < FILMSTRIP_FRAMES; i++) {
          await seekVideo(video, (i + 0.5) * clip.duration / FILMSTRIP_FRAMES);
          context.drawImage(video, 0, 0, canvas.width, canvas.height);
          out.push(canvas.toDataURL("image/jpeg", 0.7));
        }
        return out;
      } finally { video.removeAttribute("src"); video.load(); }
    })();
    frames.catch(() => filmstrips.delete(clip.src));
    filmstrips.set(clip.src, frames);
  }
  return frames;
}
function useFilmstrip(clip: VideoClip) {
  const [frames, setFrames] = useState<string[]>([]);
  useEffect(() => { let live = true; filmstrip(clip).then(value => { if (live) setFrames(value); }, () => undefined); return () => { live = false; }; }, [clip]);
  return frames;
}

/** Play, sound, trim, loop and cover for the one selected layer with a clip. Each change is one undo step. */
export function VideoControls({element, disabled, onUpdate, onReplace, onSplit}: {element: CanvasElement; disabled: boolean; onUpdate: (group: string, transform: (element: CanvasElement) => CanvasElement) => void; onReplace?: (file: File) => Promise<void>; onSplit?: (at: number) => Promise<void>}) {
  const clip = layerVideo(element)!;
  const {start, end} = clipWindow(clip);
  const speed = clipSpeed(clip), played = playWindow(clip).length, most = MAX_SLIDE_VIDEO_SECONDS * speed;
  const frames = useFilmstrip(clip);
  const [playing, setPlaying] = useState(!isVideoPaused(element.id));
  const [busy, setBusy] = useState(""), [error, setError] = useState("");
  const [now, setNow] = useState(start);
  useEffect(() => {
    const timer = window.setInterval(() => { const video = videoForLayer(element.id); if (video) setNow(video.currentTime); }, 250);
    return () => window.clearInterval(timer);
  }, [element.id]);
  const setClip = (group: string, patch: Partial<VideoClip>) => onUpdate(group, layer => {
    const current = layerVideo(layer);
    if (!current) return layer;
    const next = {...current, ...patch};
    for (const key of Object.keys(patch) as (keyof VideoClip)[]) if (patch[key] === undefined) delete next[key];
    return withLayerVideo(layer, next);
  });
  const trim = (edge: "start" | "end", value: number) => {
    // A slide plays at most 60 seconds (of slide time): moving one handle past that brings the other along.
    let nextStart = edge === "start" ? Math.min(value, end - MIN_LENGTH) : start;
    let nextEnd = edge === "end" ? Math.max(value, start + MIN_LENGTH) : end;
    if (nextEnd - nextStart > most) { if (edge === "start") nextEnd = nextStart + most; else nextStart = nextEnd - most; }
    setClip("video-trim", {start: nextStart > 0.01 ? Math.round(nextStart * 10) / 10 : undefined, end: nextEnd < clip.duration - 0.01 ? Math.round(nextEnd * 10) / 10 : undefined});
    const video = videoForLayer(element.id);
    if (video) video.currentTime = edge === "start" ? nextStart : Math.max(nextStart, nextEnd - 1);
  };
  async function setCover() {
    const video = videoForLayer(element.id);
    const time = video ? video.currentTime : start;
    setBusy("Taking the cover…"); setError("");
    try {
      const cover = await coverAt(clip, time, element.name);
      onUpdate("video-cover", layer => { const current = layerVideo(layer); return current ? withLayerVideo(layer, {...current, coverTime: Math.round(time * 100) / 100, noPoster: undefined}, {src: cover.src, previewSrc: cover.previewSrc}) : layer; });
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Couldn't take a cover from this video."); }
    finally { setBusy(""); }
  }
  /** A new speed keeps the start; the end comes in if the slide would play over 60 seconds. */
  const setSpeed = (value: number) => {
    const next = Math.round(Math.min(VIDEO_SPEED_RANGE.max, Math.max(VIDEO_SPEED_RANGE.min, value)) * 100) / 100;
    const limit = start + MAX_SLIDE_VIDEO_SECONDS * next;
    setClip("video-speed", {speed: next === 1 ? undefined : next, ...(end > limit + 0.01 ? {end: Math.round(limit * 10) / 10} : {})});
  };
  async function split() {
    if (!onSplit) return;
    const video = videoForLayer(element.id);
    const at = Math.round((video ? video.currentTime : now) * 100) / 100;
    setBusy("Splitting…"); setError("");
    try { await onSplit(at); }
    catch (reason) { setError(reason instanceof Error ? reason.message : "Couldn't split this video."); }
    finally { setBusy(""); }
  }
  const seek = (time: number) => { const video = videoForLayer(element.id); if (video) { video.currentTime = Math.min(end, Math.max(start, time)); setNow(video.currentTime); } };
  const length = played;
  const percent = (time: number) => `${Math.max(0, Math.min(100, time / clip.duration * 100))}%`;
  return <section className="te-element-section te-video-controls">
    <h3>Video</h3>
    <div className="te-element-segments" role="group" aria-label="Playback">
      <button type="button" aria-pressed={playing} onClick={() => { const next = !playing; setPlaying(next); setVideoPaused(element.id, !next); }}>{playing ? "Pause" : "Play"}</button>
      <button type="button" aria-pressed={clip.muted === false} disabled={disabled} onClick={() => setClip("video-sound", {muted: clip.muted === false ? undefined : false})} title="Sound while editing. Export has its own setting.">{clip.muted === false ? "Sound on" : "Muted"}</button>
      <button type="button" aria-pressed={clip.loop !== false} disabled={disabled} onClick={() => setClip("video-loop", {loop: clip.loop === false ? undefined : false})}>{clip.loop === false ? "Plays once" : "Loops"}</button>
    </div>
    <div className="te-video-filmstrip" role="group" aria-label="Clip frames: choose a moment">
      <div className="te-video-filmstrip-frames" aria-hidden="true">{frames.length ? frames.map((frame, index) => <span key={index} className="te-video-filmstrip-frame" style={{backgroundImage: `url(${frame})`}}/>) : <span>Loading frames…</span>}</div>
      <span className="te-video-filmstrip-outside" style={{left: 0, width: percent(start)}} aria-hidden="true"/>
      <span className="te-video-filmstrip-outside" style={{left: percent(end), right: 0}} aria-hidden="true"/>
      <span className="te-video-filmstrip-playhead" style={{left: percent(now)}} aria-hidden="true"/>
      {Array.from({length: FILMSTRIP_FRAMES}, (_, index) => { const time = (index + 0.5) * clip.duration / FILMSTRIP_FRAMES; return <button key={index} type="button" className="te-video-filmstrip-step" style={{left: `${index * 100 / FILMSTRIP_FRAMES}%`, width: `${100 / FILMSTRIP_FRAMES}%`}} aria-label={`Go to ${formatSeconds(time)}`} title={formatSeconds(time)} onClick={() => seek(time)}/>; })}
    </div>
    <fieldset disabled={disabled} className="te-video-trim">
      <label className="te-range"><span>Starts at <output>{formatSeconds(start)}</output></span><input type="range" aria-label="Trim start" min={0} max={clip.duration} step={0.1} value={start} onChange={event => trim("start", Number(event.target.value))}/></label>
      <label className="te-range"><span>Ends at <output>{formatSeconds(end)}</output></span><input type="range" aria-label="Trim end" min={0} max={clip.duration} step={0.1} value={end} onChange={event => trim("end", Number(event.target.value))}/></label>
    </fieldset>
    <p className="te-element-hint">Plays {formatSeconds(length)}{speed !== 1 ? ` (${formatSeconds(end - start)} of the clip at ${speed}×)` : ""} of {formatSeconds(clip.duration)} · now {formatSeconds(now)} · {clip.width} × {clip.height}{clip.duration > most ? ` · A slide plays up to ${MAX_SLIDE_VIDEO_SECONDS} seconds; move the handles to choose which.` : ""}{length < 3 ? " · Instagram wants at least 3 seconds." : ""}</p>
    <fieldset disabled={disabled} className="te-video-trim te-video-edits">
      <label className="te-range"><span>Speed <output>{speed}×</output></span><input type="range" aria-label="Speed" min={VIDEO_SPEED_RANGE.min} max={VIDEO_SPEED_RANGE.max} step={0.25} value={speed} onChange={event => setSpeed(Number(event.target.value))}/></label>
      <div className="te-element-segments" role="group" aria-label="Speed presets">{[0.5, 1, 1.5, 2].map(value => <button key={value} type="button" aria-pressed={speed === value} onClick={() => setSpeed(value)}>{value}×</button>)}</div>
      {speed !== 1 && <p className="te-element-hint">Exports without sound at {speed}×.</p>}
      <label className="te-range"><span>Volume <output>{Math.round((clip.volume ?? 1) * 100)}%</output></span><input type="range" aria-label="Volume" min={0} max={VIDEO_VOLUME_MAX * 100} step={5} value={Math.round((clip.volume ?? 1) * 100)} onChange={event => { const value = Number(event.target.value) / 100; setClip("video-volume", {volume: value === 1 ? undefined : value}); }}/></label>
      <label className="te-range"><span>Fade in <output>{formatSeconds(clip.fadeIn ?? 0)}</output></span><input type="range" aria-label="Fade in" min={0} max={Math.min(FADE_MAX, Math.max(0.1, Math.floor(length * 10) / 10))} step={0.1} value={clip.fadeIn ?? 0} onChange={event => { const value = Number(event.target.value); setClip("video-fade-in", {fadeIn: value > 0 ? value : undefined}); }}/></label>
      <label className="te-range"><span>Fade out <output>{formatSeconds(clip.fadeOut ?? 0)}</output></span><input type="range" aria-label="Fade out" min={0} max={Math.min(FADE_MAX, Math.max(0.1, Math.floor(length * 10) / 10))} step={0.1} value={clip.fadeOut ?? 0} onChange={event => { const value = Number(event.target.value); setClip("video-fade-out", {fadeOut: value > 0 ? value : undefined}); }}/></label>
    </fieldset>
    <div className="te-element-grid te-element-actions">
      {onSplit && <button type="button" disabled={disabled || Boolean(busy) || !canSplitVideoAt(clip, now)} onClick={() => void split()} title="The slide keeps the part before this moment; a copy of the slide right after it plays the rest.">Split here ({formatSeconds(now)})</button>}
      <button type="button" disabled={disabled || Boolean(busy)} onClick={() => void setCover()} title="The cover shows in thumbnails, PNG and PDF exports, and before the video plays.">Use this frame as cover</button>
      {onReplace && <label className="te-property-action">Replace video<input type="file" hidden aria-label="Replace video" accept="video/mp4,video/quicktime,video/webm,.mp4,.mov,.m4v,.webm" disabled={disabled || Boolean(busy)} onChange={async event => { const file = event.target.files?.[0]; event.target.value = ""; if (!file) return; setBusy("Uploading…"); setError(""); try { await onReplace(file); } catch (reason) { setError(reason instanceof Error ? reason.message : "Couldn't replace the video."); } finally { setBusy(""); } }}/></label>}
      <button type="button" disabled={disabled || Boolean(busy)} onClick={() => onUpdate("video-remove", layer => withLayerVideo(layer, null))} title="The cover stays as a still photo.">Keep cover as photo</button>
    </div>
    {busy && <p className="te-element-hint" role="status">{busy}</p>}
    {error && <p className="te-element-hint" role="alert">{error}</p>}
  </section>;
}
