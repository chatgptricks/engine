/** Frames: a slide that arrived as one flat image, taken apart into layers.
 *
 * The image a slide was made from stays as it is (`page.frame.original`); the
 * locked layer at the bottom of the slide (`frameRole: "background"`) shows it.
 * Parts lifted out of it become layers of their own above it.
 *
 * Everything here is pure (plain RGBA arrays and scene boxes), so the editor,
 * the agent API and the tests share it. Reading and writing images with sharp
 * happens in frames-server.ts. */
import { createCanvasElement, type CanvasElement, type DesignPage, type ImageElement, type PageFrame } from "./model";

export type Box = { x: number; y: number; width: number; height: number };
export type Rgb = [number, number, number];
/** The smallest part worth cutting, in image pixels a side. */
export const MIN_CUT = 4;
/** A frame's image keeps its own shape on the slide unless it's this close to the slide's. */
const SAME_SHAPE = .02;

/** Where a frame's image sits on a slide (scene units). An image the slide's
 * shape fills it; any other shape is fitted inside it, centred, so no part of
 * the image is hidden and every pixel maps to one place on the slide. */
export function frameLayout(image: { width: number; height: number }, slide: { width: number; height: number }): Box {
  const imageRatio = image.width / image.height, slideRatio = slide.width / slide.height;
  if (Math.abs(imageRatio / slideRatio - 1) <= SAME_SHAPE) return { x: 0, y: 0, width: slide.width, height: slide.height };
  const scale = Math.min(slide.width / image.width, slide.height / image.height);
  const width = image.width * scale, height = image.height * scale;
  return { x: (slide.width - width) / 2, y: (slide.height - height) / 2, width, height };
}

/** The image's drawn size and offset inside its layer, as object-fit cover with
 * object-position cropX% cropY% draws it (canvas.tsx). */
function drawn(layer: Pick<ImageElement, "width" | "height" | "cropX" | "cropY" | "fit">, image: { width: number; height: number }) {
  const scale = layer.fit === "contain" ? Math.min(layer.width / image.width, layer.height / image.height) : Math.max(layer.width / image.width, layer.height / image.height);
  const width = image.width * scale, height = image.height * scale;
  return { scale, x: (layer.width - width) * layer.cropX / 100, y: (layer.height - height) * layer.cropY / 100 };
}

/** A slide box (scene units) as a box of the frame's image pixels, clamped to the image. */
export function sceneToImage(layer: ImageElement, image: { width: number; height: number }, box: Box): Box {
  const fit = drawn(layer, image);
  const left = (box.x - layer.x - fit.x) / fit.scale, top = (box.y - layer.y - fit.y) / fit.scale;
  const right = (box.x + box.width - layer.x - fit.x) / fit.scale, bottom = (box.y + box.height - layer.y - fit.y) / fit.scale;
  return clampBox({ x: Math.floor(left), y: Math.floor(top), width: Math.ceil(right) - Math.floor(left), height: Math.ceil(bottom) - Math.floor(top) }, image.width, image.height);
}
/** A box of the frame's image pixels as a slide box (scene units). */
export function imageToScene(layer: ImageElement, image: { width: number; height: number }, box: Box): Box {
  const fit = drawn(layer, image);
  return { x: layer.x + fit.x + box.x * fit.scale, y: layer.y + fit.y + box.y * fit.scale, width: box.width * fit.scale, height: box.height * fit.scale };
}

export function clampBox(box: Box, width: number, height: number): Box {
  const x = Math.max(0, Math.min(width, Math.round(box.x))), y = Math.max(0, Math.min(height, Math.round(box.y)));
  const right = Math.max(x, Math.min(width, Math.round(box.x + box.width))), bottom = Math.max(y, Math.min(height, Math.round(box.y + box.height)));
  return { x, y, width: right - x, height: bottom - y };
}

/** The slide's frame background: the locked image at the bottom that shows the frame. */
export function frameBackground(page: Pick<DesignPage, "canvas" | "frame">): ImageElement | undefined {
  if (!page.frame) return undefined;
  return page.canvas?.elements.find((element): element is ImageElement => element.type === "image" && element.frameRole === "background");
}

/** The locked background layer a new frame slide starts with. */
export function frameBackgroundLayer(frame: PageFrame, slide: { width: number; height: number }, id?: string): ImageElement {
  const box = frameLayout(frame, slide);
  const layer = createCanvasElement("image", {
    name: "Original image", ...box, src: frame.original, fit: "cover", cropX: 50, cropY: 50,
    locked: true, frameRole: "background", intrinsicWidth: frame.width, intrinsicHeight: frame.height,
  }) as ImageElement;
  return id ? { ...layer, id } : layer;
}

/** A part cut out of the frame, as an image layer in the same place on the slide. */
export function frameCutLayer(background: ImageElement, frame: PageFrame, cut: { src: string; box: Box; name: string }, id?: string): CanvasElement {
  const box = imageToScene(background, frame, cut.box);
  const layer = createCanvasElement("image", {
    name: cut.name, ...box, src: cut.src, fit: "cover", cropX: 50, cropY: 50,
    frameRole: "cutout", intrinsicWidth: cut.box.width, intrinsicHeight: cut.box.height,
  });
  return id ? { ...layer, id } : layer;
}

/* ---------- Colour ---------- */

const linear = (channel: number) => { const value = channel / 255; return value <= .04045 ? value / 12.92 : ((value + .055) / 1.055) ** 2.4; };
const labF = (value: number) => value > 216 / 24389 ? Math.cbrt(value) : (24389 / 27 * value + 16) / 116;
export function toLab([r, g, b]: Rgb): Rgb {
  const R = linear(r), G = linear(g), B = linear(b);
  const x = labF((R * .4124 + G * .3576 + B * .1805) / .95047), y = labF(R * .2126 + G * .7152 + B * .0722), z = labF((R * .0193 + G * .1192 + B * .9505) / 1.08883);
  return [116 * y - 16, 500 * (x - y), 200 * (y - z)];
}
/** CIE76 distance between two colours: about 2.3 is just noticeable. */
export function colorDistance(a: Rgb, b: Rgb): number {
  const p = toLab(a), q = toLab(b);
  return Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2]);
}
export const toHex = ([r, g, b]: Rgb) => `#${[r, g, b].map(value => Math.round(value).toString(16).padStart(2, "0")).join("").toUpperCase()}`;

const median = (values: number[]) => { const sorted = values.sort((a, b) => a - b); return sorted[Math.floor(sorted.length / 2)] ?? 0; };
/** The pixels around a picture's edge, one ring deep. */
function borderPixels(rgba: Uint8Array | Uint8ClampedArray, width: number, height: number): Rgb[] {
  const pixels: Rgb[] = [], at = (x: number, y: number): Rgb => { const i = (y * width + x) * 4; return [rgba[i], rgba[i + 1], rgba[i + 2]]; };
  for (let x = 0; x < width; x++) { pixels.push(at(x, 0)); if (height > 1) pixels.push(at(x, height - 1)); }
  for (let y = 1; y < height - 1; y++) { pixels.push(at(0, y)); if (width > 1) pixels.push(at(width - 1, y)); }
  return pixels;
}
/** The colour around a picture's edge: the median of its border. */
export function borderColor(rgba: Uint8Array | Uint8ClampedArray, width: number, height: number): Rgb {
  const pixels = borderPixels(rgba, width, height);
  return [median(pixels.map(p => p[0])), median(pixels.map(p => p[1])), median(pixels.map(p => p[2]))];
}
/** Whether a picture sits on one flat colour: most of its edge is that colour.
 * The editor offers "Remove flat colour" first for such a cut. */
export function hasFlatBorder(rgba: Uint8Array | Uint8ClampedArray, width: number, height: number, tolerance = 10): boolean {
  const pixels = borderPixels(rgba, width, height), edge = borderColor(rgba, width, height);
  return pixels.length > 0 && pixels.filter(pixel => colorDistance(pixel, edge) <= tolerance).length / pixels.length >= .85;
}

/** Removes a flat background colour, the colour of the picture's edge: pixels
 * within `tolerance` of it become transparent, and pixels up to twice that far
 * fade in, so anti-aliased edges stay smooth. Works on every pixel of that
 * colour, so the holes inside a logo's letters clear too. Returns a new array. */
export function keyFlatBackground(rgba: Uint8Array | Uint8ClampedArray, width: number, height: number, tolerance = 12): Uint8ClampedArray {
  const out = new Uint8ClampedArray(rgba), edge = borderColor(rgba, width, height), edgeLab = toLab(edge);
  for (let i = 0; i < out.length; i += 4) {
    const lab = toLab([out[i], out[i + 1], out[i + 2]]);
    const distance = Math.hypot(lab[0] - edgeLab[0], lab[1] - edgeLab[1], lab[2] - edgeLab[2]);
    if (distance >= tolerance * 2) continue;
    const keep = distance <= tolerance ? 0 : (distance - tolerance) / tolerance;
    out[i + 3] = Math.round(out[i + 3] * keep);
    // Partly kept pixels lose the background's tint (un-premultiply against it), so no dark fringe stays.
    if (keep > 0 && keep < 1) for (let c = 0; c < 3; c++) out[i + c] = Math.max(0, Math.min(255, Math.round((out[i + c] - edge[c] * (1 - keep)) / keep)));
  }
  return out;
}
/** The box of a picture's visible pixels (alpha above 8), or null when none are. */
export function alphaBounds(rgba: Uint8Array | Uint8ClampedArray, width: number, height: number): Box | null {
  let left = width, top = height, right = -1, bottom = -1;
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) if (rgba[(y * width + x) * 4 + 3] > 8) {
    if (x < left) left = x; if (x > right) right = x; if (y < top) top = y; if (y > bottom) bottom = y;
  }
  return right < 0 ? null : { x: left, y: top, width: right - left + 1, height: bottom - top + 1 };
}
/** Copies a box out of an RGBA array. */
export function cropPixels(rgba: Uint8Array | Uint8ClampedArray, width: number, box: Box): Uint8ClampedArray {
  const out = new Uint8ClampedArray(box.width * box.height * 4);
  for (let y = 0; y < box.height; y++) out.set(rgba.subarray(((box.y + y) * width + box.x) * 4, ((box.y + y) * width + box.x + box.width) * 4), y * box.width * 4);
  return out;
}
