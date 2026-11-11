"use client";
import {useEffect, useRef, type CSSProperties} from "react";
import type {VideoClip} from "@/lib/template-editor/model";

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
 * its trim, from `start` again at `end` (or stopping there without loop). It plays
 * only while the tab is visible and the layer isn't paused; the cover shows first. */
export function VideoPlayer({clip, layerId, poster, className, style}: {clip: VideoClip; layerId: string; poster: string; className?: string; style?: CSSProperties}) {
  const ref = useRef<HTMLVideoElement>(null);
  const start = clip.start ?? 0, end = clip.end ?? clip.duration, loop = clip.loop !== false;
  useEffect(() => {
    const video = ref.current;
    if (!video) return;
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
    const begin = () => { if (video.currentTime < start || video.currentTime > end) video.currentTime = start; sync(); };
    video.addEventListener("loadedmetadata", begin);
    video.addEventListener("timeupdate", keepInside);
    const ended = () => { if (loop) { video.currentTime = start; sync(); } };
    video.addEventListener("ended", ended);
    document.addEventListener("visibilitychange", sync);
    listeners.add(sync);
    if (video.readyState >= 1) begin();
    return () => { video.removeEventListener("loadedmetadata", begin); video.removeEventListener("timeupdate", keepInside); video.removeEventListener("ended", ended); document.removeEventListener("visibilitychange", sync); listeners.delete(sync); };
  }, [layerId, start, end, loop]);
  return <video ref={ref} className={className} style={style} data-video-layer={layerId} src={clip.src} poster={poster} muted={clip.muted !== false} playsInline preload="metadata" disablePictureInPicture aria-hidden="true" />;
}
