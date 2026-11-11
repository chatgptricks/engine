import {duplicatePage, MAX_SLIDE_VIDEO_SECONDS, type CanvasElement, type DesignDocument, type DesignPage, type VideoClip} from "./model";
import {spanPairs, withoutSpans} from "./spanning-photos";

const MAX_PAGES = 20;
/** A last part shorter than this isn't worth a slide; the part before it keeps those seconds out. */
const MIN_PART_SECONDS = 0.5;

export type VideoPart = {start: number; end: number};
/** The parts of a clip, 60 seconds each from its start: 0–60, 60–120, 120–150… */
export function videoParts(clip: Pick<VideoClip, "duration">, from = 0): VideoPart[] {
  const parts: VideoPart[] = [];
  for (let start = from; clip.duration - start >= MIN_PART_SECONDS || parts.length === 0; start += MAX_SLIDE_VIDEO_SECONDS) {
    parts.push({start: round(start), end: round(Math.min(clip.duration, start + MAX_SLIDE_VIDEO_SECONDS))});
    if (start + MAX_SLIDE_VIDEO_SECONDS >= clip.duration) break;
  }
  return parts;
}
const round = (value: number) => Math.round(value * 1000) / 1000;
/** Does this clip play more than one slide's worth? */
export const needsVideoSlides = (clip: VideoClip | undefined) => Boolean(clip && clip.duration - (clip.start ?? 0) > MAX_SLIDE_VIDEO_SECONDS + MIN_PART_SECONDS);

function clipOn(element: CanvasElement): VideoClip | undefined {
  return element.type === "image" ? element.video : element.type === "shape" ? element.imageFill?.video : undefined;
}
function withPart(element: CanvasElement, part: VideoPart, cover?: {src: string; previewSrc?: string}): CanvasElement {
  const apply = (clip: VideoClip): VideoClip => {
    const next: VideoClip = {...clip, start: part.start, end: part.end, coverTime: part.start};
    if (!part.start) delete next.start;
    if (part.end >= clip.duration) delete next.end;
    return next;
  };
  // A new cover brings its own preview, or none: the old cover's preview would show the wrong frame.
  const withCover = <T extends {src: string; previewSrc?: string}>(photo: T): T => {
    if (!cover) return photo;
    const next = {...photo, src: cover.src, previewSrc: cover.previewSrc};
    if (!cover.previewSrc) delete next.previewSrc;
    return next;
  };
  if (element.type === "image" && element.video) return {...withCover(element), video: apply(element.video)};
  if (element.type === "shape" && element.imageFill?.video) return {...element, imageFill: {...withCover(element.imageFill), video: apply(element.imageFill.video)}};
  return element;
}

export type VideoSlidesResult = {design: DesignDocument; pageIds: string[]};
/** A clip longer than a slide plays (60 seconds) keeps its first minute on its own slide, and each
 * further minute goes on a copy of that slide placed right after it (after a spanning pair it
 * starts, never inside one). `covers[i]` is the cover for part i+1, when the caller has one;
 * otherwise a copy keeps the first cover. The whole deck may hold 20 slides; parts that don't fit
 * are an error, so nothing is half done. */
export function splitVideoAcrossSlides(design: DesignDocument, pageId: string, elementId: string, covers: ({src: string; previewSrc?: string} | undefined)[] = []): VideoSlidesResult {
  if (design.continuousCanvas) return {design, pageIds: []};
  const index = design.pages.findIndex(page => page.id === pageId);
  const page = design.pages[index];
  const position = page?.canvas?.elements.findIndex(element => element.id === elementId) ?? -1;
  const element = position >= 0 ? page!.canvas!.elements[position] : undefined;
  const clip = element && clipOn(element);
  if (!page?.canvas || !element || !clip || !needsVideoSlides(clip)) return {design, pageIds: []};
  const parts = videoParts(clip, clip.start ?? 0);
  if (design.pages.length + parts.length - 1 > MAX_PAGES) throw new Error(`This video needs ${parts.length} slides of ${MAX_SLIDE_VIDEO_SECONDS} seconds, and a carousel holds ${MAX_PAGES}. Trim it or remove slides first.`);
  const first: DesignPage = {...page, canvas: {...page.canvas, elements: page.canvas.elements.map((item, at) => at === position ? withPart(item, parts[0]) : item)}};
  const copies = parts.slice(1).map((part, at) => {
    const copy = withoutSpans(duplicatePage(first));
    const elements = copy.canvas!.elements.map((item, place) => place === position ? withPart(item, part, covers[at]) : item);
    return {...copy, canvas: {...copy.canvas!, elements}};
  });
  let insertAfter = index;
  const pairs = spanPairs(design);
  for (let pair = pairs.find(item => item.startPage === insertAfter); pair; pair = pairs.find(item => item.startPage === insertAfter)) insertAfter = pair.endPage;
  const pages = design.pages.map(item => item.id === pageId ? first : item);
  return {design: {...design, pages: [...pages.slice(0, insertAfter + 1), ...copies, ...pages.slice(insertAfter + 1)]}, pageIds: copies.map(copy => copy.id)};
}

/** Agents: every clip longer than a slide plays that came without a trim goes on as many slides as
 * it needs (a clip with start or end set stays one slide, cut to 60 seconds). Covers on the new
 * slides repeat the first; people can set each in the editor. */
export function splitUntrimmedVideos(design: DesignDocument): VideoSlidesResult {
  const pending = design.pages.flatMap(page => (page.canvas?.elements ?? []).flatMap(element => {
    const clip = clipOn(element);
    return clip && clip.start === undefined && clip.end === undefined && needsVideoSlides(clip) ? [{pageId: page.id, elementId: element.id}] : [];
  }));
  let next = design;
  const pageIds: string[] = [];
  for (const {pageId, elementId} of pending) { const result = splitVideoAcrossSlides(next, pageId, elementId); next = result.design; pageIds.push(...result.pageIds); }
  return {design: next, pageIds};
}
