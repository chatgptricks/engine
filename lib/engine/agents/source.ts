/**
 * The original post: imported from Instagram (or uploaded screenshots), fitted
 * for Claude, and kept as private workspace images so every stage, a resumed
 * run and the design critic can see the same slides.
 */
import { readOriginalAsset, storeOriginalAsset } from "../../template-editor/media-storage";
import { downloadSlideImages, importInstagramPost, InstagramImportError, normalizeUploadedSlides } from "../instagram-import";
import { RecreateError, type SourceImage } from "./claude";

// Claude reads images up to 5 MB and gains nothing past ~1568 px on the long
// edge, so big screenshots are shrunk to JPEG before they're sent.
const CLAUDE_LONG_EDGE = 1568, CLAUDE_MAX_BASE64 = 4_800_000;
export async function fitForClaude(image: SourceImage): Promise<SourceImage> {
  const sharp = (await import("sharp")).default;
  const bytes = Buffer.from(image.base64, "base64");
  const meta = await sharp(bytes).metadata().catch(() => null);
  if (!meta) throw new RecreateError("One of the slides isn't a readable image.");
  const longEdge = Math.max(meta.width ?? 0, meta.height ?? 0);
  if (longEdge <= CLAUDE_LONG_EDGE && image.base64.length <= CLAUDE_MAX_BASE64) return image;
  const out = await sharp(bytes).rotate().resize({ width: CLAUDE_LONG_EDGE, height: CLAUDE_LONG_EDGE, fit: "inside", withoutEnlargement: true }).jpeg({ quality: 86 }).toBuffer();
  return { mediaType: "image/jpeg", base64: out.toString("base64") };
}

function importFailure(error: unknown): never {
  if (error instanceof InstagramImportError) throw new RecreateError(error.message, error.status);
  throw error;
}

export type ImportedSource = { images: SourceImage[]; caption: string; sourceUrl?: string; owner?: string };
export async function importSource(input: { url?: string; uploads?: { name: string; dataUrl: string }[]; caption?: string }, signal?: AbortSignal): Promise<ImportedSource> {
  if (input.uploads?.length) {
    // Byte-level type check: the declared data-URL type is never trusted.
    const { images } = await normalizeUploadedSlides(input.uploads.map(upload => ({ data: upload.dataUrl, name: upload.name })), { caption: input.caption }).catch(importFailure);
    return { images: await Promise.all(images.map(image => fitForClaude(image))), caption: input.caption?.trim() ?? "", sourceUrl: input.url?.trim() || undefined };
  }
  if (!input.url?.trim()) throw new RecreateError("Paste an Instagram post link or upload the post's slides.");
  const post = await importInstagramPost(input.url.trim(), { signal }).catch(importFailure);
  const images = await downloadSlideImages(post.slides, { signal }).catch(importFailure);
  if (!images.length) throw new RecreateError("That post has no images Engine can read. Upload screenshots of its slides instead.");
  return {
    images: await Promise.all(images.map(image => fitForClaude({ mediaType: image.mediaType, base64: image.base64 }))),
    caption: [input.caption?.trim(), post.caption?.trim()].filter(Boolean).join("\n\n"),
    sourceUrl: post.url, owner: post.ownerUsername,
  };
}

/** Saves the slides as private workspace images; returns their ids in order. */
export async function keepSourceImages(ownerKey: string, images: SourceImage[]): Promise<string[]> {
  const ids: string[] = [];
  for (const [index, image] of images.entries()) {
    const asset = await storeOriginalAsset(ownerKey, Buffer.from(image.base64, "base64"), `recreate-original-${index + 1}.${image.mediaType.split("/")[1]}`);
    ids.push(asset.id);
  }
  return ids;
}

export async function loadSourceImages(ownerKey: string, ids: string[]): Promise<SourceImage[]> {
  const images: SourceImage[] = [];
  for (const id of ids) {
    const asset = await readOriginalAsset(ownerKey, id);
    if (!asset) throw new RecreateError("The original slides are no longer in the workspace. Start the recreation again.", 410);
    images.push({ mediaType: asset.mimeType as SourceImage["mediaType"], base64: asset.data.toString("base64") });
  }
  return images;
}
