import { MEDIA_ADJUSTMENTS, MEDIA_FILTERS, parseMediaLook, type CanvasElement, type MediaAdjustment, type MediaFilter, type MediaLook } from "./model";
import { parseColor } from "./color-utils";

/**
 * Photo and video looks, after Canva's Filters and Adjust: a filter at an
 * intensity, then light and colour adjustments on −100..100. Every step is a
 * linear colour change, so the whole look is one SVG colour matrix. The canvas
 * draws it on the picture (photo or video) with `filter: url(#…)`; PNG and the
 * PDF snapshot copy the DOM, and the MP4 export draws each video frame through
 * the same filter, so all four match.
 */

/** A colour matrix as feColorMatrix takes it: 4 rows (R, G, B, A) of 5 (r, g, b, a, offset). */
export type ColorMatrix = number[];

const IDENTITY: ColorMatrix = [1, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 1, 0];
const LUMA = [0.2126, 0.7152, 0.0722];

/** `second` after `first`. */
function then(first: ColorMatrix, second: ColorMatrix): ColorMatrix {
  const out: number[] = [];
  for (let row = 0; row < 4; row++) for (let col = 0; col < 5; col++) {
    let sum = col === 4 ? second[row * 5 + 4] : 0;
    for (let k = 0; k < 4; k++) sum += second[row * 5 + k] * first[k * 5 + col];
    out.push(sum);
  }
  return out;
}
const chain = (...steps: ColorMatrix[]) => steps.reduce(then, IDENTITY);
const rgb = (m: number[]): ColorMatrix => [m[0], m[1], m[2], 0, m[9] ?? 0, m[3], m[4], m[5], 0, m[10] ?? 0, m[6], m[7], m[8], 0, m[11] ?? 0, 0, 0, 0, 1, 0];

// The CSS filter functions, as the Filter Effects spec writes them.
const grayscale = (a: number) => saturate(1 - a);
function saturate(s: number): ColorMatrix {
  return rgb([0.2126 + 0.7874 * s, 0.7152 - 0.7152 * s, 0.0722 - 0.0722 * s, 0.2126 - 0.2126 * s, 0.7152 + 0.2848 * s, 0.0722 - 0.0722 * s, 0.2126 - 0.2126 * s, 0.7152 - 0.7152 * s, 0.0722 + 0.9278 * s]);
}
function sepia(a: number): ColorMatrix {
  const k = 1 - a;
  return rgb([0.393 + 0.607 * k, 0.769 - 0.769 * k, 0.189 - 0.189 * k, 0.349 - 0.349 * k, 0.686 + 0.314 * k, 0.168 - 0.168 * k, 0.272 - 0.272 * k, 0.534 - 0.534 * k, 0.131 + 0.869 * k]);
}
function hueRotate(degrees: number): ColorMatrix {
  const c = Math.cos(degrees * Math.PI / 180), s = Math.sin(degrees * Math.PI / 180);
  return rgb([0.213 + c * 0.787 - s * 0.213, 0.715 - c * 0.715 - s * 0.715, 0.072 - c * 0.072 + s * 0.928, 0.213 - c * 0.213 + s * 0.143, 0.715 + c * 0.285 + s * 0.14, 0.072 - c * 0.072 - s * 0.283, 0.213 - c * 0.213 - s * 0.787, 0.715 - c * 0.715 + s * 0.715, 0.072 + c * 0.928 + s * 0.072]);
}
const brightness = (b: number) => rgb([b, 0, 0, 0, b, 0, 0, 0, b]);
const contrast = (c: number) => rgb([c, 0, 0, 0, c, 0, 0, 0, c, 0.5 - 0.5 * c, 0.5 - 0.5 * c, 0.5 - 0.5 * c]);
/** Adds to each channel: warmer, cooler, greener, pinker. */
const shift = (r: number, g: number, b: number) => rgb([1, 0, 0, 0, 1, 0, 0, 0, 1, r, g, b]);
/** Darks to one colour, lights to another, by luminance. */
function duotone(shadow: string, highlight: string): ColorMatrix {
  const dark = channels(shadow), light = channels(highlight);
  return rgb([0, 1, 2].flatMap(index => LUMA.map(weight => weight * (light[index] - dark[index])))).map((value, at) => at === 4 ? dark[0] : at === 9 ? dark[1] : at === 14 ? dark[2] : value);
}
function channels(color: string) {
  const parsed = parseColor(color)?.rgb ?? "#000000";
  return [1, 3, 5].map(index => parseInt(parsed.slice(index, index + 2), 16) / 255);
}

export const MEDIA_FILTER_LABELS: Record<MediaFilter, string> = { mono: "Mono", noir: "Noir", vintage: "Vintage", vivid: "Vivid", warm: "Warm", cool: "Cool", fade: "Fade", duotone: "Duotone" };
export const MEDIA_ADJUSTMENT_LABELS: Record<MediaAdjustment, string> = { brightness: "Brightness", contrast: "Contrast", saturation: "Saturation", temperature: "Temperature", tint: "Tint" };
/** Duotone's colours when the look doesn't give them: black darks, the brand's green lights. */
export const DUOTONE_DEFAULTS = { shadow: "#0B1014", highlight: "#00D98A" };

function filterMatrix(look: MediaLook): ColorMatrix {
  switch (look.filter) {
    case "mono": return chain(grayscale(1), contrast(1.1));
    case "noir": return chain(grayscale(1), contrast(1.4), brightness(0.94));
    case "vintage": return chain(sepia(0.45), saturate(0.8), contrast(0.92), brightness(1.05));
    case "vivid": return chain(saturate(1.6), contrast(1.15));
    case "warm": return chain(hueRotate(-12), saturate(1.2), brightness(1.04), sepia(0.15));
    case "cool": return chain(hueRotate(8), saturate(1.05), shift(-0.04, 0.01, 0.07));
    case "fade": return chain(saturate(0.85), contrast(0.78), brightness(1.06));
    case "duotone": return chain(duotone(look.shadow ?? DUOTONE_DEFAULTS.shadow, look.highlight ?? DUOTONE_DEFAULTS.highlight));
    default: return IDENTITY;
  }
}

function adjustMatrix(look: MediaLook): ColorMatrix {
  const k = (key: MediaAdjustment) => (look[key] ?? 0) / 100;
  return chain(
    brightness(1 + 0.5 * k("brightness")),
    contrast(1 + 0.6 * k("contrast")),
    saturate(1 + k("saturation")),
    shift(0.1 * k("temperature"), 0.02 * k("temperature"), -0.1 * k("temperature")),
    shift(0.03 * k("tint"), -0.08 * k("tint"), 0.03 * k("tint")),
  );
}

/** The look as one colour matrix; null when it changes nothing. */
export function lookMatrix(look: MediaLook | undefined): ColorMatrix | null {
  if (!look || !hasLook(look)) return null;
  const strength = (look.intensity ?? 100) / 100, filtered = filterMatrix(look);
  const mixed = filtered.map((value, index) => IDENTITY[index] + (value - IDENTITY[index]) * strength);
  return then(mixed, adjustMatrix(look)).map(value => Math.round(value * 10000) / 10000);
}

export function hasLook(look: MediaLook | undefined): boolean {
  return Boolean(look && (look.filter && (look.intensity ?? 100) > 0 || MEDIA_ADJUSTMENTS.some(key => look[key])));
}

/** The look of a photo layer, or of a shape's photo fill. */
export function mediaLook(element: CanvasElement): MediaLook | undefined {
  return element.type === "image" ? element.look : element.type === "shape" ? element.imageFill?.look : undefined;
}

/** The layer with a new look (null removes it); a layer with no picture is returned as it is. */
export function setMediaLook(element: CanvasElement, look: MediaLook | null): CanvasElement {
  const clean = look && hasLook(look) ? tidy(look) : null;
  if (element.type === "image") {
    const next = { ...element };
    if (clean) next.look = clean; else delete next.look;
    return next;
  }
  if (element.type === "shape" && element.imageFill) {
    const fill = { ...element.imageFill };
    if (clean) fill.look = clean; else delete fill.look;
    return { ...element, imageFill: fill };
  }
  return element;
}

/** Drops zeros, and duotone colours on another filter. */
function tidy(look: MediaLook): MediaLook {
  const next: MediaLook = {};
  if (look.filter) { next.filter = look.filter; if (look.intensity !== undefined && look.intensity !== 100) next.intensity = look.intensity; }
  if (look.filter === "duotone") { if (look.shadow) next.shadow = look.shadow; if (look.highlight) next.highlight = look.highlight; }
  for (const key of MEDIA_ADJUSTMENTS) if (look[key]) next[key] = look[key];
  return next;
}

/** What agents may send: a filter name alone, null (no look), or the look's settings.
 * A partial object changes only what it names: `{brightness: 20}` keeps the filter. */
export function agentMediaLook(value: unknown, current: MediaLook | undefined): MediaLook | null | undefined {
  if (value === null || value === "none" || value === "original") return null;
  if (typeof value === "string") return (MEDIA_FILTERS as readonly string[]).includes(value) ? { ...current, filter: value as MediaFilter, intensity: undefined } : undefined;
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const raw = value as Record<string, unknown>;
  const merged: Record<string, unknown> = { ...current, ...raw };
  if (raw.filter === null || raw.filter === "none" || raw.filter === "original") { delete merged.filter; delete merged.intensity; delete merged.shadow; delete merged.highlight; }
  for (const key of Object.keys(merged)) if (merged[key] === undefined) delete merged[key];
  const parsed = parseMediaLook(merged);
  if (parsed) return parsed;
  // Everything set to 0 (or the filter removed) is no look, which is fine; anything else is a bad value.
  const empty = merged.filter === undefined && MEDIA_ADJUSTMENTS.every(key => merged[key] === undefined || merged[key] === 0) && Object.keys(merged).every(key => (MEDIA_ADJUSTMENTS as readonly string[]).includes(key));
  return empty ? null : undefined;
}
