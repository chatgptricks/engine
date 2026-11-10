/** Frames on the server: reads a frame's original with sharp, cuts parts out of
 * it and stores the results as media files. The editor's route and the agent
 * API both use these, so a cut is the same whoever asks for it. */
import "server-only";
import sharp from "sharp";
import { FRAME_ASSET } from "./model";
import { readOriginalAsset, storeOriginalAsset } from "./media-storage";
import { MIN_CUT, alphaBounds, borderColor, clampBox, cropPixels, keyFlatBackground, toHex, type Box } from "./frames";

const MAX_PIXELS = 100_000_000;
export type RemoveBackground = "none" | "flat";
export class FrameError extends Error {}

const assetSrc = (id: string) => `/api/template-editor/assets/${id}`;
function assetId(src: string): string {
  if (!FRAME_ASSET.test(src)) throw new FrameError("A frame must use an image stored in Engine (/api/template-editor/assets/<id>).");
  return src.slice(src.lastIndexOf("/") + 1);
}
async function readAsset(owner: string, src: string) {
  const asset = await readOriginalAsset(owner, assetId(src));
  if (!asset) throw new FrameError("That image isn't in this workspace.");
  if (asset.mimeType === "image/svg+xml") throw new FrameError("A frame must be a PNG, JPG or WebP picture, not a vector.");
  return asset;
}
const decode = (data: Buffer) => sharp(data, { limitInputPixels: MAX_PIXELS, failOn: "error" }).rotate();

/** Stores an image for a new frame slide (a stored image's path, or a data: URL)
 * and reads what the slide needs: its size and the colour around its edge. */
export async function prepareFrameImage(owner: string, source: string, name = "Image") {
  let src = source;
  if (source.startsWith("data:")) {
    const match = /^data:image\/(png|jpeg|webp);base64,([A-Za-z0-9+/=]+)$/.exec(source);
    if (!match) throw new FrameError("Send the image as a PNG, JPG or WebP data: URL, or upload it first.");
    src = assetSrc((await storeOriginalAsset(owner, Buffer.from(match[2], "base64"), name)).id);
  }
  const asset = await readAsset(owner, src);
  const edge = await decode(asset.data).resize(256, 256, { fit: "inside" }).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  return { original: src, width: asset.width, height: asset.height, name: name.slice(0, 200) || asset.name, edge: toHex(borderColor(edge.data, edge.info.width, edge.info.height)) };
}

/** Cuts a box of a frame's original into a picture of its own. With
 * removeBackground "flat", the colour around the box's edge becomes transparent
 * and the picture is trimmed to what is left. Returns the stored picture and the
 * box of the original it covers. */
export async function cutFrame(owner: string, original: string, box: Box, removeBackground: RemoveBackground, name = "Cut out") {
  const asset = await readAsset(owner, original);
  const area = clampBox(box, asset.width, asset.height);
  if (area.width < MIN_CUT || area.height < MIN_CUT) throw new FrameError(`Mark an area at least ${MIN_CUT} pixels on each side inside the image.`);
  const raw = await decode(asset.data).extract({ left: area.x, top: area.y, width: area.width, height: area.height }).ensureAlpha().raw().toBuffer();
  let pixels: Uint8Array | Uint8ClampedArray = raw, cut = area, part = { x: 0, y: 0, width: area.width, height: area.height };
  if (removeBackground === "flat") {
    const keyed = keyFlatBackground(raw, area.width, area.height);
    const bounds = alphaBounds(keyed, area.width, area.height);
    if (!bounds) throw new FrameError("Nothing is left once the background colour is removed. Mark the part itself, or keep its background.");
    part = bounds; pixels = cropPixels(keyed, area.width, bounds);
    cut = { x: area.x + bounds.x, y: area.y + bounds.y, width: bounds.width, height: bounds.height };
  }
  const image = sharp(Buffer.from(pixels.buffer, pixels.byteOffset, pixels.byteLength), { raw: { width: part.width, height: part.height, channels: 4 } });
  const data = removeBackground === "flat" ? await image.png({ compressionLevel: 9 }).toBuffer() : await image.removeAlpha().jpeg({ quality: 92, mozjpeg: true }).toBuffer();
  const stored = await storeOriginalAsset(owner, data, name);
  return { src: assetSrc(stored.id), box: cut, width: stored.width, height: stored.height };
}

/** A look at a frame for an agent's own model: the original (or a box of it) as
 * a PNG at most `maxSide` pixels on its long side. */
export async function viewFrame(owner: string, original: string, box?: Box, maxSide = 1568) {
  const asset = await readAsset(owner, original);
  const area = box ? clampBox(box, asset.width, asset.height) : { x: 0, y: 0, width: asset.width, height: asset.height };
  if (area.width < 1 || area.height < 1) throw new FrameError("That box is outside the image.");
  const data = await decode(asset.data).extract({ left: area.x, top: area.y, width: area.width, height: area.height }).resize(maxSide, maxSide, { fit: "inside", withoutEnlargement: true }).png().toBuffer({ resolveWithObject: true });
  return { base64: data.data.toString("base64"), mimeType: "image/png" as const, box: area, width: data.info.width, height: data.info.height };
}
