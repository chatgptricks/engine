import { randomBytes } from "node:crypto";
import { NextResponse } from "next/server";
import { resolveEngineAccess } from "@/lib/engine/member";

export const runtime = "nodejs";

/**
 * Instagram login — step 1 (authorize redirect).
 *
 * The user experience is ManyChat-style: click Connect → log in to Instagram
 * itself → approve → done. No codes or keys for the user. The app owner sets
 * up the Meta app ONCE (see /admin/instagram-setup) and provides:
 *   INSTAGRAM_APP_ID, INSTAGRAM_APP_SECRET
 *
 * Uses the "Instagram API with Instagram Login" product (professional —
 * business/creator — IG accounts; no Facebook Page needed). The OAuth state
 * is a random nonce bound to a short-lived httpOnly cookie (CSRF) plus the
 * channel id being connected.
 *
 * Called with ?channel=<id>&probe=1 from the Channels screen first: probe
 * returns JSON ({url} or {error}) so an unconfigured app explains itself
 * inline instead of dead-ending a redirect.
 */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const channel = url.searchParams.get("channel") ?? "";
  const probe = url.searchParams.get("probe") === "1";

  const access = await resolveEngineAccess();
  if (!access) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  const appId = process.env.INSTAGRAM_APP_ID;
  if (!appId || !process.env.INSTAGRAM_APP_SECRET) {
    // Tailor the message: the owner gets the setup pointer; a member just
    // hears it isn't available yet (they never deal with API keys).
    const error =
      access.kind === "owner"
        ? "Instagram login isn’t configured yet — finish the one-time Meta app setup at /admin/instagram-setup."
        : "Instagram connection isn’t available yet — it’s being set up.";
    return probe
      ? NextResponse.json({ error }, { status: 503 })
      : NextResponse.redirect(new URL("/admin/engine", url.origin));
  }
  if (!channel || !/^[a-z0-9_-]{1,80}$/i.test(channel)) {
    return NextResponse.json({ error: "Missing channel id." }, { status: 400 });
  }

  const origin = (process.env.NEXT_PUBLIC_SITE_URL ?? url.origin).replace(/\/$/, "");
  const nonce = randomBytes(16).toString("hex");
  const authorize = new URL("https://www.instagram.com/oauth/authorize");
  authorize.searchParams.set("client_id", appId);
  authorize.searchParams.set("redirect_uri", `${origin}/api/instagram/callback`);
  authorize.searchParams.set("response_type", "code");
  authorize.searchParams.set(
    "scope",
    "instagram_business_basic,instagram_business_content_publish",
  );
  authorize.searchParams.set("state", `${nonce}:${channel}`);

  const response = probe
    ? NextResponse.json({ url: authorize.toString() })
    : NextResponse.redirect(authorize);
  // CSRF: the callback only accepts a state whose nonce matches this cookie.
  response.cookies.set("gf_ig_oauth", nonce, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/api/instagram",
    maxAge: 10 * 60,
  });
  return response;
}
