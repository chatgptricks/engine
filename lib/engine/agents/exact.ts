/**
 * Exact copy: the original post rebuilt as it is in the page's template. One
 * Claude call reads every slide word for word and lays it out on the closest
 * template page, with a box around the slide's photo, chart or screenshot.
 * Code snaps each box to the picture's real edges, the deck stage cuts the
 * pictures out of the original slides, and nothing is researched or added:
 * no hooks, no reader questions, no reactions, no Follow slide the original
 * doesn't have. The headline model is never called.
 */
import type Anthropic from "@anthropic-ai/sdk";
import sharp from "sharp";
import { applyGuideToDeck } from "../../template-editor/guide-template";
import type { DesignDocument, DesignTemplate } from "../../template-editor/model";
import { ask, imageBlock, RecreateError, type SourceImage } from "./claude";
import { need, rerunNote, type StageRunner } from "./context";
import { assembleDeck, MAX_DECK_SLIDES, saveBuiltDeck, type AssembledPage, type AssembledSlide } from "./deck";
import { coverPage, describePages, followPage, singlePhotoPage, templatePages, type PageCatalog } from "./pages";
import { rolePrompt } from "./playbook";
import { originalPost, originalSlides } from "./research";
import { TranscriptSchema, type DeckOutput, type MEDIA_KINDS, type MediaBox, type TranscriptOutput } from "./schemas";

/** Boxes are on a 0-1000 grid of the original slide; one smaller than 6% a side isn't a picture. */
export const GRID = 1000;
const MIN_SIDE = 60;
const message = (error: unknown) => error instanceof Error ? error.message : String(error);
const clamp = (value: number, low: number, high: number) => Math.min(high, Math.max(low, value));
const tenth = (value: number) => Math.round(value * 10) / 10;

/** The pages an exact copy can use: not the Reaction pages (they show real posts from X) nor a photo pair. */
export const exactPages = (template: DesignTemplate): PageCatalog[] => templatePages(template).filter(page => !page.cards && !page.pair);

/** A box kept inside the slide, or null when it is missing or too small to be a picture. */
export function cleanBox(box: MediaBox | null | undefined): MediaBox | null {
  if (!box || ![box.x, box.y, box.width, box.height].every(Number.isFinite)) return null;
  const x = clamp(box.x, 0, GRID), y = clamp(box.y, 0, GRID);
  const width = clamp(box.width, 0, GRID - x), height = clamp(box.height, 0, GRID - y);
  return width >= MIN_SIDE && height >= MIN_SIDE ? { x: tenth(x), y: tenth(y), width: tenth(width), height: tenth(height) } : null;
}

/**
 * Keeps a transcript to what the template can show: real pages (the closest
 * photo page when one is made up), only the slots each page has, a picture
 * only where the page has a photo slot, and at most 20 slides. What had to be
 * left out is noted, so a person can put it back.
 */
export function normalizeTranscript(output: TranscriptOutput, pages: PageCatalog[], slideCount: number): TranscriptOutput {
  const fallback = singlePhotoPage(pages) ?? pages.find(page => page.text.length) ?? pages[0];
  if (!fallback) return { ...output, slides: [] };
  const notes = [...output.notes], most = Math.max(1, slideCount);
  if (output.slides.length > MAX_DECK_SLIDES) notes.push(`Kept the first ${MAX_DECK_SLIDES} slides; Engine decks hold at most ${MAX_DECK_SLIDES}.`);
  const slides = output.slides.slice(0, MAX_DECK_SLIDES).map((slide, index) => {
    const page = pages.find(candidate => candidate.index === slide.templatePage) ?? fallback;
    const names = new Set(page.text.map(slot => slot.slot));
    const original = Number.isInteger(slide.original) && slide.original >= 1 && slide.original <= most ? slide.original : Math.min(index + 1, most);
    const texts = slide.texts.flatMap(entry => {
      if (names.has(entry.slot)) return [{ slot: entry.slot, text: entry.text.trim() }];
      if (entry.text.trim()) notes.push(`Slide ${index + 1}: left out "${entry.text.trim().slice(0, 80)}", for a ${entry.slot} slot the ${page.label} page doesn't have.`);
      return [];
    });
    const box = slide.media.kind === "none" ? null : cleanBox(slide.media.box);
    if (box && !page.photo.length) notes.push(`Slide ${index + 1}: the original's ${slide.media.kind} was left out, because the ${page.label} page has no photo slot.`);
    const media = box && page.photo.length ? { kind: slide.media.kind, box, alt: slide.media.alt.trim() } : { kind: "none" as const, box: null, alt: "" };
    return { original, templatePage: page.index, texts, media };
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
  const follow = followPage(pages), language = profile.language === "es" ? "Spanish" : "English";
  const rules = [
    `TEMPLATE "${template.name}" PAGES (templatePage is the page number)\n${describePages(pages)}`,
    `Write the slides and the caption in ${language}: word for word when the original is in ${language}, otherwise translated faithfully.`,
    "The character guides show what fits comfortably. An exact copy keeps the original's words even when they run longer, so choose the page with room for them.",
    "List slots (names ending in -items): one item per line, with no bullet characters or numbering.",
    follow ? `Follow page (page ${follow.index}): its first line "${profile.followCta.line1}" is fixed. Its text slot takes only the second line, at most ${profile.followCta.maxChars} characters.` : "",
    "Media boxes are on a 0-1000 grid of the original slide: x and y are the box's top-left corner, then its width and height. Give kind none and a null box when the slide has no picture.",
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
  const slides = await Promise.all(plan.slides.map(async slide => {
    const image = images[slide.original - 1], box = slide.media.box;
    if (!box || !image) return slide;
    return { ...slide, media: { ...slide.media, box: await snapBox(image, box, slide.media.kind).catch(() => box) } };
  }));
  return { output: { ...plan, slides } satisfies TranscriptOutput, source };
};

/** The cover headline in capitals, as the template sets it; [[accent]] marks stay. */
export function coverCaps(text: string, language: string): string {
  return text.toLocaleUpperCase(language === "es" ? "es" : "en");
}

/**
 * An exact copy shows only what the original has. Empty text slots and empty
 * photo frames are hidden (Layers shows them again), except the Follow page's
 * profile screenshot, which a person adds; a one-slide post loses its swipe
 * prompt. A picture alone on its page takes the room of the hidden copy above
 * it, keeping its shape, as the original shows a meme or screenshot large.
 */
export function tidyExactDeck(document: DesignDocument, pages: AssembledPage[], catalog: PageCatalog[], swipeTexts: string[]): void {
  const follow = followPage(catalog)?.index, single = document.pages.length === 1;
  const swipes = new Set(swipeTexts.map(text => text.trim()).filter(Boolean));
  for (const page of document.pages) {
    const templatePage = pages.find(item => item.pageId === page.id)?.templatePage, elements = page.canvas?.elements ?? [];
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

/** The designer for an exact copy: the transcript's words on its pages, each picture cut from its original slide. */
export const exactDeck: StageRunner = async context => {
  const { file, profile, template, templates } = context;
  const copied = need<TranscriptOutput>(file, "transcript");
  const images = await originalSlides(context);
  const previous = context.previous as DeckOutput | undefined;
  const catalog = templatePages(template), cover = coverPage(catalog);
  const headline = cover?.text.find(slot => slot.role === "cover")?.slot ?? cover?.text[0]?.slot;
  const notes = [...copied.notes];
  const slides = await Promise.all(copied.slides.map(async (slide, index): Promise<AssembledSlide> => {
    const texts = slide.texts.map(entry => slide.templatePage === cover?.index && entry.slot === headline ? { ...entry, text: coverCaps(entry.text, profile.language) } : entry);
    const base = { templatePage: slide.templatePage, slide: index, texts };
    const { kind, box, alt } = slide.media, image = images[slide.original - 1];
    if (kind === "none" || !box) return base;
    try {
      if (!image) throw new Error("its original slide is missing");
      const cut = await cropOriginal(image, box);
      return { ...base, photo: { url: cut.url, alt, credit: "cut from the original post", sourceUrl: file.source.url ?? "", size: { width: cut.width, height: cut.height }, ...(kind === "photo" ? {} : { fit: "contain" as const }) } };
    } catch (error) {
      if (context.signal.aborted) throw error;
      notes.push(`Slide ${index + 1}: the ${kind} couldn't be cut from the original (${message(error)}); add it by hand.`);
      return { ...base, photoBrief: alt || `the ${kind} on original slide ${slide.original}` };
    }
  }));
  const origin = [file.source.owner ? `@${file.source.owner}` : "", file.source.url ?? ""].filter(Boolean).join(", ");
  const assembled = await assembleDeck({
    profile, template, templates, id: previous?.deckId, name: copied.name, caption: copied.caption, slides, notes, signal: context.signal,
    credit: `Exact copy of ${origin || "the original post"}, made by Recreate for ${profile.name}. The team's working file is ${file.id}; agents can read it with engine_recreate_status.`,
  });
  const single = assembled.document.pages.length === 1;
  if (context.guide) assembled.notes.push(...applyGuideToDeck(assembled.document, context.guide, { swipeText: single ? "" : profile.swipeText }));
  tidyExactDeck(assembled.document, assembled.pages, catalog, ["SWIPE FOR MORE", profile.swipeText]);
  assembled.document.tags = [...new Set([...(assembled.document.tags ?? []), "exact-copy"])].slice(0, 20);
  return saveBuiltDeck(context.ownerKey, assembled, previous);
};
