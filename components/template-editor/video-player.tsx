"use client";
import {useEffect, useRef, type CSSProperties} from "react";
import type {VideoClip} from "@/lib/template-editor/model";
import {fadeAt, fadesPicture, playWindow, slideTimeAt} from "@/lib/template-editor/clip-timing";

/** Paused clips, by layer id, for this tab only: playback isn't part of the design. */
const paused = new Set<string>();
const listeners = new Set<() => void>();
export const isVideoPaused = (id: string) => paused.has(id);
export function setVideoPaused(id: string, value: boolean) {
  if (value) paused.add(id); else paused.delete(id);
  for (const listener of listeners) listener();
}
/** The playing clip of a layer on the canvas, for the inspector's controls. */
export const videoForLayer = (id: string) => document.querySelector<HTMLVideoElement>(`video[data-video-layer="${CSS.escape(id)}"]`);

/** A layer's clip on the canvas: silent unless the clip says otherwise, playing only
 * its trim at its speed, from `start` again at `end` (or stopping there without loop),
 * with its fades on the picture and sound. It plays only while the tab is visible and
 * the layer isn't paused; the cover shows first. */
export function VideoPlayer({clip, layerId, poster, className, style}: {clip: VideoClip; layerId: string; poster: string; className?: string; style?: CSSProperties}) {
  const ref = useRef<HTMLVideoElement>(null);
  const {start, end, speed} = playWindow(clip);
  const loop = clip.loop !== false, volume = clip.volume ?? 1, fadeIn = clip.fadeIn ?? 0, fadeOut = clip.fadeOut ?? 0;
  useEffect(() => {
    const video = ref.current;
    if (!video) return;
    const timing = {duration: clip.duration, start, end, speed, volume, fadeIn, fadeOut};
    const sync = () => {
      const play = !paused.has(layerId) && document.visibilityState === "visible";
      if (play && video.paused && !(video.ended && !loop)) void video.play().catch(() => undefined);
      if (!play && !video.paused) video.pause();
    };
    const keepInside = () => {
      if (video.currentTime < start - 0.05) video.currentTime = start;
      else if (video.currentTime >= end - 0.03) {
        if (loop) video.currentTime = start;
        else { video.pause(); video.currentTime = end; }
      }
    };
    // Fades and level follow the playhead every frame it shows.
    const fades = fadesPicture(timing);
    let frame = 0;
    const level = () => {
      const t = slideTimeAt(timing, video.currentTime), fade = fadeAt(timing, t);
      // A paused clip shows its frame in full, so it can be framed and trimmed.
      video.style.opacity = fades && !video.paused ? String(fade) : "";
      video.volume = Math.min(1, Math.max(0, volume * fade));
      frame = window.requestAnimationFrame(level);
    };
    const begin = () => { video.playbackRate = speed; video.preservesPitch = true; if (video.currentTime < start || video.currentTime > end) video.currentTime = start; sync(); };
    video.playbackRate = speed;
    video.addEventListener("loadedmetadata", begin);
    video.addEventListener("timeupdate", keepInside);
    const ended = () => { if (loop) { video.currentTime = start; sync(); } };
    video.addEventListener("ended", ended);
    document.addEventListener("visibilitychange", sync);
    listeners.add(sync);
    if (video.readyState >= 1) begin();
    frame = window.requestAnimationFrame(level);
    return () => { window.cancelAnimationFrame(frame); video.style.opacity = ""; video.removeEventListener("loadedmetadata", begin); video.removeEventListener("timeupdate", keepInside); video.removeEventListener("ended", ended); document.removeEventListener("visibilitychange", sync); listeners.delete(sync); };
  }, [layerId, start, end, loop, speed, volume, fadeIn, fadeOut, clip.duration]);
  return <video ref={ref} className={className} style={style} data-video-layer={layerId} src={clip.src} poster={poster} muted={clip.muted !== false} playsInline preload="metadata" disablePictureInPicture aria-hidden="true" />;
}
