/**
 * Timed captions on a video slide, after OpenFilm's caption tracks (github.com/openfilm/openfilm, MIT):
 * a clip carries cues `{start, end, text}` in the file's own seconds (as its trim is), so trimming,
 * speed and splitting a slide keep each cue on its moment. A text layer marked `captions` is how they
 * look: its box, font, size, colour and effects; it shows the cue playing and nothing between cues.
 * Pure: the editor, the export and the agent API share it.
 */
import {playWindow, sourceTimeAt} from "./clip-timing";
import {MAX_CAPTION_CUES, MAX_CAPTION_TEXT, MIN_CAPTION_SECONDS, type CanvasElement, type CanvasScene, type CaptionCue, type TextElement, type VideoClip} from "./model";

export {MAX_CAPTION_CUES, MAX_CAPTION_TEXT, MIN_CAPTION_SECONDS, parseCaptionCues, type CaptionCue} from "./model";

const round = (value: number) => Math.round(value * 1000) / 1000;
const clean = (text: string) => text.replace(/\r\n?/g, "\n").split("\n").map(line => line.replace(/\s+/g, " ").trim()).filter(Boolean).join("\n");

const TIME = /^(?:(\d+):)?(\d{1,2}):(\d{1,2})[.,](\d{1,3})$/;
function seconds(stamp: string): number | null {
  const match = TIME.exec(stamp.trim());
  if (!match) return null;
  const [, hours = "0", minutes, secs, fraction] = match;
  return Number(hours) * 3600 + Number(minutes) * 60 + Number(secs) + Number(fraction.padEnd(3, "0")) / 1000;
}

export class CaptionFileError extends Error {}
/** Cues from an SRT or WebVTT file. Styling tags (<i>, <b>, <c.x>, <v Name>) and VTT cue settings
 * are dropped; NOTE, STYLE and REGION blocks are skipped. Throws CaptionFileError, in words people
 * read, when the file has no cues or too many. */
export function parseCaptionFile(source: string): CaptionCue[] {
  const text = source.replace(/^﻿/, "").replace(/\r\n?/g, "\n");
  const cues: CaptionCue[] = [];
  for (const block of text.split(/\n{2,}/)) {
    const lines = block.split("\n").filter(line => line.trim() !== "");
    const at = lines.findIndex(line => line.includes("-->"));
    if (at < 0 || /^(NOTE|STYLE|REGION)\b/.test(lines[0] ?? "")) continue;
    const [from, rest] = lines[at].split("-->");
    const start = seconds(from), end = seconds(rest.trim().split(/\s+/)[0] ?? "");
    if (start === null || end === null) throw new CaptionFileError(`This line has a time Engine can't read: "${lines[at].trim()}".`);
    const words = clean(lines.slice(at + 1).join("\n").replace(/<[^>]*>/g, "").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&nbsp;/g, " "));
    if (!words) continue;
    cues.push({start: round(start), end: round(Math.max(end, start + MIN_CAPTION_SECONDS)), text: words.slice(0, MAX_CAPTION_TEXT)});
  }
  if (!cues.length) throw new CaptionFileError("This file has no captions in it. Use an .srt or .vtt file.");
  if (cues.length > MAX_CAPTION_CUES) throw new CaptionFileError(`This file has ${cues.length} captions; a clip holds ${MAX_CAPTION_CUES}.`);
  return cues.sort((a, b) => a.start - b.start);
}

const stamp = (value: number, comma: boolean) => {
  const ms = Math.round(value * 1000), h = Math.floor(ms / 3_600_000), m = Math.floor(ms / 60_000) % 60, s = Math.floor(ms / 1000) % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}${comma ? "," : "."}${String(ms % 1000).padStart(3, "0")}`;
};
/** The cues as an SRT file. */
export const formatSrt = (cues: CaptionCue[]) => cues.map((cue, index) => `${index + 1}\n${stamp(cue.start, true)} --> ${stamp(cue.end, true)}\n${cue.text}\n`).join("\n");

/** The cue showing at a second of the file: the latest one started, when it hasn't ended. */
export function cueAt(cues: CaptionCue[] | undefined, source: number): CaptionCue | undefined {
  let found: CaptionCue | undefined;
  for (const cue of cues ?? []) { if (cue.start > source + 1e-6) break; if (source < cue.end - 1e-6) found = cue; }
  return found;
}

/** What the caption layer shows over a slide: runs of slide time, each with its cue's words or
 * nothing. Covers 0 … the slide's length with no gaps. */
export function captionSegments(clip: VideoClip): {from: number; to: number; text: string | null}[] {
  const {start, end, speed, length} = playWindow(clip);
  const marks = new Set([0, length]);
  for (const cue of clip.captions ?? []) for (const time of [cue.start, cue.end]) if (time > start && time < end) marks.add((time - start) / speed);
  const times = [...marks].sort((a, b) => a - b), segments: {from: number; to: number; text: string | null}[] = [];
  for (let i = 0; i + 1 < times.length; i++) {
    const from = times[i], to = times[i + 1];
    if (to - from < 1e-6) continue;
    const text = cueAt(clip.captions, sourceTimeAt(clip, (from + to) / 2))?.text ?? null;
    const last = segments.at(-1);
    if (last && last.text === text) last.to = to; else segments.push({from, to, text});
  }
  return segments;
}

/** The cue at the clip's cover moment, which stills (thumbnails, PNG, PDF) show. */
export const coverCue = (clip: VideoClip) => cueAt(clip.captions, clip.coverTime ?? clip.start ?? 0);

const clipOf = (element: CanvasElement): VideoClip | undefined => element.hidden ? undefined : element.type === "image" ? element.video : element.type === "shape" ? element.imageFill?.video : undefined;
/** The clip a caption layer follows: the slide's video. On a continuous canvas, the video under
 * the layer's middle (else the first). */
export function captionClip(scene: CanvasScene | undefined, layer: Pick<CanvasElement, "x" | "width">): {id: string; clip: VideoClip} | undefined {
  const videos = (scene?.elements ?? []).flatMap(element => { const clip = clipOf(element); return clip ? [{id: element.id, clip, element}] : []; });
  const middle = layer.x + layer.width / 2;
  const found = videos.find(({element}) => middle >= element.x && middle <= element.x + element.width) ?? videos[0];
  return found && {id: found.id, clip: found.clip};
}
export const isCaptionLayer = (element: CanvasElement): element is TextElement & {captions: true} => element.type === "text" && element.captions === true;
/** Words shown in a caption layer when there's no cue to show: what it is, so it can be styled. */
export const CAPTION_SAMPLE = "Captions show here";

type Box = {x: number; y: number; width: number; height: number};
/** A caption layer for a slide `box` (scene units): centred near its foot, white bold type with a
 * soft shadow so it reads over any picture, in `font`. */
export function defaultCaptionLayer(box: Box, font: string, id: string): TextElement {
  const width = box.width * .84, size = Math.round(box.width * .05 * 10) / 10;
  return {
    id, name: "Captions", type: "text", text: CAPTION_SAMPLE, captions: true,
    x: box.x + (box.width - width) / 2, y: box.y + box.height * .78, width, height: box.height * .12, rotation: 0, opacity: 1, locked: false,
    font, fontSize: size, fontWeight: 700, italic: false, underline: false, color: "#ffffff", align: "center",
    lineHeight: 1.2, letterSpacing: 0, textMode: "fixed", verticalAlign: "bottom",
    shadow: {color: "#00000099", offsetX: 0, offsetY: size * .08, blur: size * .4, spread: 0},
  };
}

/** The caption layer that shows a video layer's cues, if there is one. */
export function captionLayerFor(scene: CanvasScene, videoId: string): TextElement | undefined {
  return scene.elements.find((element): element is TextElement => isCaptionLayer(element) && captionClip(scene, element)?.id === videoId);
}

/** The slide in `box` gets the default caption layer when its video has cues and no caption layer
 * shows them, in the font of the scene's first text layer. `id` makes the new layer's id. Returns
 * the scene unchanged when nothing's missing. */
export function withCaptionLayer(scene: CanvasScene, box: Box, id: () => string, fallbackFont = "geist"): CanvasScene {
  const video = captionClip(scene, box);
  if (!video?.clip.captions?.length || captionLayerFor(scene, video.id)) return scene;
  const font = scene.elements.find((element): element is TextElement => element.type === "text" && !element.captions)?.font ?? fallbackFont;
  return {...scene, elements: [...scene.elements, defaultCaptionLayer(box, font, id())]};
}
