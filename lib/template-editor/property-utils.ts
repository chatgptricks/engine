import type { CanvasElement, TextElement } from "./model";

/** Preserve mixed values rather than displaying one arbitrary selected layer. */
export function commonValue<T, K extends keyof T>(items: readonly T[], key: K): T[K] | undefined {
  if (!items.length) return undefined;
  const first = items[0][key];
  return items.every(item => Object.is(item[key], first)) ? first : undefined;
}

export function boldState(items: readonly Pick<TextElement, "fontWeight">[]): boolean | "mixed" {
  if (!items.length) return false;
  const first = items[0].fontWeight >= 700;
  return items.every(item => (item.fontWeight >= 700) === first) ? first : "mixed";
}

export function booleanState<T, K extends keyof T>(items: readonly T[], key: K): boolean | "mixed" {
  if (!items.length) return false;
  const first = Boolean(items[0][key]);
  return items.every(item => Boolean(item[key]) === first) ? first : "mixed";
}

/** The original raster must cover at least one source pixel per exported pixel. */
export function imageResolution(element: Pick<CanvasElement, "width" | "height"> & { intrinsicWidth?: number; intrinsicHeight?: number; cropScale?: number; fit?: "cover" | "contain" }, outputScale = 3): { ratio: number; low: boolean } | null {
  if (!element.intrinsicWidth || !element.intrinsicHeight) return null;
  const scale = Math.max(.1, element.cropScale ?? 1);
  const ratios = [element.intrinsicWidth / (element.width * outputScale * scale), element.intrinsicHeight / (element.height * outputScale * scale)];
  const ratio = element.fit === "contain" ? Math.max(...ratios) : Math.min(...ratios);
  return { ratio, low: ratio < 1 };
}
