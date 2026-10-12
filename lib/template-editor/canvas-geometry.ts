import type { CanvasElement, CanvasScene } from "./model";

export type CanvasBounds = { x: number; y: number; width: number; height: number };

/** Round joins keep visible outlines within this physical expansion. */
export function shapeStrokeOutset(element: CanvasElement): number {
  if(element.type!=="shape" || element.strokeWidth<=0 || element.opacity===0 || element.strokeAlign==="inside")return 0;
  const color=element.stroke.trim().toLowerCase();
  if(!color || color==="none" || color==="transparent" || /^#[a-f\d]{3}0$/.test(color) || /^#[a-f\d]{6}00$/.test(color))return 0;
  return element.strokeWidth*(element.strokeAlign==="outside"?1:.5);
}

function orientation(rotation: number): { cosine: number; sine: number } {
  const radians = (rotation % 360) * Math.PI / 180;
  const cosine = Math.cos(radians);
  const sine = Math.sin(radians);
  // Exact quarter turns should not manufacture subpixel overlap at an edge.
  return {
    cosine: Math.abs(cosine) < 4 * Number.EPSILON ? 0 : cosine,
    sine: Math.abs(sine) < 4 * Number.EPSILON ? 0 : sine,
  };
}

/** Axis-aligned bounds of the element's box after rotation about its center. */
export function elementVisualBounds(element: CanvasElement): CanvasBounds {
  const { cosine, sine } = orientation(element.rotation);
  const padding=shapeStrokeOutset(element);
  const width = Math.abs((element.width+padding*2) * cosine) + Math.abs((element.height+padding*2) * sine);
  const height = Math.abs((element.width+padding*2) * sine) + Math.abs((element.height+padding*2) * cosine);
  const bounds = {
    x: element.x + (element.width - width) / 2,
    y: element.y + (element.height - height) / 2,
    width,
    height,
  };
  if (!element.clipBounds) return bounds;
  const clip = element.clipBounds;
  const x = Math.max(bounds.x, clip.x), y = Math.max(bounds.y, clip.y);
  return { x, y, width: Math.max(0, Math.min(bounds.x + bounds.width, clip.x + clip.width) - x), height: Math.max(0, Math.min(bounds.y + bounds.height, clip.y + clip.height) - y) };
}

/** Union of all element boxes, including layers parked outside the page.
 * Empty scenes have no bounds. Opacity and locking do not change geometry. */
export function sceneVisualBounds(scene: CanvasScene): CanvasBounds | null {
  if (!scene.elements.length) return null;
  const boxes = scene.elements.map(elementVisualBounds).filter(box => box.width > 0 && box.height > 0);
  if (!boxes.length) return null;
  const x = Math.min(...boxes.map(box => box.x));
  const y = Math.min(...boxes.map(box => box.y));
  return {
    x,
    y,
    width: Math.max(...boxes.map(box => box.x + box.width)) - x,
    height: Math.max(...boxes.map(box => box.y + box.height)) - y,
  };
}

/** True only for positive-area intersection between the rotated element box
 * and the canvas rectangle (0, 0, width, height). Edge/corner contact is false.
 * Four separating axes handle complete enclosure as well as corner crossings;
 * an AABB test alone would wrongly clip diagonal elements near page corners. */
export function elementIntersectsCanvas(element: CanvasElement, width: number, height: number): boolean {
  return elementIntersectsRect(element, { x: 0, y: 0, width, height });
}

/** Intersect both the rotated artwork and its immutable world-space viewport. */
export function elementIntersectsRect(element: CanvasElement, rectangle: CanvasBounds): boolean {
  const clip = element.clipBounds;
  const x = clip ? Math.max(rectangle.x, clip.x) : rectangle.x;
  const y = clip ? Math.max(rectangle.y, clip.y) : rectangle.y;
  const width = clip ? Math.min(rectangle.x + rectangle.width, clip.x + clip.width) - x : rectangle.width;
  const height = clip ? Math.min(rectangle.y + rectangle.height, clip.y + clip.height) - y : rectangle.height;
  if (![element.x, element.y, element.width, element.height, element.rotation, x, y, width, height].every(Number.isFinite) ||
    element.width <= 0 || element.height <= 0 || width <= 0 || height <= 0) return false;

  const { cosine, sine } = orientation(element.rotation);
  const padding=shapeStrokeOutset(element);
  const halfWidth = element.width / 2 + padding;
  const halfHeight = element.height / 2 + padding;
  const canvasHalfWidth = width / 2;
  const canvasHalfHeight = height / 2;
  const offsetX = element.x + element.width/2 - (x + canvasHalfWidth);
  const offsetY = element.y + element.height/2 - (y + canvasHalfHeight);
  const axes = [[1, 0], [0, 1], [cosine, sine], [-sine, cosine]];
  // Only compensate for floating-point arithmetic error, not visible gaps.
  const tolerance = 16 * Number.EPSILON * Math.max(1, Math.abs(offsetX), Math.abs(offsetY), element.width, element.height, width, height);
  for (const [axisX, axisY] of axes) {
    const elementRadius = halfWidth * Math.abs(axisX * cosine + axisY * sine)
      + halfHeight * Math.abs(-axisX * sine + axisY * cosine);
    const canvasRadius = canvasHalfWidth * Math.abs(axisX) + canvasHalfHeight * Math.abs(axisY);
    const centerDistance = Math.abs(offsetX * axisX + offsetY * axisY);
    if (elementRadius + canvasRadius - centerDistance <= tolerance) return false;
  }
  return true;
}
