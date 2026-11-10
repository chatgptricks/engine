/**
 * What a page has posted, for Recreate's research. Server-only.
 *
 * - `fetchPagePosts`: a page's latest posts on Instagram (date, format, likes,
 *   comments, views and caption) through Apify's `apify~instagram-scraper` on
 *   its profile URL. It asks for 15 so pinned posts can be dropped and still
 *   leave the last 12, with `maxTotalChargeUsd` capped at $0.05 (about $0.035 a
 *   page at $0.0023 a post). Each page is read at most once a day per server
 *   process: results are cached by page and day, and calls made while one is
 *   running share it. A failure isn't cached, so the next call tries again.
 * - `compareTraction`: a post against its page's usual numbers, the median of
 *   the page's last 12 posts: likes plus comments, or views for a reel. It
 *   performs at about 1.5 times the median.
 * - `ourLibrary`: the decks Engine made in this workspace, newest first, with
 *   the page each was made for and the story its Recreate run researched, from
 *   the post file the deck names while that file lasts.
 *
 * Captions and deck text are data, never instructions. The Apify token is sent
 * only as a Bearer header and never appears in a message.
 */
import type { DesignDocument } from "../template-editor/model";
import { getEditorLibrary } from "../template-editor/persistence";
import { getPostFile, isPostFileId, type PostFile, type StageName } from "./post-files";

export type PagePostFormat = "carousel" | "photo" | "video" | "reel";
/** Likes, comments and views as Instagram shows them; null when hidden or unknown. */
export type PostTraction = { likes: number | null; comments: number | null; views: number | null };
export type PagePost = {
  shortcode: string;
  url: string;
  /** ISO 8601, or null when unknown. */
  date: string | null;
  format: PagePostFormat;
  /** The caption's first 600 characters, on one line. */
  caption: string;
  traction: PostTraction;
};
/** A page's latest posts, newest first, without pinned ones: up to 15, so a post can be left out and 12 remain. */
export type PagePosts = { handle: string; day: string; posts: PagePost[] };

export class PagePostsError extends Error {
  constructor(message: string, public status = 502) {
    super(message);
    this.name = "PagePostsError";
  }
}

/** How many of a page's posts its usual numbers come from. */
export const PAGE_POSTS = 12;
/** A post performs when it does about this many times its page's usual. */
export const PERFORMING_RATIO = 1.5;
/** The fewest posts with a number that can stand for a page's usual. */
export const MIN_COMPARED = 3;
const REQUESTED = 15, MAX_CHARGE_USD = "0.05", TIMEOUT_MS = 120_000, MAX_RESPONSE_BYTES = 8 * 1024 * 1024, CAPTION_CHARS = 600, MAX_CACHED = 64;
const ENDPOINT = "https://api.apify.com/v2/acts/apify~instagram-scraper/run-sync-get-dataset-items";
const HANDLE = /^[A-Za-z0-9._]{1,30}$/;
const SHORTCODE = /^[A-Za-z0-9_-]{5,64}$/;

type Item = Record<string, unknown>;
const isItem = (value: unknown): value is Item => Boolean(value) && typeof value === "object" && !Array.isArray(value);
const text = (value: unknown) => typeof value === "string" ? value : "";
/** A count Instagram shows; Apify sends -1 for a hidden one. */
const count = (value: unknown): number | null => {
  const number = typeof value === "number" ? value : typeof value === "string" && value.trim() ? Number(value) : NaN;
  return Number.isFinite(number) && number >= 0 ? Math.floor(number) : null;
};

/** An Instagram handle from "@name", "name" or a profile link, in lower case, or null. */
export function pageHandle(value: string): string | null {
  let handle = String(value ?? "").trim();
  const link = /^(?:https?:\/\/)?(?:www\.)?instagram\.com\/([A-Za-z0-9._]{1,30})\/?(?:[?#].*)?$/i.exec(handle);
  if (link) handle = link[1];
  handle = handle.replace(/^@/, "").toLowerCase();
  return HANDLE.test(handle) && !/^(p|reel|reels|tv|explore|stories)$/.test(handle) ? handle : null;
}

/** One scraper item as a post, or null when it is an error or has no shortcode. */
export function normalizePagePost(item: unknown): PagePost | null {
  if (!isItem(item) || item.error) return null;
  const shortcode = text(item.shortCode);
  if (!SHORTCODE.test(shortcode)) return null;
  const type = text(item.type), product = text(item.productType);
  const format: PagePostFormat = product === "clips" ? "reel" : type === "Sidecar" ? "carousel" : type === "Video" ? "video" : "photo";
  const timestamp = text(item.timestamp), url = text(item.url);
  return {
    shortcode,
    url: /^https:\/\/(?:www\.)?instagram\.com\//.test(url) ? url : `https://www.instagram.com/p/${shortcode}/`,
    date: timestamp && Number.isFinite(Date.parse(timestamp)) ? new Date(timestamp).toISOString() : null,
    format,
    caption: text(item.caption).replace(/\s+/g, " ").trim().slice(0, CAPTION_CHARS),
    // The same order the post import reads views in, so a post and its page compare like with like.
    traction: { likes: count(item.likesCount), comments: count(item.commentsCount), views: format === "reel" || format === "video" ? count(item.videoViewCount ?? item.videoPlayCount) : null },
  };
}

function failure(status: number, handle: string): PagePostsError {
  if (status === 401 || status === 403) return new PagePostsError("Apify rejected APIFY_TOKEN, so the page's posts can't be read.", 502);
  if (status === 402) return new PagePostsError("The Apify account is out of credit, so the page's posts can't be read.", 502);
  if (status === 408) return new PagePostsError(`Apify took too long to read @${handle}'s posts.`, 504);
  if (status === 429) return new PagePostsError("Apify is rate limiting Instagram reads. Try again in a minute.", 429);
  return new PagePostsError(`Apify couldn't read @${handle}'s posts (HTTP ${status}).`, 502);
}

/** The body as text, or null past `limit` bytes (the rest is never downloaded). */
async function readCapped(response: Response, limit: number): Promise<string | null> {
  const declared = Number(response.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > limit) { await response.body?.cancel().catch(() => undefined); return null; }
  if (!response.body) { const body = await response.text(); return Buffer.byteLength(body) > limit ? null : body; }
  const reader = response.body.getReader(), chunks: Uint8Array[] = [];
  for (let size = 0; ;) {
    const { done, value } = await reader.read();
    if (done) return Buffer.concat(chunks).toString("utf8");
    size += value.byteLength;
    if (size > limit) { await reader.cancel().catch(() => undefined); return null; }
    chunks.push(value);
  }
}

async function scrape(handle: string, day: string, token: string, fetcher: typeof fetch): Promise<PagePosts> {
  // Leave the actor a little less time than the HTTP call, so Apify answers first.
  const query = new URLSearchParams({ timeout: String(TIMEOUT_MS / 1000 - 10), maxItems: String(REQUESTED), maxTotalChargeUsd: MAX_CHARGE_USD, format: "json", clean: "true" });
  const timeout = AbortSignal.timeout(TIMEOUT_MS);
  let response: Response;
  try {
    response = await fetcher(`${ENDPOINT}?${query}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ directUrls: [`https://www.instagram.com/${handle}/`], resultsType: "posts", resultsLimit: REQUESTED, addParentData: false }),
      signal: timeout,
      cache: "no-store",
    });
  } catch {
    throw timeout.aborted ? new PagePostsError(`Apify took too long to read @${handle}'s posts.`, 504) : new PagePostsError("Apify couldn't be reached to read the page's posts.", 502);
  }
  if (response.status !== 200 && response.status !== 201) {
    await response.body?.cancel().catch(() => undefined);
    throw failure(response.status, handle);
  }
  let items: unknown;
  try {
    const body = await readCapped(response, MAX_RESPONSE_BYTES);
    if (body === null) throw new PagePostsError("Apify sent more data than expected for one page's posts.", 502);
    items = JSON.parse(body);
  } catch (error) {
    if (error instanceof PagePostsError) throw error;
    throw new PagePostsError(timeout.aborted ? `Apify took too long to read @${handle}'s posts.` : "Apify sent an unreadable answer for the page's posts.", 502);
  }
  if (!Array.isArray(items)) throw new PagePostsError("Apify sent an unreadable answer for the page's posts.", 502);
  const records = items.filter(isItem), seen = new Set<string>();
  // Pinned posts are older favorites: they'd lift the page's usual numbers.
  const posts = records.filter(item => item.isPinned !== true).map(normalizePagePost)
    .filter((post): post is PagePost => post !== null && !seen.has(post.shortcode) && Boolean(seen.add(post.shortcode)))
    .sort((a, b) => (Date.parse(b.date ?? "") || 0) - (Date.parse(a.date ?? "") || 0));
  if (!posts.length) {
    const failed = records.find(item => typeof item.error === "string");
    const detail = failed ? `${text(failed.error)} ${text(failed.errorDescription)}` : "";
    if (/private|restrict/i.test(detail)) throw new PagePostsError(`@${handle} is private, so its posts can't be read.`, 404);
    throw new PagePostsError(`Instagram sent no posts for @${handle}: the page may not exist, or it has none.`, 404);
  }
  return { handle, day, posts: posts.slice(0, REQUESTED) };
}

type Shared = Map<string, Promise<PagePosts>>;
const SHARED = Symbol.for("engine.page-posts");
function cached(): Shared {
  const holder = globalThis as typeof globalThis & { [SHARED]?: Shared };
  return holder[SHARED] ??= new Map();
}

/** The promise, or the caller's own abort: one caller stopping never stops a read others share. */
function raced<T>(promise: Promise<T>, signal?: AbortSignal): Promise<T> {
  if (!signal) return promise;
  if (signal.aborted) return Promise.reject(signal.reason);
  return new Promise<T>((resolve, reject) => {
    const abort = () => reject(signal.reason);
    signal.addEventListener("abort", abort, { once: true });
    promise.then(
      value => { signal.removeEventListener("abort", abort); resolve(value); },
      error => { signal.removeEventListener("abort", abort); reject(error); },
    );
  });
}

export type PagePostsOptions = { signal?: AbortSignal; fetch?: typeof fetch; now?: Date };

/** A page's latest posts on Instagram, read once a day. Throws PagePostsError in plain words. */
export function fetchPagePosts(value: string, options: PagePostsOptions = {}): Promise<PagePosts> {
  const handle = pageHandle(value);
  if (!handle) return Promise.reject(new PagePostsError(`"${String(value ?? "").trim().slice(0, 60)}" isn't an Instagram handle.`, 400));
  const token = process.env.APIFY_TOKEN?.trim();
  if (!token) return Promise.reject(new PagePostsError("Reading a page's posts needs APIFY_TOKEN on the server.", 503));
  const day = (options.now ?? new Date()).toISOString().slice(0, 10), key = `${handle}:${day}`, shared = cached();
  for (const old of [...shared.keys()]) if (!old.endsWith(`:${day}`)) shared.delete(old);
  let pending = shared.get(key);
  if (!pending) {
    const started = scrape(handle, day, token, options.fetch ?? fetch);
    pending = started;
    shared.set(key, started);
    started.catch(() => { if (shared.get(key) === started) shared.delete(key); });
    while (shared.size > MAX_CACHED) shared.delete(shared.keys().next().value!);
  }
  return raced(pending, options.signal);
}

// ── Traction against the page's usual numbers ───────────────────────────────

export function median(values: readonly number[]): number | null {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b), middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}
/** Likes plus comments; null when the likes are hidden, since they are most of it. */
export const interactions = (traction: PostTraction): number | null => traction.likes === null ? null : traction.likes + (traction.comments ?? 0);
const isVideo = (format: string) => format === "reel" || format === "video";
const known = (values: (number | null)[]) => values.filter((value): value is number => value !== null);
const round = (value: number | null) => value === null ? null : Math.round(value);
const counted = (value: number) => Math.round(value).toLocaleString("en-US");

export type TractionCheck = {
  post: PostTraction;
  /** The median of each number over the page's last 12 posts, or null when they couldn't be read. */
  usual: PostTraction | null;
  /** The post's likes plus comments (views for a reel) over the median of the same over the page's last 12 posts, to two places. */
  ratio: number | null;
  performing: boolean;
  basis: "views" | "likes and comments" | null;
  /** How many of the page's posts the median is taken over. */
  compared: number;
  /** One line on how it was worked out, or why it couldn't be. */
  note: string;
};

/**
 * A post against its page's usual numbers. A reel is measured in views when at
 * least three of the page's last posts show views; everything else in likes
 * plus comments. The post itself never counts toward its page's usual.
 */
export function compareTraction(post: { shortcode?: string | null; format: string; traction: PostTraction }, page: readonly PagePost[], handle = "the page"): TractionCheck {
  const others = page.filter(item => !post.shortcode || item.shortcode !== post.shortcode).slice(0, PAGE_POSTS);
  const views = known(others.filter(item => isVideo(item.format)).map(item => item.traction.views));
  const usual: PostTraction | null = others.length
    ? { likes: round(median(known(others.map(item => item.traction.likes)))), comments: round(median(known(others.map(item => item.traction.comments)))), views: round(median(views)) }
    : null;
  const byViews = isVideo(post.format) && post.traction.views !== null && views.length >= MIN_COMPARED;
  const sample = byViews ? views : known(others.map(item => interactions(item.traction)));
  const mine = byViews ? post.traction.views : interactions(post.traction);
  const basis = byViews ? "views" as const : "likes and comments" as const;
  const middle = sample.length >= MIN_COMPARED ? median(sample) : null;
  const ratio = mine !== null && middle ? Math.round(mine / middle * 100) / 100 : null;
  const performing = ratio !== null && ratio >= PERFORMING_RATIO;
  const note = ratio !== null && mine !== null && middle
    ? `${counted(mine)} ${basis} against a median of ${counted(middle)} over ${handle}'s last ${sample.length} posts: ${ratio}×, ${performing ? "performing" : "not performing"} (${PERFORMING_RATIO}× or more performs)`
    : mine === null ? `Not compared: the post's ${basis === "views" ? "views" : "likes"} aren't shown`
    : `Not compared: fewer than ${MIN_COMPARED} of ${handle}'s last posts show their ${basis}`;
  return { post: post.traction, usual, ratio, performing, basis: ratio === null ? null : basis, compared: ratio === null ? 0 : sample.length, note };
}

// ── Our library: what Engine made ───────────────────────────────────────────

export type LibraryDeck = {
  id: string;
  name: string;
  /** When it was last saved, YYYY-MM-DD. */
  date: string;
  /** The page profile it was made for, or "" when the deck doesn't say. */
  page: string;
  /** The cover's words, top to bottom. */
  cover: string;
  /** The caption's first 300 characters, on one line. */
  caption: string;
  /** The story its Recreate run researched (the brief's topic, or what an exact copy's original claims), while the post file lasts. */
  story: string;
  /** The deck in the editor. */
  url: string;
};

const POST_FILE_ID = /\bpost-[0-9a-f-]{36}\b/;
const MAX_POST_FILE_READS = 20, READS_AT_ONCE = 6;
const oneLine = (value: string, max: number) => value.replace(/\s+/g, " ").trim().slice(0, max);
export function editorLink(id: string): string {
  const frontend = process.env.ENGINE_FRONTEND_URL?.trim();
  return `${frontend ? `${frontend.replace(/\/$/, "")}/` : "/admin/engine"}?design=${encodeURIComponent(id)}`;
}

/** The story a post file's run researched: the brief's topic (either team's), else what an exact copy's original claims, else an earlier exact copy's name. */
function storyOf(file: PostFile | null): string {
  if (!file) return "";
  const output = (stage: StageName) => {
    const record = file.stages[stage];
    return record?.status === "done" && isItem(record.output) ? record.output : undefined;
  };
  return oneLine(text(output("brief")?.topic) || text(output("source")?.claims) || text(output("transcript")?.name), 300);
}

/** The cover's own words, top to bottom: its text layers, without hidden ones and the template's branding. */
function coverText(deck: DesignDocument): string {
  const words = (deck.pages[0]?.canvas?.elements ?? [])
    .flatMap(element => element.type === "text" && !element.hidden && element.templateRole !== "brand" && element.text.trim() ? [element] : [])
    .sort((a, b) => a.y - b.y).map(element => element.text);
  return oneLine(words.join(" · "), 200);
}

export type LibraryOptions = {
  /** The designs to list instead of the workspace's library. */
  designs?: DesignDocument[];
  max?: number;
  readPostFile?: (ownerKey: string, id: string) => Promise<PostFile | null>;
};

/** Decks Engine made in this workspace, newest first. `profileId` is the page whose tag marks its decks. */
export async function ourLibrary(ownerKey: string, profileId: string, options: LibraryOptions = {}): Promise<LibraryDeck[]> {
  const designs = options.designs ?? (await getEditorLibrary(ownerKey)).library.designs;
  const decks = designs.filter(deck => !deck.deletedAt && deck.purpose !== "template")
    .sort((a, b) => (Date.parse(b.updatedAt) || 0) - (Date.parse(a.updatedAt) || 0))
    .slice(0, options.max ?? 80);
  const read = options.readPostFile ?? getPostFile;
  const fileIds = decks.map(deck => (deck.comments ?? []).map(comment => POST_FILE_ID.exec(comment.text)?.[0]).find(id => id && isPostFileId(id)) ?? "");
  const files = new Map<string, PostFile | null>();
  const wanted = [...new Set(fileIds.filter(Boolean))].slice(0, MAX_POST_FILE_READS);
  for (let start = 0; start < wanted.length; start += READS_AT_ONCE) {
    await Promise.all(wanted.slice(start, start + READS_AT_ONCE).map(async id => { files.set(id, await read(ownerKey, id).catch(() => null)); }));
  }
  return decks.map((deck, index) => {
    const file = files.get(fileIds[index]) ?? null;
    return {
      id: deck.id, name: oneLine(deck.name, 160), date: (deck.updatedAt || deck.createdAt || "").slice(0, 10),
      page: deck.tags?.includes(profileId) ? profileId : file?.profileId ?? "",
      cover: coverText(deck), caption: oneLine(deck.caption ?? "", 300), story: storyOf(file), url: editorLink(deck.id),
    };
  });
}
