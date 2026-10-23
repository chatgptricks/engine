/** Only the configured frontend may make authenticated cross-origin calls. */
export function frontendOrigin(): string | null {
  try {
    const url = new URL(process.env.ENGINE_FRONTEND_URL ?? "");
    if (url.username || url.password || !["https:", "http:"].includes(url.protocol)) return null;
    if (url.protocol !== "https:" && !["localhost", "127.0.0.1"].includes(url.hostname)) return null;
    return url.origin;
  } catch { return null; }
}
export function isFrontendOrigin(value: string | null): boolean {
  return value !== null && value === frontendOrigin();
}
