/**
 * Cutting pictures out of the original's slides, for the designer's
 * cut_from_source tool (design-tools.ts): a photo's box snapped to the
 * picture's real edges, a logo's mark found against its own background, and
 * the cut itself as a JPEG. Boxes are on a 0-1000 grid of the original slide.
 *
 * Copied from exact.ts (snapBox, cutLogo, cropOriginal and their helpers),
 * which keeps its own copy until the cleanup removes the first team's modules.
 */
import sharp from "sharp";
import type { SourceImage } from "./claude";
import type { MediaBox } from "./schemas";

/** Boxes are on a 0-1000 grid of the original slide; one smaller than 6% a side isn't a picture. */
export const GRID = 1000;
const MIN_SIDE = 60;
const clamp = (value: number, low: number, high: number) => Math.min(high, Math.max(low, value));
const tenth = (value: number) => Math.round(value * 10) / 10;

/** A box kept inside the slide, or null when it is missing or smaller than `min` a side (6% for a picture). */
export function cleanBox(box: MediaBox | null | undefined, min = MIN_SIDE): MediaBox | null {
  if (!box || ![box.x, box.y, box.width, box.height].every(Number.isFinite)) return null;
  const x = clamp(box.x, 0, GRID), y = clamp(box.y, 0, GRID);
  const width = clamp(box.width, 0, GRID - x), height = clamp(box.height, 0, GRID - y);
  return width >= min && height >= min ? { x: tenth(x), y: tenth(y), width: tenth(width), height: tenth(height) } : null;
}

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
export async function snapBox(image: SourceImage, box: MediaBox, kind: "photo" | "chart" | "screenshot" | "none" = "photo"): Promise<MediaBox> {
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

/** A row or grid of logos on an original slide: where it sits, how many logos a row holds, and their labels. One logo is a block of one. */
export type LogoCells = { box: MediaBox; columns: number; logos: { label: string }[] };
export type Cut = { url: string; width: number; height: number };

/**
 * One logo cut out of its cell in a logo block on the original slide: the
 * mark's ink found against the cell's own background (above its label when the
 * block has labels), with a little room around it. Null when the cell is blank.
 */
export async function cutLogo(image: SourceImage, block: LogoCells, index = 0): Promise<Cut | null> {
  const p = await pixelsOf(image);
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
export async function cropOriginal(image: SourceImage, box: MediaBox): Promise<Cut> {
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
