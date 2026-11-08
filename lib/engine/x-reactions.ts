/**
 * Real reactions from X for Recreate's reaction slides. Server-only.
 *
 * `fetchXReactions` runs the Apify actor `apidojo~tweet-scraper` (Top sort,
 * a like floor, one language, a start date) and returns only real posts from
 * the scraper: no retweets, no promoted posts, no duplicates. A post's text is
 * kept exactly as written. The only changes: surrounding whitespace is trimmed,
 * the trailing t.co links X itself hides (attached media, a quoted post) are
 * removed, and a long post the scraper cut short ends with "…", as X's
 * "Show more" does. `trimReaction` may shorten it at a word boundary with "…".
 * Every reaction keeps its link (`https://x.com/<handle>/status/<id>`).
 *
 * Cost: the actor bills $0.40 per 1,000 posts, so the 60-post cap is about $0.02.
 * Needs APIFY_TOKEN on a paid Apify plan: on the free plan the actor runs only in
 * demo mode (a few runs a month, not through the API) and sends `{noResults: true}`
 * placeholders instead of posts, which fetchXReactions reports as X_PAID_PLAN.
 * The token is never put in an error, a log or a result.
 */

export type XReaction = {
  id: string;
  url: string;
  author: { name: string; handle: string; avatarUrl: string | null; verified: boolean };
  text: string;
  /** ISO 8601, or null when the scraper's date can't be read. */
  createdAt: string | null;
  likes: number;
  reposts: number;
  replies: number;
  views: number;
};

export type FetchXReactionsOptions = {
  /** Search terms, one X search per term; the first 5 distinct terms are used. */
  terms: string[];
  /** Earliest post date, as a Date or "YYYY-MM-DD". Defaults to 30 days ago. */
  since?: Date | string;
  /** Posts to request, at most 60. Defaults to 30. */
  max?: number;
  /** X language code. Defaults to "en". */
  language?: string;
  /** Minimum likes per post. Defaults to 100. */
  minLikes?: number;
  signal?: AbortSignal;
  fetch?: typeof fetch;
};

export class XReactionsError extends Error {
  readonly status: number;
  constructor(message: string, status: number) {
    super(message);
    this.name = "XReactionsError";
    this.status = status;
  }
}

export const X_REACTIONS_MAX = 60;
const ACTOR = "apidojo~tweet-scraper";
const TIMEOUT_MS = 120_000;
const DAY_MS = 86_400_000;
const HANDLE = /^[A-Za-z0-9_]{1,15}$/;

type Item = Record<string, unknown>;
const record = (value: unknown): Item | undefined => value && typeof value === "object" && !Array.isArray(value) ? value as Item : undefined;
const text = (value: unknown): string => typeof value === "string" ? value : "";
const count = (value: unknown): number => {
  const number = typeof value === "string" ? Number(value.replace(/,/g, "")) : typeof value === "number" ? value : NaN;
  return Number.isFinite(number) && number > 0 ? Math.floor(number) : 0;
};

/** X's API escapes these three characters in post text; this restores what the author typed. */
const unescape = (value: string) => value.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");

/** Only pbs.twimg.com profile images, upgraded from the 48 px "_normal" size to 400 × 400. */
function avatar(value: unknown): string | null {
  try {
    const url = new URL(text(value));
    if (url.protocol !== "https:" || url.hostname !== "pbs.twimg.com" || url.username || url.password || url.port) return null;
    url.pathname = url.pathname.replace(/_(normal|bigger|mini)(\.\w+)$/, "_400x400$2");
    return url.toString();
  } catch {
    return null;
  }
}

function isoDate(value: unknown): string | null {
  const raw = text(value) || (typeof value === "number" ? value : "");
  if (raw === "") return null;
  const date = new Date(raw);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

/** t.co links X hides from a post's text: attached media, and permalinks to a
 * post on X (a quoted post, or "Show more" on a long post). */
function hiddenLinks(item: Item): Set<string> {
  const links = new Set<string>();
  for (const entities of [record(item.entities), record(item.extendedEntities), record(item.extended_entities)]) {
    for (const media of Array.isArray(entities?.media) ? entities.media : []) { const url = text(record(media)?.url); if (url) links.add(url); }
    for (const link of Array.isArray(entities?.urls) ? entities.urls : []) {
      const entry = record(link), url = text(entry?.url);
      if (url && /^https?:\/\/(?:www\.|mobile\.)?(?:x|twitter)\.com\/(?:[A-Za-z0-9_]{1,15}|i\/web|i)\/status\/\d+/.test(text(entry?.expanded_url))) links.add(url);
    }
  }
  return links;
}

/** The post as X shows it: surrounding whitespace trimmed and trailing hidden
 * links removed; every word, emoji and line break is kept. When the scraper
 * cut a long post (X's "Show more"), the cut is marked with "…". */
function visibleText(item: Item, raw: string): string {
  const hidden = hiddenLinks(item);
  let body = raw.trim(), removed = false;
  for (let match = body.match(/\s*(https:\/\/t\.co\/\w+)$/); match && hidden.has(match[1]); match = body.match(/\s*(https:\/\/t\.co\/\w+)$/)) {
    body = body.slice(0, match.index).trimEnd(); removed = true;
  }
  // Long posts arrive as their first ~275 characters plus a link; regular posts stop at 280.
  const cut = removed && Array.from(body).length >= 260 && !/[.!?…)"”’'\]]$|\p{Extended_Pictographic}$/u.test(body);
  return cut ? `${body}…` : body;
}

function isRetweet(item: Item, body: string): boolean {
  return item.isRetweet === true || Boolean(record(item.retweet) || record(item.retweeted_tweet) || record(item.retweetedTweet)) || /^RT @\w/.test(body);
}

function isPromoted(item: Item): boolean {
  const type = text(item.type).toLowerCase();
  return item.isPromoted === true || item.promoted === true || Boolean(record(item.promotedMetadata)) || type === "promoted" || type === "ad";
}

/** One scraper item as a reaction, or null when it isn't a real, original post
 * with an id, a handle and text. Text is kept verbatim, trimmed of whitespace. */
export function normalizeTweet(value: unknown): XReaction | null {
  const item = record(value);
  if (!item) return null;
  const id = text(item.id) || text(item.id_str) || (typeof item.id === "number" && Number.isSafeInteger(item.id) ? String(item.id) : "");
  if (!/^\d{1,25}$/.test(id)) return null;
  const author = record(item.author) ?? record(item.user) ?? {};
  const handle = (text(author.userName) || text(author.screen_name) || text(author.username)).replace(/^@/, "").trim();
  if (!HANDLE.test(handle)) return null;
  const raw = unescape(text(item.fullText) || text(item.full_text) || text(item.text));
  if (!raw.trim() || isRetweet(item, raw.trim()) || isPromoted(item)) return null;
  const body = visibleText(item, raw);
  if (!body) return null;
  const name = (text(author.name) || handle).trim();
  return {
    id,
    url: `https://x.com/${handle}/status/${id}`,
    author: {
      name,
      handle,
      avatarUrl: avatar(author.profilePicture ?? author.profile_image_url_https ?? author.profileImageUrl),
      verified: author.isBlueVerified === true || author.isVerified === true || author.verified === true || Boolean(text(author.verifiedType)),
    },
    text: body,
    createdAt: isoDate(item.createdAt ?? item.created_at),
    likes: count(item.likeCount ?? item.favorite_count),
    reposts: count(item.retweetCount ?? item.retweet_count),
    replies: count(item.replyCount ?? item.reply_count),
    views: count(item.viewCount ?? item.views),
  };
}

const engagement = (reaction: XReaction) => reaction.likes + reaction.reposts + reaction.replies;
const sameText = (value: string) => value.toLowerCase().replace(/\s+/g, " ");

/** Normalizes scraper items, drops anything normalizeTweet rejects or with
 * fewer than `minLikes` likes, sorts by engagement (likes + reposts + replies,
 * then views) and drops repeats: the same id, or the same text from another
 * account (copy-paste reposts), keeping the most engaged copy. */
export function normalizeTweets(items: unknown, minLikes = 0): XReaction[] {
  if (!Array.isArray(items)) return [];
  const sorted = items.map(normalizeTweet).filter((reaction): reaction is XReaction => reaction !== null && reaction.likes >= minLikes)
    .sort((a, b) => engagement(b) - engagement(a) || b.views - a.views);
  const ids = new Set<string>(), bodies = new Set<string>();
  return sorted.filter(reaction => {
    const body = sameText(reaction.text);
    if (ids.has(reaction.id) || bodies.has(body)) return false;
    ids.add(reaction.id); bodies.add(body); return true;
  });
}

/** A card's room for post text: wrapped lines, and lowercase characters per
 * line (capitals count 1.3, emoji 2). Blank lines between paragraphs count as lines. */
export type ReactionFit = { lines: number; perLine: number };

const glyphWidth = (character: string) => /\p{Extended_Pictographic}/u.test(character) ? 2 : /\p{Lu}/u.test(character) ? 1.3 : 1;

/** Lines `value` takes when greedily word-wrapped at `perLine` lowercase characters. */
export function reactionLines(value: string, perLine: number): number {
  const width = Math.max(1, perLine);
  return value.split("\n").reduce((total, paragraph) => {
    let lines = 1, used = 0;
    for (const word of paragraph.split(/\s+/).filter(Boolean)) {
      const length = Array.from(word).reduce((sum, character) => sum + glyphWidth(character), 0);
      if (used && used + 1 + length <= width) { used += 1 + length; continue; }
      if (used) lines += 1;
      lines += Math.ceil(length / width) - 1; used = length - (Math.ceil(length / width) - 1) * width;
    }
    return total + lines;
  }, 0);
}

/** Shortens a post to at most `max` characters (and, with `fit`, to the card's
 * lines), cutting at a word boundary and adding "…". Text that already fits
 * comes back unchanged. Counts characters, not UTF-16 units, so an emoji is
 * never split. Only the end is removed; the words that stay are untouched. */
export function trimReaction(value: string, max: number, fit?: ReactionFit): string {
  const text = value.trim(), characters = Array.from(text);
  const limit = Math.max(1, Math.floor(max));
  const fits = (candidate: string) => Array.from(candidate).length <= limit && (!fit || reactionLines(candidate, fit.perLine) <= fit.lines);
  if (fits(text)) return text;
  const close = (head: string) => `${head.replace(/[\s,;:–—-]+$/u, "")}…`;
  // Every word boundary that leaves room for "…", longest first.
  const head = characters.slice(0, limit).join("");
  const boundaries = [...head.matchAll(/\s+/g)].map(match => match.index!).filter(index => index > 0).reverse();
  for (const boundary of boundaries) {
    const candidate = close(head.slice(0, boundary));
    if (candidate !== "…" && fits(candidate)) return candidate;
  }
  // One very long word or link: cut inside it.
  for (let length = limit - 1; length > 0; length--) {
    const candidate = close(characters.slice(0, length).join(""));
    if (fits(candidate)) return candidate;
  }
  return "…";
}

const compact = (value: number, language: string) => new Intl.NumberFormat(language, { notation: "compact", maximumFractionDigits: 1 }).format(value);

/** The card's meta line, for example "48K likes · 3.1K reposts · Nov 3, 2026".
 * Zero counts and an unknown date are left out. English and Spanish wording. */
export function formatReactionMeta(reaction: Pick<XReaction, "likes" | "reposts" | "createdAt">, language = "en"): string {
  const spanish = language.toLowerCase().startsWith("es"), locale = spanish ? "es" : "en";
  const parts: string[] = [];
  if (reaction.likes) parts.push(`${compact(reaction.likes, locale)} ${spanish ? "me gusta" : reaction.likes === 1 ? "like" : "likes"}`);
  if (reaction.reposts) parts.push(`${compact(reaction.reposts, locale)} ${reaction.reposts === 1 ? "repost" : "reposts"}`);
  if (reaction.createdAt) parts.push(new Intl.DateTimeFormat(locale, { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" }).format(new Date(reaction.createdAt)));
  return parts.join(" · ");
}

/** Room for post text on the chatgptricks template's cards, so a post fits at
 * the card's full type size: "reaction" is the one-card page (template page 4,
 * 48 px text, 12 lines), "reactions" either card of the two-card page (page 5,
 * 43 px body text, 5 lines). */
export const REACTION_CARDS = {
  // Measured on real posts in SF Pro Display: about 36 lowercase characters per line at 48 px, 40 at 43 px.
  reaction: { maxText: 280, lines: 12, perLine: 35 },
  reactions: { maxText: 160, lines: 5, perLine: 38 },
} as const satisfies Record<string, ReactionFit & { maxText: number }>;

/** Slot values for one post card on the chatgptricks template. `second` fills
 * the lower card of the Reactions page (slots ending in "-2"). The text is
 * trimmed to the card with trimReaction. The avatar slot is left out when the
 * post has no pbs.twimg.com avatar, so the placeholder stays. */
export function reactionSlots(reaction: XReaction, { page = "reaction", second = false, language = "en" }: { page?: keyof typeof REACTION_CARDS; second?: boolean; language?: string } = {}): Record<string, string> {
  const suffix = second ? "-2" : "", card = REACTION_CARDS[second ? "reactions" : page];
  return {
    [`reaction-name${suffix}`]: reaction.author.name,
    [`reaction-handle${suffix}`]: `@${reaction.author.handle}`,
    [`reaction-text${suffix}`]: trimReaction(reaction.text, card.maxText, card),
    [`reaction-meta${suffix}`]: formatReactionMeta(reaction, language),
    ...(reaction.author.avatarUrl ? { [`reaction-avatar${suffix}`]: reaction.author.avatarUrl } : {}),
  };
}

/** Why X search came back empty when the Apify plan doesn't allow it. */
export const X_PAID_PLAN = "X search needs a paid Apify plan. On the free plan the tweet scraper only runs in demo mode and returns no posts to Engine.";

/** The scraper's stand-in for a post. It sends these when nothing matched, and
 * on the free plan, where the run then asks for a paid plan instead. */
const isPlaceholder = (value: unknown) => record(value)?.noResults === true;

async function paidPlanAsked(token: string, fetcher: typeof fetch, signal?: AbortSignal): Promise<boolean> {
  const timeout = AbortSignal.timeout(15_000);
  try {
    const response = await fetcher(`https://api.apify.com/v2/acts/${ACTOR}/runs/last?status=SUCCEEDED`, {
      headers: { Authorization: `Bearer ${token}` },
      signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
    });
    if (!response.ok) return false;
    return /paid plan/i.test(text(record(record(await response.json())?.data)?.statusMessage));
  } catch (error) {
    if (signal?.aborted) throw signal.reason ?? error;
    return false;
  }
}

/** True when the scraper's last finished run asked for a paid Apify plan, so
 * this token can't search X. False when that can't be read. */
export async function xSearchNeedsPaidPlan({ signal, fetch: fetcher = fetch }: { signal?: AbortSignal; fetch?: typeof fetch } = {}): Promise<boolean> {
  const token = process.env.APIFY_TOKEN?.trim();
  return token ? paidPlanAsked(token, fetcher, signal) : false;
}

function startDate(since: Date | string | undefined): string {
  const date = since === undefined ? new Date(Date.now() - 30 * DAY_MS) : new Date(since);
  if (Number.isNaN(date.getTime())) throw new XReactionsError("The start date for X reactions isn't a valid date.", 400);
  return date.toISOString().slice(0, 10);
}

/** Searches X for the most-liked real posts about `terms` and returns them
 * normalized, deduplicated and sorted by engagement. Throws XReactionsError. */
export async function fetchXReactions({ terms, since, max = 30, language = "en", minLikes = 100, signal, fetch: fetcher = fetch }: FetchXReactionsOptions): Promise<XReaction[]> {
  const token = process.env.APIFY_TOKEN?.trim();
  if (!token) throw new XReactionsError("X reactions need an Apify token. Set APIFY_TOKEN on the server.", 503);
  const searchTerms = [...new Set((terms ?? []).map(term => String(term).trim()).filter(Boolean))].slice(0, 5);
  if (!searchTerms.length) throw new XReactionsError("Give at least one search term for X reactions.", 400);
  const limit = Math.max(1, Math.min(X_REACTIONS_MAX, Math.floor(Number(max) || 30)));
  const lang = /^[a-z]{2,3}$/i.test(language) ? language.toLowerCase() : "en";
  const floor = Math.max(0, Math.floor(Number(minLikes) || 0));
  const input = { searchTerms, maxItems: limit, sort: "Top", tweetLanguage: lang, minimumFavorites: floor, start: startDate(since) };
  const scrub = (message: string) => message.split(token).join("[redacted]").replace(/\s+/g, " ").trim().slice(0, 200);
  const timeout = AbortSignal.timeout(TIMEOUT_MS);
  let response: Response;
  try {
    response = await fetcher(`https://api.apify.com/v2/acts/${ACTOR}/run-sync-get-dataset-items?timeout=120&maxItems=${limit}&clean=true`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify(input),
      signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
    });
  } catch (error) {
    if (signal?.aborted) throw signal.reason ?? error;
    if (timeout.aborted) throw new XReactionsError("X search took longer than 2 minutes. Try fewer or narrower terms.", 504);
    throw new XReactionsError("Couldn't reach Apify to search X. Try again in a minute.", 502);
  }
  if (!response.ok) {
    let detail = "";
    try { detail = scrub(text(record(record(await response.json())?.error)?.message)); } catch { /* not JSON */ }
    const reason = response.status === 401 || response.status === 403 ? "Apify rejected the token. Check APIFY_TOKEN."
      : response.status === 402 ? "The Apify account is out of credit."
      : response.status === 408 ? "X search took longer than 2 minutes. Try fewer or narrower terms."
      : response.status === 429 ? "Apify is rate-limiting X searches. Try again in a minute."
      : `Apify's X search failed (HTTP ${response.status}).`;
    throw new XReactionsError(detail ? `${reason} Apify said: ${detail}` : reason, response.status === 408 ? 504 : response.status === 429 ? 429 : 502);
  }
  let items: unknown;
  try {
    items = await response.json();
  } catch {
    if (signal?.aborted) throw signal.reason;
    throw new XReactionsError("Apify's X search returned something that isn't a list of posts.", 502);
  }
  if (!Array.isArray(items)) throw new XReactionsError("Apify's X search returned something that isn't a list of posts.", 502);
  // Only placeholders: nothing matched, or the plan doesn't allow X search at all.
  if (items.length && items.every(isPlaceholder) && await paidPlanAsked(token, fetcher, signal)) throw new XReactionsError(X_PAID_PLAN, 402);
  // The actor's like floor is loose, so it is applied again here.
  return normalizeTweets(items, floor).slice(0, limit);
}
