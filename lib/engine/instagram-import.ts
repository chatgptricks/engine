/**
 * Server-only Instagram post import for "Recreate post".
 *
 * A teammate (or an agent) pastes an Instagram post link. We read the post
 * through Apify's official `apify/instagram-scraper` actor (same APIFY_TOKEN
 * and REST style as the X image search in ./apify.ts), normalize it into a
 * small, stable shape, then download the slide images from Meta's CDN for
 * Claude vision. When Apify is unavailable, uploaded screenshots plus a
 * pasted caption are normalized into the same shape.
 *
 * Network guards:
 * - The Apify token is only ever sent as an `Authorization: Bearer` header.
 * - Image downloads only reach https URLs on *.cdninstagram.com / *.fbcdn.net
 *   (re-checked on every redirect hop), so a crafted slide URL cannot point
 *   this server at private networks or arbitrary hosts.
 * - Every request has a bounded timeout, responses have size caps, and image
 *   bytes are sniffed so the declared media type always matches the data.
 */

export type InstagramPostKind = "p" | "reel" | "tv";
export type InstagramPostType = "Image" | "Video" | "Sidecar";
export type SlideMediaType = "image/jpeg" | "image/png" | "image/webp";

export interface ParsedInstagramUrl {
  shortcode: string;
  kind: InstagramPostKind;
  canonicalUrl: string;
}

export interface InstagramSlide {
  /** 0-based position in the post (carousel order). */
  index: number;
  /** Still image for this slide. For a video slide this is its cover frame.
   * Uploaded screenshots use the placeholder `upload:<index>`. */
  imageUrl: string;
  isVideo: boolean;
  videoUrl?: string;
  width?: number;
  height?: number;
}

export interface ImportedInstagramPost {
  shortcode: string;
  url: string;
  ownerUsername: string;
  caption: string;
  /** ISO 8601 publish time, or null when unknown (always null for uploads). */
  takenAt: string | null;
  type: InstagramPostType;
  slides: InstagramSlide[];
  /** "instagram" when imported through Apify, "upload" for the screenshot fallback. */
  source: "instagram" | "upload";
}

/** One image ready for a Claude vision content block. */
export interface SlideImage {
  index: number;
  mediaType: SlideMediaType;
  base64: string;
}

export type InstagramImportErrorCode =
  | "invalid_url"
  | "missing_token"
  | "not_found"
  | "private"
  | "upstream"
  | "timeout"
  | "aborted"
  | "no_media"
  | "blocked_host"
  | "unsupported_media"
  | "too_large"
  | "too_many_slides"
  | "invalid_upload";

/** `status` is a suggested HTTP status for routes that surface the error. */
export class InstagramImportError extends Error {
  constructor(public code: InstagramImportErrorCode, message: string, public status = 400) {
    super(message);
    this.name = "InstagramImportError";
  }
}

export const MAX_SLIDES = 20;
export const DEFAULT_MAX_IMAGE_BYTES = 10 * 1024 * 1024;
const MAX_IMAGE_BYTES_LIMIT = 25 * 1024 * 1024;
const MAX_APIFY_RESPONSE_BYTES = 8 * 1024 * 1024;
const MAX_CAPTION_CHARS = 5000;
const APIFY_ENDPOINT = "https://api.apify.com/v2/acts/apify~instagram-scraper/run-sync-get-dataset-items";
const DEFAULT_IMPORT_TIMEOUT_MS = 120_000;
const DEFAULT_IMAGE_TIMEOUT_MS = 20_000;
const MAX_REDIRECTS = 3;
const DOWNLOAD_CONCURRENCY = 4;

type FetchLike = typeof fetch;

/* ─── URL parsing ────────────────────────────────────────────────────────── */

const SHORTCODE = /^[A-Za-z0-9_-]{5,64}$/;
const USERNAME = /^[A-Za-z0-9._]{1,30}$/;
const KINDS: Record<string, InstagramPostKind> = {p: "p", reel: "reel", reels: "reel", tv: "tv"};
const INSTAGRAM_HOSTS = new Set(["instagram.com", "www.instagram.com"]);

function invalidUrl(message = "Paste an Instagram post link like https://www.instagram.com/p/ABC123xyz/."): InstagramImportError {
  return new InstagramImportError("invalid_url", message, 400);
}

/**
 * Accepts instagram.com and www.instagram.com links to /p/, /reel/ (or
 * /reels/) and /tv/ posts, with an optional leading username segment, any
 * query string (e.g. ?img_index=1) or fragment. Throws InstagramImportError
 * ("invalid_url") for anything else.
 */
export function parseInstagramUrl(input: string): ParsedInstagramUrl {
  if (typeof input !== "string") throw invalidUrl();
  const text = input.trim();
  if (!text || text.length > 2048) throw invalidUrl();
  let url: URL;
  try {
    url = new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(text) ? text : `https://${text}`);
  } catch {
    throw invalidUrl();
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") throw invalidUrl();
  if (url.username || url.password || url.port) throw invalidUrl();
  if (!INSTAGRAM_HOSTS.has(url.hostname.toLowerCase())) throw invalidUrl("Only instagram.com post links can be imported.");
  const segments = url.pathname.split("/").filter(Boolean).map(segment => {
    try {return decodeURIComponent(segment);} catch {return segment;}
  });
  let offset = -1;
  if (segments.length >= 2 && KINDS[segments[0].toLowerCase()]) offset = 0;
  else if (segments.length >= 3 && USERNAME.test(segments[0]) && KINDS[segments[1].toLowerCase()]) offset = 1;
  // Allow short trailing segments such as /embed/ or /c/<comment-id>/.
  if (offset < 0 || segments.length - offset > 4) throw invalidUrl("That link isn't an Instagram post, reel or video. Open the post and copy its link.");
  const kind = KINDS[segments[offset].toLowerCase()];
  const shortcode = segments[offset + 1];
  if (!SHORTCODE.test(shortcode)) throw invalidUrl("That Instagram link has an invalid post code.");
  return {shortcode, kind, canonicalUrl: `https://www.instagram.com/${kind}/${shortcode}/`};
}

/* ─── Apify import ───────────────────────────────────────────────────────── */

function boundedSignal(signal: AbortSignal | undefined, timeoutMs: number): {signal: AbortSignal; timeout: AbortSignal} {
  const timeout = AbortSignal.timeout(timeoutMs);
  return {signal: signal ? AbortSignal.any([signal, timeout]) : timeout, timeout};
}

function abortFailure(caller: AbortSignal | undefined, timeout: AbortSignal, what: string): InstagramImportError | null {
  if (caller?.aborted) return new InstagramImportError("aborted", `${what} was cancelled.`, 499);
  if (timeout.aborted) return new InstagramImportError("timeout", `${what} timed out. Try again, or upload screenshots instead.`, 504);
  return null;
}

async function readBounded(response: Response, maxBytes: number, tooLarge: () => InstagramImportError): Promise<Buffer> {
  const declared = Number(response.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > maxBytes) {
    await response.body?.cancel().catch(() => undefined);
    throw tooLarge();
  }
  if (!response.body) return Buffer.alloc(0);
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const {done, value} = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > maxBytes) {
        await reader.cancel().catch(() => undefined);
        throw tooLarge();
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  return Buffer.concat(chunks, size);
}

const text = (value: unknown): string => (typeof value === "string" ? value : "");
const positive = (value: unknown): number | undefined =>
  typeof value === "number" && Number.isFinite(value) && value > 0 ? Math.round(value) : undefined;
const httpUrl = (value: unknown): string | undefined =>
  typeof value === "string" && /^https?:\/\//i.test(value) && value.length <= 4096 ? value : undefined;

function slide(index: number, imageUrl: string, isVideo: boolean, videoUrl: string | undefined, width: unknown, height: unknown): InstagramSlide {
  const result: InstagramSlide = {index, imageUrl, isVideo};
  if (isVideo && videoUrl) result.videoUrl = videoUrl;
  const w = positive(width), h = positive(height);
  if (w) result.width = w;
  if (h) result.height = h;
  return result;
}

/**
 * Normalize one `apify/instagram-scraper` post item. Carousels arrive as
 * `type: "Sidecar"` with `childPosts` (each with its own `type`, `displayUrl`,
 * `videoUrl`, `dimensionsWidth`, `dimensionsHeight`); when those are missing
 * the flat `images` (or `carouselImages`) URL list is used. Single posts use
 * `displayUrl`, with `videoUrl` for videos and reels.
 */
export function normalizeApifyPost(item: unknown, expected?: ParsedInstagramUrl): ImportedInstagramPost {
  if (!item || typeof item !== "object" || Array.isArray(item)) throw new InstagramImportError("upstream", "Apify returned an unreadable Instagram post.", 502);
  const post = item as Record<string, unknown>;
  const shortcode = text(post.shortCode) || expected?.shortcode || "";
  const children = Array.isArray(post.childPosts)
    ? post.childPosts.filter((child): child is Record<string, unknown> => Boolean(child) && typeof child === "object" && !Array.isArray(child))
    : [];
  const flatImages = (Array.isArray(post.images) && post.images.length ? post.images : Array.isArray(post.carouselImages) ? post.carouselImages : [])
    .map(httpUrl)
    .filter((url): url is string => Boolean(url));
  const declaredType = text(post.type);
  const sidecar = declaredType === "Sidecar" || children.length > 1 || (!declaredType && flatImages.length > 1);
  const slides: InstagramSlide[] = [];
  if (sidecar && children.length) {
    for (const child of children) {
      const imageUrl = httpUrl(child.displayUrl) ?? (Array.isArray(child.images) ? child.images.map(httpUrl).find(Boolean) : undefined);
      if (!imageUrl) continue;
      const videoUrl = httpUrl(child.videoUrl);
      slides.push(slide(slides.length, imageUrl, text(child.type) === "Video" || Boolean(videoUrl), videoUrl, child.dimensionsWidth, child.dimensionsHeight));
    }
  } else if (sidecar) {
    for (const imageUrl of flatImages) slides.push(slide(slides.length, imageUrl, false, undefined, undefined, undefined));
  } else {
    const imageUrl = httpUrl(post.displayUrl) ?? flatImages[0];
    const videoUrl = httpUrl(post.videoUrl);
    if (imageUrl) slides.push(slide(0, imageUrl, declaredType === "Video" || Boolean(videoUrl), videoUrl, post.dimensionsWidth, post.dimensionsHeight));
  }
  if (!slides.length) throw new InstagramImportError("no_media", "This Instagram post has no images Engine can read. Upload screenshots instead.", 422);
  const timestamp = text(post.timestamp);
  const type: InstagramPostType = sidecar ? "Sidecar" : declaredType === "Video" || slides[0].isVideo ? "Video" : "Image";
  return {
    shortcode,
    url: httpUrl(post.url) ?? (shortcode ? `https://www.instagram.com/p/${shortcode}/` : expected?.canonicalUrl ?? ""),
    ownerUsername: text(post.ownerUsername),
    caption: text(post.caption).slice(0, MAX_CAPTION_CHARS),
    takenAt: timestamp && Number.isFinite(Date.parse(timestamp)) ? new Date(timestamp).toISOString() : null,
    type,
    slides: slides.slice(0, MAX_SLIDES),
    source: "instagram",
  };
}

function apifyFailure(status: number): InstagramImportError {
  if (status === 401 || status === 403) return new InstagramImportError("upstream", "Apify rejected APIFY_TOKEN. Check the token in the server environment.", 502);
  if (status === 402) return new InstagramImportError("upstream", "Apify's usage limit is reached, so the post can't be imported. Upload screenshots instead.", 502);
  if (status === 408) return new InstagramImportError("timeout", "Apify took too long to read the post. Try again, or upload screenshots instead.", 504);
  if (status === 429) return new InstagramImportError("upstream", "Apify is rate limiting imports. Wait a minute and try again.", 503);
  return new InstagramImportError("upstream", `Apify couldn't import the post (HTTP ${status}). Try again, or upload screenshots instead.`, 502);
}

function errorItemFailure(item: Record<string, unknown>): InstagramImportError {
  const detail = `${text(item.error)} ${text(item.errorDescription)}`;
  if (/private|restrict|log ?in|sign ?in/i.test(detail)) {
    return new InstagramImportError("private", "This Instagram post is private or restricted, so it can't be imported. Upload screenshots instead.", 404);
  }
  return new InstagramImportError("not_found", "Instagram post not found. Check the link, or upload screenshots instead.", 404);
}

export interface ImportInstagramPostOptions {
  signal?: AbortSignal;
  /** Overall budget for the Apify call (default 120 s, clamped to 10–180 s). */
  timeoutMs?: number;
  /** Injected for tests; defaults to the global fetch. */
  fetch?: FetchLike;
}

/** Import one public Instagram post through Apify and normalize it. */
export async function importInstagramPost(url: string, options: ImportInstagramPostOptions = {}): Promise<ImportedInstagramPost> {
  const parsed = parseInstagramUrl(url);
  const token = process.env.APIFY_TOKEN?.trim();
  if (!token) throw new InstagramImportError("missing_token", "Instagram import needs APIFY_TOKEN on the server. Upload screenshots and paste the caption instead.", 503);
  const fetchImpl = options.fetch ?? fetch;
  const budget = Math.min(180_000, Math.max(10_000, options.timeoutMs ?? DEFAULT_IMPORT_TIMEOUT_MS));
  // Leave the actor a little less time than the HTTP call so Apify answers first.
  const runTimeout = Math.max(5, Math.floor(budget / 1000) - 10);
  const query = new URLSearchParams({timeout: String(runTimeout), maxItems: "3", maxTotalChargeUsd: "0.05", format: "json", clean: "true"});
  const {signal, timeout} = boundedSignal(options.signal, budget);
  let response: Response;
  try {
    response = await fetchImpl(`${APIFY_ENDPOINT}?${query}`, {
      method: "POST",
      headers: {"Content-Type": "application/json", Accept: "application/json", Authorization: `Bearer ${token}`},
      // /p/<code>/ resolves posts, reels and IGTV alike for the "posts" results type.
      body: JSON.stringify({directUrls: [`https://www.instagram.com/p/${parsed.shortcode}/`], resultsType: "posts", resultsLimit: 1, addParentData: false}),
      signal,
      cache: "no-store",
    });
  } catch {
    throw abortFailure(options.signal, timeout, "Instagram import") ?? new InstagramImportError("upstream", "Apify couldn't be reached. Try again, or upload screenshots instead.", 502);
  }
  if (response.status !== 200 && response.status !== 201) {
    await response.body?.cancel().catch(() => undefined);
    throw apifyFailure(response.status);
  }
  let items: unknown;
  try {
    const body = await readBounded(response, MAX_APIFY_RESPONSE_BYTES, () => new InstagramImportError("upstream", "Apify returned more data than expected for one post.", 502));
    items = JSON.parse(body.toString("utf8"));
  } catch (error) {
    if (error instanceof InstagramImportError) throw error;
    throw abortFailure(options.signal, timeout, "Instagram import") ?? new InstagramImportError("upstream", "Apify returned an unreadable response.", 502);
  }
  if (!Array.isArray(items)) throw new InstagramImportError("upstream", "Apify returned an unreadable response.", 502);
  const records = items.filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === "object" && !Array.isArray(item));
  const usable = records.filter(item => !item.error);
  const match = usable.find(item => item.shortCode === parsed.shortcode) ?? usable.find(item => item.shortCode === undefined && (item.type || item.displayUrl));
  if (!match) {
    const failed = records.find(item => typeof item.error === "string");
    if (failed) throw errorItemFailure(failed);
    throw new InstagramImportError("not_found", "Instagram post not found, or it's private. Check the link, or upload screenshots instead.", 404);
  }
  return normalizeApifyPost(match, parsed);
}

/* ─── Slide image downloads ──────────────────────────────────────────────── */

const ALLOWED_IMAGE_HOST_SUFFIXES = ["cdninstagram.com", "fbcdn.net"];
const DECLARED_TYPES = new Map<string, SlideMediaType>([
  ["image/jpeg", "image/jpeg"],
  ["image/jpg", "image/jpeg"],
  ["image/pjpeg", "image/jpeg"],
  ["image/png", "image/png"],
  ["image/webp", "image/webp"],
]);

/** True only for https URLs on Instagram/Facebook CDN hosts, default port, no credentials. */
export function isAllowedInstagramImageUrl(value: string): boolean {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return false;
  }
  if (url.protocol !== "https:" || url.username || url.password || (url.port && url.port !== "443")) return false;
  const host = url.hostname.toLowerCase();
  return ALLOWED_IMAGE_HOST_SUFFIXES.some(suffix => host === suffix || host.endsWith(`.${suffix}`));
}

/** Identify JPEG, PNG or WebP from magic bytes; anything else is null. */
export function sniffImageType(bytes: Uint8Array): SlideMediaType | null {
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "image/jpeg";
  if (bytes.length >= 8 && [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a].every((byte, i) => bytes[i] === byte)) return "image/png";
  if (bytes.length >= 12 && String.fromCharCode(...bytes.subarray(0, 4)) === "RIFF" && String.fromCharCode(...bytes.subarray(8, 12)) === "WEBP") return "image/webp";
  return null;
}

function checkedMaxBytes(value: number | undefined): number {
  const maxBytes = value ?? DEFAULT_MAX_IMAGE_BYTES;
  if (!Number.isInteger(maxBytes) || maxBytes < 1024 || maxBytes > MAX_IMAGE_BYTES_LIMIT) throw new RangeError(`maxBytes must be an integer from 1 KB to ${MAX_IMAGE_BYTES_LIMIT / 1024 / 1024} MB.`);
  return maxBytes;
}

const megabytes = (bytes: number) => `${Math.round((bytes / 1024 / 1024) * 10) / 10} MB`;

async function fetchSlideImage(imageUrl: string, index: number, fetchImpl: FetchLike, maxBytes: number, caller: AbortSignal | undefined, timeoutMs: number): Promise<SlideImage> {
  const label = `Slide ${index + 1}`;
  const {signal, timeout} = boundedSignal(caller, timeoutMs);
  let current = imageUrl;
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    if (!isAllowedInstagramImageUrl(current)) throw new InstagramImportError("blocked_host", `${label} image isn't on Instagram's CDN, so Engine won't download it.`, 400);
    let response: Response;
    try {
      response = await fetchImpl(current, {
        method: "GET",
        redirect: "manual",
        headers: {Accept: "image/jpeg,image/png,image/webp", "User-Agent": "EngineBot/1.0 (+https://github.com/chatgptricks/engine)"},
        signal,
        cache: "no-store",
      });
    } catch {
      throw abortFailure(caller, timeout, `${label} download`) ?? new InstagramImportError("upstream", `${label} image couldn't be downloaded. Try again, or upload screenshots instead.`, 502);
    }
    if ([301, 302, 303, 307, 308].includes(response.status)) {
      const location = response.headers.get("location");
      await response.body?.cancel().catch(() => undefined);
      if (!location) break;
      try {
        current = new URL(location, current).href;
      } catch {
        break;
      }
      continue;
    }
    if (response.status !== 200) {
      await response.body?.cancel().catch(() => undefined);
      throw new InstagramImportError("upstream", `${label} image is unavailable (HTTP ${response.status}). Instagram image links expire, so import the post again.`, 502);
    }
    const declared = (response.headers.get("content-type") ?? "").split(";")[0].trim().toLowerCase();
    if (!DECLARED_TYPES.has(declared)) {
      await response.body?.cancel().catch(() => undefined);
      throw new InstagramImportError("unsupported_media", `${label} isn't a JPEG, PNG or WebP image.`, 415);
    }
    let bytes: Buffer;
    try {
      bytes = await readBounded(response, maxBytes, () => new InstagramImportError("too_large", `${label} image is larger than ${megabytes(maxBytes)}.`, 413));
    } catch (error) {
      if (error instanceof InstagramImportError) throw error;
      throw abortFailure(caller, timeout, `${label} download`) ?? new InstagramImportError("upstream", `${label} image download was interrupted.`, 502);
    }
    // Claude vision rejects a media type that disagrees with the bytes, so trust the bytes.
    const mediaType = sniffImageType(bytes);
    if (!mediaType) throw new InstagramImportError("unsupported_media", `${label} isn't a JPEG, PNG or WebP image.`, 415);
    return {index, mediaType, base64: bytes.toString("base64")};
  }
  throw new InstagramImportError("upstream", `${label} image redirected too many times.`, 502);
}

export interface DownloadSlideImagesOptions {
  signal?: AbortSignal;
  /** Per-image cap in bytes (default 10 MB). */
  maxBytes?: number;
  /** Per-image timeout (default 20 s, clamped to 2–60 s). */
  timeoutMs?: number;
  /** Injected for tests; defaults to the global fetch. */
  fetch?: FetchLike;
}

/**
 * Download each slide's still image for Claude vision, preserving slide order.
 * Video slides contribute their cover frame. Every URL is checked against the
 * CDN allowlist before any request is made.
 */
export async function downloadSlideImages(slides: readonly Pick<InstagramSlide, "index" | "imageUrl">[], options: DownloadSlideImagesOptions = {}): Promise<SlideImage[]> {
  if (!Array.isArray(slides)) throw new TypeError("slides must be an array.");
  if (slides.length > MAX_SLIDES) throw new InstagramImportError("too_many_slides", `A post can have at most ${MAX_SLIDES} slides.`, 413);
  const maxBytes = checkedMaxBytes(options.maxBytes);
  const timeoutMs = Math.min(60_000, Math.max(2_000, options.timeoutMs ?? DEFAULT_IMAGE_TIMEOUT_MS));
  const fetchImpl = options.fetch ?? fetch;
  slides.forEach((item, position) => {
    if (!item || typeof item.imageUrl !== "string" || !isAllowedInstagramImageUrl(item.imageUrl)) {
      throw new InstagramImportError("blocked_host", `Slide ${position + 1} image isn't on Instagram's CDN, so Engine won't download it.`, 400);
    }
  });
  if (options.signal?.aborted) throw new InstagramImportError("aborted", "Slide download was cancelled.", 499);
  const results: SlideImage[] = new Array(slides.length);
  let next = 0;
  const worker = async () => {
    while (next < slides.length) {
      const position = next++;
      const item = slides[position];
      const index = Number.isInteger(item.index) && item.index >= 0 ? item.index : position;
      results[position] = await fetchSlideImage(item.imageUrl, index, fetchImpl, maxBytes, options.signal, timeoutMs);
    }
  };
  await Promise.all(Array.from({length: Math.min(DOWNLOAD_CONCURRENCY, slides.length)}, worker));
  return results;
}

/* ─── Uploaded screenshots (no-Apify fallback) ───────────────────────────── */

/** A browser File/Blob, or raw bytes / base64 / a data URL with an optional declared type. */
export type UploadedSlideInput =
  | Blob
  | {data: ArrayBuffer | ArrayBufferView | string; mediaType?: string; name?: string};

export interface NormalizeUploadedSlidesOptions {
  caption?: string;
  /** Optional link to the original post; fills shortcode and url when valid. */
  url?: string;
  ownerUsername?: string;
  /** Per-image cap in bytes (default 10 MB). */
  maxBytes?: number;
}

function uploadError(message: string, status = 400): InstagramImportError {
  return new InstagramImportError(status === 413 ? "too_large" : status === 415 ? "unsupported_media" : "invalid_upload", message, status);
}

async function uploadedBytes(file: UploadedSlideInput, label: string, maxBytes: number): Promise<Buffer> {
  const tooLarge = () => uploadError(`${label} is larger than ${megabytes(maxBytes)}.`, 413);
  if (typeof Blob !== "undefined" && file instanceof Blob) {
    if (file.size > maxBytes) throw tooLarge();
    return Buffer.from(await file.arrayBuffer());
  }
  if (!file || typeof file !== "object" || !("data" in file)) throw uploadError(`${label} isn't a readable image upload.`);
  const {data} = file;
  if (typeof data === "string") {
    const base64 = data.replace(/^data:[^,]{0,100};base64,/i, "").replace(/\s+/g, "");
    if (!base64 || !/^[A-Za-z0-9+/]+={0,2}$/.test(base64)) throw uploadError(`${label} isn't valid base64 image data.`);
    if (Math.floor((base64.length * 3) / 4) > maxBytes + 2) throw tooLarge();
    return Buffer.from(base64, "base64");
  }
  if (data instanceof ArrayBuffer) {
    if (data.byteLength > maxBytes) throw tooLarge();
    return Buffer.from(new Uint8Array(data));
  }
  if (ArrayBuffer.isView(data)) {
    if (data.byteLength > maxBytes) throw tooLarge();
    return Buffer.from(data.buffer, data.byteOffset, data.byteLength);
  }
  throw uploadError(`${label} isn't a readable image upload.`);
}

/**
 * Turn uploaded screenshots (in slide order) plus a pasted caption into the
 * same post shape `importInstagramPost` returns, together with the vision-ready
 * images `downloadSlideImages` would return.
 */
export async function normalizeUploadedSlides(files: readonly UploadedSlideInput[], options: NormalizeUploadedSlidesOptions = {}): Promise<{post: ImportedInstagramPost; images: SlideImage[]}> {
  if (!Array.isArray(files) || files.length === 0) throw uploadError("Upload at least one screenshot of the post.");
  if (files.length > MAX_SLIDES) throw new InstagramImportError("too_many_slides", `Upload at most ${MAX_SLIDES} screenshots.`, 413);
  const maxBytes = checkedMaxBytes(options.maxBytes);
  const caption = typeof options.caption === "string" ? options.caption.trim() : "";
  if (caption.length > MAX_CAPTION_CHARS) throw uploadError(`The caption is longer than ${MAX_CAPTION_CHARS} characters.`, 413);
  const parsed = options.url?.trim() ? parseInstagramUrl(options.url) : null;
  const owner = (options.ownerUsername ?? "").trim().replace(/^@/, "");
  const images: SlideImage[] = [];
  for (const [index, file] of files.entries()) {
    const label = `Screenshot ${index + 1}`;
    const bytes = await uploadedBytes(file, label, maxBytes);
    if (bytes.length > maxBytes) throw uploadError(`${label} is larger than ${megabytes(maxBytes)}.`, 413);
    const mediaType = sniffImageType(bytes);
    if (!mediaType) throw uploadError(`${label} isn't a JPEG, PNG or WebP image.`, 415);
    images.push({index, mediaType, base64: bytes.toString("base64")});
  }
  return {
    post: {
      shortcode: parsed?.shortcode ?? "",
      url: parsed?.canonicalUrl ?? "",
      ownerUsername: USERNAME.test(owner) ? owner : "",
      caption,
      takenAt: null,
      type: images.length > 1 ? "Sidecar" : "Image",
      slides: images.map(image => ({index: image.index, imageUrl: `upload:${image.index}`, isVideo: false})),
      source: "upload",
    },
    images,
  };
}
