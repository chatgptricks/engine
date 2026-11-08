/** Spanning photos: one photo that starts on one slide and continues on the
 * next, so it splits at the boundary as people swipe.
 *
 * A spanning photo is two linked image layers: the "start" half on page i and
 * the "end" half on page i + 1, sharing `span.id`. They share the photo, its
 * size, crop and effects; the end half sits one page width (360) to the left,
 * so each page frame clips its own half and export needs nothing new. The seam,
 * the share of the photo on the start page, follows from the geometry:
 * (360 − start.x) / start.width.
 *
 * Editor commits go through `syncSpans` and agent edits through
 * `reconcileSpans`, so the halves never drift apart: a changed half is
 * mirrored to its twin, a deleted half takes its twin with it, and halves
 * whose pages stop being neighbors are unlinked, each keeping the half it
 * shows. The whole photo always stays upright on its two pages; it is never
 * cropped at their outer edges. On the @chatgptricks Wide photo pages (slot "wide-photo")
 * the photo is as large as fits and the title, body and photo stay balanced as
 * one block, so both titles sit level. */
import {
  BUILT_IN_TEMPLATES, duplicatePage,
  type CanvasElement, type DesignDocument, type DesignPage, type ImageElement, type TextElement,
} from "./model";

export const SPAN_PAGE_WIDTH = 360;
/** The seam slider and agents keep at least a tenth of the photo on each slide. */
export const SEAM_MIN = .1;
export const SEAM_MAX = .9;
/** The start half's slot on the @chatgptricks Wide photo pages. */
export const WIDE_PHOTO_SLOT = "wide-photo";
export const CHATGPTRICKS_TEMPLATE = "chatgptricks-3x4";
const PAGE = SPAN_PAGE_WIDTH, PAIR = 2 * PAGE, MAX_PAGES = 20, EPSILON = 1e-6;
const px = (value: number) => value / 3;
/** Wide photo pages in 1080-wide output pixels: the block runs from 90 to 1252,
 * a one-line title (62.72) and 23 px under it a two-line body (95.4), then the
 * photo 64 px below, up to 2160 wide. model.ts draws the pages with the same numbers. */
const WIDE = { top: px(90), bottom: px(1252), body: px(62.72 + 23), header: px(62.72 + 23 + 95.4), gap: px(64), width: px(2160) };
const WIDE_MAX_HEIGHT = WIDE.bottom - WIDE.top - WIDE.header - WIDE.gap;

type SpanLink = NonNullable<ImageElement["span"]>;
export type SpanHalf = ImageElement & { span: SpanLink };
/** A start half on page `startPage` and its end half on the page after it. */
export type SpanPair = { id: string; startPage: number; endPage: number; start: SpanHalf; end: SpanHalf };
export type SpanPlace = SpanPair & { side: "start" | "end" };
/** `unlinked`: page indexes whose half lost its partner in this change.
 * `onePage`: page indexes where a linked photo moved fully onto one slide. */
export type SpanReport = { design: DesignDocument; unlinked: number[]; onePage: number[] };

export const isSpanHalf = (element: CanvasElement | null | undefined): element is SpanHalf => element?.type === "image" && Boolean(element.span);
/** The share of the photo's width on the start page. */
export const seamOf = (start: Pick<ImageElement, "x" | "width">) => (PAGE - start.x) / start.width;
export const isWidePair = (pair: Pick<SpanPair, "start">) => pair.start.slot === WIDE_PHOTO_SLOT;
const elementsOf = (page: DesignPage | undefined): CanvasElement[] => page?.canvas?.elements ?? [];
const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));
const newSpanId = () => crypto.randomUUID();
/** The photo's own proportions when known, otherwise the frame's. */
const ratioOf = (image: ImageElement) => image.intrinsicWidth && image.intrinsicHeight ? image.intrinsicWidth / image.intrinsicHeight : image.width / image.height;
const isPlaceholder = (element: CanvasElement) => element.type === "image" && element.templateRole === "media" && /^data:image\/svg\+xml/.test(element.src);

/** Deep equality that ignores key order and undefined values, so an unchanged twin keeps its identity. */
function same(left: unknown, right: unknown): boolean {
  if (left === right) return true;
  if (!left || !right || typeof left !== "object" || typeof right !== "object") return false;
  if (Array.isArray(left) || Array.isArray(right)) return Array.isArray(left) && Array.isArray(right) && left.length === right.length && left.every((value, index) => same(value, right[index]));
  const a = left as Record<string, unknown>, b = right as Record<string, unknown>;
  const keys = Object.keys(a).filter(key => a[key] !== undefined), other = Object.keys(b).filter(key => b[key] !== undefined);
  return keys.length === other.length && keys.every(key => same(a[key], b[key]));
}

export function hasSpans(design: Pick<DesignDocument, "pages">): boolean {
  return design.pages.some(page => elementsOf(page).some(isSpanHalf));
}

/** Valid pairs, left to right. Each half belongs to at most one pair; the first match wins. */
export function spanPairs(design: Pick<DesignDocument, "pages">): SpanPair[] {
  const pairs: SpanPair[] = [], claimed = new Set<CanvasElement>();
  design.pages.forEach((page, index) => {
    for (const start of elementsOf(page)) {
      if (!isSpanHalf(start) || start.span.part !== "start") continue;
      const end = elementsOf(design.pages[index + 1]).find((candidate): candidate is SpanHalf => isSpanHalf(candidate) && candidate.span.part === "end" && candidate.span.id === start.span.id && !claimed.has(candidate));
      if (!end) continue;
      claimed.add(end);
      pairs.push({ id: start.span.id, startPage: index, endPage: index + 1, start, end });
    }
  });
  return pairs;
}

/** The pair a layer belongs to, and which half it is. */
export function findSpan(design: Pick<DesignDocument, "pages">, pageId: string, elementId: string): SpanPlace | undefined {
  const index = design.pages.findIndex(page => page.id === pageId);
  if (index < 0) return undefined;
  for (const pair of spanPairs(design)) {
    if (pair.startPage === index && pair.start.id === elementId) return { ...pair, side: "start" };
    if (pair.endPage === index && pair.end.id === elementId) return { ...pair, side: "end" };
  }
  return undefined;
}

/** Each half keeps its own identity, name, template role and stacking; everything about the photo is shared. */
const OWN_KEYS = new Set(["id", "name", "x", "span", "groupId", "master", "anchors", "slot", "protected", "templateRole", "layoutRole", "smartFlow", "componentId", "componentInstanceId", "componentSourceId", "clipBounds"]);
/** `target` showing `source`'s photo, size, crop and effects, one page over. */
export function mirrorHalf(source: SpanHalf, target: SpanHalf): SpanHalf {
  const offset = source.span.part === "start" ? -PAGE : PAGE;
  const copy: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(source)) if (!OWN_KEYS.has(key) && value !== undefined) copy[key] = structuredClone(value);
  for (const [key, value] of Object.entries(target)) if (OWN_KEYS.has(key) && value !== undefined) copy[key] = value;
  copy.x = source.x + offset;
  if (source.clipBounds) copy.clipBounds = { ...source.clipBounds, x: source.clipBounds.x + offset };
  else delete copy.clipBounds;
  const next = copy as SpanHalf;
  return same(next, target) ? target : next;
}

/** Most of the photo that fits its two pages at `seam`: width ≤ 720, and ≤ 360 on each side of the seam. */
const seamLimit = (seam: number) => Math.min(PAIR, PAGE / Math.max(seam, EPSILON), PAGE / Math.max(1 - seam, EPSILON));

/** The whole photo stays on its two pages: never cropped at their outer edges.
 * A photo wider than both pages shrinks around its center, keeping its shape. */
function contained(start: SpanHalf): SpanHalf {
  let { x, y, width, height } = start;
  if (width > PAIR + EPSILON) {
    const k = PAIR / width;
    x += width * (1 - k) / 2; y += height * (1 - k) / 2; width = PAIR; height *= k;
  }
  x = clamp(x, 0, PAIR - width);
  if (Math.abs(x - start.x) < EPSILON && width === start.width) return start;
  const dx = x - start.x;
  return { ...start, x, y, width, height, ...(start.clipBounds ? { clipBounds: { ...start.clipBounds, x: start.clipBounds.x + dx } } : {}) };
}

/** A plain photo again: the layer keeps the half it shows. A leftover end half
 * of a template pair loses the delete lock it had only to keep the pair whole. */
function unspanned(half: SpanHalf): ImageElement {
  const plain: ImageElement = { ...half };
  delete plain.span;
  if (half.span.part === "end" && !half.slot && plain.protected?.includes("delete")) {
    const rest = plain.protected.filter(property => property !== "delete");
    if (rest.length) plain.protected = rest; else delete plain.protected;
  }
  return plain;
}

/** Copy-on-write access to a design's pages. */
function draft(design: DesignDocument) {
  const pages = [...design.pages], copied = new Set<number>();
  const elements = (index: number): CanvasElement[] => {
    if (!copied.has(index)) {
      const page = pages[index];
      pages[index] = { ...page, canvas: { ...page.canvas!, elements: [...page.canvas!.elements] } };
      copied.add(index);
    }
    return pages[index].canvas!.elements;
  };
  return {
    pages,
    put(index: number, previous: CanvasElement, next: CanvasElement) {
      if (previous === next) return;
      const list = elements(index), at = list.findIndex(element => element.id === previous.id);
      if (at >= 0) list[at] = next;
    },
    remove(index: number, id: string) {
      const list = elements(index), at = list.findIndex(element => element.id === id);
      if (at < 0) return;
      list.splice(at, 1);
      const page = pages[index];
      if (page.readingOrder?.includes(id)) pages[index] = { ...page, readingOrder: page.readingOrder.filter(item => item !== id) };
    },
    insert(index: number, element: CanvasElement, at: number) {
      elements(index).splice(at, 0, element);
      const page = pages[index];
      if (page.readingOrder) pages[index] = { ...page, readingOrder: [...page.readingOrder, element.id] };
    },
    find(index: number, id: string) { return elementsOf(pages[index]).find(element => element.id === id); },
    done(): DesignDocument { return copied.size || pages.some((page, index) => page !== design.pages[index]) ? { ...design, pages } : design; },
  };
}
type Draft = ReturnType<typeof draft>;

/** The Wide photo block for a start half: the photo in its own proportions,
 * no larger than fits at `seam` (or exactly as large as fits with `refit`), and
 * the title, body and photo balanced between 90 and 1252. */
export function widePhotoGeometry(start: Pick<ImageElement, "width" | "height" | "intrinsicWidth" | "intrinsicHeight">, seam: number, refit: boolean) {
  seam = clamp(seam, SEAM_MIN, SEAM_MAX);
  const ratio = refit ? ratioOf(start as ImageElement) : start.width / start.height;
  const limit = Math.min(WIDE.width, seamLimit(seam));
  let width = refit ? Math.min(limit, WIDE_MAX_HEIGHT * ratio) : start.width, height = width / ratio;
  const k = Math.min(1, limit / width, WIDE_MAX_HEIGHT / height);
  width *= k; height *= k;
  const top = WIDE.top + (WIDE.bottom - WIDE.top - (WIDE.header + WIDE.gap + height)) / 2;
  return { x: PAGE - seam * width, y: top + WIDE.header + WIDE.gap, width, height, titleY: top, bodyY: top + WIDE.body };
}

/** Lays out a Wide photo pair in place: the photo, then the title and body on both pages. */
function layOutWide(work: Draft, pair: SpanPair, refit: boolean, seam = seamOf(pair.start)): SpanHalf {
  const geometry = widePhotoGeometry(pair.start, seam, refit);
  const start: SpanHalf = { ...pair.start, x: geometry.x, y: geometry.y, width: geometry.width, height: geometry.height, rotation: 0 };
  for (const index of [pair.startPage, pair.endPage]) {
    for (const element of elementsOf(work.pages[index])) {
      if (element.type !== "text" || (element.slot !== "title" && element.slot !== "body")) continue;
      const y = element.slot === "title" ? geometry.titleY : geometry.bodyY;
      if (Math.abs(element.y - y) > EPSILON) work.put(index, element, { ...element, y });
    }
  }
  return start;
}

/** A spanning photo in a new shape (a replaced photo, or an agent's new size)
 * keeps its height and seam where it can, and stays on its two pages. */
function reshaped(start: SpanHalf, seam: number): SpanHalf {
  const ratio = ratioOf(start);
  let height = start.height, width = height * ratio;
  const limit = seamLimit(clamp(seam, EPSILON, 1 - EPSILON));
  if (width > limit) { width = limit; height = width / ratio; }
  return { ...start, width, height, x: PAGE - seam * width, y: start.y + (start.height - height) / 2 };
}

export type SettleOptions = {
  /** The design before this change: halves that were linked there and aren't now are reported. */
  before?: DesignDocument;
  /** Span ids whose photo changed shape: the frame takes the photo's proportions again. */
  refit?: Set<string>;
};
/**
 * Puts every spanning photo in order after any change. Halves pair by
 * position (a start half with the end half that has its id on the next page);
 * each pair gets its own id; every end half follows its start half; the whole
 * photo stays on its two pages; Wide photo pages keep their balanced block.
 * A photo moved fully onto one page stops spanning (its empty half goes), and
 * halves without a partner are unlinked, each keeping the half it shows.
 */
export function reconcileSpans(design: DesignDocument, options: SettleOptions = {}): SpanReport {
  if (design.continuousCanvas || !hasSpans(design)) return { design, unlinked: [], onePage: [] };
  const work = draft(design), pairs = spanPairs(design), paired = new Set<CanvasElement>(), ids = new Set<string>(), onePage: number[] = [];
  for (const pair of pairs) {
    paired.add(pair.start); paired.add(pair.end);
    let start = pair.start, end = pair.end;
    if (ids.has(pair.id)) {
      const id = newSpanId();
      start = { ...start, span: { id, part: "start" } };
      end = { ...end, span: { id, part: "end" } };
    }
    ids.add(start.span.id);
    // A spanning photo stays upright, so neither slide crops a corner.
    if (start.rotation) start = { ...start, rotation: 0 };
    const current = { ...pair, start, end };
    if (isWidePair(current)) start = layOutWide(work, current, Boolean(options.refit?.has(pair.id)));
    else start = contained(options.refit?.has(pair.id) ? reshaped(start, clamp(seamOf(start), SEAM_MIN, SEAM_MAX)) : start);
    if (same(start, pair.start)) start = pair.start;
    // Fully on one page: it isn't spanning any more, so the empty half goes.
    if (!isWidePair(current) && start.x + start.width <= PAGE + EPSILON) {
      work.put(pair.startPage, pair.start, unspanned(start));
      work.remove(pair.endPage, pair.end.id);
      if (options.before) onePage.push(pair.startPage);
      continue;
    }
    if (!isWidePair(current) && start.x >= PAGE - EPSILON) {
      work.put(pair.endPage, pair.end, unspanned(mirrorHalf(start, end)));
      work.remove(pair.startPage, pair.start.id);
      if (options.before) onePage.push(pair.endPage);
      continue;
    }
    work.put(pair.startPage, pair.start, start);
    work.put(pair.endPage, pair.end, mirrorHalf(start, end));
  }
  const unlinked: number[] = [];
  const linkedBefore = new Set(options.before ? spanPairs(options.before).flatMap(pair => [`${options.before!.pages[pair.startPage].id}:${pair.start.id}`, `${options.before!.pages[pair.endPage].id}:${pair.end.id}`]) : []);
  design.pages.forEach((page, index) => {
    for (const element of elementsOf(page)) {
      if (!isSpanHalf(element) || paired.has(element)) continue;
      work.put(index, element, unspanned(element));
      if (linkedBefore.has(`${page.id}:${element.id}`) && !unlinked.includes(index)) unlinked.push(index);
    }
  });
  return { design: work.done(), unlinked, onePage };
}

const slideList = (indexes: number[]) => {
  const numbers = indexes.map(index => index + 1);
  return numbers.length < 3 ? numbers.join(" and ") : `${numbers.slice(0, -1).join(", ")} and ${numbers.at(-1)}`;
};
/** What an edit did to spanning photos, in a sentence for the editor's notice, or undefined. */
export function describeSpanChange(report: Pick<SpanReport, "unlinked" | "onePage">): string | undefined {
  const parts: string[] = [];
  if (report.onePage.length === 1) parts.push(`The photo is all on slide ${report.onePage[0] + 1} now, so it no longer spans two slides.`);
  else if (report.onePage.length) parts.push(`The photos on slides ${slideList(report.onePage)} are each on one slide now, so they no longer span two slides.`);
  if (report.unlinked.length === 1) parts.push(`The photo on slide ${report.unlinked[0] + 1} no longer continues on a neighboring slide. It keeps the half it shows.`);
  else if (report.unlinked.length) parts.push(`Slides ${slideList(report.unlinked)} no longer share photos with a neighboring slide. Each keeps the half it shows.`);
  return parts.length ? parts.join(" ") : undefined;
}

/**
 * The editor's commit hook: `next` is `previous` after one edit. A changed half
 * is mirrored to its twin (the start half wins when both changed), a half
 * deleted from a page that still exists takes its twin with it, and a replaced
 * photo takes its own shape. Then everything is settled by `reconcileSpans`.
 */
export function syncSpans(previous: DesignDocument, next: DesignDocument): SpanReport {
  if (next.continuousCanvas || !hasSpans(previous) && !hasSpans(next)) return { design: next, unlinked: [], onePage: [] };
  const work = draft(next), refit = new Set<string>();
  const pageIndex = new Map(next.pages.map((page, index) => [page.id, index]));
  const located = (page: DesignPage, element: CanvasElement) => {
    const index = pageIndex.get(page.id);
    return index === undefined ? undefined : { index, element: elementsOf(next.pages[index]).find(item => item.id === element.id) };
  };
  for (const pair of spanPairs(previous)) {
    const start = located(previous.pages[pair.startPage], pair.start), end = located(previous.pages[pair.endPage], pair.end);
    if (!start || !end) continue; // A deleted page unlinks the other half instead.
    if (!start.element && end.element) { work.remove(end.index, end.element.id); continue; }
    if (!end.element && start.element) { work.remove(start.index, start.element.id); continue; }
    if (!isSpanHalf(start.element) || !isSpanHalf(end.element)) continue;
    const startChanged = !same(start.element, pair.start), endChanged = !same(end.element, pair.end);
    const changed = startChanged ? { now: start.element, was: pair.start } : endChanged ? { now: end.element, was: pair.end } : undefined;
    if (!changed) continue;
    const photo = changed.now.src !== changed.was.src || changed.now.intrinsicWidth !== changed.was.intrinsicWidth || changed.now.intrinsicHeight !== changed.was.intrinsicHeight;
    const resized = changed.now.width !== changed.was.width || changed.now.height !== changed.was.height;
    // A new photo takes its own shape. On Wide photo pages anything but a resize
    // (a drag that moves the seam, a crop) keeps the photo as large as fits.
    if (photo || isWidePair(pair) && !resized) refit.add(start.element.span.id);
    if (!startChanged && endChanged && start.element.span.id === end.element.span.id) work.put(start.index, start.element, mirrorHalf(end.element, start.element));
  }
  return reconcileSpans(work.done(), { before: previous, refit });
}

/** The @chatgptricks cover never offers Span, so the editor hides the button for this reason. */
export const SPAN_COVER_BLOCKER = "The cover keeps its own photo and dark fade.";
/** Why a photo can't span from here, or undefined when it can. */
export function spanBlocker(design: DesignDocument, pageId: string, elementId: string): string | undefined {
  if (design.continuousCanvas) return "In a continuous carousel, drag the photo across the slide edge instead.";
  const index = design.pages.findIndex(page => page.id === pageId), page = design.pages[index];
  const element = elementsOf(page).find(item => item.id === elementId);
  if (!page || !element || element.type !== "image") return "Select a photo to span.";
  if (isSpanHalf(element)) return undefined;
  if (element.locked) return "Unlock the photo first.";
  if (element.templateRole === "brand") return "Brand layers stay where they are.";
  const brand = design.templateId === CHATGPTRICKS_TEMPLATE;
  if (brand && elementsOf(page).some(item => item.slot === "cover-headline")) return SPAN_COVER_BLOCKER;
  if (element.templateRole === "media" && !(brand && element.slot === "media")) return "This template photo stays in its frame.";
  const reuse = brand && element.templateRole === "media" ? headerOnly(design.pages[index + 1]) : spanTarget(design.pages[index + 1]);
  if (!reuse && design.pages.length >= MAX_PAGES) return "This carousel already has 20 slides, so there's no room for the second half.";
  return undefined;
}

/** A next page the photo can continue on: it shows no photo of its own. */
function spanTarget(page: DesignPage | undefined): boolean {
  return Boolean(page?.canvas) && !elementsOf(page).some(element => !element.hidden && element.templateRole !== "brand" && (element.type === "image" && !isPlaceholder(element) || element.type === "shape" && Boolean(element.imageFill)));
}
/** A @chatgptricks page with only a title, body and source (and brand layers or an unfilled placeholder). */
function headerOnly(page: DesignPage | undefined): boolean {
  if (!page?.canvas) return false;
  return elementsOf(page).every(element => element.hidden || element.templateRole === "brand" || isPlaceholder(element) || element.type === "text" && ["title", "body", "source"].includes(element.slot ?? ""));
}

export type SpanResult = { design: DesignDocument; start: { pageId: string; elementId: string }; end: { pageId: string; elementId: string }; addedPage: boolean };

/**
 * Span: the whole photo moves onto the seam between this page and the next,
 * in its own proportions, centered unless `seam` says otherwise. It continues
 * on the next page when that page shows no photo of its own, otherwise on a new
 * page inserted after this one. On @chatgptricks Text + Media pages both pages
 * become the Wide photo pair and keep their title, body and source. A photo
 * that already spans just moves its seam.
 */
export function spanPhoto(design: DesignDocument, pageId: string, elementId: string, seam = .5): SpanResult {
  seam = clamp(Number.isFinite(seam) ? seam : .5, SEAM_MIN, SEAM_MAX);
  const existing = findSpan(design, pageId, elementId);
  if (existing) {
    const moved = setSeam(design, pageId, elementId, seam);
    return { design: moved, start: { pageId: design.pages[existing.startPage].id, elementId: existing.start.id }, end: { pageId: design.pages[existing.endPage].id, elementId: existing.end.id }, addedPage: false };
  }
  const blocked = spanBlocker(design, pageId, elementId);
  if (blocked) throw new Error(blocked);
  const index = design.pages.findIndex(page => page.id === pageId), page = design.pages[index];
  const element = elementsOf(page).find(item => item.id === elementId) as ImageElement;
  if (design.templateId === CHATGPTRICKS_TEMPLATE && element.templateRole === "media") return spanTemplatePhoto(design, index, element, seam);

  const id = newSpanId(), reuse = spanTarget(design.pages[index + 1]);
  let pages = [...design.pages];
  if (!reuse) {
    const blank = duplicatePage(page);
    blank.canvas = { background: page.canvas!.background, elements: [], ...(page.canvas!.layout ? { layout: structuredClone(page.canvas!.layout) } : {}) };
    delete blank.label; delete blank.readingOrder; delete blank.publicDescription;
    pages.splice(index + 1, 0, blank);
  }
  const ratio = ratioOf(element);
  let height = element.height, width = height * ratio;
  const limit = seamLimit(seam);
  if (width > limit) { width = limit; height = width / ratio; }
  const start: SpanHalf = {
    ...element, x: PAGE - seam * width, y: element.y + (element.height - height) / 2, width, height, rotation: 0,
    fit: "cover", cropX: 50, cropY: 50, span: { id, part: "start" },
  };
  delete start.cropScale; delete start.clipBounds;
  const endShell: SpanHalf = { ...start, id: crypto.randomUUID(), span: { id, part: "end" } };
  for (const key of ["groupId", "master", "anchors", "slot", "protected", "templateRole", "layoutRole", "smartFlow", "componentId", "componentInstanceId", "componentSourceId"] as const) delete endShell[key];
  const end = mirrorHalf(start, endShell);
  const work = draft({ ...design, pages });
  work.put(index, element, start);
  const next = work.pages[index + 1];
  // Unfilled placeholders on the next page would show through; the photo sits under that page's text.
  for (const item of elementsOf(next)) if (isPlaceholder(item) && !item.hidden) work.put(index + 1, item, { ...item, hidden: true });
  const firstText = elementsOf(work.pages[index + 1]).findIndex(item => item.type === "text");
  work.insert(index + 1, end, firstText < 0 ? elementsOf(work.pages[index + 1]).length : firstText);
  pages = work.pages;
  const settled = reconcileSpans({ ...design, pages }).design;
  return { design: settled, start: { pageId: page.id, elementId: start.id }, end: { pageId: pages[index + 1].id, elementId: end.id }, addedPage: !reuse };
}

/** The template's Wide photo pages, start then end. */
export function widePhotoTemplatePages(): [DesignPage, DesignPage] | undefined {
  const template = BUILT_IN_TEMPLATES.find(candidate => candidate.id === CHATGPTRICKS_TEMPLATE);
  if (!template) return undefined;
  const index = template.pages.findIndex(page => elementsOf(page).some(element => isSpanHalf(element) && element.span.part === "start" && element.slot === WIDE_PHOTO_SLOT));
  return index >= 0 && template.pages[index + 1] ? [template.pages[index], template.pages[index + 1]] : undefined;
}

/** A @chatgptricks Text + Media page and the page after it become the Wide photo pair. */
function spanTemplatePhoto(design: DesignDocument, index: number, element: ImageElement, seam: number): SpanResult {
  const pair = widePhotoTemplatePages();
  if (!pair) throw new Error("This template has no Wide photo pages.");
  const current = design.pages[index], following = design.pages[index + 1], reuse = headerOnly(following);
  const text = (page: DesignPage | undefined, slot: string) => elementsOf(page).find((item): item is TextElement => item.type === "text" && item.slot === slot);
  const carry = (target: DesignPage, source: DesignPage | undefined, slots: string[]) => {
    for (const slot of slots) {
      const from = text(source, slot), to = text(target, slot);
      if (!from || !to) continue;
      Object.assign(to, { text: from.text, richText: from.richText, wordTextures: from.wordTextures });
      if (from.richText === undefined) delete to.richText;
      if (from.wordTextures === undefined) delete to.wordTextures;
    }
  };
  const start = duplicatePage(pair[0]), end = duplicatePage(pair[1]);
  start.id = current.id;
  carry(start, current, ["title", "body"]);
  if (reuse) { end.id = following.id; carry(end, following, ["title", "body", "source"]); }
  const source = text(current, "source");
  if (source?.text.trim()) carry(end, current, ["source"]);
  // An unfilled Text + Media frame keeps the pair's own wide placeholder.
  const photo = isPlaceholder(element) ? undefined : element, id = newSpanId();
  for (const page of [start, end]) for (const [at, item] of elementsOf(page).entries()) {
    if (!isSpanHalf(item)) continue;
    const half: SpanHalf = { ...item, span: { id, part: item.span.part } };
    if (photo) {
      Object.assign(half, { src: photo.src, fit: "cover", cropX: 50, cropY: 50 });
      for (const key of ["previewSrc", "publicAlt", "rightsNote", "sourceUrl"] as const) if (photo[key]) half[key] = photo[key];
      if (photo.provenance) half.provenance = structuredClone(photo.provenance);
      // Without the photo's own size the frame keeps the template's 16:9.
      if (photo.intrinsicWidth && photo.intrinsicHeight) Object.assign(half, { intrinsicWidth: photo.intrinsicWidth, intrinsicHeight: photo.intrinsicHeight });
      else { delete half.intrinsicWidth; delete half.intrinsicHeight; }
    }
    page.canvas!.elements[at] = half;
  }
  const pages = [...design.pages];
  pages.splice(index, reuse ? 2 : 1, start, end);
  if (!reuse && pages.length > MAX_PAGES) throw new Error("This carousel already has 20 slides, so there's no room for the second half.");
  let next: DesignDocument = { ...design, pages };
  const placed = spanPairs(next).find(item => item.startPage === index);
  if (!placed) throw new Error("The Wide photo pages couldn't be linked.");
  const work = draft(next);
  work.put(index, placed.start, layOutWide(work, placed, true, seam));
  next = reconcileSpans(work.done()).design;
  const settled = spanPairs(next).find(item => item.startPage === index)!;
  return { design: next, start: { pageId: start.id, elementId: settled.start.id }, end: { pageId: end.id, elementId: settled.end.id }, addedPage: !reuse };
}

/**
 * Moves the seam of a spanning photo, from either half. The photo keeps its
 * size and is never cropped; when it doesn't fit at the new seam it shrinks
 * just enough, keeping its shape (from `base`, the size when a slider drag
 * began, so dragging back restores it). Wide photo pages refit the photo to the
 * largest size that fits and rebalance the block.
 */
export function setSeam(design: DesignDocument, pageId: string, elementId: string, seam: number, base?: Pick<ImageElement, "y" | "width" | "height">): DesignDocument {
  const place = findSpan(design, pageId, elementId);
  if (!place) throw new Error("This photo doesn't continue on another slide.");
  seam = clamp(Number.isFinite(seam) ? seam : .5, SEAM_MIN, SEAM_MAX);
  const work = draft(design);
  let start: SpanHalf;
  if (isWidePair(place)) start = layOutWide(work, place, true, seam);
  else {
    const from = base ?? place.start, k = Math.min(1, seamLimit(seam) / from.width);
    const width = from.width * k, height = from.height * k;
    start = { ...place.start, width, height, x: PAGE - seam * width, y: from.y + (from.height - height) / 2 };
  }
  work.put(place.startPage, place.start, start);
  return reconcileSpans(work.done()).design;
}

/** Two ordinary photos: each half keeps what it shows. */
export function unlinkSpan(design: DesignDocument, pageId: string, elementId: string): DesignDocument {
  const place = findSpan(design, pageId, elementId);
  if (!place) return design;
  const work = draft(design);
  work.put(place.startPage, place.start, unspanned(place.start));
  work.put(place.endPage, place.end, unspanned(place.end));
  return work.done();
}

/** A duplicated page gets ordinary photos, never a third half. */
export function withoutSpans(page: DesignPage): DesignPage {
  if (!page.canvas?.elements.some(isSpanHalf)) return page;
  return { ...page, canvas: { ...page.canvas, elements: page.canvas.elements.map(element => isSpanHalf(element) ? unspanned(element) : element) } };
}

/** The pair's slide numbers and seam, for labels and agents. */
export function describeSpan(place: Pick<SpanPair, "startPage" | "endPage" | "start">) {
  return { slides: [place.startPage + 1, place.endPage + 1] as [number, number], seam: seamOf(place.start) };
}
