/**
 * Addresses Engine fetches on someone's behalf (the image proxy, photos from
 * a source's page) must be public: http(s), no credentials, and never a
 * loopback, private, link-local or internal host (SSRF).
 */
export function isBlockedHost(host: string): boolean {
  const h = host.toLowerCase().replace(/^\[|\]$/g, "");
  return (
    h === "localhost" ||
    h.endsWith(".localhost") ||
    h === "::" ||
    h === "::1" ||
    h.startsWith("::ffff:") ||
    /^f[cd][0-9a-f]{0,2}:/.test(h) ||
    /^fe[89ab][0-9a-f]?:/.test(h) ||
    h.endsWith(".local") ||
    h.endsWith(".internal") ||
    /^127\./.test(h) ||
    /^0\./.test(h) ||
    /^10\./.test(h) ||
    /^169\.254\./.test(h) ||
    /^192\.168\./.test(h) ||
    /^172\.(1[6-9]|2\d|3[0-1])\./.test(h) ||
    /^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\./.test(h)
  );
}

/** The URL when it is a public http(s) address without credentials, else null. */
export function publicHttpUrl(value: string): URL | null {
  try {
    const url = new URL(value);
    if (!/^https?:$/.test(url.protocol) || url.username || url.password || isBlockedHost(url.hostname)) return null;
    return url;
  } catch {
    return null;
  }
}
