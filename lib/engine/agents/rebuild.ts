/**
 * Rebuilding a graphic made of parts (a meme, a grid of logos, a diagram with
 * words) in the page's template, for an exact copy. The copier describes the
 * graphic's panels and their parts with boxes on the original slide; code lays
 * them out on the page's media area at one scale, so the original's
 * arrangement holds, in the page's look: each panel a card in the page's
 * surface color, headings in its title style, other words in its text style,
 * photos cut one by one with rounded corners, and logos as even grids with
 * their labels, never under the page's smallest text size (a dense grid takes
 * the room its labels need). Every part is its own layer, grouped by panel.
 */
import { randomUUID } from "node:crypto";
import { guideTokens, type BrandGuide } from "../../template-editor/brand-guide";
import { createCanvasElement, type CanvasElement, type CanvasGradient, type CanvasGroup, type DesignPage, type TextElement } from "../../template-editor/model";
import type { FoundLogo, LogoSource } from "../logos";
import type { Graphic, GraphicBlock, MediaBox } from "./schemas";

/** Boxes are on a 0-1000 grid of the original slide. */
export const GRID = 1000;
/** A part smaller than 1.5% of the slide a side isn't one. */
const MIN_PART = 15, MAX_PANELS = 6, MAX_BLOCKS = 16, MAX_LOGOS = 60;
/** A slide's layers, the template's own included. */
export const MAX_LAYERS = 100;
const clamp = (value: number, low: number, high: number) => Math.min(high, Math.max(low, value));
const tenth = (value: number) => Math.round(value * 10) / 10;

// ── The copier's graphic, checked ───────────────────────────────────────────
/** A part's box inside `within` (the slide when absent), or null when too small to be one. */
export function partBox(box: MediaBox | null | undefined, within: MediaBox = { x: 0, y: 0, width: GRID, height: GRID }): MediaBox | null {
  if (!box || ![box.x, box.y, box.width, box.height].every(Number.isFinite)) return null;
  const x = clamp(box.x, within.x, within.x + within.width), y = clamp(box.y, within.y, within.y + within.height);
  const width = clamp(box.x + box.width, x, within.x + within.width) - x, height = clamp(box.y + box.height, y, within.y + within.height) - y;
  return width >= MIN_PART && height >= MIN_PART ? { x: tenth(x), y: tenth(y), width: tenth(width), height: tenth(height) } : null;
}

/**
 * Keeps a graphic to parts that can be laid out: panels and blocks with real
 * boxes (blocks inside their panel), words for headings and text, logos with
 * a row length the grid can use. Null when nothing is left.
 */
export function normalizeGraphic(graphic: Graphic | null | undefined): Graphic | null {
  if (!graphic?.panels?.length) return null;
  const panels = graphic.panels.slice(0, MAX_PANELS).flatMap(panel => {
    const box = partBox(panel.box);
    if (!box) return [];
    const blocks = panel.blocks.slice(0, MAX_BLOCKS).flatMap((block): GraphicBlock[] => {
      const inside = partBox(block.box, box);
      if (!inside) return [];
      const align = (["left", "center", "right"] as const).includes(block.align) ? block.align : "center";
      const plain = { kind: block.kind, box: inside, align, text: "", columns: 0, logos: [], alt: "" };
      if (block.kind === "heading" || block.kind === "text") {
        const text = block.text.replace(/\r\n?/g, "\n").trim();
        return text ? [{ ...plain, text }] : [];
      }
      if (block.kind === "logos") {
        const logos = block.logos.slice(0, MAX_LOGOS).map(logo => ({ brand: logo.brand.trim().slice(0, 80), label: logo.label.trim().slice(0, 80) })).filter(logo => logo.brand || logo.label);
        if (!logos.length) return [];
        return [{ ...plain, columns: clamp(Math.round(block.columns) || logos.length, 1, logos.length), logos }];
      }
      return [{ ...plain, alt: block.alt.trim().slice(0, 2000) }];
    });
    return blocks.length ? [{ box, card: Boolean(panel.card), blocks }] : [];
  });
  return panels.length ? { panels } : null;
}

/** The graphic's box on the original slide: around all its panels. */
export function graphicBox(graphic: Graphic): MediaBox {
  const boxes = graphic.panels.map(panel => panel.box);
  const x = Math.min(...boxes.map(box => box.x)), y = Math.min(...boxes.map(box => box.y));
  return { x, y, width: Math.max(...boxes.map(box => box.x + box.width)) - x, height: Math.max(...boxes.map(box => box.y + box.height)) - y };
}

/** Words without the [[marks]] the copier sets them apart with. */
const unmarked = (value: string) => value.replace(/\[\[|\]\]/g, "");
/** Words a graphic shows, for describing it in one line. */
export const graphicWords = (graphic: Graphic) => graphic.panels.flatMap(panel => panel.blocks.filter(block => block.kind === "heading" || block.kind === "text").map(block => unmarked(block.text).replace(/\s+/g, " "))).join(" / ");

/** Layers a rebuilt graphic adds: a card per carded panel, one per heading, text, photo and picture, and a logo, its label and its tile. */
export function graphicLayers(graphic: Graphic, tiles = 0): number {
  return graphic.panels.reduce((total, panel) => total + (panel.card ? 1 : 0) + panel.blocks.reduce((sum, block) =>
    sum + (block.kind === "logos" ? block.logos.length + block.logos.filter(logo => logo.label).length : 1), 0), tiles);
}

/**
 * A graphic that fits the slide's layers: while it has too many, its largest
 * logo block is kept as one picture cut from the original instead. Blocks keep
 * their places, so keys to their parts stay valid. Returns the graphic and the
 * blocks that became pictures.
 */
export function fitLayerBudget(graphic: Graphic, budget: number, tiles = 0): { graphic: Graphic; cut: GraphicBlock[] } {
  const next: Graphic = structuredClone(graphic), cut: GraphicBlock[] = [];
  while (graphicLayers(next, tiles) > budget) {
    const largest = next.panels.flatMap(panel => panel.blocks).filter(block => block.kind === "logos").sort((a, b) => b.logos.length - a.logos.length)[0];
    if (!largest) break;
    cut.push(structuredClone(largest));
    Object.assign(largest, { kind: "picture", alt: `Logos: ${largest.logos.map(logo => logo.label || logo.brand).join(", ")}`.slice(0, 2000), columns: 0, logos: [] });
  }
  return { graphic: next, cut };
}

// ── Text sizes, measured roughly on the server ──────────────────────────────
export type TextLook = { font: string; weight: number; size: number; lineHeight: number; tracking: number; color: string; gradient?: CanvasGradient };
const NARROW = new Set([..."ijl!.,:;'|`"]), SEMI = new Set([..."frtI()[]{}-\"/ "]);
/**
 * A text's width in px at `size`, from typical advance widths of the page's
 * sans fonts, a little generous: the editor fits the text with the real font,
 * this only decides how much room to leave.
 */
export function textWidth(text: string, size: number, look: Pick<TextLook, "weight" | "tracking">): number {
  let em = 0;
  for (const char of text) em += NARROW.has(char) ? .27 : SEMI.has(char) ? .36 : /[mw]/.test(char) ? .84 : /[MW@%]/.test(char) ? .9 : /[A-Z]/.test(char) ? .66 : /\d/.test(char) ? .6 : .56;
  return (em * (look.weight >= 600 ? 1.06 : 1) + look.tracking * [...text].length) * size * 1.04;
}
const longestWord = (text: string, size: number, look: Pick<TextLook, "weight" | "tracking">) => Math.max(0, ...text.split(/\s+/).map(word => textWidth(word, size, look)));
/** Lines `text` wraps to at `size` across `width`. */
function lineCount(text: string, size: number, width: number, look: TextLook): number {
  let lines = 0;
  const space = textWidth(" ", size, look);
  for (const paragraph of text.split("\n")) {
    let used = 0;
    lines++;
    for (const word of paragraph.split(/\s+/).filter(Boolean)) {
      const wide = textWidth(word, size, look);
      if (used && used + space + wide > width) { lines++; used = wide; } else used += (used ? space : 0) + wide;
    }
  }
  return Math.max(1, lines);
}
const fitsAt = (text: string, size: number, width: number, height: number, look: TextLook) => longestWord(text, size, look) <= width && lineCount(text, size, width, look) * size * look.lineHeight <= height + .01;
/** The largest size from `min` to `max`, in half pixels, at which `text` fits `width` by `height`; null when even `min` doesn't. */
function fittedSize(text: string, look: TextLook, width: number, height: number, min: number, max: number): number | null {
  for (let size = max; size >= min; size -= .5) if (fitsAt(text, size, width, height, look)) return size;
  return fitsAt(text, min, width, height, look) ? min : null;
}

// ── The page's look ─────────────────────────────────────────────────────────
export type RebuildStyle = { heading: TextLook; text: TextLook; label: TextLook; card: string; tile: string; background: string; minText: number; cardRadius: number; photoRadius: number; accent?: string };
const escapeHtml = (value: string) => value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
/** "[[words]]" the original sets apart: the words without the marks, and rich text with them in the accent color. */
export function accented(value: string, accent: string): { text: string; richText?: string } {
  const text = value.replace(/\[\[([^\]]+)\]\]/g, "$1").replace(/\[\[|\]\]/g, "");
  if (!/\[\[[^\]]+\]\]/.test(value)) return { text };
  const richText = value.split(/(\[\[[^\]]+\]\])/g).map(part => {
    const match = /^\[\[([^\]]+)\]\]$/.exec(part);
    return match ? `<span style="color: ${accent}">${escapeHtml(match[1])}</span>` : escapeHtml(part.replace(/\[\[|\]\]/g, ""));
  }).join("").replace(/\n/g, "<br>");
  return { text, richText };
}
const hexOf = (value: string) => /^#[0-9a-f]{6}/i.test(value) ? value.slice(0, 7) : null;
function mix(a: string, b: string, share: number): string {
  const [x, y] = [hexOf(a), hexOf(b)];
  if (!x || !y) return a;
  return `#${[1, 3, 5].map(at => Math.round(parseInt(x.slice(at, at + 2), 16) * (1 - share) + parseInt(y.slice(at, at + 2), 16) * share).toString(16).padStart(2, "0")).join("").toUpperCase()}`;
}
const dark = (value: string) => { const hex = hexOf(value); if (!hex) return true; const [r, g, b] = [1, 3, 5].map(at => parseInt(hex.slice(at, at + 2), 16)); return .299 * r + .587 * g + .114 * b < 128; };

/**
 * The rebuilt graphic's look, from the page itself: headings as its title,
 * other words as its text, labels as its list items in its secondary color.
 * With a brand guide, colors are the guide's: cards in its surface color,
 * text in its text color, labels in its secondary color.
 */
export function rebuildStyle(page: DesignPage, guide: BrandGuide | null | undefined, pixels: number): RebuildStyle {
  const elements = page.canvas?.elements ?? [], background = page.canvas?.background ?? "#000000";
  const text = (test: (element: TextElement) => boolean) => elements.find((element): element is TextElement => element.type === "text" && test(element));
  const title = text(element => element.slot === "title") ?? text(element => element.smartText?.role === "heading");
  const body = text(element => element.slot === "body") ?? text(element => element.smartText?.role === "body");
  const tokens = guide ? guideTokens(guide) : null;
  const look = (element: TextElement | undefined, fallback: { size: number; weight: number }, color: string): TextLook => ({
    font: element?.font ?? "sfpro", weight: element?.fontWeight ?? fallback.weight,
    size: element ? (element.smartText?.maxFontSize ?? element.fontSize) * pixels : fallback.size,
    lineHeight: element?.lineHeight ?? 1.2, tracking: element && element.fontSize ? element.letterSpacing / element.fontSize : 0,
    color, ...(element?.gradient ? { gradient: structuredClone(element.gradient) } : {}),
  });
  const ink = tokens?.text ?? body?.color ?? (dark(background) ? "#FFFFFF" : "#000000");
  const heading = look(title, { size: 56, weight: 700 }, title?.color ?? tokens?.accent ?? ink);
  const words = look(body, { size: 43, weight: 400 }, ink);
  const card = tokens?.surface && tokens.surface.toUpperCase() !== tokens.background.toUpperCase() ? tokens.surface : mix(background, ink, .08);
  const accent = tokens?.accent ?? (title?.color && title.color.toUpperCase() !== ink.toUpperCase() ? title.color : "#00D98A");
  return {
    heading, text: words, accent,
    label: { font: words.font, weight: 400, size: tokens?.styles.list?.size ?? Math.round(words.size * .8), lineHeight: 1.15, tracking: 0, color: tokens?.secondary ?? ink },
    card, tile: dark(card) ? (tokens?.text ?? "#FFFFFF") : background, background,
    minText: guide?.layout.minTextSize ?? 24, cardRadius: 28, photoRadius: 20,
  };
}

// ── Where the graphic goes ──────────────────────────────────────────────────
export type Rect = { x: number; y: number; width: number; height: number };
/**
 * The page's media area in px: across the media frame, from under the copy the
 * slide shows (the page's top when it shows none) down to the frame's bottom,
 * or to the foot of the source line when the slide has none.
 */
export function graphicArea(page: DesignPage, photoSlot: string, shown: Map<string, string>, pixels: number): Rect | null {
  const elements = page.canvas?.elements ?? [], frame = elements.find(element => element.slot === photoSlot);
  if (!frame) return null;
  const k = pixels, texts = elements.filter((element): element is TextElement => element.type === "text" && Boolean(element.slot));
  const above = texts.filter(element => element.y + element.height <= frame.y + 1).sort((a, b) => a.y - b.y);
  const below = texts.filter(element => element.y >= frame.y + frame.height - 1);
  let top = Math.min(frame.y, ...above.map(element => element.y)) * k, wrote = false;
  for (const element of above) {
    const words = shown.get(element.slot!)?.trim();
    if (!words) continue;
    const size = (element.smartText?.maxFontSize ?? element.fontSize) * k, look: TextLook = { font: element.font, weight: element.fontWeight, size, lineHeight: element.lineHeight, tracking: element.fontSize ? element.letterSpacing / element.fontSize : 0, color: element.color };
    top += (wrote ? (element.smartFlow?.gap ?? 0) * k : 0) + lineCount(words, size, element.width * k, look) * size * element.lineHeight;
    wrote = true;
  }
  if (wrote) top += (frame.smartFlow?.gap ?? 20) * k;
  const frameBottom = (frame.smartFlow && !frame.smartFlow.direction ? frame.smartFlow.bottom : frame.y + frame.height) * k;
  const footer = below.filter(element => shown.get(element.slot!)?.trim());
  const bottom = footer.length || !below.length ? frameBottom : Math.max(...below.map(element => element.y + element.height)) * k;
  return bottom - top >= 120 ? { x: frame.x * k, y: top, width: frame.width * k, height: bottom - top } : null;
}

// ── The layout ──────────────────────────────────────────────────────────────
type Cut = { url: string; width: number; height: number };
/** What the deck stage found or cut for each part, keyed `panel:block` and `panel:block:logo`. */
export type PartFiles = { pictures: Map<string, Cut>; logos: Map<string, { found: FoundLogo } | { cut: Cut }> };
const MAX_SCALE = 2.5, GAP = 16, MIN_LOGO = 40, FLOOR = 12;

function union(rects: Rect[]): Rect {
  const x = Math.min(...rects.map(rect => rect.x)), y = Math.min(...rects.map(rect => rect.y));
  return { x, y, width: Math.max(...rects.map(rect => rect.x + rect.width)) - x, height: Math.max(...rects.map(rect => rect.y + rect.height)) - y };
}
/** A span grown to `needed`, around its middle, kept within [low, high]. */
function grow(start: number, size: number, needed: number, low: number, high: number): [number, number] {
  const want = Math.min(needed, high - low);
  if (want <= size) return [start, size];
  return [clamp(start - (want - size) / 2, low, high - want), want];
}
type Extent = { left: number; right: number; top: number; bottom: number };
/** A part a block's room stops at, and whether it grows into the space between them too. */
type Neighbour = { rect: Rect; grows: boolean };
const grows = (block: GraphicBlock) => block.kind !== "photo" && block.kind !== "picture";
/**
 * The room a block may take: up to its neighbours, sharing the space between
 * two parts that both grow, and never less than its own box.
 */
function freeRoom(rect: Rect, neighbours: Neighbour[], bounds: Rect): Extent {
  let left = bounds.x, right = bounds.x + bounds.width, top = bounds.y, bottom = bounds.y + bounds.height;
  for (const { rect: other, grows: share } of neighbours) {
    const across = other.y < rect.y + rect.height && other.y + other.height > rect.y, along = other.x < rect.x + rect.width && other.x + other.width > rect.x;
    if (across && other.x + other.width <= rect.x + 1) left = Math.max(left, share ? (other.x + other.width + rect.x + GAP) / 2 : other.x + other.width + GAP);
    else if (across && other.x >= rect.x + rect.width - 1) right = Math.min(right, share ? (rect.x + rect.width + other.x - GAP) / 2 : other.x - GAP);
    if (along && other.y + other.height <= rect.y + 1) top = Math.max(top, share ? (other.y + other.height + rect.y + GAP) / 2 : other.y + other.height + GAP);
    else if (along && other.y >= rect.y + rect.height - 1) bottom = Math.min(bottom, share ? (rect.y + rect.height + other.y - GAP) / 2 : other.y - GAP);
  }
  return { left: Math.min(left, rect.x), right: Math.max(right, rect.x + rect.width), top: Math.min(top, rect.y), bottom: Math.max(bottom, rect.y + rect.height) };
}

export type LaidOut = {
  elements: CanvasElement[];
  groups: CanvasGroup[];
  photos: number;
  logos: { found: string[]; cut: string[]; missing: string[]; sources: LogoSource[] };
  /** Words that may be set under the page's smallest text size: by the rough measure here, they don't fit their room at it. */
  small: string[];
};
/**
 * The graphic's layers on the page: `slide` is the original slide's size in
 * px, `area` and every size in page px (`pixels` page px to a scene unit).
 * Layers stack cards, tiles, pictures, logos, then words.
 */
export function layoutGraphic(input: { graphic: Graphic; slide: { width: number; height: number }; area: Rect; style: RebuildStyle; files: PartFiles; pixels: number; key: string }): LaidOut {
  const { graphic, slide, area, style, files, pixels: k, key } = input;
  const scene = (rect: Rect) => ({ x: rect.x / k, y: rect.y / k, width: Math.max(1, rect.width / k), height: Math.max(1, rect.height / k) });
  const toPx = (box: MediaBox): Rect => ({ x: box.x / GRID * slide.width, y: box.y / GRID * slide.height, width: box.width / GRID * slide.width, height: box.height / GRID * slide.height });
  const bounds = union(graphic.panels.map(panel => toPx(panel.box)));
  const scale = Math.min(area.width / bounds.width, area.height / bounds.height, MAX_SCALE);
  const left = area.x + (area.width - bounds.width * scale) / 2, top = area.y + (area.height - bounds.height * scale) / 2;
  const place = (rect: Rect): Rect => ({ x: left + (rect.x - bounds.x) * scale, y: top + (rect.y - bounds.y) * scale, width: rect.width * scale, height: rect.height * scale });

  const cards: CanvasElement[] = [], tiles: CanvasElement[] = [], pictures: CanvasElement[] = [], marks: CanvasElement[] = [], words: CanvasElement[] = [], groups: CanvasGroup[] = [];
  const result: Omit<LaidOut, "elements" | "groups"> = { photos: 0, logos: { found: [], cut: [], missing: [], sources: [] }, small: [] };
  /** A text layer the editor fits with the real font: as large as its style allows, never under the minimum unless the rough measure here says it can't fit at it. */
  const text = (name: string, marked: string, rect: Rect, look: TextLook, align: TextElement["align"], fit: { min: number; max: number; role: "heading" | "body"; group?: string }, groupId: string) => {
    // Words the original sets apart come in [[double brackets]]: shown in the accent color, never as marks.
    const { text: value, richText } = accented(marked, style.accent ?? "#00D98A");
    let min = fit.min, size = fittedSize(value, look, rect.width, rect.height, min, fit.max);
    if (size === null) {
      // An overflow stops exports, so the floor goes down to what fits (or 12 px) and the words are noted.
      min = size = fittedSize(value, look, rect.width, rect.height, FLOOR, min) ?? FLOOR;
      result.small.push(value);
    }
    const height = Math.min(rect.height, lineCount(value, size, rect.width, look) * size * look.lineHeight);
    words.push(createCanvasElement("text", {
      name: unmarked(name).slice(0, 200), ...scene({ ...rect, height }), text: value, ...(richText ? { richText } : {}), font: look.font, fontSize: fit.max / k, autoFitFontSize: size / k, fontWeight: look.weight,
      italic: false, underline: false, color: look.color, align, lineHeight: look.lineHeight, letterSpacing: look.tracking * fit.max / k,
      textMode: "auto-fit", verticalAlign: "top", groupId, layoutRole: "free",
      smartText: { role: fit.role, lines: 0, minFontSize: min / k, maxFontSize: fit.max / k, maxHeight: Math.max(1, rect.height / k), ...(fit.group ? { group: fit.group } : {}) },
      ...(look.gradient ? { gradient: structuredClone(look.gradient) } : {}),
    }));
  };

  const boxes = graphic.panels.map(panel => ({ card: place(toPx(panel.box)), placed: panel.blocks.map(block => ({ block, rect: place(toPx(block.box)) })) }));
  graphic.panels.forEach((panel, panelIndex) => {
    const { card, placed } = boxes[panelIndex], groupId = randomUUID();
    const heading = unmarked(panel.blocks.find(block => block.kind === "heading")?.text ?? "").split("\n")[0];
    groups.push({ id: groupId, name: (heading || `Panel ${panelIndex + 1}`).slice(0, 200) });
    const pad = panel.card ? clamp(card.width * .035, 18, 36) : 0;
    const inner = { x: card.x + pad, y: card.y + pad, width: card.width - 2 * pad, height: card.height - 2 * pad };
    if (panel.card) cards.push(createCanvasElement("shape", { name: "Card", ...scene(card), shape: "rectangle", fill: style.card, stroke: "transparent", strokeWidth: 0, radius: style.cardRadius / k, groupId, layoutRole: "free" }));
    // A panel without a card has no edge to keep its words in: they may spread past it over the
    // graphic's area, up to the other panels' parts (sharing the space between words that grow) or cards.
    const others: Neighbour[] = panel.card ? [] : boxes.flatMap((other, at) => at === panelIndex ? []
      : graphic.panels[at].card ? [{ rect: other.card, grows: false }] : other.placed.map(({ block, rect }) => ({ rect, grows: grows(block) })));
    placed.forEach(({ block, rect }, blockIndex) => {
      const neighbours = [...placed.flatMap((other, at) => at === blockIndex ? [] : [{ rect: other.rect, grows: grows(other.block) }]), ...others];
      const room = freeRoom(rect, neighbours, panel.card ? inner : area), part = `${panelIndex}:${blockIndex}`;
      if (block.kind === "heading" || block.kind === "text") {
        const look = block.kind === "heading" ? style.heading : style.text, min = style.minText;
        // Words may take the free room across their line, keeping their alignment, and the
        // height their lines need at the smallest size, as far as the room goes down.
        const middle = rect.x + rect.width / 2, half = Math.min(middle - room.left, room.right - middle);
        const span = block.align === "left" ? { x: rect.x, width: room.right - rect.x } : block.align === "right" ? { x: room.left, width: rect.x + rect.width - room.left } : { x: middle - half, width: 2 * half };
        const needed = lineCount(unmarked(block.text), min, span.width, look) * min * look.lineHeight;
        const height = Math.min(room.bottom - rect.y, Math.max(rect.height * 1.15, needed * 1.02));
        text(block.kind === "heading" ? block.text : `Text: ${block.text}`, block.text, { ...rect, ...span, height }, look, block.align,
          { min, max: Math.max(min, look.size), role: block.kind === "heading" ? "heading" : "body", ...(block.kind === "heading" ? { group: `${key}-headings` } : {}) }, groupId);
        return;
      }
      if (block.kind === "photo" || block.kind === "picture") {
        const file = files.pictures.get(part);
        if (!file) return;
        if (block.kind === "photo") result.photos++;
        pictures.push(createCanvasElement("image", {
          name: block.kind === "photo" ? "Photo" : "Picture", ...scene(rect), src: file.url, fit: block.kind === "photo" ? "cover" : "contain", cropX: 50, cropY: 50,
          radius: (block.kind === "photo" ? style.photoRadius : style.photoRadius / 2) / k, intrinsicWidth: file.width, intrinsicHeight: file.height,
          ...(block.alt ? { publicAlt: block.alt.slice(0, 2000) } : {}), groupId, layoutRole: "free",
        }));
        return;
      }
      // A row or grid of logos: even cells in the original's order, each logo above its label.
      const logosGroup = randomUUID();
      groups.push({ id: logosGroup, name: "Logos", parentId: groupId });
      const count = block.logos.length, columns = block.columns, rows = Math.ceil(count / columns), labelled = block.logos.some(logo => logo.label);
      const look = style.label, min = style.minText;
      const widest = Math.max(0, ...block.logos.map(logo => textWidth(logo.label, min, look))), widestWord = Math.max(0, ...block.logos.map(logo => longestWord(logo.label, min, look)));
      const [x, width] = labelled ? grow(rect.x, rect.width, columns * (widest + 8), room.left, room.right) : [rect.x, rect.width];
      const cellWidth = width / columns;
      const labelSize = labelled ? clamp(Math.min(look.size, cellWidth * .22, widest ? (cellWidth - 4) * min / widest : look.size), min, Math.max(min, look.size)) : 0;
      // A label wider than its cell at the smallest size takes two lines, when its words fit one by one.
      const labelLines = labelled && widest > cellWidth - 4 && widestWord <= cellWidth - 4 ? 2 : 1;
      const labelHeight = labelled ? labelSize * look.lineHeight * labelLines : 0, labelGap = labelled ? Math.max(4, labelSize * .2) : 0;
      const logoSize = (cell: number) => Math.min(cellWidth * .8, cell * .94 - labelHeight - labelGap);
      let [y, height] = [rect.y, rect.height];
      if (logoSize(height / rows) < MIN_LOGO) [y, height] = grow(y, height, rows * (MIN_LOGO + labelHeight + labelGap) / .94, room.top, room.bottom);
      const cellHeight = height / rows, size = Math.max(16, logoSize(cellHeight));
      block.logos.forEach((logo, index) => {
        const row = Math.floor(index / columns), column = index % columns, inRow = row === rows - 1 ? count - row * columns : columns;
        const middle = x + (columns - inRow) * cellWidth / 2 + column * cellWidth + cellWidth / 2;
        const logoTop = y + row * cellHeight + (cellHeight - size - (labelled ? labelGap + labelHeight : 0)) / 2;
        const box = { x: middle - size / 2, y: logoTop, width: size, height: size }, name = logo.brand || logo.label || `Logo ${index + 1}`;
        const file = files.logos.get(`${part}:${index}`);
        if (file && "found" in file) {
          const found = file.found;
          result.logos.found.push(name);
          if (!result.logos.sources.includes(found.source)) result.logos.sources.push(found.source);
          let mark = box;
          if (found.tile) {
            tiles.push(createCanvasElement("shape", { name: `${name} tile`, ...scene(box), shape: "rectangle", fill: style.tile, stroke: "transparent", strokeWidth: 0, radius: size * .22 / k, groupId: logosGroup, layoutRole: "free" }));
            mark = { x: box.x + size * .14, y: box.y + size * .14, width: size * .72, height: size * .72 };
          }
          marks.push(createCanvasElement("image", { name: `${name} logo`, ...scene(mark), src: found.src, fit: "contain", cropX: 50, cropY: 50, radius: 0, intrinsicWidth: found.width, intrinsicHeight: found.height, publicAlt: `${name} logo`, groupId: logosGroup, layoutRole: "free", ...(found.sourceUrl ? { sourceUrl: found.sourceUrl } : {}) }));
        } else if (file && "cut" in file) {
          // Cut from the original with its own background around it, so it reads as a tile.
          result.logos.cut.push(name);
          marks.push(createCanvasElement("image", { name: `${name} logo (cut from the original)`, ...scene(box), src: file.cut.url, fit: "contain", cropX: 50, cropY: 50, radius: size * .18 / k, intrinsicWidth: file.cut.width, intrinsicHeight: file.cut.height, publicAlt: `${name} logo`, groupId: logosGroup, layoutRole: "free" }));
        } else result.logos.missing.push(name);
        if (labelled && logo.label) {
          const label = { x: middle - cellWidth / 2 + 1, y: logoTop + size + labelGap, width: cellWidth - 2, height: labelHeight * 1.05 };
          text(`${logo.label} label`, logo.label, label, { ...look, size: labelSize }, "center", { min, max: labelSize, role: "heading", group: `${key}-labels-${part.replace(":", "-")}` }, logosGroup);
        }
      });
    });
  });
  return { elements: [...cards, ...tiles, ...pictures, ...marks, ...words], groups, ...result };
}
