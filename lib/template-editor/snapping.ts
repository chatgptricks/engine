import type { CanvasElement, CanvasScene } from "./model";
import { elementVisualBounds, type CanvasBounds } from "./canvas-geometry";
import { isElementHidden } from "./commands";

export type SnapGuide = { axis: "x" | "y"; position: number; label?: string; from?: number; to?: number };
export type SnapOptions = { width: number; height: number; slideWidth?: number; scale: number; disabled?: boolean; outputScale?:number; axis?: "x" | "y" };
type Target = SnapGuide & { priority: number };
const defaults = { enabled: true, objects: true, page: true, guides: true, grid: false, spacing: true, tolerance: 6 };
const positions = (b: CanvasBounds, axis: "x" | "y") => axis === "x" ? [b.x, b.x + b.width / 2, b.x + b.width] : [b.y, b.y + b.height / 2, b.y + b.height];

function targets(scene: CanvasScene, ids: readonly string[], bounds: CanvasBounds, options: SnapOptions): Target[] {
  const config = { ...defaults, ...scene.layout?.snapping };
  const out: Target[] = [];
  const add = (axis: "x" | "y", position: number, priority: number, label?: string) => out.push({ axis, position, priority, label });
  const slide = options.slideWidth ?? options.width;
  const count = Math.min(20, Math.ceil(options.width / slide));
  if (config.page) {
    for (let i = 0; i < count; i++) {
      const offset = i * slide;
      for (const x of [offset, offset + slide / 2, Math.min(options.width, offset + slide)]) add("x", x, 2);
      for (const inset of [scene.layout?.margins, scene.layout?.safeArea]) {
        if (inset?.enabled) {
          add("x", offset + inset.left, 1, "Margin"); add("x", offset + slide - inset.right, 1, "Margin");
          add("y", inset.top, 1, "Margin"); add("y", options.height - inset.bottom, 1, "Margin");
        }
      }
    }
    for (const y of [0, options.height / 2, options.height]) add("y", y, 2);
  }
  if (config.guides) for (const guide of scene.layout?.guides ?? []) add(guide.axis, guide.position, 0);
  const stationary = scene.elements.filter(e => !ids.includes(e.id) && !isElementHidden(scene,e)).map(elementVisualBounds).filter(b => b.width > 0 && b.height > 0);
  if (config.objects) for (const b of stationary) for (const axis of ["x", "y"] as const) for (const p of positions(b, axis)) add(axis, p, 3);
  if (config.grid && scene.layout?.grid) {
    const grid = scene.layout.grid;
    const size = Math.max(1, grid.size);
    for (const axis of ["x", "y"] as const) for (const p of positions(bounds, axis)) add(axis, Math.round(p / size) * size, 4);
    const m = scene.layout.margins;
    const left = m?.enabled ? m.left : 0, right = m?.enabled ? m.right : 0;
    const top = m?.enabled ? m.top : 0, bottom = m?.enabled ? m.bottom : 0;
    for (let s = 0; s < count; s++) {
      const colWidth = (slide - left - right - (grid.columns - 1) * grid.gutter) / Math.max(1, grid.columns);
      for (let c = 0; c < grid.columns; c++) { add("x", s * slide + left + c * (colWidth + grid.gutter), 4); add("x", s * slide + left + c * (colWidth + grid.gutter) + colWidth, 4); }
    }
    const rowHeight = (options.height - top - bottom - (grid.rows - 1) * grid.gutter) / Math.max(1, grid.rows);
    for (let r = 0; r < grid.rows; r++) { add("y", top + r * (rowHeight + grid.gutter), 4); add("y", top + r * (rowHeight + grid.gutter) + rowHeight, 4); }
  }
  if (config.spacing) for (const axis of ["x", "y"] as const) {
    const size = axis === "x" ? bounds.width : bounds.height;
    const cross = axis === "x" ? "y" : "x";
    const relevant = stationary.filter(b => {
      const a = positions(b, cross), c = positions(bounds, cross);
      return a[0] < c[2] && a[2] > c[0];
    }).sort((a, b) => positions(a, axis)[0] - positions(b, axis)[0]);
    for (let i = 0; i < relevant.length - 1; i++) {
      const a = positions(relevant[i], axis), b = positions(relevant[i + 1], axis);
      const gap = b[0] - a[2];
      if (gap < 0) continue;
      if (gap >= size) add(axis, a[2] + (gap - size) / 2, 1, `${Math.round((gap - size) / 2 * (options.outputScale??3))} px equal gap`);
      add(axis, b[2] + gap, 1, `${Math.round(gap * (options.outputScale??3))} px gap`);
      add(axis, a[0] - gap - size, 1, `${Math.round(gap * (options.outputScale??3))} px gap`);
    }
  }
  return out;
}

/** Threshold is measured in screen pixels, so snapping feels the same at every zoom. */
export function snapMove(scene: CanvasScene, ids: readonly string[], original: CanvasBounds, delta: { x: number; y: number }, options: SnapOptions) {
  const config = { ...defaults, ...scene.layout?.snapping };
  const moved = { ...original, x: original.x + delta.x, y: original.y + delta.y };
  if (options.disabled || !config.enabled) return { delta, guides: [] as SnapGuide[] };
  const candidates = targets(scene, ids, moved, options);
  const threshold = Math.min(1000, config.tolerance / Math.max(.005, options.scale));
  const next = { ...delta }; const guides: SnapGuide[] = [];
  for (const axis of ["x", "y"] as const) {
    if (options.axis && options.axis !== axis) continue;
    let best: { diff: number; target: Target } | undefined;
    for (const target of candidates.filter(t => t.axis === axis)) {
      // Equal-gap candidates describe the leading edge, not the center or trailing edge.
      for (const p of target.label?.includes("gap") ? positions(moved, axis).slice(0, 1) : positions(moved, axis)) {
        const diff = target.position - p;
        if (Math.abs(diff) > threshold) continue;
        if (!best || Math.abs(diff) < Math.abs(best.diff) - .001 || Math.abs(Math.abs(diff) - Math.abs(best.diff)) < .001 && target.priority < best.target.priority) best = { diff, target };
      }
    }
    if (best) { next[axis] += best.diff; guides.push(best.target); }
  }
  return { delta: next, guides };
}

export function snapPoint(scene: CanvasScene, ids: readonly string[], point: { x: number; y: number }, options: SnapOptions) {
  return snapMove(scene, ids, { ...point, width: 0, height: 0 }, { x: 0, y: 0 }, options);
}

/** Bound the translation once for the whole selection, never compressing its spacing. */
export function translateElements(elements: CanvasElement[], delta: { x: number; y: number }): CanvasElement[] {
  if (!elements.length) return elements;
  const dx = Math.max(-10000 - Math.min(...elements.map(e => e.x)), Math.min(10000 - Math.max(...elements.map(e => e.x)), delta.x));
  const dy = Math.max(-10000 - Math.min(...elements.map(e => e.y)), Math.min(10000 - Math.max(...elements.map(e => e.y)), delta.y));
  return elements.map(e => ({ ...e, x: Math.round((e.x + dx) * 100) / 100, y: Math.round((e.y + dy) * 100) / 100 }));
}
