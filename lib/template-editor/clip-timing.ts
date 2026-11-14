/**
 * How a clip plays on its slide: which seconds of the file, how fast, and how loud at each
 * moment. The ideas follow OpenFilm's clip attributes (github.com/openfilm/openfilm, MIT):
 * a trim, a `speed` that keeps the slide (end − start) / speed long, a `volume` gain, and
 * `fade: [in, out]` ramps that take the picture's opacity and the sound's gain from 0 to 1
 * over the first seconds and back over the last. Times here are the slide's (played) seconds
 * unless they say "source". Pure: the editor, the export and the agent API share it.
 */
import {MAX_SLIDE_VIDEO_SECONDS, VIDEO_SPEED_RANGE, type VideoClip} from "./model";

type Clip = Pick<VideoClip, "duration" | "start" | "end" | "speed" | "volume" | "fadeIn" | "fadeOut">;

export const clipSpeed = (clip: Pick<VideoClip, "speed">) => Math.min(VIDEO_SPEED_RANGE.max, Math.max(VIDEO_SPEED_RANGE.min, clip.speed ?? 1));

/** The seconds of the file a slide plays, and how long the slide plays them (at most 60 s). */
export function playWindow(clip: Clip): {start: number; end: number; speed: number; length: number} {
  const speed = clipSpeed(clip);
  const start = Math.max(0, Math.min(clip.start ?? 0, clip.duration - 0.1));
  const end = Math.max(start + 0.1, Math.min(clip.end ?? clip.duration, clip.duration, start + MAX_SLIDE_VIDEO_SECONDS * speed));
  return {start, end, speed, length: (end - start) / speed};
}

/** The second of the file showing `t` seconds into the slide. */
export const sourceTimeAt = (clip: Clip, t: number) => { const {start, end, speed} = playWindow(clip); return Math.min(end, start + Math.max(0, t) * speed); };
/** How far into the slide a second of the file is. */
export const slideTimeAt = (clip: Clip, source: number) => { const {start, speed, length} = playWindow(clip); return Math.min(length, Math.max(0, (source - start) / speed)); };

/** The fades' lengths, shrunk together when they'd overlap on a short slide. */
export function fadeLengths(clip: Clip): {fadeIn: number; fadeOut: number} {
  const {length} = playWindow(clip);
  const fadeIn = Math.max(0, clip.fadeIn ?? 0), fadeOut = Math.max(0, clip.fadeOut ?? 0);
  const total = fadeIn + fadeOut;
  if (total <= length || total === 0) return {fadeIn, fadeOut};
  return {fadeIn: fadeIn * length / total, fadeOut: fadeOut * length / total};
}

/** 0 to 1: how much of the picture and sound show at `t` seconds into the slide. */
export function fadeAt(clip: Clip, t: number): number {
  const {length} = playWindow(clip), {fadeIn, fadeOut} = fadeLengths(clip);
  let level = 1;
  if (fadeIn > 0 && t < fadeIn) level = Math.min(level, Math.max(0, t / fadeIn));
  if (fadeOut > 0 && t > length - fadeOut) level = Math.min(level, Math.max(0, (length - t) / fadeOut));
  return level;
}

/** The sound's gain at `t` seconds into the slide: its volume times its fades. */
export const gainAt = (clip: Clip, t: number) => (clip.volume ?? 1) * fadeAt(clip, t);
/** Does the sound need more than copying: a level or fades? */
export const changesSound = (clip: Clip) => (clip.volume ?? 1) !== 1 || Boolean(clip.fadeIn) || Boolean(clip.fadeOut);
/** Does the picture fade? */
export const fadesPicture = (clip: Clip) => Boolean(clip.fadeIn) || Boolean(clip.fadeOut);
