"use client";
import {useEffect, useState} from "react";
import {MAX_SLIDE_VIDEO_SECONDS, type CanvasElement, type VideoClip} from "@/lib/template-editor/model";
import {clipWindow, coverAt, formatSeconds} from "@/lib/template-editor/client-video";
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

/** Play, sound, trim, loop and cover for the one selected layer with a clip. Each change is one undo step. */
export function VideoControls({element, disabled, onUpdate, onReplace}: {element: CanvasElement; disabled: boolean; onUpdate: (group: string, transform: (element: CanvasElement) => CanvasElement) => void; onReplace?: (file: File) => Promise<void>}) {
  const clip = layerVideo(element)!;
  const {start, end} = clipWindow(clip);
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
    // A slide plays at most 60 seconds: moving one handle past that brings the other along.
    let nextStart = edge === "start" ? Math.min(value, end - MIN_LENGTH) : start;
    let nextEnd = edge === "end" ? Math.max(value, start + MIN_LENGTH) : end;
    if (nextEnd - nextStart > MAX_SLIDE_VIDEO_SECONDS) { if (edge === "start") nextEnd = nextStart + MAX_SLIDE_VIDEO_SECONDS; else nextStart = nextEnd - MAX_SLIDE_VIDEO_SECONDS; }
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
  const length = end - start;
  return <section className="te-element-section te-video-controls">
    <h3>Video</h3>
    <div className="te-element-segments" role="group" aria-label="Playback">
      <button type="button" aria-pressed={playing} onClick={() => { const next = !playing; setPlaying(next); setVideoPaused(element.id, !next); }}>{playing ? "Pause" : "Play"}</button>
      <button type="button" aria-pressed={clip.muted === false} disabled={disabled} onClick={() => setClip("video-sound", {muted: clip.muted === false ? undefined : false})} title="Sound while editing. Export has its own setting.">{clip.muted === false ? "Sound on" : "Muted"}</button>
      <button type="button" aria-pressed={clip.loop !== false} disabled={disabled} onClick={() => setClip("video-loop", {loop: clip.loop === false ? undefined : false})}>{clip.loop === false ? "Plays once" : "Loops"}</button>
    </div>
    <fieldset disabled={disabled} className="te-video-trim">
      <label className="te-range"><span>Starts at <output>{formatSeconds(start)}</output></span><input type="range" aria-label="Trim start" min={0} max={clip.duration} step={0.1} value={start} onChange={event => trim("start", Number(event.target.value))}/></label>
      <label className="te-range"><span>Ends at <output>{formatSeconds(end)}</output></span><input type="range" aria-label="Trim end" min={0} max={clip.duration} step={0.1} value={end} onChange={event => trim("end", Number(event.target.value))}/></label>
    </fieldset>
    <p className="te-element-hint">Plays {formatSeconds(length)} of {formatSeconds(clip.duration)} · now {formatSeconds(now)} · {clip.width} × {clip.height}{clip.duration > MAX_SLIDE_VIDEO_SECONDS ? ` · A slide plays up to ${MAX_SLIDE_VIDEO_SECONDS} seconds; move the handles to choose which.` : ""}{length < 3 ? " · Instagram wants at least 3 seconds." : ""}</p>
    <div className="te-element-grid te-element-actions">
      <button type="button" disabled={disabled || Boolean(busy)} onClick={() => void setCover()} title="The cover shows in thumbnails, PNG and PDF exports, and before the video plays.">Use this frame as cover</button>
      {onReplace && <label className="te-property-action">Replace video<input type="file" hidden aria-label="Replace video" accept="video/mp4,video/quicktime,video/webm,.mp4,.mov,.m4v,.webm" disabled={disabled || Boolean(busy)} onChange={async event => { const file = event.target.files?.[0]; event.target.value = ""; if (!file) return; setBusy("Uploading…"); setError(""); try { await onReplace(file); } catch (reason) { setError(reason instanceof Error ? reason.message : "Couldn't replace the video."); } finally { setBusy(""); } }}/></label>}
      <button type="button" disabled={disabled || Boolean(busy)} onClick={() => onUpdate("video-remove", layer => withLayerVideo(layer, null))} title="The cover stays as a still photo.">Keep cover as photo</button>
    </div>
    {busy && <p className="te-element-hint" role="status">{busy}</p>}
    {error && <p className="te-element-hint" role="alert">{error}</p>}
  </section>;
}
