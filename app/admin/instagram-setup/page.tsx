import Link from "next/link";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Connect Instagram login · Engine",
  robots: { index: false, follow: false },
};

/**
 * One-time Meta app setup so Engine channels can be connected with a
 * plain Instagram login (ManyChat-style). After this, every user — you or a
 * subscriber — connects a channel by clicking "Connect Instagram", signing in
 * to Instagram itself, and approving. No keys on their side, ever.
 */
export default function InstagramSetupPage() {
  const appId = Boolean(process.env.INSTAGRAM_APP_ID);
  const appSecret = Boolean(process.env.INSTAGRAM_APP_SECRET);
  const site = (process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000").replace(
    /\/$/,
    "",
  );
  const redirectUri = `${site}/api/instagram/callback`;
  const ready = appId && appSecret;

  return (
    <div className="relative mx-auto flex min-h-svh max-w-[680px] flex-col px-6 pt-12 pb-12 sm:pt-16">
      <Link
        href="/admin/engine"
        className="text-sm text-muted underline decoration-link-underline decoration-[1.5px] underline-offset-[3px] hover:decoration-fg"
      >
        ← Back to the studio
      </Link>

      <main className="mt-14 flex-1">
        <p className="text-xs font-medium uppercase tracking-wide text-muted">
          Admin
        </p>
        <h1 className="mt-3 text-3xl font-semibold tracking-tight text-fg">
          Connect Instagram login
        </h1>
        <p className="mt-3 text-[15px] text-muted">
          Once-only setup. After this, anyone using Engine connects a
          channel by simply <em>logging in to Instagram</em> and granting
          access — the way ManyChat does it. Their tokens are stored
          server-side and refreshed automatically.
        </p>

        {ready ? (
          <div className="mt-8 rounded-xl border border-card-border bg-card p-4 text-sm text-fg">
            ✓ Configured. The Connect Instagram button on the Channels tab now
            opens the real Instagram login. While the Meta app is in{" "}
            <strong className="font-medium">Development mode</strong>, only
            Instagram accounts added as testers can connect — submit for App
            Review (step 6) to open it to everyone.
          </div>
        ) : (
          <div className="mt-8 rounded-xl border border-card-border bg-card p-4 text-sm text-muted">
            Not configured yet — the Connect button currently explains that
            setup is pending. Follow the steps below; it takes about ten
            minutes.
          </div>
        )}

        <section className="mt-10 space-y-5">
          <h2 className="text-sm font-medium uppercase tracking-wide text-muted">
            Steps
          </h2>
          <ol className="list-decimal space-y-4 pl-5 text-[15px] leading-relaxed text-fg">
            <li>
              Go to{" "}
              <a
                href="https://developers.facebook.com/apps/"
                target="_blank"
                rel="noreferrer"
                className="underline decoration-link-underline underline-offset-[3px] hover:decoration-fg"
              >
                developers.facebook.com/apps
              </a>{" "}
              → <strong className="font-medium">Create App</strong>. Pick{" "}
              <em>Other</em> → <em>Business</em> as the type.
            </li>
            <li>
              In the app dashboard, find{" "}
              <strong className="font-medium">
                Instagram API with Instagram Login
              </strong>{" "}
              under Products and click <em>Set up</em>. (This flavor works for
              professional Instagram accounts directly — no Facebook Page
              linkage needed.)
            </li>
            <li>
              Under{" "}
              <strong className="font-medium">
                API setup with Instagram login
              </strong>{" "}
              → Business login settings, add this OAuth redirect URI:
              <pre className="mt-2 overflow-x-auto whitespace-pre-wrap break-all rounded-lg border border-card-border bg-bg p-3 font-mono text-[12px] text-fg">
                {redirectUri}
              </pre>
              For local testing also add{" "}
              <code className="font-mono text-[13px]">
                http://localhost:3000/api/instagram/callback
              </code>
              .
            </li>
            <li>
              From the same screen copy the{" "}
              <strong className="font-medium">Instagram App ID</strong> and{" "}
              <strong className="font-medium">Instagram App Secret</strong>{" "}
              into <code className="font-mono text-[13px]">.env.local</code>{" "}
              (and Vercel → Project → Settings → Environment Variables):
              <pre className="mt-2 overflow-x-auto whitespace-pre-wrap rounded-lg border border-card-border bg-bg p-3 font-mono text-[12px] text-fg">
                {`INSTAGRAM_APP_ID=...\nINSTAGRAM_APP_SECRET=...`}
              </pre>
              Restart the dev server / redeploy.
            </li>
            <li>
              Test it: open the studio → Channels → Connect Instagram. While
              the app is in Development mode, first add your Instagram account
              as a tester (App roles → Add people → Instagram tester, then
              accept the invite in Instagram → Settings → Apps and websites →
              Tester invites). The account must be a{" "}
              <em>professional</em> (Business or Creator) account.
            </li>
            <li>
              To let <em>any</em> customer connect (the sellable state):
              submit the app for{" "}
              <strong className="font-medium">App Review</strong> with the{" "}
              <code className="font-mono text-[13px]">
                instagram_business_basic
              </code>{" "}
              and{" "}
              <code className="font-mono text-[13px]">
                instagram_business_content_publish
              </code>{" "}
              permissions, then switch the app to{" "}
              <strong className="font-medium">Live mode</strong>. Until then,
              only tester accounts can complete the login.
            </li>
          </ol>
        </section>

        <section className="mt-10 space-y-4">
          <h2 className="text-sm font-medium uppercase tracking-wide text-muted">
            Status
          </h2>
          <ul className="space-y-2 text-sm">
            <li className="flex items-center gap-2">
              <Status ok={appId} />
              <code className="font-mono text-[13px]">INSTAGRAM_APP_ID</code>
            </li>
            <li className="flex items-center gap-2">
              <Status ok={appSecret} />
              <code className="font-mono text-[13px]">INSTAGRAM_APP_SECRET</code>
            </li>
          </ul>
          <p className="text-xs text-muted">
            Connections are stored per channel in{" "}
            <code className="font-mono">gf_ig_credentials</code> (migration
            0016; the dev file store covers local testing). Long-lived tokens
            (~60 days) refresh automatically whenever the Channels screen is
            visited in their final three weeks.
          </p>
        </section>
      </main>

    </div>
  );
}

function Status({ ok }: { ok: boolean }) {
  return (
    <span
      aria-hidden
      className={`inline-block size-2 rounded-full ${ok ? "bg-green-500" : "bg-red-400"}`}
    />
  );
}
