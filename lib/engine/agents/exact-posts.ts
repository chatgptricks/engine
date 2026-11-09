/**
 * Posts from X an exact copy shows, rebuilt as our post cards. For each post
 * the copier transcribed, Engine looks for the real one: by a link to it (on
 * the slide or in the caption) through X's embed, which is free, else by one
 * X search for its author and first words (Apify, a few cents; at most
 * MAX_POST_SEARCHES a deck). A result counts only from the same handle (a
 * capital I and a small l counting as one letter, as X's font draws them
 * alike) and with nearly all the screenshot's words. A post that isn't found is built
 * from the screenshot: its words as copied, its profile photo and its own
 * photo cut from the original slide. A found post with several photos keeps
 * them all, cut together from the screenshot, as a card draws only one.
 */
import { xPostId } from "../x-links";
import { fetchXPost, fetchXReactions, XReactionsError, type XReaction } from "../x-reactions";
import type { CopiedPost, MediaBox } from "./schemas";

/** X searches one deck may make; posts past them are built from their screenshots. */
export const MAX_POST_SEARCHES = 6;
/** The share of the screenshot's words a found post must have, and the share of its own words they must make up (a screenshot may cut a long post short). */
export const MATCH_WORDS = .9, MATCH_OWN_WORDS = .3;
const LOOKBACK_DAYS = 3 * 365;
const message = (error: unknown) => error instanceof Error ? error.message : String(error);

/** A post's words for comparing: lower case, without links, mentions' @, punctuation or emoji. */
export function postWords(text: string): string[] {
  return text.toLowerCase().normalize("NFKC").replace(/https?:\/\/\S+/g, " ").replace(/[@#]/g, " ")
    .split(/[^\p{L}\p{N}'’%$]+/u).map(word => word.replace(/^['’]+|['’]+$/g, "")).filter(Boolean);
}
/** A handle as X's font shows it: a capital I and a small l look the same there, so a screenshot can't tell them apart. */
export const shownHandle = (handle: string) => handle.toLowerCase().replace(/i/g, "l");
/** Every spelling of a handle a screenshot could show the same way (each l or I either letter, handles ignoring case), at most 8. */
export function handleSpellings(handle: string): string[] {
  const shown = shownHandle(handle), at = [...shown].flatMap((letter, index) => letter === "l" ? [index] : []);
  if (!at.length) return [handle];
  // Up to three look-alike letters: every mix; past that, one letter changed at a time.
  const flips = at.length <= 3 ? Array.from({ length: 2 ** at.length }, (_, mask) => at.filter((_, bit) => mask & 1 << bit))
    : [[], ...at.map(index => [index])];
  const spellings = flips.map(flip => [...shown].map((letter, index) => flip.includes(index) ? "i" : letter).join(""));
  return [handle, ...spellings.filter(spelling => spelling !== handle.toLowerCase())].slice(0, 8);
}
/**
 * How surely `found` is the post the screenshot shows: 0 when it isn't (another handle, or too few
 * of the same words), else the share of its own words the screenshot shows, 1 for the same words.
 */
export function postMatch(found: Pick<XReaction, "author" | "text">, copied: Pick<CopiedPost, "handle" | "text">): number {
  if (shownHandle(found.author.handle) !== shownHandle(copied.handle)) return 0;
  const shown = postWords(copied.text), own = postWords(found.text);
  if (!shown.length || !own.length) return !shown.length && !own.length ? 1 : 0;
  const pool = new Map<string, number>();
  for (const word of own) pool.set(word, (pool.get(word) ?? 0) + 1);
  let common = 0;
  for (const word of shown) { const left = pool.get(word) ?? 0; if (left) { common++; pool.set(word, left - 1); } }
  return common / shown.length >= MATCH_WORDS && common / own.length >= MATCH_OWN_WORDS ? common / own.length : 0;
}
/** True when `found` is the post the screenshot shows: the same handle and nearly the same words. */
export const samePost = (found: Pick<XReaction, "author" | "text">, copied: Pick<CopiedPost, "handle" | "text">) => postMatch(found, copied) > 0;
/** One X search for the post: its author (under each spelling the screenshot could show) and up to five of its first words long enough to be telling. */
export function postSearch(post: Pick<CopiedPost, "handle" | "text">): string {
  const words = post.text.replace(/https?:\/\/\S+/g, " ").split(/\s+/).map(word => word.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, "")).filter(word => /^[\p{L}\p{N}'’-]+$/u.test(word) && [...word].length >= 4);
  const spellings = handleSpellings(post.handle), from = spellings.map(handle => `from:${handle}`);
  return [spellings.length > 1 ? `(${from.join(" OR ")})` : from[0], ...words.slice(0, 5)].join(" ");
}

export type CardLookup = {
  /** Cuts a box out of the slide the post is on, as an image URL with its size. */
  cut: (box: MediaBox) => Promise<{ url: string; width: number; height: number }>;
  /** The original post's caption, whose links to posts on X are tried too. */
  caption?: string;
  signal: AbortSignal;
  /** Searches this deck may still make; each one spends one. */
  budget: { searches: number };
  /** Posts already looked up in this deck or its last build: by `postKey`, and by `id:` and the post's id for a link read. */
  known: Map<string, XReaction | null>;
  /** Links being read for this deck, by post id, so posts looked up at once read each link once. */
  reading?: Map<string, Promise<XReaction | null>>;
  fetch?: typeof fetch;
  now?: number;
};
export type Card = { post: XReaction; found: boolean; note: string };
export const postKey = (post: Pick<CopiedPost, "handle" | "text">) => `${post.handle.toLowerCase()}\n${postWords(post.text).join(" ")}`;

/** The post a link points to, read through X's embed once a deck; null when X won't show it. */
function readLink(id: string, lookup: CardLookup, reading: Map<string, Promise<XReaction | null>>): Promise<XReaction | null> {
  const key = `id:${id}`;
  if (lookup.known.has(key)) return Promise.resolve(lookup.known.get(key) ?? null);
  let read = reading.get(id);
  if (!read) {
    read = fetchXPost(id, { signal: lookup.signal, fetch: lookup.fetch }).then(real => { lookup.known.set(key, real); return real; }, error => {
      if (lookup.signal.aborted) throw error;
      // A post X won't show stays that way; a network failure is tried again next build.
      if (error instanceof XReactionsError && [400, 404, 422].includes(error.status)) lookup.known.set(key, null);
      return null;
    });
    reading.set(id, read);
  }
  return read;
}

/** The real post, or null with the reason it wasn't found. */
async function findPost(post: CopiedPost, lookup: CardLookup, reading: Map<string, Promise<XReaction | null>>): Promise<{ found: XReaction | null; why: string }> {
  const key = postKey(post);
  // Only a search that found nothing is remembered as missing; one that failed or never ran is tried again.
  if (lookup.known.has(key)) return { found: lookup.known.get(key) ?? null, why: "an earlier X search didn't find it" };
  const links = [post.link ?? "", ...(lookup.caption ?? "").match(/\b(?:https?:\/\/)?(?:www\.|mobile\.)?(?:x|twitter)\.com\/\S+/gi) ?? []];
  const ids = [...new Set(links.map(link => xPostId(link)).filter((id): id is string => Boolean(id)))].slice(0, 4);
  for (const id of ids) {
    const real = await readLink(id, lookup, reading);
    if (real && samePost(real, post)) { lookup.known.set(key, real); return { found: real, why: "" }; }
  }
  if (lookup.budget.searches <= 0) return { found: null, why: `this deck's ${MAX_POST_SEARCHES} searches of X were used` };
  lookup.budget.searches--;
  const now = lookup.now ?? Date.now(), shown = post.date ? Date.parse(`${post.date}T00:00:00Z`) : NaN;
  const since = new Date(Number.isFinite(shown) ? Math.max(now - LOOKBACK_DAYS * 864e5, shown - 7 * 864e5) : now - LOOKBACK_DAYS * 864e5).toISOString().slice(0, 10);
  try {
    // Latest, not Top: X's top results leave out most replies, and a screenshot often shows one.
    const results = await fetchXReactions({ terms: [postSearch(post)], since, max: 10, language: post.language, minLikes: 0, sort: "Latest", signal: lookup.signal, fetch: lookup.fetch });
    // The closest match: a post that only adds words to the screenshot's loses to one with the same words.
    const real = results.map(result => ({ result, score: postMatch(result, post) })).filter(item => item.score > 0).sort((a, b) => b.score - a.score)[0]?.result ?? null;
    lookup.known.set(key, real);
    return { found: real, why: real ? "" : "X search didn't find it" };
  } catch (error) {
    if (lookup.signal.aborted) throw error;
    // Without an Apify token the search never ran, so it costs nothing.
    if (error instanceof XReactionsError && error.status === 503) { lookup.budget.searches++; return { found: null, why: "X search isn't set up on this server" }; }
    return { found: null, why: `X search failed: ${message(error).replace(/\.$/, "")}` };
  }
}

/** Our card for each post on slide `slide` (1-based), in order: the real post when it's found, else one built from the screenshot. */
export async function cardsFor(posts: CopiedPost[], slide: number, lookup: CardLookup): Promise<Card[]> {
  const reading = lookup.reading ?? new Map<string, Promise<XReaction | null>>();
  return Promise.all(posts.map(async (post, index): Promise<Card> => {
    const { found, why } = await findPost(post, lookup, reading);
    if (found) {
      const note = `Slide ${slide}: the post by @${found.author.handle} is the real one from X (${found.url}).`, several = found.mediaCount ?? 0;
      if (several < 2) return { post: found, found: true, note };
      // A card draws one photo; the screenshot shows all of them as X lays them out, so they are cut together from it.
      const photos = post.photo ? await lookup.cut(post.photo).catch(() => null) : null;
      if (!photos) return { post: found, found: true, note: `${note} It shows ${several} photos; its card has only the first, so add the others by hand.` };
      return { post: { ...found, media: { url: photos.url, width: photos.width, height: photos.height } }, found: true, note: `${note} Its ${several} photos are cut together from the original, as X shows them.` };
    }
    const [avatar, photo] = await Promise.all([post.avatar, post.photo].map(box => box ? lookup.cut(box).catch(() => null) : Promise.resolve(null)));
    const built: XReaction = {
      id: `copied-${slide}-${index + 1}`, url: "",
      author: { name: post.name, handle: post.handle, avatarUrl: avatar?.url ?? null, verified: post.badge !== "none", badge: post.badge === "none" ? null : post.badge, square: post.square },
      text: post.text,
      media: photo ? { url: photo.url, width: photo.width, height: photo.height } : null,
      createdAt: post.date ? `${post.date}T12:00:00.000Z` : null, likes: 0, reposts: 0, replies: 0, views: 0,
    };
    const lost = [post.avatar && !avatar ? "its profile photo" : "", post.photo && !photo ? "its photo" : ""].filter(Boolean);
    return {
      post: built, found: false,
      note: `Slide ${slide}: the post by @${post.handle} wasn't found on X (${why}), so its card is built from the screenshot${avatar || photo ? `, with ${[avatar ? "its profile photo" : "", photo ? "its photo" : ""].filter(Boolean).join(" and ")} cut from the original` : ""}.${lost.length ? ` Add ${lost.join(" and ")} by hand.` : ""}`,
    };
  }));
}
