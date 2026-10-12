import { NextResponse } from "next/server";
import { getAuthServerClient } from "@/lib/supabase/auth-server";
import { isOwnerEmail } from "@/lib/owners";

/**
 * Magic-link callback for /admin.
 *
 * Two-flow router:
 *
 *   1) **PKCE flow** (preferred). Email link redirects here with
 *      `?code=...`. We exchange the code for a session using the
 *      code_verifier cookie that the send-magic-link route wrote.
 *      Works server-side; no JS required.
 *
 *   2) **Implicit / signup-confirmation flow** (fallback). Some older
 *      Supabase email templates and first-time signup confirmations
 *      redirect here with `#access_token=...&refresh_token=...` in
 *      the URL fragment — which the server can't read. We render a
 *      tiny client page that pulls the tokens out of the hash, calls
 *      `supabase.auth.setSession`, then bounces to /admin.
 *
 * Any error path (wrong email, expired link, missing code AND missing
 * hash) ends back at /admin/login with a query-string error code so
 * the login page can show a useful message.
 */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const errorParam = url.searchParams.get("error_description");

  if (errorParam) {
    return NextResponse.redirect(
      new URL(
        `/admin/login?error=${encodeURIComponent(errorParam)}`,
        request.url,
      ),
    );
  }

  // No ?code= AND no error: this is probably an implicit/signup flow
  // where the tokens are in the URL fragment. Render the client-side
  // hash handler page.
  if (!code) {
    return new NextResponse(IMPLICIT_HANDLER_HTML, {
      status: 200,
      headers: { "content-type": "text/html; charset=utf-8" },
    });
  }

  const supabase = await getAuthServerClient();
  const { data, error } = await supabase.auth.exchangeCodeForSession(code);

  if (error || !data.session) {
    return NextResponse.redirect(
      new URL("/admin/login?error=link-expired", request.url),
    );
  }

  if (!isOwnerEmail(data.session.user.email)) {
    // Sign out immediately so the unauthorized session doesn't linger.
    await supabase.auth.signOut();
    return NextResponse.redirect(
      new URL("/admin/login?error=not-authorized", request.url),
    );
  }

  return NextResponse.redirect(new URL("/admin/engine", request.url));
}

/**
 * Inline HTML for the implicit-flow fallback. Kept inline (no React,
 * no client component) so it ships in one round-trip and works even
 * if the client bundle is broken or slow. It:
 *
 *   1. Reads the URL hash to pull access_token + refresh_token.
 *   2. Calls /api/admin/exchange-tokens with them so the session
 *      cookies get set server-side (we don't trust the client to set
 *      cookies on its own — the route handler validates the tokens
 *      via supabase.auth.setSession and then writes the cookies).
 *   3. Redirects to /admin.
 *
 * If anything fails, redirect to /admin/login?error=link-expired.
 */
const IMPLICIT_HANDLER_HTML = `<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Signing you in…</title>
    <style>
      body { font-family: -apple-system, system-ui, sans-serif; background: #faf9f7; color: #1a1a1a; display: flex; align-items: center; justify-content: center; min-height: 100vh; margin: 0; }
      .center { text-align: center; }
      .spinner { display: inline-block; width: 24px; height: 24px; border: 2px solid rgba(0,0,0,0.1); border-top-color: rgba(0,0,0,0.6); border-radius: 50%; animation: spin 0.8s linear infinite; margin-bottom: 12px; }
      @keyframes spin { to { transform: rotate(360deg); } }
      p { font-size: 14px; color: rgba(0,0,0,0.6); }
    </style>
  </head>
  <body>
    <div class="center">
      <div class="spinner" aria-hidden></div>
      <p>Finishing sign-in…</p>
    </div>
    <script>
      (async () => {
        const fail = (code) => {
          window.location.replace("/admin/login?error=" + encodeURIComponent(code));
        };
        try {
          const hash = window.location.hash.replace(/^#/, "");
          if (!hash) return fail("link-expired");
          const params = new URLSearchParams(hash);
          const access_token = params.get("access_token");
          const refresh_token = params.get("refresh_token");
          if (!access_token || !refresh_token) return fail("link-expired");
          const res = await fetch("/api/admin/exchange-tokens", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ access_token, refresh_token }),
          });
          if (!res.ok) {
            const body = await res.json().catch(() => ({}));
            return fail(body.error || "link-expired");
          }
          window.location.replace("/admin/engine");
        } catch (e) {
          fail("link-expired");
        }
      })();
    </script>
  </body>
</html>`;
