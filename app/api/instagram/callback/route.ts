import { NextResponse } from "next/server";
import { resolveEngineAccess } from "@/lib/engine/member";
import { saveIgCredential } from "@/lib/engine/ig-store";

export const runtime = "nodejs";

/**
 * Instagram login — step 2 (code exchange).
 *
 * Verifies the CSRF nonce, exchanges the authorize code for a short-lived
 * token, upgrades it to a long-lived (~60-day) token, fetches the account's
 * username, and stores the credential SERVER-SIDE for (owner, channel) —
 * see lib/engine/ig-store.ts. The browser only ever learns the
 * public bits (handle + user id) via redirect params so the Channels screen
 * can mark the channel connected instantly; the token itself never leaves
 * the server.
 */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state") ?? "";
  const back = (extra: string) =>
    NextResponse.redirect(new URL(`/admin/engine${extra}`, url.origin));

  // Instagram reports an explicit denial with error params.
  if (url.searchParams.get("error")) return back("?ig_error=denied");

  const appId = process.env.INSTAGRAM_APP_ID;
  const appSecret = process.env.INSTAGRAM_APP_SECRET;
  if (!appId || !appSecret || !code) return back("");

  // CSRF: state = `<nonce>:<channelId>`, nonce must match the cookie set by
  // the connect route in this same browser.
  const [nonce, channel] = state.split(":");
  const cookieNonce = request.headers
    .get("cookie")
    ?.match(/(?:^|;\s*)gf_ig_oauth=([^;]+)/)?.[1];
  if (!nonce || !channel || !cookieNonce || cookieNonce !== nonce) {
    return back("?ig_error=state");
  }

  // Who is connecting? The credential is stored in their partition.
  const access = await resolveEngineAccess();
  if (!access) return back("?ig_error=auth");

  const origin = (process.env.NEXT_PUBLIC_SITE_URL ?? url.origin).replace(/\/$/, "");

  try {
    // 1) code → short-lived token
    const form = new URLSearchParams({
      client_id: appId,
      client_secret: appSecret,
      grant_type: "authorization_code",
      redirect_uri: `${origin}/api/instagram/callback`,
      code,
    });
    const shortRes = await fetch("https://api.instagram.com/oauth/access_token", {
      method: "POST",
      body: form,
      signal: AbortSignal.timeout(15_000),
    });
    if (!shortRes.ok) return back("?ig_error=exchange");
    const short = (await shortRes.json()) as {
      access_token?: string;
      user_id?: string | number;
    };
    if (!short.access_token) return back("?ig_error=exchange");

    // 2) short-lived → long-lived (~60 days)
    const longUrl = new URL("https://graph.instagram.com/access_token");
    longUrl.searchParams.set("grant_type", "ig_exchange_token");
    longUrl.searchParams.set("client_secret", appSecret);
    longUrl.searchParams.set("access_token", short.access_token);
    const longRes = await fetch(longUrl, { signal: AbortSignal.timeout(15_000) });
    const long = longRes.ok
      ? ((await longRes.json()) as { access_token?: string; expires_in?: number })
      : {};
    const token = long.access_token ?? short.access_token;
    const expiresIn = Number(long.expires_in) || 60 * 60 * 24; // fallback 1 day

    // 3) who is this account?
    const meUrl = new URL("https://graph.instagram.com/v23.0/me");
    meUrl.searchParams.set("fields", "user_id,username");
    meUrl.searchParams.set("access_token", token);
    const meRes = await fetch(meUrl, { signal: AbortSignal.timeout(15_000) });
    const me = meRes.ok
      ? ((await meRes.json()) as { user_id?: string | number; username?: string })
      : {};
    const igUserId = String(me.user_id ?? short.user_id ?? "");
    const username = String(me.username ?? "");

    // 4) persist server-side for this owner + channel
    await saveIgCredential(access.ownerKey, channel, {
      igUserId,
      username,
      token,
      expiresAt: new Date(Date.now() + expiresIn * 1000).toISOString(),
    });

    const params = new URLSearchParams({ ig_connected: channel });
    if (username) params.set("ig_handle", username);
    if (igUserId) params.set("ig_id", igUserId);
    const response = back(`?${params.toString()}`);
    response.cookies.delete("gf_ig_oauth");
    return response;
  } catch {
    return back("?ig_error=exchange");
  }
}
