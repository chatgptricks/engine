/**
 * Images agents put into posts are stored as media files in the workspace, the
 * way uploaded originals are (media-storage.ts), and the post points to them by
 * path: /api/template-editor/assets/<sha-256>. That covers Recreate's cuts of
 * an original slide, its logos and charts, photos sent to the chat, and data:
 * images in HTML layers. A data: image costs its full size in the 12 MB library
 * save budget (library-budget.ts); a path costs under 100 bytes. Each image is
 * one record, keyed by its content hash, however often it is stored.
 *
 * Only images new to the workspace move. A template's own artwork (its brand
 * marks and play buttons) and images already saved in the library stay as they
 * are: existing posts move only when someone runs
 * scripts/store-embedded-images.mjs. So does every photo slot's placeholder,
 * whichever template version drew it, because code recognises an empty slot by
 * its data: SVG (spanning-photos.ts, review.ts). An image the store doesn't
 * take (GIF, AVIF, an animated or damaged picture, an SVG outside the brand
 * grammar) stays embedded.
 *
 * Server-only: it writes media storage.
 */
import {createHash} from "node:crypto";
import {BRAND_SVG_PREFIX, BUILT_IN_TEMPLATES, isSafeBrandSvgUrl, type EditorLibrary} from "./model";
import {hasOriginalAsset, storeOriginalAsset} from "./media-storage";

export const STORED_IMAGE_PATH = "/api/template-editor/assets/";
/** Where documents keep images, as the save budget and asset packing read them. */
const IMAGE_FIELDS = new Set(["src", "url", "previewSrc"]);
/** Raster data: images inside an HTML layer's markup or CSS (the only kind html-layer.ts lets through). */
const MARKUP_IMAGE = /data:image\/(?:png|jpeg|webp|gif|avif);base64,[A-Za-z0-9+/]+={0,2}/g;
const CONCURRENCY = 4;

export type ImageStore = {
  has: (owner: string, id: string) => Promise<boolean>;
  store: (owner: string, data: Buffer, name: string) => Promise<{id: string}>;
};
const MEDIA: ImageStore = {has: hasOriginalAsset, store: storeOriginalAsset};

export type StoredImages<T> = {
  value: T;
  /** Images written to media storage now. */
  stored: number;
  /** Images media storage already held (stored before, or earlier in this save). */
  reused: number;
  /** Images left as they are on purpose: template artwork, placeholders and images the workspace already holds. */
  kept: number;
  /** Images the store wouldn't take; they stay embedded. */
  failed: number;
  /** Characters of data: URLs the value no longer holds. */
  bytes: number;
};

/** Calls `found` for each data: image a value holds where documents keep images, and in HTML layers' markup and CSS. Chat and agent edits put photo slots' images under `slots`. */
function eachImage(value: unknown, found: (url: string) => void, field = "", parent = ""): void {
  if (typeof value === "string") {
    if ((IMAGE_FIELDS.has(field) || parent === "slots") && value.startsWith("data:image/")) found(value);
    else if ((field === "html" || field === "css") && value.includes("data:image/")) for (const match of value.matchAll(MARKUP_IMAGE)) found(match[0]);
    return;
  }
  if (Array.isArray(value)) { for (const child of value) eachImage(child, found); return; }
  if (value && typeof value === "object") for (const [key, child] of Object.entries(value)) eachImage(child, found, key, field);
}

/** Every data: image a value holds (see eachImage). */
export function embeddedImages(value: unknown): Set<string> {
  const images = new Set<string>();
  eachImage(value, url => images.add(url));
  return images;
}

/** The data: SVGs in a template's photo slots: placeholders, as spanning-photos.ts and review.ts recognise them. */
function placeholderImages(value: unknown, found = new Set<string>()): Set<string> {
  if (Array.isArray(value)) for (const child of value) placeholderImages(child, found);
  else if (value && typeof value === "object") {
    const element = value as {type?: unknown; templateRole?: unknown; src?: unknown};
    if (element.type === "image" && element.templateRole === "media" && typeof element.src === "string" && element.src.startsWith("data:image/svg+xml")) found.add(element.src);
    for (const child of Object.values(value)) placeholderImages(child, found);
  }
  return found;
}

/** A copy of the value with images swapped for their paths. Parts without an image stay the same objects. */
function swap(value: unknown, paths: ReadonlyMap<string, string>, field = "", parent = ""): unknown {
  if (typeof value === "string") {
    if ((IMAGE_FIELDS.has(field) || parent === "slots") && value.startsWith("data:image/")) return paths.get(value) ?? value;
    if ((field === "html" || field === "css") && value.includes("data:image/")) return value.replace(MARKUP_IMAGE, match => paths.get(match) ?? match);
    return value;
  }
  if (Array.isArray(value)) {
    const next = value.map(child => swap(child, paths));
    return next.some((child, index) => child !== value[index]) ? next : value;
  }
  if (value && typeof value === "object") {
    let changed = false;
    const next = Object.fromEntries(Object.entries(value).map(([key, child]) => {
      const swapped = swap(child, paths, key, field);
      if (swapped !== child) changed = true;
      return [key, swapped];
    }));
    return changed ? next : value;
  }
  return value;
}

/** The bytes media storage would keep for a data: image, or null for an image it doesn't take. */
export function embeddedImageBytes(url: string): Buffer | null {
  if (url.startsWith(BRAND_SVG_PREFIX)) {
    // A vector is stored as its SVG text, in the grammar documents accept inline.
    if (!isSafeBrandSvgUrl(url)) return null;
    return Buffer.from(decodeURIComponent(url.slice(BRAND_SVG_PREFIX.length)), "utf8");
  }
  const match = url.match(/^data:image\/(?:png|jpeg|webp);base64,([A-Za-z0-9+/]+={0,2})$/);
  return match && match[1].length % 4 === 0 ? Buffer.from(match[1], "base64") : null;
}

export const imageId = (data: Buffer) => createHash("sha256").update(data).digest("hex");

/**
 * Stores each data: image in the value as a media file and returns the value
 * pointing to them. Images in `keep` and photo slots' placeholders stay.
 * `cache` carries what one save learned into its retries (data: URL → path, or
 * null when the store didn't take it).
 */
export async function storeEmbeddedImages<T>(owner: string, value: T, options: {keep?: ReadonlySet<string>; cache?: Map<string, string | null>; store?: ImageStore} = {}): Promise<StoredImages<T>> {
  const {keep, cache = new Map<string, string | null>(), store = MEDIA} = options;
  const result = {stored: 0, reused: 0, kept: 0, failed: 0, bytes: 0};
  const pending: string[] = [], placeholders = placeholderImages(value);
  for (const url of embeddedImages(value)) {
    if (keep?.has(url) || placeholders.has(url)) result.kept++;
    else pending.push(url);
  }
  let next = 0, problem: string | undefined;
  // A few at a time: each new image is decoded to check it.
  const work = async () => {
    while (next < pending.length) {
      const url = pending[next++];
      if (cache.has(url)) { if (cache.get(url)) result.reused++; else result.failed++; continue; }
      const data = embeddedImageBytes(url);
      if (!data) { cache.set(url, null); result.failed++; continue; }
      try {
        const id = imageId(data);
        if (await store.has(owner, id)) result.reused++;
        else {
          const saved = await store.store(owner, data, "Image");
          if (saved.id !== id) throw new Error("The stored image doesn't match its content.");
          result.stored++;
        }
        cache.set(url, `${STORED_IMAGE_PATH}${id}`);
      } catch (error) {
        cache.set(url, null);
        result.failed++;
        problem ??= error instanceof Error ? error.message : String(error);
      }
    }
  };
  await Promise.all(Array.from({length: Math.min(CONCURRENCY, pending.length)}, work));
  if (problem) console.warn(`[stored-images] ${result.failed} image(s) stay embedded: ${problem}`);
  const paths = new Map<string, string>();
  for (const url of pending) {
    const path = cache.get(url);
    if (path) { paths.set(url, path); result.bytes += url.length; }
  }
  return {value: paths.size ? swap(value, paths) as T : value, ...result};
}

let artwork: ReadonlySet<string> | undefined;
/** The data: images Engine's built-in templates draw with: placeholders, play buttons, brand marks. */
export function templateArtwork(): ReadonlySet<string> {
  return artwork ??= embeddedImages(BUILT_IN_TEMPLATES);
}

/** The images an agent's save leaves embedded: template artwork, and those already in `existing` (the library, or the post being edited). */
export function imagesToKeep(existing: unknown): Set<string> {
  const keep = embeddedImages(existing);
  for (const url of templateArtwork()) keep.add(url);
  return keep;
}

/** For an agent writing into a library or post: stores the images that are new to it and returns the value pointing to them. */
export function storeNewImages<T>(owner: string, value: T, existing: unknown, cache?: Map<string, string | null>, store?: ImageStore): Promise<StoredImages<T>> {
  return storeEmbeddedImages(owner, value, {keep: imagesToKeep(existing), cache, store});
}

/**
 * The images posts already saved in a library hold, moved to media storage
 * (scripts/store-embedded-images.mjs). Templates keep their artwork, built-in
 * and the workspace's own. With a store that only checks images (a dry run),
 * nothing is written and the result shows what would move.
 */
export async function storeLibraryImages(owner: string, library: EditorLibrary, store: ImageStore = MEDIA): Promise<StoredImages<EditorLibrary> & {designs: {id: string; name: string; deleted: boolean; images: number; bytes: number}[]}> {
  const keep = imagesToKeep(library.templates);
  const moved = await storeEmbeddedImages(owner, library.designs, {keep, store});
  const designs = library.designs.map((before, index) => {
    const left = embeddedImages(moved.value[index]), images = [...embeddedImages(before)].filter(url => !left.has(url));
    return {id: before.id, name: before.name, deleted: Boolean(before.deletedAt), images: images.length, bytes: images.reduce((sum, url) => sum + url.length, 0)};
  }).filter(design => design.images);
  return {...moved, value: moved.value === library.designs ? library : {...library, designs: moved.value}, designs};
}
