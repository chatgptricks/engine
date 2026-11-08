/**
 * Links to posts on X, for the posts a person adds to a Recreate run by hand.
 * Pure and safe to import from client code: no network, no Node APIs.
 */

/** Posts a person can add by link to one Recreate run. */
export const MAX_ADDED_POSTS = 8;

/** A post's id from a link to it on X or Twitter (with a handle, /i/web/ or /i/, any query),
 * or from the bare id. Null for anything else, including links to other sites. */
export function xPostId(value: string): string | null {
  const input = String(value ?? "").trim();
  if (/^\d{1,25}$/.test(input)) return input;
  try {
    const url = new URL(/^https?:\/\//i.test(input) ? input : `https://${input}`);
    if (!/^(?:www\.|mobile\.)?(?:x|twitter)\.com$/i.test(url.hostname) || url.username || url.password || url.port) return null;
    return /^\/(?:[A-Za-z0-9_]{1,15}|i\/web|i)\/status(?:es)?\/(\d{1,25})(?:\/|$)/.exec(url.pathname)?.[1] ?? null;
  } catch {
    return null;
  }
}

/** The link Engine keeps for an added post. X redirects it to the author's own address. */
export const xPostLink = (id: string) => `https://x.com/i/status/${id}`;

/** Links pasted one per line (or separated by spaces or commas): the posts' links in order
 * without repeats, and whatever isn't a link to a post on X. */
export function parseXPostLinks(value: string | string[]): { links: string[]; invalid: string[] } {
  const parts = (Array.isArray(value) ? value : [value]).flatMap(item => String(item ?? "").split(/[\s,]+/)).map(item => item.trim()).filter(Boolean);
  const links: string[] = [], invalid: string[] = [];
  for (const part of parts) {
    const id = xPostId(part);
    if (!id) invalid.push(part);
    else if (!links.includes(xPostLink(id))) links.push(xPostLink(id));
  }
  return { links, invalid };
}
