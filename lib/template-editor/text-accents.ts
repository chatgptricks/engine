/**
 * Accent ranges: styled words inside one text box, in the form agents read and
 * write through the Engine connector. They are the editor's own word styling
 * (rich text spans and word textures), so the editor, thumbnails and every
 * export draw them as they draw words a person colors by hand.
 *
 * - `{ start, end, style: "#1D9BF0" }` colors the characters from `start` up to
 *   (not including) `end` of the box's text.
 * - `style: "accent"` fills them with the brand accent gradient, #00D98A to
 *   #32FFBB from top to bottom, as on @chatgptricks covers.
 *
 * Offsets count UTF-16 code units, as JavaScript string indexes do; a line break
 * is one character.
 */
import { accentTexture, type BrandGuide } from "./brand-guide";
import { parseColor } from "./color-utils";
import { BRAND_SVG_PREFIX, richTextToPlain, sanitizeRichText, type ShapeImageFill, type TextElement } from "./model";

export type TextAccent = { start: number; end: number; style: string };
export const ACCENT_STYLE = "accent";
/** The @chatgptricks brand accent gradient. */
export const ACCENT_GRADIENT = { from: "#00D98A", to: "#32FFBB", angle: 180 };
export const MAX_TEXT_ACCENTS = 30;
const HEX = /^#(?:[0-9a-fA-F]{6})$/;

/** The accent gradient as a word texture (a brand-safe SVG). */
export function accentGradientTexture(id = ACCENT_STYLE): ShapeImageFill & { id: string } {
  return accentTexture({ accentGradient: ACCENT_GRADIENT } as BrandGuide, id)!;
}
const isGradientTexture = (texture: ShapeImageFill | undefined) => Boolean(texture?.src.startsWith(BRAND_SVG_PREFIX) && decodeURIComponent(texture.src.slice(BRAND_SVG_PREFIX.length)).includes("<linearGradient"));

const escapeText = (value: string) => value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/\r\n|\r|\n/g, "<br>");

/** Why `accents` can't style `text`, or null when they can. */
export function accentProblem(text: string, accents: unknown): string | null {
  if (!Array.isArray(accents)) return "must be a list of {start, end, style}";
  if (accents.length > MAX_TEXT_ACCENTS) return `allows at most ${MAX_TEXT_ACCENTS} ranges`;
  const sorted = [...accents].sort((a, b) => Number(a?.start) - Number(b?.start));
  let last = 0;
  for (const accent of sorted) {
    if (!accent || typeof accent !== "object") return "must be a list of {start, end, style}";
    const { start, end, style } = accent as TextAccent;
    if (!Number.isInteger(start) || !Number.isInteger(end) || start < 0 || end <= start || end > text.length) return `range ${start}–${end} must have whole-number offsets with 0 ≤ start < end ≤ ${text.length} (the text's length)`;
    if (start < last) return `range ${start}–${end} overlaps another range`;
    if (style !== ACCENT_STYLE && !(typeof style === "string" && HEX.test(style) && parseColor(style))) return `style "${String(style)}" must be "accent" or a hex color such as #1D9BF0`;
    last = end;
  }
  return null;
}

/** The rich text and word textures that draw `text` with `accents`. No accents: plain text. */
export function accentedText(text: string, accents: readonly TextAccent[]): Pick<TextElement, "richText" | "wordTextures"> {
  if (!accents.length) return { richText: undefined, wordTextures: undefined };
  const sorted = [...accents].sort((a, b) => a.start - b.start);
  let html = "", at = 0;
  for (const { start, end, style } of sorted) {
    html += escapeText(text.slice(at, start));
    const open = style === ACCENT_STYLE ? `<span data-texture-id="${ACCENT_STYLE}">` : `<span style="color: ${style.toUpperCase()}">`;
    html += `${open}${escapeText(text.slice(start, end))}</span>`;
    at = end;
  }
  html += escapeText(text.slice(at));
  const richText = sanitizeRichText(html);
  if (richText === undefined) throw new Error("Those accents couldn't be applied to this text.");
  return { richText, wordTextures: sorted.some(accent => accent.style === ACCENT_STYLE) ? [accentGradientTexture()] : undefined };
}

/** A text box's accents: its colored words and its words in a gradient texture,
 * as ranges of its text. Other word styling (bold, sizes) isn't listed. */
export function textAccents(element: Pick<TextElement, "richText" | "wordTextures">): TextAccent[] {
  const safe = sanitizeRichText(element.richText);
  if (safe === undefined) return [];
  const textures = new Map((element.wordTextures ?? []).map(texture => [texture.id, texture]));
  const accents: TextAccent[] = [], styles: (string | undefined)[] = [];
  let offset = 0;
  for (const chunk of safe.split(/(<[^>]*>)/g)) {
    if (!chunk) continue;
    if (chunk === "<br>") { offset++; continue; }
    if (chunk.startsWith("</")) { styles.pop(); continue; }
    if (chunk.startsWith("<")) {
      const texture = chunk.match(/\sdata-texture-id="([a-zA-Z0-9_-]+)"/)?.[1], color = chunk.match(/color\s*:\s*(#[0-9a-fA-F]{6})\b/)?.[1];
      // The accent texture keeps its id when Engine stores its picture as a media file.
      styles.push(texture ? (texture === ACCENT_STYLE || isGradientTexture(textures.get(texture)) ? ACCENT_STYLE : undefined) : color ? color.toUpperCase() : styles.at(-1));
      continue;
    }
    const length = richTextToPlain(chunk).length, style = styles.at(-1);
    if (style && length) {
      const previous = accents.at(-1);
      if (previous && previous.style === style && previous.end === offset) previous.end += length;
      else accents.push({ start: offset, end: offset + length, style });
    }
    offset += length;
  }
  return accents;
}
