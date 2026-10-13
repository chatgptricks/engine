import type { ImageElement } from "./model";
import { photoContent } from "./photo-frames";
import type { CanvasElement } from "./model";

/** object-position's percent refers to painted overflow, not frame width. */
export function cropAfterDrag(element: CanvasElement, delta: { x: number; y: number }, intrinsic?: { width: number; height: number }): Partial<ImageElement> {
  const photo = photoContent(element);
  if (!photo) return {};
  const sourceWidth = intrinsic?.width ?? photo.intrinsicWidth ?? element.width;
  const sourceHeight = intrinsic?.height ?? photo.intrinsicHeight ?? element.height;
  const fit = photo.fit === "cover" ? Math.max(element.width / sourceWidth, element.height / sourceHeight) : Math.min(element.width / sourceWidth, element.height / sourceHeight);
  const zoom = photo.cropScale ?? 1;
  const radians = -element.rotation * Math.PI / 180;
  const dx = delta.x * Math.cos(radians) - delta.y * Math.sin(radians), dy = delta.x * Math.sin(radians) + delta.y * Math.cos(radians);
  // Flip occurs inside the zoom wrapper. Its contribution changes direction,
  // while zoom around the focal point adds an unflipped frame translation.
  const coefficientX = (element.width - sourceWidth * fit) * zoom * (photo.flipX ? -1 : 1) + element.width * (1 - zoom);
  const coefficientY = (element.height - sourceHeight * fit) * zoom * (photo.flipY ? -1 : 1) + element.height * (1 - zoom);
  const move = (position: number, amount: number, coefficient: number) => Math.abs(coefficient) < 1e-7 ? position : Math.max(0, Math.min(100, position + amount / coefficient * 100));
  return { cropX: move(photo.cropX, dx, coefficientX), cropY: move(photo.cropY, dy, coefficientY) };
}
