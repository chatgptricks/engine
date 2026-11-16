"use client";
import {useEffect, useRef, useState, useSyncExternalStore, type CSSProperties} from "react";
import type {VideoClip} from "@/lib/template-editor/model";
import {fadeAt, fadesPicture, playWindow, slideTimeAt} from "@/lib/template-editor/clip-timing";
import {cueAt} from "@/lib/template-editor/captions";

/** Playing clips, by layer id, for this tab only: playback isn't part of the design.
 * Every clip starts stopped on its cover when the editor opens, and plays once someone presses Play. */
const playing = new Set<string>();
const listeners = new Set<() => void>();
/** Each clip on the canvas, by layer id: takes it back to its start and shows its cover. */
const rewinders = new Map<string, () => void>();
export const isVideoPlaying = (id: string) => playing.has(id);
export function setVideoPlaying(id: string, value: boolean) {
  if (value === playing.has(id)) return;
  if (value) playing.add(id); else playing.delete(id);
  for (const listener of [...listeners]) listener();
  refreshSound();
}
/** Stop: pause the clip and go back to its start, showing its cover again. */
export function stopVideo(id: string) {
  setVideoPlaying(id, false);
  rewinders.get(id)?.();
}
const subscribe = (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; };
/** Whether a layer's clip is playing, kept current for buttons. */
export const useVideoPlaying = (id: string | undefined) => useSyncExternalStore(subscribe, () => Boolean(id && playing.has(id)), () => false);

/** Clips on the canvas, by layer id: whether each has sound and how much of it is in view.
 * One plays its sound at a time, the one most in view, so video slides side by side don't
 * talk over each other. Browsers let a page play sound once someone has clicked or typed in it;
 * until then every clip plays silent. */
const players = new Map<string, {video: HTMLVideoElement; sound: boolean; seen: number}>();
let unlocked = typeof navigator !== "undefined" && Boolean((navigator as Navigator & {userActivation?: {hasBeenActive: boolean}}).userActivation?.hasBeenActive);
function refreshSound() {
  let loudest: string | undefined, most = 0.2;
  for (const [id, player] of players) if (player.sound && playing.has(id) && player.seen > most) { most = player.seen; loudest = id; }
  for (const [id, player] of players) { const on = unlocked && id === loudest; if (player.video.muted === on) player.video.muted = !on; }
}
if (typeof document !== "undefined" && !unlocked) {
  const unlock = () => { unlocked = true; document.removeEventListener("pointerdown", unlock, true); document.removeEventListener("keydown", unlock, true); refreshSound(); };
  document.addEventListener("pointerdown", unlock, true);
  document.addEventListener("keydown", unlock, true);
}
/** The playing clip of a layer on the canvas, for the inspector's controls. */
export const videoForLayer = (id: string) => document.querySelector<HTMLVideoElement>(`video[data-video-layer="${CSS.escape(id)}"]`);

/** A layer's clip on the canvas: with its sound unless the clip is muted, playing only
 * its trim at its speed, from `start` again at `end` (or stopping there without loop),
 * with its fades on the picture and sound. It plays only after Play is pressed and while
 * the tab is visible; until then it shows its cover. */
export function VideoPlayer({clip, layerId, poster, className, style}: {clip: VideoClip; layerId: string; poster: string; className?: string; style?: CSSProperties}) {
  const ref = useRef<HTMLVideoElement>(null);
  const {start, end, speed} = playWindow(clip);
  const loop = clip.loop !== false, volume = clip.volume ?? 1, fadeIn = clip.fadeIn ?? 0, fadeOut = clip.fadeOut ?? 0;
  useEffect(() => {
    const video = ref.current;
    if (!video) return;
    const timing = {duration: clip.duration, start, end, speed, volume, fadeIn, fadeOut};
    const sync = () => {
      const play = playing.has(layerId) && document.visibilityState === "visible";
      // Play again from the start after a clip that plays once has finished.
      if (play && video.paused && video.currentTime >= end - 0.05) video.currentTime = start;
      // A browser that won't play it with sound yet plays it silent.
      if (play && video.paused) void video.play().catch(() => { if (!video.muted) { video.muted = true; void video.play().catch(() => undefined); } });
      if (!play && !video.paused) video.pause();
    };
    const keepInside = () => {
      if (video.currentTime < start - 0.05) video.currentTime = start;
      else if (video.currentTime >= end - 0.03) {
        if (loop) video.currentTime = start;
        else { video.pause(); video.currentTime = end; setVideoPlaying(layerId, false); }
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
    const ended = () => { if (loop) { video.currentTime = start; sync(); } else setVideoPlaying(layerId, false); };
    video.addEventListener("ended", ended);
    document.addEventListener("visibilitychange", sync);
    listeners.add(sync);
    // Reloading shows the cover again; begin then moves to the trim's start.
    const rewind = () => { video.pause(); video.load(); };
    rewinders.set(layerId, rewind);
    if (video.readyState >= 1) begin();
    frame = window.requestAnimationFrame(level);
    return () => { window.cancelAnimationFrame(frame); video.style.opacity = ""; video.removeEventListener("loadedmetadata", begin); video.removeEventListener("timeupdate", keepInside); video.removeEventListener("ended", ended); document.removeEventListener("visibilitychange", sync); listeners.delete(sync); if (rewinders.get(layerId) === rewind) rewinders.delete(layerId); };
  }, [layerId, start, end, loop, speed, volume, fadeIn, fadeOut, clip.duration]);
  const sound = clip.muted !== true;
  useEffect(() => {
    const video = ref.current;
    if (!video) return;
    const player = {video, sound, seen: 0};
    players.set(layerId, player);
    const observer = typeof IntersectionObserver === "undefined" ? null : new IntersectionObserver(entries => { for (const entry of entries) player.seen = entry.isIntersecting ? entry.intersectionRatio : 0; refreshSound(); }, {threshold: [0, .2, .4, .6, .8, 1]});
    if (observer) observer.observe(video); else player.seen = 1;
    refreshSound();
    return () => { observer?.disconnect(); if (players.get(layerId) === player) players.delete(layerId); video.muted = true; refreshSound(); };
  }, [layerId, sound]);
  // Starts silent, as browsers allow; refreshSound turns the sound on.
  return <video ref={ref} className={className} style={style} data-video-layer={layerId} src={clip.src} poster={poster} muted playsInline preload="metadata" disablePictureInPicture aria-hidden="true" />;
}

const OFF = {text: null, playing: false};
/** The cue a caption layer shows on the editing canvas, following its clip's playhead: its words,
 * or null between cues, and whether the clip is playing. Off (null, not playing) unless `live`. */
export function useLiveCaption(videoLayerId: string | undefined, clip: VideoClip | undefined, live: boolean): {text: string | null; playing: boolean} {
  const [state, setState] = useState<{text: string | null; playing: boolean}>({text: null, playing: false});
  const cues = clip?.captions;
  useEffect(() => {
    if (!live || !videoLayerId || !cues?.length) return;
    let frame = 0;
    const update = () => {
      const video = videoForLayer(videoLayerId);
      const text = video ? cueAt(cues, video.currentTime)?.text ?? null : cueAt(cues, clip?.coverTime ?? clip?.start ?? 0)?.text ?? null;
      const playing = Boolean(video && !video.paused);
      setState(current => current.text === text && current.playing === playing ? current : {text, playing});
    };
    const tick = () => { update(); frame = window.requestAnimationFrame(tick); };
    // The video's own events too: a tab in the background draws a frame a second or less.
    const onVideo = (event: Event) => { if (event.target instanceof HTMLVideoElement && event.target.dataset.videoLayer === videoLayerId) update(); };
    const events = ["timeupdate", "seeked", "play", "pause"];
    for (const name of events) document.addEventListener(name, onVideo, true);
    frame = window.requestAnimationFrame(tick);
    return () => { window.cancelAnimationFrame(frame); for (const name of events) document.removeEventListener(name, onVideo, true); };
  }, [live, videoLayerId, cues, clip?.coverTime, clip?.start]);
  return live && videoLayerId && cues?.length ? state : OFF;
}
