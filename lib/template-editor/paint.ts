import { colorWithAlpha, parseColor } from "./color-utils";
import { sanitizeRichText, type CanvasElement, type CanvasGradient } from "./model";
import type { TextFormattingPatch } from "./rich-text-editing";

export type Paint = { type: "solid"; color: string } | { type: "gradient"; gradient: CanvasGradient };
export const RECENT_PAINTS_KEY = "engine:recent-paints:v1";
export const RECENT_PAINTS_LIMIT = 12;

export const GRADIENT_PRESETS: { name: string; paint: Paint }[] = [
  { name: "Mint", paint: { type: "gradient", gradient: { type: "linear", angle: 90, stops: [{ color: "#00d98a", position: 0 }, { color: "#32ffbb", position: 100 }] } } },
  { name: "Twilight", paint: { type: "gradient", gradient: { type: "linear", angle: 135, stops: [{ color: "#60a5fa", position: 0 }, { color: "#a855f7", position: 100 }] } } },
  { name: "Sunset", paint: { type: "gradient", gradient: { type: "linear", angle: 90, stops: [{ color: "#fb7185", position: 0 }, { color: "#fbbf24", position: 100 }] } } },
  { name: "Ocean", paint: { type: "gradient", gradient: { type: "linear", angle: 135, stops: [{ color: "#2563eb", position: 0 }, { color: "#22d3ee", position: 100 }] } } },
  { name: "Monochrome", paint: { type: "gradient", gradient: { type: "linear", angle: 90, stops: [{ color: "#111827", position: 0 }, { color: "#ffffff", position: 100 }] } } },
  { name: "Glow", paint: { type: "gradient", gradient: { type: "radial", angle: 0, stops: [{ color: "#ffffff", position: 0 }, { color: "#a855f700", position: 100 }] } } },
];

/** Recents are untrusted local storage; only accept paints the document can save. */
export function normalizePaint(value: unknown): Paint | null {
  if (!value || typeof value !== "object") return null;
  const paint = value as Partial<Paint>;
  if (paint.type === "solid" && typeof paint.color === "string") {
    const color = parseColor(paint.color);
    return color ? { type: "solid", color: colorWithAlpha(color.rgb, color.alpha) } : null;
  }
  if (paint.type !== "gradient" || !paint.gradient || typeof paint.gradient !== "object") return null;
  const gradient = paint.gradient;
  if (!["linear", "radial"].includes(gradient.type) || !Number.isFinite(gradient.angle) || Math.abs(gradient.angle) > 3600 || !Array.isArray(gradient.stops) || gradient.stops.length < 2 || gradient.stops.length > 20) return null;
  const stops: CanvasGradient["stops"] = [];
  for (const stop of gradient.stops) {
    if (!stop || typeof stop.color !== "string" || !Number.isFinite(stop.position) || stop.position < 0 || stop.position > 100) return null;
    const color = parseColor(stop.color);
    if (!color) return null;
    stops.push({ color: colorWithAlpha(color.rgb, color.alpha), position: stop.position });
  }
  return { type: "gradient", gradient: { type: gradient.type, angle: gradient.type === "radial" ? 0 : (gradient.angle % 360 + 360) % 360, stops: stops.sort((a, b) => a.position - b.position) } };
}

export function paintKey(paint: Paint): string { return JSON.stringify(normalizePaint(paint)); }

export function recentPaintsFromStorage(raw: string | null): Paint[] {
  try {
    const values: unknown = JSON.parse(raw ?? "[]");
    if (!Array.isArray(values)) return [];
    const seen = new Set<string>();
    return values.flatMap(value => {
      const paint = normalizePaint(value);
      if (!paint || seen.has(paintKey(paint))) return [];
      seen.add(paintKey(paint));
      return [paint];
    }).slice(0, RECENT_PAINTS_LIMIT);
  } catch { return []; }
}

export function addRecentPaint(recent: readonly Paint[], paint: Paint): Paint[] {
  return recentPaintsFromStorage(JSON.stringify([paint, ...recent]));
}

export function paintForElement(element: CanvasElement): Paint | undefined {
  if (element.type !== "text" && element.type !== "shape") return undefined;
  return element.gradient ? { type: "gradient", gradient: element.gradient } : { type: "solid", color: element.type === "text" ? element.color : element.fill };
}

export function commonElementPaint(elements: readonly CanvasElement[]): Paint | undefined {
  const first = elements[0] && paintForElement(elements[0]);
  return first && elements.every(element => { const paint = paintForElement(element); return paint && paintKey(paint) === paintKey(first); }) ? first : undefined;
}

/** Whole-layer paint replaces local paint while keeping fonts, emphasis and words. */
export function clearRichTextPaint(value: string | undefined): string | undefined {
  return sanitizeRichText(value)?.replace(/\sdata-texture-id="[a-zA-Z0-9_-]+"/g, "").replace(/\sstyle="([^"]*)"/g, (_match, style: string) => {
    const kept = style.split(";").map(part => part.trim()).filter(part => part && !/^color\s*:/i.test(part));
    return kept.length ? ` style="${kept.join("; ")}"` : "";
  });
}

export function applyElementPaint<T extends CanvasElement>(element: T, value: Paint): T {
  const paint = normalizePaint(value);
  if (!paint || element.type !== "text" && element.type !== "shape") return element;
  const next = { ...element, colorRoleId: undefined, gradient: paint.type === "gradient" ? paint.gradient : undefined };
  if (next.type === "text") {
    if (paint.type === "solid") next.color = paint.color;
    next.textureFill = undefined;
    next.wordTextures = undefined;
    next.richText = clearRichTextPaint(next.richText);
  } else if (next.type === "shape" && paint.type === "solid") next.fill = paint.color;
  return next;
}

/** Gradients belong to the text layer; solid colors can also format selected words. */
export function paintTextFormattingPatch(paint: Paint): TextFormattingPatch | undefined {
  return paint.type === "solid" ? { color: paint.color, colorRoleId: undefined, textureFill: null } : undefined;
}

/** Stable stop indices while dragging; rendering and persistence can sort later. */
export function updatePaintStop(paint: Paint, index: number, patch: Partial<CanvasGradient["stops"][number]>): Paint {
  if (paint.type !== "gradient" || !paint.gradient.stops[index]) return paint;
  const stops = paint.gradient.stops.map((stop, i) => i === index ? { ...stop, ...patch } : stop);
  const candidate: Paint = { ...paint, gradient: { ...paint.gradient, stops } };
  return normalizePaint(candidate) ? candidate : paint;
}
