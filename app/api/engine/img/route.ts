import { resolveEngineAccess } from "@/lib/engine/member";

export const runtime = "nodejs";

/**
 * Engine — same-origin image proxy.
 *
 * The gallery shows real photos hotlinked from third-party hosts (Wikimedia,
 * Flickr, X). Loading those cross-origin in the browser is unreliable on the
 * live HTTPS site — referrer/privacy/cache differences mean many silently fail
 * even when the URL is perfectly valid. Routing them through here makes every
 * image same-origin (`/api/engine/img?u=…`), which loads consistently
 * and lets the "download in order" fetch work too.
 *
 * Guards: http(s) only, no internal/private hosts (SSRF), reject cross-site
 * callers (so it isn't an open proxy), image content-type only, hard timeout.
 */

function isBlockedHost(host: string): boolean {
  const h = host.toLowerCase();
  return (
    h === "localhost" ||
    h === "::1" ||
    h.endsWith(".local") ||
    h.endsWith(".internal") ||
    /^127\./.test(h) ||
    /^0\./.test(h) ||
    /^10\./.test(h) ||
    /^169\.254\./.test(h) ||
    /^192\.168\./.test(h) ||
    /^172\.(1[6-9]|2\d|3[0-1])\./.test(h)
  );
}

export async function GET(request: Request) {
  if (!(await resolveEngineAccess())) {
    return new Response("unauthorized", { status: 401 });
  }
  // Don't let other sites hotlink our proxy. Same-origin <img> requests send
  // Sec-Fetch-Site: same-origin; only reject an explicit cross-site caller.
  if (request.headers.get("sec-fetch-site") === "cross-site") {
    return new Response("forbidden", { status: 403 });
  }

  const u = new URL(request.url).searchParams.get("u");
  if (!u) return new Response("missing u", { status: 400 });

  let target: URL;
  try {
    target = new URL(u);
  } catch {
    return new Response("bad url", { status: 400 });
  }
  if (!/^https?:$/.test(target.protocol) || isBlockedHost(target.hostname)) {
    return new Response("blocked", { status: 403 });
  }

  try {
    const upstream = await fetch(target.toString(), {
      headers: {
        "User-Agent": "EngineBot/1.0 (+https://github.com/chatgptricks/engine)",
        Accept: "image/avif,image/webp,image/apng,image/*,*/*;q=0.8",
      },
      redirect: "follow",
      // no Referer leaks out
      referrer: "",
      signal: AbortSignal.timeout(12_000),
    });
    if (!upstream.ok || !upstream.body) {
      return new Response("upstream error", { status: 502 });
    }
    const contentType = upstream.headers.get("content-type") ?? "";
    if (!contentType.startsWith("image/")) {
      return new Response("not an image", { status: 415 });
    }
    return new Response(upstream.body, {
      status: 200,
      headers: {
        "Content-Type": contentType,
        // Cache hard at the edge + browser; these images never change.
        "Cache-Control": "public, max-age=86400, s-maxage=604800, immutable",
      },
    });
  } catch {
    return new Response("fetch failed", { status: 502 });
  }
}
