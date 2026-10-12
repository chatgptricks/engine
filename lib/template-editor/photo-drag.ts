import { parseShapeImageFill, type ShapeImageFill } from "./model";

export const PHOTO_DRAG_TYPE = "application/x-engine-photo";
const MAX_PHOTO_DRAG_CHARS = 2_100_000;
function plainPayload(value: unknown, seen = new Set<object>()): boolean {
  if (!value || typeof value !== "object") return true;
  const prototype = Object.getPrototypeOf(value);
  if ((!Array.isArray(value) && prototype !== Object.prototype && prototype !== null) || seen.has(value)) return false;
  seen.add(value);
  const safe = Object.entries(value).every(([key,child]) => !["__proto__","constructor","prototype"].includes(key) && plainPayload(child,seen));
  seen.delete(value);
  return safe;
}

export function encodePhotoDrag(photo: ShapeImageFill): string {
  if (!plainPayload(photo)) throw new Error("Choose a valid photo.");
  const value = parseShapeImageFill(photo);
  if (!value) throw new Error("Choose a valid photo.");
  const payload = JSON.stringify(value);
  if (payload.length > MAX_PHOTO_DRAG_CHARS) throw new Error("This photo is too large to drag. Use a smaller image.");
  return payload;
}

export function decodePhotoDrag(value: string): ShapeImageFill | null {
  if (typeof value !== "string" || !value || value.length > MAX_PHOTO_DRAG_CHARS) return null;
  try { const payload:unknown = JSON.parse(value);return plainPayload(payload) ? parseShapeImageFill(payload) : null; } catch { return null; }
}

/** Custom payloads keep image URLs and crop data separate from ordinary links. */
export function writePhotoDrag(transfer: DataTransfer, photo: ShapeImageFill): void {
  transfer.effectAllowed = "copy";
  transfer.setData(PHOTO_DRAG_TYPE, encodePhotoDrag(photo));
}
