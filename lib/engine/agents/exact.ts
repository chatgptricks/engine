/**
 * Exact copy: the original post rebuilt as it is in the page's template, every
 * part in the page's style. One Claude call reads every slide word for word and
 * lays it out on the closest template page: a box around each photo and chart,
 * each graphic made of parts (a meme, a grid of logos, an article) described
 * part by part, and each post from X transcribed. Code snaps each box to the
 * picture's real edges. The chart rebuilder (exact-data.ts) finds each chart's
 * real numbers; the deck stage redraws the charts in our style, makes our post
 * cards (exact-posts.ts), rebuilds graphics in the template (rebuild.ts) with
 * logos found online by name (logos.ts), and cuts only photos out of the
 * original slides. Nothing else is researched or added: no hooks, no reader
 * questions, no reactions the original doesn't show, no Follow slide it
 * doesn't have. The headline model is never called.
 */
import type Anthropic from "@anthropic-ai/sdk";
import sharp from "sharp";
import type { BrandGuide } from "../../template-editor/brand-guide";
import { applyGuideToDeck } from "../../template-editor/guide-template";
import { formatDimensions, type CanvasElement, type DesignDocument, type DesignTemplate } from "../../template-editor/model";
import { findLogos, type LogoOptions, type LogoRequest, type LogoSource } from "../logos";
import { reactionSlots, type XReaction } from "../x-reactions";
import { ask, imageBlock, RecreateError, type SourceImage } from "./claude";
import { resolveChart } from "./charts";
import { need, outputOf, rerunNote, type StageRunner } from "./context";
import { assembleDeck, MAX_DECK_SLIDES, saveBuiltDeck, type AssembledPage, type AssembledSlide } from "./deck";
import { cardsFor, MAX_POST_SEARCHES } from "./exact-posts";
import { coverPage, describePages, followPage, reactionPageFor, singlePhotoPage, templatePages, type PageCatalog } from "./pages";
import { rolePrompt } from "./playbook";
import { fitLayerBudget, graphicArea, graphicBox, graphicWords, layoutGraphic, MAX_LAYERS, normalizeGraphic, partBox, rebuildStyle, type LaidOut, type PartFiles } from "./rebuild";
import { originalPost, originalSlides } from "./research";
import { TranscriptSchema, X_BADGES, type CopiedPost, type DeckOutput, type ExactDataOutput, type Graphic, type GraphicBlock, type MEDIA_KINDS, type MediaBox, type TranscriptOutput } from "./schemas";

type TranscriptSlide = TranscriptOutput["slides"][number];

/** Boxes are on a 0-1000 grid of the original slide; one smaller than 6% a side isn't a picture. */
export const GRID = 1000;
const MIN_SIDE = 60;
const message = (error: unknown) => error instanceof Error ? error.message : String(error);
const clamp = (value: number, low: number, high: number) => Math.min(high, Math.max(low, value));
const tenth = (value: number) => Math.round(value * 10) / 10;

/** The pages an exact copy can use: every page but a photo pair. The Reaction pages take the posts from X a slide shows, as our post cards. */
export const exactPages = (template: DesignTemplate): PageCatalog[] => templatePages(template).filter(page => !page.pair);

/** A box kept inside the slide, or null when it is missing or smaller than `min` a side (6% for a picture). */
export function cleanBox(box: MediaBox | null | undefined, min = MIN_SIDE): MediaBox | null {
  if (!box || ![box.x, box.y, box.width, box.height].every(Number.isFinite)) return null;
  const x = clamp(box.x, 0, GRID), y = clamp(box.y, 0, GRID);
  const width = clamp(box.width, 0, GRID - x), height = clamp(box.height, 0, GRID - y);
  return width >= min && height >= min ? { x: tenth(x), y: tenth(y), width: tenth(width), height: tenth(height) } : null;
}

/** At most this many posts from X a slide, and the smallest profile photo worth cutting (1.5% of the slide a side). */
const MAX_SLIDE_POSTS = 6, MIN_AVATAR = 15;
const DAY = /^\d{4}-\d{2}-\d{2}$/;
/** The posts a slide shows, cleaned: an @handle and words or a photo each (a card shows both), boxes inside the slide. */
export function normalizePosts(posts: readonly CopiedPost[] | undefined): CopiedPost[] {
  return (posts ?? []).flatMap((post): CopiedPost[] => {
    const handle = String(post.handle ?? "").trim().replace(/^@+/, "").slice(0, 50), name = String(post.name ?? "").trim().slice(0, 80);
    const text = String(post.text ?? "").replace(/\r\n?/g, "\n").trim(), photo = cleanBox(post.photo);
    if (!/^\w{1,50}$/.test(handle) || !text && !photo) return [];
    const box = cleanBox(post.box) ?? { x: 0, y: 0, width: GRID, height: GRID };
    const date = typeof post.date === "string" && DAY.test(post.date.trim()) ? post.date.trim() : null, link = typeof post.link === "string" && post.link.trim() ? post.link.trim().slice(0, 300) : null;
    const language = /^[a-z]{2}$/i.test(String(post.language ?? "").trim()) ? post.language.trim().toLowerCase() : "en";
    return [{ box, name: name || handle, handle, badge: X_BADGES.includes(post.badge) ? post.badge : "none", square: Boolean(post.square), text, language, date, link, avatar: cleanBox(post.avatar, MIN_AVATAR), photo }];
  });
}
/** One box around all of a slide's posts, to cut them whole when the template has no Reaction page. */
function postsBox(posts: CopiedPost[]): MediaBox | null {
  const left = Math.min(...posts.map(post => post.box.x)), top = Math.min(...posts.map(post => post.box.y));
  const right = Math.max(...posts.map(post => post.box.x + post.box.width)), bottom = Math.max(...posts.map(post => post.box.y + post.box.height));
  return cleanBox({ x: left, y: top, width: right - left, height: bottom - top });
}

/**
 * Keeps a transcript to what the template can show: real pages (the closest
 * photo page when one is made up), only the slots each page has (words for a
 * slot a page lacks go in its closest free slot, as a cover headline in a
 * page's title), a picture only where the page has a photo slot, and at most
 * 20 slides. A graphic made of parts goes on the page with a heading and a
 * photo frame, where it is rebuilt; a template without one cuts it whole. A
 * cover stays a cover: a photo with its headline the copier gave as a graphic
 * is cut whole as its photo. A slide of posts from X goes
 * on the Reaction page, whose cards show them; a template without one cuts
 * them whole, and a slide without posts never stays there. What had to be
 * left out is noted, so a person can put it back.
 */
export function normalizeTranscript(output: TranscriptOutput, pages: PageCatalog[], slideCount: number): TranscriptOutput {
  const rebuildOn = singlePhotoPage(pages), plain = pages.filter(page => !page.cards), cover = coverPage(pages);
  const fallback = rebuildOn ?? plain.find(page => page.text.length) ?? plain[0];
  // Each slot's role (cover, heading, body, list), to find a page's closest slot for words its own lacks.
  const roles = new Map(pages.flatMap(page => page.text.flatMap(slot => slot.role ? [[slot.slot, slot.role] as const] : [])));
  if (!fallback) return { ...output, slides: [] };
  const notes = [...output.notes], most = Math.max(1, slideCount);
  if (output.slides.length > MAX_DECK_SLIDES) notes.push(`Kept the first ${MAX_DECK_SLIDES} slides; Engine decks hold at most ${MAX_DECK_SLIDES}.`);
  const slides = output.slides.slice(0, MAX_DECK_SLIDES).map((slide, index) => {
    let graphic = normalizeGraphic(slide.graphic), posts = normalizePosts(slide.posts);
    const unreadable = (slide.posts?.length ?? 0) - posts.length;
    if (unreadable) notes.push(`Slide ${index + 1}: left out ${unreadable === 1 ? "a post" : `${unreadable} posts`} from X without an @handle, or without words or a photo.`);
    if (posts.length > MAX_SLIDE_POSTS) {
      notes.push(`Slide ${index + 1}: kept the first ${MAX_SLIDE_POSTS} of its ${posts.length} posts from X.`);
      posts = posts.slice(0, MAX_SLIDE_POSTS);
    }
    if (posts.length && graphic) {
      notes.push(`Slide ${index + 1}: its post${posts.length === 1 ? " is" : "s are"} rebuilt as part of the graphic, not as a post card.`);
      posts = [];
    }
    const cards = posts.length ? reactionPageFor(pages, posts.length) : undefined;
    let cut: { box: MediaBox | null; alt: string } | null = null;
    if (posts.length && !cards) {
      // No Reaction page: the posts are cut whole, as before.
      cut = { box: postsBox(posts), alt: posts.map(post => `@${post.handle}: ${post.text}`).join(" ").slice(0, 300) };
      notes.push(`Slide ${index + 1}: the post${posts.length === 1 ? " is" : "s are"} cut whole: the template has no Reaction page for post cards.`);
      posts = [];
    }
    const chosen = pages.find(candidate => candidate.index === slide.templatePage);
    // A cover stays a cover: a photo with its headline, logos and labels on it included, is cut whole as
    // its photo under the headline. A graphic without a headline (a meme put first) is rebuilt instead.
    const coverPicture = Boolean(graphic && !cut && chosen && chosen === cover && chosen.photo.length
      && slide.texts.some(entry => entry.text.trim() && chosen.text.some(slot => slot.slot === entry.slot))
      && graphic.panels.some(panel => panel.blocks.some(block => block.kind === "photo")));
    let coverCut: MediaBox | null = null, coverAlt = "";
    if (coverPicture && graphic) {
      [coverCut, coverAlt] = [cleanBox(graphicBox(graphic)), slide.media.alt.trim() || graphicWords(graphic).slice(0, 300)];
      notes.push(`Slide ${index + 1}: the cover keeps the original's picture whole as its photo, with what is drawn on it, under its headline.`);
      graphic = null;
    }
    const page = cards ?? (coverCut ? chosen! : graphic && rebuildOn ? rebuildOn : cut ? rebuildOn ?? fallback : chosen && !chosen.cards ? chosen : fallback);
    const names = new Set(page.text.map(slot => slot.slot)), taken = new Set(slide.texts.filter(entry => names.has(entry.slot) && entry.text.trim()).map(entry => entry.slot));
    const original = Number.isInteger(slide.original) && slide.original >= 1 && slide.original <= most ? slide.original : Math.min(index + 1, most);
    const placed = slide.texts.flatMap(entry => {
      if (names.has(entry.slot)) return [{ slot: entry.slot, text: entry.text.trim() }];
      if (!entry.text.trim()) return [];
      // Words for a slot this page lacks (a cover headline on a page with a title) go in its closest free slot.
      const role = roles.get(entry.slot), closest = page.text.find(slot => !taken.has(slot.slot) && slot.role === role)
        ?? page.text.find(slot => !taken.has(slot.slot) && (role === "cover" || role === "heading") && (slot.role === "cover" || slot.role === "heading"));
      if (closest) {
        taken.add(closest.slot);
        notes.push(`Slide ${index + 1}: "${entry.text.trim().slice(0, 80)}" goes in the ${page.label} page's ${closest.slot} slot, as it has no ${entry.slot} slot.`);
        return [{ slot: closest.slot, text: entry.text.trim() }];
      }
      notes.push(`Slide ${index + 1}: left out "${entry.text.trim().slice(0, 80)}", for a ${entry.slot} slot the ${page.label} page doesn't have.`);
      return [];
    });
    // One entry a slot. The deck sets a slot to its last entry, and the copier's empty entry for a slot
    // can follow the words moved into it; words win over an empty entry, and two with words are joined.
    const texts = [...placed.reduce((kept, entry) => {
      const before = kept.get(entry.slot);
      return kept.set(entry.slot, !before?.text ? entry : !entry.text || entry.text === before.text ? before : { slot: entry.slot, text: `${before.text}\n${entry.text}` });
    }, new Map<string, { slot: string; text: string }>()).values()];
    // A slide of posts shows them as cards: a box around the screenshot would only repeat them.
    let box = coverCut ?? (graphic || posts.length ? null : cut ? cut.box : slide.media.kind === "none" ? null : cleanBox(slide.media.box));
    let kind = coverCut ? "photo" as const : cut ? "screenshot" as const : slide.media.kind, alt = coverCut ? coverAlt : cut ? cut.alt : slide.media.alt.trim();
    if (graphic && !rebuildOn) {
      // No page to rebuild it on: the graphic is cut whole, as before.
      [box, kind, alt, graphic] = [cleanBox(graphicBox(graphic)), "screenshot", graphicWords(graphic).slice(0, 300), null];
      notes.push(`Slide ${index + 1}: the graphic is cut whole: the template has no page with a heading and a photo frame to rebuild it on.`);
    }
    if (box && !page.photo.length) notes.push(`Slide ${index + 1}: the original's ${kind} was left out, because the ${page.label} page has no photo slot.`);
    const media = box && page.photo.length ? { kind, box, alt } : { kind: "none" as const, box: null, alt: "" };
    return { original, templatePage: page.index, texts, media, graphic, posts };
  });
  return { ...output, name: output.name.trim() || "Exact copy", caption: output.caption.trim(), slides, notes };
}

// ── Cutting the pictures out ────────────────────────────────────────────────
type Pixels = { data: Buffer; width: number; height: number; channels: number };
/**
 * An edge moves at most 4% of the slide; it needs a clear colour change (0-255 a
 * channel) with the slide's own background, plain, just outside it. A colour
 * within MATCH of the background counts as background.
 */
const EDGE_REACH = .04, EDGE_STRENGTH = 20, PLAIN = 14, MATCH = 12, BORDER = .015, STRIP = 4, GAP = 2;

async function pixelsOf(image: SourceImage): Promise<Pixels> {
  const { data, info } = await sharp(Buffer.from(image.base64, "base64")).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  return { data, width: info.width, height: info.height, channels: info.channels };
}
const offset = (p: Pixels, columns: boolean, line: number, along: number) => (columns ? along * p.width + line : line * p.width + along) * p.channels;
const sampleStep = (from: number, to: number) => Math.max(1, Math.floor((to - from) / 300));

/** How sharply the slide changes between line `line - 1` and line `line` (columns when `columns`), along [from, to). */
function contrast(p: Pixels, columns: boolean, line: number, from: number, to: number): number {
  let sum = 0, count = 0;
  for (let along = from; along < to; along += sampleStep(from, to)) {
    const a = offset(p, columns, line - 1, along), b = offset(p, columns, line, along);
    sum += Math.abs(p.data[a] - p.data[b]) + Math.abs(p.data[a + 1] - p.data[b + 1]) + Math.abs(p.data[a + 2] - p.data[b + 2]);
    count += 3;
  }
  return count ? sum / count : 0;
}

const distance = (a: number[], b: number[]) => (Math.abs(a[0] - b[0]) + Math.abs(a[1] - b[1]) + Math.abs(a[2] - b[2])) / 3;
/** A pixel more than FAR from the background is something drawn on it; a region with more than STRAY of them isn't plain. */
const FAR = 40, STRAY = .002;
/**
 * Lines [start, end) along [from, to) are plain background: their colour
 * averages the slide's background, varies little, and almost no pixel is far
 * from it. The last test keeps thin text in: a column of small labels hardly
 * moves the average, but every glyph counts.
 */
function isBackground(p: Pixels, background: number[], columns: boolean, start: number, end: number, from: number, to: number): boolean {
  if (end <= start || to <= from) return true;
  const { data } = p, count = (end - start) * (to - from), [red, green, blue] = background;
  let far = 0, r = 0, g = 0, b = 0;
  for (let line = start; line < end; line++) for (let along = from; along < to; along++) {
    const at = offset(p, columns, line, along);
    r += data[at]; g += data[at + 1]; b += data[at + 2];
    if (Math.abs(data[at] - red) + Math.abs(data[at + 1] - green) + Math.abs(data[at + 2] - blue) > FAR * 3) far++;
  }
  if (far > count * STRAY) return false;
  const mean = [r / count, g / count, b / count];
  if (distance(mean, background) > MATCH) return false;
  let spread = 0;
  for (let line = start; line < end; line++) for (let along = from; along < to; along++) {
    const at = offset(p, columns, line, along);
    spread += Math.abs(data[at] - mean[0]) + Math.abs(data[at + 1] - mean[1]) + Math.abs(data[at + 2] - mean[2]);
  }
  return spread / count / 3 <= PLAIN;
}

/**
 * The slide's own background colour: the middle colour of its outer border,
 * when most of that border has it. Null when the border isn't plain (a picture
 * runs to the edge, or the background is a photo): then no edge is moved.
 */
function backgroundOf(p: Pixels): number[] | null {
  const band = Math.max(2, Math.round(Math.min(p.width, p.height) * BORDER)), samples: number[][] = [];
  const take = (x: number, y: number) => { const at = (y * p.width + x) * p.channels; samples.push([p.data[at], p.data[at + 1], p.data[at + 2]]); };
  const stepX = Math.max(1, Math.floor(p.width / 200)), stepY = Math.max(1, Math.floor(p.height / 200));
  for (let y = 0; y < band; y++) for (let x = 0; x < p.width; x += stepX) { take(x, y); take(x, p.height - 1 - y); }
  for (let x = 0; x < band; x++) for (let y = band; y < p.height - band; y += stepY) { take(x, y); take(p.width - 1 - x, y); }
  const middle = [0, 1, 2].map(channel => samples.map(sample => sample[channel]).sort((a, b) => a - b)[samples.length >> 1]);
  return samples.filter(sample => distance(sample, middle) <= MATCH).length >= samples.length * .6 ? middle : null;
}

/**
 * Moves one edge of a box to the picture's real edge nearby: a strong straight
 * change in colour with the slide's background just outside it. `outside` is -1
 * when the background lies before the edge (left, top) and 1 after it (right,
 * bottom). Moving in, the box sheds only background; an edge inside the picture
 * (a frame, a row of labels, a white margin) is never taken for its border. An
 * edge at the slide's border stays: the picture runs to the edge.
 */
function snapEdge(p: Pixels, background: number[], columns: boolean, line: number, from: number, to: number, outside: -1 | 1): number {
  const size = columns ? p.width : p.height, margin = STRIP + GAP;
  if (line <= size * BORDER || line >= size * (1 - BORDER) || to - from < 8) return line;
  const reach = Math.round(size * EDGE_REACH), candidates: { line: number; strength: number }[] = [];
  for (let candidate = Math.max(margin, line - reach); candidate <= Math.min(size - margin, line + reach); candidate++) {
    candidates.push({ line: candidate, strength: contrast(p, columns, candidate, from, to) });
  }
  candidates.sort((a, b) => b.strength - a.strength);
  for (const candidate of candidates.slice(0, 6)) {
    if (candidate.strength < EDGE_STRENGTH) break;
    const [start, end] = outside < 0 ? [candidate.line - GAP - STRIP, candidate.line - GAP] : [candidate.line + GAP, candidate.line + GAP + STRIP];
    if (!isBackground(p, background, columns, start, end, from, to)) continue;
    const inward = outside < 0 ? candidate.line > line : candidate.line < line;
    if (inward) {
      // Moving in sheds only background.
      const [shedStart, shedEnd] = outside < 0 ? [line, candidate.line - GAP] : [candidate.line + GAP, line];
      if (isBackground(p, background, columns, shedStart, shedEnd, from, to)) return candidate.line;
    } else {
      // Moving out only across picture: a line of background in between means the edge found
      // belongs to something else, such as a headline above the picture.
      const [low, high] = [Math.min(line, candidate.line), Math.max(line, candidate.line)];
      let across = true;
      for (let at = low; at < high && across; at++) across = !isBackground(p, background, columns, at, at + 1, from, to);
      if (across) return candidate.line;
    }
  }
  return line;
}

/**
 * A chart has no straight border: its labels and axes are thin, so a box can
 * end inside them. An edge first moves out across what is still chart (up to
 * 4% of the slide, over gaps of up to 1.5% such as those between label
 * columns), then in across plain background to the chart, then out again
 * across up to 2% of background, so labels at the edge stay whole and keep a
 * little room. `edge` is the box's first line when `outside` is -1 (left, top)
 * and the line just after its last when it is 1 (right, bottom).
 */
const CHART_JUMP = .015, CHART_ROOM = .02;
function chartEdge(p: Pixels, background: number[], columns: boolean, edge: number, from: number, to: number, outside: -1 | 1, far: number): number {
  const size = columns ? p.width : p.height, plain = (line: number) => isBackground(p, background, columns, line, line + 1, from, to);
  const beyond = (at: number) => outside < 0 ? at - 1 : at; // the line just outside an edge at `at`
  let reached = edge;
  for (let at = edge, gap = 0; Math.abs(at - edge) < size * EDGE_REACH && gap <= size * CHART_JUMP; at += outside) {
    const line = beyond(at);
    if (line < 0 || line >= size) break;
    if (plain(line)) gap++;
    else { reached = at + outside; gap = 0; }
  }
  let trimmed = reached;
  while ((trimmed - far) * outside > 0 && Math.abs(trimmed - far) > Math.abs(edge - far) / 2 && plain(outside < 0 ? trimmed : trimmed - 1)) trimmed -= outside;
  let padded = trimmed;
  while (Math.abs(padded - trimmed) < size * CHART_ROOM && beyond(padded) >= 0 && beyond(padded) < size && plain(beyond(padded))) padded += outside;
  return padded;
}

/**
 * Snaps a picture's box (0-1000 grid) to the picture's real edges on the
 * original slide, so the cut takes no background or stray text with it. A
 * chart's box is fitted to the chart instead, with a little room around it.
 */
export async function snapBox(image: SourceImage, box: MediaBox, kind: (typeof MEDIA_KINDS)[number] = "photo"): Promise<MediaBox> {
  const p = await pixelsOf(image), background = backgroundOf(p);
  if (!background) return box;
  const x0 = Math.round(box.x / GRID * p.width), x1 = Math.round((box.x + box.width) / GRID * p.width);
  const y0 = Math.round(box.y / GRID * p.height), y1 = Math.round((box.y + box.height) / GRID * p.height);
  // Edges are measured away from the box's corners, which may be rounded.
  const insetX = Math.round((x1 - x0) * .1), insetY = Math.round((y1 - y0) * .1);
  let left = snapEdge(p, background, true, x0, y0 + insetY, y1 - insetY, -1), right = snapEdge(p, background, true, x1, y0 + insetY, y1 - insetY, 1);
  let top = snapEdge(p, background, false, y0, x0 + insetX, x1 - insetX, -1), bottom = snapEdge(p, background, false, y1, x0 + insetX, x1 - insetX, 1);
  // A snap that would cut the picture to less than half of the box found a stray edge: the box stays.
  if (right - left < (x1 - x0) / 2 || bottom - top < (y1 - y0) / 2) [left, right, top, bottom] = [x0, x1, y0, y1];
  if (kind === "chart") {
    [left, right] = [chartEdge(p, background, true, left, top, bottom, -1, right), chartEdge(p, background, true, right, top, bottom, 1, left)];
    [top, bottom] = [chartEdge(p, background, false, top, left, right, -1, bottom), chartEdge(p, background, false, bottom, left, right, 1, top)];
  }
  if ([left, right, top, bottom].join() === [x0, x1, y0, y1].join()) return box;
  const grid = (value: number, size: number) => tenth(value / size * GRID);
  return cleanBox({ x: grid(left, p.width), y: grid(top, p.height), width: grid(right - left, p.width), height: grid(bottom - top, p.height) }) ?? box;
}

/** The colour just around a box (1% of the slide outside it), when most of that ring has it; null when the ring isn't plain. */
function ringColour(p: Pixels, x0: number, y0: number, x1: number, y1: number): number[] | null {
  const away = Math.max(2, Math.round(Math.min(p.width, p.height) * .01)), samples: number[][] = [];
  const take = (x: number, y: number) => {
    if (x < 0 || y < 0 || x >= p.width || y >= p.height) return;
    const at = (y * p.width + x) * p.channels;
    samples.push([p.data[at], p.data[at + 1], p.data[at + 2]]);
  };
  const stepX = Math.max(1, Math.floor((x1 - x0) / 100)), stepY = Math.max(1, Math.floor((y1 - y0) / 100));
  for (let x = x0; x < x1; x += stepX) { take(x, y0 - away); take(x, y1 - 1 + away); }
  for (let y = y0; y < y1; y += stepY) { take(x0 - away, y); take(x1 - 1 + away, y); }
  if (samples.length < 40) return null;
  const middle = [0, 1, 2].map(channel => samples.map(sample => sample[channel]).sort((a, b) => a - b)[samples.length >> 1]);
  return samples.filter(sample => distance(sample, middle) <= MATCH).length >= samples.length * .6 ? middle : null;
}

/** Lines of one flat colour, such as a frame drawn around a photo: 80% of the line (its ends left out) within 30 of its middle colour. */
function flatLine(p: Pixels, columns: boolean, line: number, from: number, to: number): boolean {
  const end = Math.round((to - from) * .03), samples: number[][] = [];
  for (let along = from + end; along < to - end; along += sampleStep(from, to)) {
    const at = offset(p, columns, line, along);
    samples.push([p.data[at], p.data[at + 1], p.data[at + 2]]);
  }
  if (samples.length < 8) return false;
  const middle = [0, 1, 2].map(channel => samples.map(sample => sample[channel]).sort((a, b) => a - b)[samples.length >> 1]);
  return samples.filter(sample => distance(sample, middle) <= 30).length >= samples.length * .8;
}
/** Moves each edge in across flat lines (a frame around a photo), by at most 3% of the side. */
function trimFrame(p: Pixels, left: number, right: number, top: number, bottom: number): [number, number, number, number] {
  const reachX = Math.round((right - left) * .03), reachY = Math.round((bottom - top) * .03);
  let [l, r, t, b] = [left, right, top, bottom];
  while (l - left < reachX && flatLine(p, true, l, top, bottom)) l++;
  while (right - r < reachX && flatLine(p, true, r - 1, top, bottom)) r--;
  while (t - top < reachY && flatLine(p, false, t, left, right)) t++;
  while (bottom - b < reachY && flatLine(p, false, b - 1, left, right)) b--;
  return [l, r, t, b];
}

/**
 * A photo inside a graphic sits on its panel's own background, not the
 * slide's: its edges snap against the colour just around its box when that
 * colour is plain, and a frame drawn around it is trimmed off.
 */
function snapPart(p: Pixels, box: MediaBox): MediaBox {
  const x0 = Math.round(box.x / GRID * p.width), x1 = Math.round((box.x + box.width) / GRID * p.width);
  const y0 = Math.round(box.y / GRID * p.height), y1 = Math.round((box.y + box.height) / GRID * p.height);
  if (x1 - x0 < 16 || y1 - y0 < 16) return box;
  let [left, right, top, bottom] = [x0, x1, y0, y1];
  const around = ringColour(p, x0, y0, x1, y1);
  if (around) {
    const insetX = Math.round((x1 - x0) * .1), insetY = Math.round((y1 - y0) * .1);
    [left, right] = [snapEdge(p, around, true, x0, y0 + insetY, y1 - insetY, -1), snapEdge(p, around, true, x1, y0 + insetY, y1 - insetY, 1)];
    [top, bottom] = [snapEdge(p, around, false, y0, x0 + insetX, x1 - insetX, -1), snapEdge(p, around, false, y1, x0 + insetX, x1 - insetX, 1)];
    if (right - left < (x1 - x0) / 2 || bottom - top < (y1 - y0) / 2) [left, right, top, bottom] = [x0, x1, y0, y1];
  }
  [left, right, top, bottom] = trimFrame(p, left, right, top, bottom);
  if ([left, right, top, bottom].join() === [x0, x1, y0, y1].join()) return box;
  const grid = (value: number, size: number) => tenth(value / size * GRID);
  return partBox({ x: grid(left, p.width), y: grid(top, p.height), width: grid(right - left, p.width), height: grid(bottom - top, p.height) }) ?? box;
}

/** Snaps each photo inside a graphic to its own edges; other parts keep their boxes. */
export async function snapGraphic(image: SourceImage, graphic: Graphic): Promise<Graphic> {
  if (!graphic.panels.some(panel => panel.blocks.some(block => block.kind === "photo"))) return graphic;
  const p = await pixelsOf(image);
  return { panels: graphic.panels.map(panel => ({ ...panel, blocks: panel.blocks.map(block => block.kind === "photo" ? { ...block, box: snapPart(p, block.box) } : block) })) };
}

/**
 * One logo cut out of its cell in a logo block on the original slide: the
 * mark's ink found against the cell's own background (above its label when the
 * block has labels), with a little room around it. Null when the cell is blank.
 */
async function cutLogo(image: SourceImage, p: Pixels, block: GraphicBlock, index: number): Promise<{ url: string; width: number; height: number } | null> {
  const columns = Math.max(1, block.columns), rows = Math.ceil(block.logos.length / columns), row = Math.floor(index / columns), column = index % columns;
  const cellWidth = block.box.width / GRID * p.width / columns, cellHeight = block.box.height / GRID * p.height / rows;
  const x0 = clamp(Math.round(block.box.x / GRID * p.width + column * cellWidth), 0, p.width - 1), x1 = clamp(Math.round(block.box.x / GRID * p.width + (column + 1) * cellWidth), x0 + 1, p.width);
  const y0 = clamp(Math.round(block.box.y / GRID * p.height + row * cellHeight), 0, p.height - 1);
  const y1 = clamp(Math.round(block.box.y / GRID * p.height + row * cellHeight + cellHeight * (block.logos.some(logo => logo.label) ? .74 : 1)), y0 + 1, p.height);
  const pixel = (x: number, y: number) => { const at = (y * p.width + x) * p.channels; return [p.data[at], p.data[at + 1], p.data[at + 2]]; };
  const edge: number[][] = [];
  for (let x = x0; x < x1; x++) edge.push(pixel(x, y0), pixel(x, y1 - 1));
  for (let y = y0; y < y1; y++) edge.push(pixel(x0, y), pixel(x1 - 1, y));
  const background = [0, 1, 2].map(channel => edge.map(sample => sample[channel]).sort((a, b) => a - b)[edge.length >> 1]);
  let [left, right, top, bottom] = [x1, x0, y1, y0];
  for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) {
    if (distance(pixel(x, y), background) <= FAR) continue;
    [left, right, top, bottom] = [Math.min(left, x), Math.max(right, x + 1), Math.min(top, y), Math.max(bottom, y + 1)];
  }
  if (right - left < 6 || bottom - top < 6) return null;
  const room = Math.round(Math.max(right - left, bottom - top) * .06);
  [left, right, top, bottom] = [Math.max(0, left - room), Math.min(p.width, right + room), Math.max(0, top - room), Math.min(p.height, bottom + room)];
  const grid = (value: number, size: number) => value / size * GRID;
  return cropOriginal(image, { x: grid(left, p.width), y: grid(top, p.height), width: grid(right - left, p.width), height: grid(bottom - top, p.height) });
}

/** A data URL stays well under the 2,000,000 characters a deck's photo slot takes. */
const MAX_CUT_URL = 1_900_000;
/** Cuts a box (0-1000 grid) out of an original slide as a JPEG data URL, with its size in pixels. */
export async function cropOriginal(image: SourceImage, box: MediaBox): Promise<{ url: string; width: number; height: number }> {
  const bytes = Buffer.from(image.base64, "base64");
  const { width: slideWidth = 0, height: slideHeight = 0 } = await sharp(bytes).metadata();
  if (!slideWidth || !slideHeight) throw new Error("the original slide can't be read");
  const left = clamp(Math.round(box.x / GRID * slideWidth), 0, slideWidth - 1), top = clamp(Math.round(box.y / GRID * slideHeight), 0, slideHeight - 1);
  const width = Math.min(slideWidth - left, Math.round(box.width / GRID * slideWidth)), height = Math.min(slideHeight - top, Math.round(box.height / GRID * slideHeight));
  if (width < 16 || height < 16) throw new Error("the box is too small");
  for (const quality of [90, 80, 70]) {
    const cut = await sharp(bytes).extract({ left, top, width, height }).flatten({ background: "#000000" }).jpeg({ quality }).toBuffer();
    const url = `data:image/jpeg;base64,${cut.toString("base64")}`;
    if (url.length <= MAX_CUT_URL) return { url, width, height };
  }
  throw new Error("the picture is too large to place");
}

// ── The stages ──────────────────────────────────────────────────────────────
export const transcript: StageRunner = async context => {
  const { file, profile, template } = context;
  const { images, source } = await originalPost(context);
  const pages = exactPages(template);
  if (!pages.length) throw new RecreateError(`${template.name} has no pages an exact copy can use.`, 409);
  const { caption, owner, url, notes } = source ?? file.source;
  const follow = followPage(pages), rebuildOn = singlePhotoPage(pages), cards = reactionPageFor(pages, 1), language = profile.language === "es" ? "Spanish" : "English";
  const rules = [
    `TEMPLATE "${template.name}" PAGES (templatePage is the page number)\n${describePages(pages)}`,
    `Write the slides and the caption in ${language}: word for word when the original is in ${language}, otherwise translated faithfully. Brand and product names stay as they are.`,
    "The character guides show what fits comfortably. An exact copy keeps the original's words even when they run longer, so choose the page with room for them.",
    "List slots (names ending in -items): one item per line, with no bullet characters or numbering.",
    follow ? `Follow page (page ${follow.index}): its first line "${profile.followCta.line1}" is fixed. Its text slot takes only the second line, at most ${profile.followCta.maxChars} characters.` : "",
    "Media boxes are on a 0-1000 grid of the original slide: x and y are the box's top-left corner, then its width and height. Give kind none and a null box when the slide has no picture.",
    rebuildOn
      ? `A graphic made of parts goes on page ${rebuildOn.index} (${rebuildOn.label}) with media kind none; leave that page's slots empty unless the original has words outside the graphic. Its panel and part boxes are on the same 0-1000 grid of the original slide.`
      : "This template has no page to rebuild a graphic on: give graphic null and cut every picture whole, as media.",
    rebuildOn ? `A chart goes on page ${rebuildOn.index} (${rebuildOn.label}) as media kind chart, boxed whole: Engine's chart rebuilder redraws it in our style from real data. The chart's own title goes in the title slot and its source line in the source slot, word for word.` : "",
    cards
      ? `Posts from X go on page ${cards.index} (${cards.label}): give each post under posts, in reading order, with media kind none and graphic null. Engine finds the real post on X or builds our card from your copy, so the page's only words are its title: the words outside the screenshot. A post keeps its own words in its own language, never translated. A post inside a bigger graphic (a meme with a post in one panel) is part of that graphic instead.`
      : "This template has no Reaction page: give posts empty and cut a screenshot of a post whole, as media kind screenshot.",
  ].filter(Boolean).join("\n\n");
  const content: Anthropic.Beta.BetaContentBlockParam[] = [
    ...images.flatMap((image, index): Anthropic.Beta.BetaContentBlockParam[] => [{ type: "text", text: `Original slide ${index + 1}:` }, imageBlock(image)]),
    { type: "text", text: [
      owner ? `Original creator: @${owner}` : "",
      url ? `Original post: ${url}` : "",
      `Original caption:\n${caption || "(none provided)"}`,
      notes ? `Teammate's notes: ${notes}` : "",
      rerunNote(context),
    ].filter(Boolean).join("\n\n") },
  ];
  const written = await ask({ role: "transcript", what: "copy the original post", system: rolePrompt("transcript", profile, rules), content, schema: TranscriptSchema, signal: context.signal, usage: context.usage });
  const plan = normalizeTranscript(written, pages, images.length);
  if (!plan.slides.length) throw new RecreateError("Claude found no slides to copy in the original. Try again.", 502);
  const slides = await Promise.all(plan.slides.map(async (slide): Promise<TranscriptSlide> => {
    const image = images[slide.original - 1], box = slide.media.box, graphic = slide.graphic;
    if (!image) return slide;
    return {
      ...slide,
      media: box ? { ...slide.media, box: await snapBox(image, box, slide.media.kind).catch(() => box) } : slide.media,
      graphic: graphic ? await snapGraphic(image, graphic).catch(() => graphic) : null,
    };
  }));
  return { output: { ...plan, slides } satisfies TranscriptOutput, source };
};

/** The cover headline in capitals, as the template sets it; [[accent]] marks stay. */
export function coverCaps(text: string, language: string): string {
  return text.toLocaleUpperCase(language === "es" ? "es" : "en");
}

/**
 * A cover's photo frame keeps the template's shape, so a picture cut wider than it (a picture over
 * the top half of the original, with the headline under it) would lose its sides to the crop. It
 * keeps its full width at the top of the cover instead, as the original shows it, and the fade
 * over the frame's foot moves up with it.
 */
export function fullWidthCover(elements: CanvasElement[]): void {
  for (const frame of elements) {
    if (frame.hidden || frame.type !== "image" || frame.templateRole !== "media" || !frame.slot || !frame.intrinsicWidth || !frame.intrinsicHeight) continue;
    const ratio = frame.intrinsicWidth / frame.intrinsicHeight, height = frame.width / ratio;
    // Within 5% of the frame's shape, the crop takes too little to matter.
    if (!(frame.height > 0) || ratio <= frame.width / frame.height * 1.05) continue;
    const foot = frame.y + frame.height, rise = frame.height - height;
    for (const shape of elements) {
      const over = shape.x < frame.x + frame.width && shape.x + shape.width > frame.x;
      if (shape.templateRole === "brand" && shape.type === "shape" && over && Math.abs(shape.y + shape.height - foot) <= 2 && shape.y >= frame.y) shape.y = Math.max(frame.y, shape.y - rise);
    }
    Object.assign(frame, { height, fit: "cover", cropX: 50, cropY: 50 });
  }
}

/**
 * An exact copy shows only what the original has. Empty text slots and empty
 * photo frames are hidden (Layers shows them again), except the Follow page's
 * profile screenshot, which a person adds; a one-slide post loses its swipe
 * prompt. A picture alone on its page takes the room of the hidden copy above
 * it, keeping its shape, as the original shows a meme or screenshot large. A
 * cover picture wider than the cover's frame keeps its full width (fullWidthCover).
 */
export function tidyExactDeck(document: DesignDocument, pages: AssembledPage[], catalog: PageCatalog[], swipeTexts: string[]): void {
  const follow = followPage(catalog)?.index, cover = coverPage(catalog)?.index, single = document.pages.length === 1;
  const swipes = new Set(swipeTexts.map(text => text.trim()).filter(Boolean));
  for (const page of document.pages) {
    const templatePage = pages.find(item => item.pageId === page.id)?.templatePage, elements = page.canvas?.elements ?? [];
    if (templatePage !== undefined && templatePage === cover) fullWidthCover(elements);
    for (const element of elements) {
      if (element.hidden) continue;
      if (element.templateRole === "brand") {
        if (single && element.type === "text" && swipes.has(element.text.trim())) element.hidden = true;
        continue;
      }
      if (!element.slot || element.slot.startsWith("reaction-")) continue;
      if (element.type === "text" && !element.text.trim()) element.hidden = true;
      const placeholder = element.type === "image" && element.templateRole === "media" && !element.slot.startsWith("topic-logo") && /^data:image\/svg\+xml/.test(element.src);
      if (placeholder && templatePage !== follow) element.hidden = true;
    }
    const byKey = new Map(elements.flatMap(element => [[element.id, element] as const, ...(element.slot ? [[element.slot, element] as const] : [])]));
    for (const element of elements) {
      const flow = element.smartFlow;
      if (element.hidden || element.type !== "image" || !flow?.media || flow.direction || flow.edge || !element.intrinsicWidth || !element.intrinsicHeight) continue;
      // Shown copy above it lays the picture out under itself; hidden copy leaves its room.
      let anchor = byKey.get(flow.after), top = element.y;
      for (let step = 0; anchor?.hidden && step < 8; step++) {
        top = Math.min(top, anchor.y);
        anchor = anchor.smartFlow ? byKey.get(anchor.smartFlow.after) : undefined;
      }
      if (anchor && !anchor.hidden) continue;
      const room = flow.bottom - top, ratio = element.intrinsicWidth / element.intrinsicHeight;
      if (room <= element.height) continue;
      const width = Math.min(flow.media.width, room * ratio), height = width / ratio;
      Object.assign(element, { x: flow.media.x + (flow.media.width - width) / 2, y: top + (room - height) / 2, width, height });
    }
  }
}

// ── Rebuilding graphics ─────────────────────────────────────────────────────
/**
 * A graphic rebuilt in the page's template (rebuild.ts): its logos found
 * online by name on the color they sit on, a plain icon or a logo not found
 * cut from its place on the original, its photos and other pictures cut one by
 * one, all laid out on the page's media area. A logo block that would pass
 * the slide's layers stays one picture. Throws when the graphic can't be
 * rebuilt at all; the deck then cuts it whole.
 */
export async function rebuildGraphic(slide: TranscriptSlide, index: number, input: { template: DesignTemplate; catalog: PageCatalog[]; image?: SourceImage; guide?: BrandGuide | null; signal: AbortSignal; fetch?: LogoOptions["fetch"] }, notes: string[]): Promise<LaidOut> {
  const { template, catalog, image, guide, signal } = input;
  const page = template.pages[slide.templatePage], photoSlot = catalog.find(item => item.index === slide.templatePage)?.photo[0]?.slot;
  if (!slide.graphic || !page || !photoSlot) throw new Error("its page has no photo frame");
  if (!image) throw new Error("its original slide is missing");
  const pixels = formatDimensions(template).width / 360, style = rebuildStyle(page, guide, pixels);
  const area = graphicArea(page, photoSlot, new Map(slide.texts.map(entry => [entry.slot, entry.text])), pixels);
  if (!area) throw new Error("the page's copy leaves it no room");
  const p = await pixelsOf(image), files: PartFiles = { pictures: new Map(), logos: new Map() };
  const wanted = slide.graphic.panels.flatMap((panel, panelAt) => panel.blocks.flatMap((block, blockAt) => block.kind !== "logos" ? [] :
    block.logos.map((logo, logoAt) => ({ key: `${panelAt}:${blockAt}:${logoAt}`, panelAt, blockAt, logoAt, logo, block, background: panel.card ? style.card : style.background }))));
  for (const background of new Set(wanted.filter(item => item.logo.brand).map(item => item.background))) {
    const items = wanted.filter(item => item.logo.brand && item.background === background);
    const found = await findLogos(items.map((item): LogoRequest => ({ brand: item.logo.brand, ...(item.logo.label ? { label: item.logo.label } : {}) })), { guide, background, ink: style.text.color, signal, ...(input.fetch ? { fetch: input.fetch } : {}) });
    items.forEach((item, at) => { const logo = found[at]; if (logo) files.logos.set(item.key, { found: logo }); });
  }
  const tiles = [...files.logos.values()].filter(file => "found" in file && file.found.tile).length;
  const { graphic, cut } = fitLayerBudget(slide.graphic, MAX_LAYERS - (page.canvas?.elements.length ?? 0) - 2, tiles);
  for (const block of cut) notes.push(`Slide ${index + 1}: a block of ${block.logos.length} logos stays one picture cut from the original: rebuilt, the slide would pass the ${MAX_LAYERS} layers a slide holds.`);
  await Promise.all([
    ...wanted.filter(item => !files.logos.has(item.key) && graphic.panels[item.panelAt].blocks[item.blockAt].kind === "logos").map(async item => {
      const logoCut = await cutLogo(image, p, item.block, item.logoAt).catch(() => null);
      if (logoCut) files.logos.set(item.key, { cut: logoCut });
    }),
    ...graphic.panels.flatMap((panel, panelAt) => panel.blocks.map(async (block, blockAt) => {
      if (block.kind !== "photo" && block.kind !== "picture") return;
      try {
        files.pictures.set(`${panelAt}:${blockAt}`, await cropOriginal(image, block.box));
      } catch (error) {
        notes.push(`Slide ${index + 1}: ${block.alt ? `the ${block.kind} of ${block.alt.slice(0, 80)}` : `a ${block.kind}`} couldn't be cut from the original (${message(error)}); add it by hand.`);
      }
    })),
  ]);
  return layoutGraphic({ graphic, slide: { width: p.width, height: p.height }, area, style, files, pixels, key: `s${index + 1}` });
}

const counted = (count: number, word: string) => `${count} ${word}${count === 1 ? "" : "s"}`;
const listed = (names: string[]) => names.length < 2 ? names.join("") : `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
/** What a team member should know about a rebuilt graphic. */
export function rebuildNotes(slide: number, graphic: Graphic, laid: Pick<LaidOut, "photos" | "logos" | "small">, minText = 24): string[] {
  const { found, cut, missing } = laid.logos, logos = found.length + cut.length + missing.length;
  return [
    `Slide ${slide}: rebuilt the graphic from its parts in the template: ${counted(graphic.panels.length, "panel")}, ${counted(laid.photos, "photo")} and ${counted(logos, "logo")}, each its own layer.`,
    cut.length ? `Slide ${slide}: no clean file was found for ${listed(cut)}, so ${cut.length === 1 ? "it is" : "they are"} cut from the original; swap in real files when you have them.` : "",
    missing.length ? `Slide ${slide}: ${listed(missing)} couldn't be found or cut; add ${missing.length === 1 ? "it" : "them"} by hand.` : "",
    laid.small.length ? `Slide ${slide}: ${listed(laid.small.map(words => `"${words.slice(0, 40)}"`))} may be set under ${minText} px to fit; check ${laid.small.length === 1 ? "it" : "them"} in the editor.` : "",
  ].filter(Boolean);
}
const LOGO_CREDITS: Record<LogoSource, string> = { guide: "the brand guide's logos", svgl: "svgl.app", "simple-icons": "Simple Icons (CC0)", lobe: "Lobe Icons (MIT)" };
/** Where the logos came from; the marks stay their owners'. */
export const logoCredits = (sources: LogoSource[]) => sources.length ? `Logos come from ${listed(sources.map(source => LOGO_CREDITS[source]))}. The marks remain their owners' trademarks, used as the original post uses them.` : "";

/**
 * Puts each rebuilt graphic's layers on its page, over the page's hidden photo
 * frame. The page's copy keeps the template's place instead of centring over
 * the graphic, and the note about an empty frame goes.
 */
export function placeRebuilt(document: DesignDocument, pages: AssembledPage[], rebuilt: Map<number, Pick<LaidOut, "elements" | "groups">>): string[] {
  const notes: string[] = [];
  for (const [slide, laid] of rebuilt) {
    const pageId = pages.find(item => item.slide === slide)?.pageId, page = document.pages.find(item => item.id === pageId);
    if (!page?.canvas) continue;
    if (page.canvas.elements.length + laid.elements.length > MAX_LAYERS || (page.canvas.groups?.length ?? 0) + laid.groups.length > MAX_LAYERS) {
      notes.push(`Slide ${slide + 1}: the rebuilt graphic has more layers than the slide holds; add it by hand.`);
      continue;
    }
    for (const element of page.canvas.elements) {
      delete element.smartCenter;
      if (element.templateRole === "media" && element.slot) {
        element.hidden = true;
        // A hidden frame with a flow gives its room back by centring the copy over it (smart-text's
        // balanceShortCopy), which would put the title behind the graphic that fills that room.
        delete element.smartFlow;
      }
    }
    page.canvas.elements.push(...laid.elements);
    page.canvas.groups = [...(page.canvas.groups ?? []), ...laid.groups];
    document.comments = (document.comments ?? []).filter(comment => comment.pageId !== page.id || !comment.text.startsWith("No photo or chart for this slide yet"));
  }
  return notes;
}

/** The designer for an exact copy: the transcript's words on its pages, charts redrawn from their real numbers, posts from X as our cards, graphics rebuilt from their parts, and only photos cut from the original slides. */
/** An exact copy's deck output also keeps the posts it looked up on X, so a rebuild (a fix round) doesn't search again. */
type ExactDeckOutput = DeckOutput & { posts?: { key: string; post: XReaction | null }[] };

/** How many of the deck's post cards show the real post from X. */
const postsFound = (found: number, cards: number) => found === cards ? cards === 1 ? "The post from X is the real one." : `All ${cards} posts from X are the real ones.`
  : !found ? `${cards === 1 ? "The post" : `All ${cards} posts`} from X ${cards === 1 ? "is" : "are"} built from the screenshot${cards === 1 ? "" : "s"}.`
  : `${found} of ${cards} posts from X ${found === 1 ? "is" : "are"} the real ${found === 1 ? "one" : "ones"}; the rest are built from the screenshots.`;

export const exactDeck: StageRunner = async context => {
  const { file, profile, template, templates } = context;
  const copied = need<TranscriptOutput>(file, "transcript");
  const images = await originalSlides(context);
  const previous = context.previous as ExactDeckOutput | undefined;
  const catalog = templatePages(template), cover = coverPage(catalog);
  const headline = cover?.text.find(slot => slot.role === "cover")?.slot ?? cover?.text[0]?.slot;
  const rebuilt = new Map<number, LaidOut>(), sources = new Set<LogoSource>();
  // Charts the chart rebuilder redrew from real data, by original slide, and why the others stay cut.
  const redrawn = outputOf<ExactDataOutput>(file, "data"), skipped = file.stages.data?.status === "skipped" ? file.stages.data.error : undefined;
  // Links to the posts may be in the original's caption (the copier's copy keeps them too).
  const lookup = { caption: [file.source.caption, copied.caption].filter(Boolean).join("\n"), signal: context.signal, budget: { searches: MAX_POST_SEARCHES }, known: new Map((previous?.posts ?? []).map(item => [item.key, item.post] as const)), reading: new Map() };
  let drawn = 0, cards = 0, found = 0;
  const built = await Promise.all(copied.slides.map(async (slide, index): Promise<{ slide: AssembledSlide; notes: string[] }> => {
    const texts = slide.texts.map(entry => slide.templatePage === cover?.index && entry.slot === headline ? { ...entry, text: coverCaps(entry.text, profile.language) } : entry);
    const base = { templatePage: slide.templatePage, slide: index, texts }, notes: string[] = [];
    const image = images[slide.original - 1];
    let { kind, box, alt } = slide.media;
    if (slide.posts?.length) {
      // Posts from X become our post cards: the real posts when they're found, else built from the screenshot.
      const made = await cardsFor(slide.posts, index + 1, { ...lookup, cut: part => image ? cropOriginal(image, part) : Promise.reject(new Error("its original slide is missing")) });
      cards += made.length;
      found += made.filter(card => card.found).length;
      // A post longer than its card holds is cut short there: its full words go in the notes.
      const short = made.filter(card => reactionSlots(card.post)["reaction-text"] !== card.post.text.trim())
        .map(card => `Slide ${index + 1}: the post by @${card.post.author.handle} is cut short to fit its card. Its full words: "${card.post.text.trim().replace(/\s+/g, " ").slice(0, 1200)}"`);
      return { slide: { ...base, reactions: made.map(card => card.post) }, notes: [...made.map(card => card.note), ...short] };
    }
    if (kind === "chart" && box) {
      const chart = redrawn?.charts.find(item => item.slide === slide.original);
      let why = redrawn?.missing.find(item => item.slide === slide.original)?.why ?? (skipped ? `the chart rebuilder stopped (${skipped.replace(/\.$/, "")})` : "it wasn't redrawn");
      if (chart) {
        try {
          await resolveChart(chart.chart, context.cache.chartData, context.signal);
          drawn++;
          return { slide: { ...base, chart: { chart: chart.chart, source: chart.source } }, notes: [`Slide ${index + 1}: the chart is redrawn in our style from real data (${chart.source}).`] };
        } catch (error) {
          if (context.signal.aborted) throw error;
          why = `its data couldn't be drawn (${message(error)})`;
        }
      }
      notes.push(`Slide ${index + 1}: the chart stays cut from the original: ${why.replace(/\.$/, "")}.`);
    }
    if (slide.graphic) {
      try {
        const laid = await rebuildGraphic(slide, index, { template, catalog, image, guide: context.guide, signal: context.signal }, notes);
        rebuilt.set(index, laid);
        laid.logos.sources.forEach(source => sources.add(source));
        return { slide: base, notes: [...rebuildNotes(index + 1, slide.graphic, laid, context.guide?.layout.minTextSize), ...notes] };
      } catch (error) {
        if (context.signal.aborted) throw error;
        notes.push(`Slide ${index + 1}: the graphic couldn't be rebuilt (${message(error)}), so it is cut whole from the original.`);
        [kind, box, alt] = ["screenshot", cleanBox(graphicBox(slide.graphic)), graphicWords(slide.graphic).slice(0, 300)];
      }
    }
    if (kind === "none" || !box) return { slide: base, notes };
    try {
      if (!image) throw new Error("its original slide is missing");
      const cut = await cropOriginal(image, box);
      return { slide: { ...base, photo: { url: cut.url, alt, credit: "cut from the original post", sourceUrl: file.source.url ?? "", size: { width: cut.width, height: cut.height }, ...(kind === "photo" ? {} : { fit: "contain" as const }) } }, notes };
    } catch (error) {
      if (context.signal.aborted) throw error;
      notes.push(`Slide ${index + 1}: the ${kind} couldn't be cut from the original (${message(error)}); add it by hand.`);
      return { slide: { ...base, photoBrief: alt || `the ${kind} on original slide ${slide.original}` }, notes };
    }
  }));
  const notes = [...copied.notes, ...built.flatMap(item => item.notes), logoCredits([...sources]), cards ? postsFound(found, cards) : ""].filter(Boolean);
  const origin = [file.source.owner ? `@${file.source.owner}` : "", file.source.url ?? ""].filter(Boolean).join(", ");
  const assembled = await assembleDeck({
    profile, template, templates, id: previous?.deckId, name: copied.name, caption: copied.caption, slides: built.map(item => item.slide), notes, signal: context.signal,
    chartData: context.cache.chartData,
    credit: `Exact copy of ${origin || "the original post"}, made by Recreate for ${profile.name}. The team's working file is ${file.id}; agents can read it with engine_recreate_status.`,
  });
  const single = assembled.document.pages.length === 1;
  if (context.guide) assembled.notes.push(...applyGuideToDeck(assembled.document, context.guide, { swipeText: single ? "" : profile.swipeText }));
  tidyExactDeck(assembled.document, assembled.pages, catalog, ["SWIPE FOR MORE", profile.swipeText]);
  assembled.notes.push(...placeRebuilt(assembled.document, assembled.pages, rebuilt));
  assembled.document.tags = [...new Set([...(assembled.document.tags ?? []), "exact-copy", ...(rebuilt.size ? ["rebuilt-graphics"] : []), ...(drawn ? ["redrawn-charts"] : []), ...(cards ? ["post-cards"] : [])])].slice(0, 20);
  const saved = await saveBuiltDeck(context.ownerKey, assembled, previous);
  return { output: { ...saved.output, posts: [...lookup.known].map(([key, post]) => ({ key, post })) } satisfies ExactDeckOutput };
};
