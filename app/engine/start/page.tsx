"use client";

import { Suspense, useState } from "react";
import { useSearchParams } from "next/navigation";
import {
  loadChannels,
  saveActiveChannelId,
  saveChannels,
} from "@/lib/engine/storage";
import {
  CHANNEL_COLORS,
  newChannelId,
  normalizeHandle,
} from "@/lib/engine/channels";
import { ENGINE_PLAN, formatPlanPrice } from "@/lib/engine/plan";

/**
 * Engine — public onboarding. Three steps on one page:
 *   1. Account — name + email (the email becomes the membership identity).
 *   2. First channel — the Instagram account they curate for.
 *   3. Subscribe — Stripe Checkout (mock mode grants access directly in dev).
 *
 * The channel is written to this browser's studio storage before checkout, so
 * the studio is already personalized when they land in it. Membership itself
 * is the gf_member cookie minted after payment — Stripe stays the source of
 * truth, no user table.
 */
export default function EngineStart() {
  return (
    <Suspense fallback={null}>
      <StartFlow />
    </Suspense>
  );
}

function StartFlow() {
  const searchParams = useSearchParams();
  const canceled = searchParams.has("canceled");
  const [step, setStep] = useState(0);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [channelName, setChannelName] = useState("");
  const [handle, setHandle] = useState("");
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);

  function next(e: React.FormEvent) {
    e.preventDefault();
    setNote(null);
    if (step === 0) {
      if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email.trim())) {
        setNote("Enter a valid email — it’s how your access works.");
        return;
      }
      setStep(1);
      return;
    }
    if (step === 1) {
      if (!channelName.trim() && !handle.trim()) {
        setNote("Name your channel or add its @handle.");
        return;
      }
      // Seed the studio with their first channel, set active.
      const existing = loadChannels();
      const clean = normalizeHandle(handle);
      if (!existing.some((c) => c.handle === clean && clean)) {
        const channel = {
          id: newChannelId(),
          name: channelName.trim() || `@${clean}`,
          handle: clean,
          color: CHANNEL_COLORS[existing.length % CHANNEL_COLORS.length],
          createdAt: new Date().toISOString(),
        };
        saveChannels([...existing, channel]);
        saveActiveChannelId(channel.id);
      }
      setStep(2);
      return;
    }
  }

  async function subscribe() {
    setBusy(true);
    setNote(null);
    try {
      const res = await fetch("/api/engine/subscribe", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: email.trim(), name: name.trim() }),
      });
      const j = (await res.json()) as { url?: string; error?: string };
      if (j.url) {
        window.location.href = j.url;
        return;
      }
      setNote(j.error ?? "Couldn’t start checkout.");
    } catch {
      setNote("Couldn’t reach checkout.");
    }
    setBusy(false);
  }

  const steps = ["Account", "Your channel", "Subscribe"];

  return (
    <main className="mx-auto flex min-h-[80vh] w-full max-w-md flex-col justify-center px-6 py-16">
      <p className="text-xs uppercase tracking-[0.18em] text-muted">
        {ENGINE_PLAN.name}
      </p>
      <h1 className="mt-2 text-2xl font-semibold tracking-tight">
        {step === 0 && "Create your account"}
        {step === 1 && "Add your first channel"}
        {step === 2 && "Start your subscription"}
      </h1>
      <p className="mt-2 text-sm leading-relaxed text-muted">
        {ENGINE_PLAN.description}
      </p>

      <ol className="mt-6 flex items-center gap-2 text-[11px] uppercase tracking-wider text-muted">
        {steps.map((s, i) => (
          <li
            key={s}
            className={`rounded-full border px-3 py-1 ${
              i === step
                ? "border-fg/40 text-fg"
                : i < step
                  ? "border-card-border text-fg/70"
                  : "border-card-border"
            }`}
          >
            {s}
          </li>
        ))}
      </ol>

      {canceled && step === 0 && (
        <p className="mt-4 rounded-xl border border-card-border bg-card px-4 py-3 text-sm text-muted">
          Checkout was canceled — pick up where you left off whenever you’re
          ready.
        </p>
      )}

      <div className="mt-6 rounded-2xl border border-card-border bg-card p-6">
        {step === 0 && (
          <form onSubmit={next} className="flex flex-col gap-4">
            <label className="flex flex-col gap-1.5 text-sm">
              <span className="text-muted">Your name</span>
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Ada Lovelace"
                className="rounded-xl border border-card-border bg-transparent px-3.5 py-2.5 outline-none focus:border-fg/40"
              />
            </label>
            <label className="flex flex-col gap-1.5 text-sm">
              <span className="text-muted">Email</span>
              <input
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@example.com"
                className="rounded-xl border border-card-border bg-transparent px-3.5 py-2.5 outline-none focus:border-fg/40"
              />
            </label>
            <button
              type="submit"
              className="mt-1 rounded-full bg-pill px-5 py-2.5 text-sm font-medium text-pill-fg"
            >
              Continue
            </button>
          </form>
        )}

        {step === 1 && (
          <form onSubmit={next} className="flex flex-col gap-4">
            <label className="flex flex-col gap-1.5 text-sm">
              <span className="text-muted">Channel name</span>
              <input
                value={channelName}
                onChange={(e) => setChannelName(e.target.value)}
                placeholder="Engine"
                className="rounded-xl border border-card-border bg-transparent px-3.5 py-2.5 outline-none focus:border-fg/40"
              />
            </label>
            <label className="flex flex-col gap-1.5 text-sm">
              <span className="text-muted">Instagram handle</span>
              <input
                value={handle}
                onChange={(e) => setHandle(e.target.value)}
                placeholder="@engine"
                className="rounded-xl border border-card-border bg-transparent px-3.5 py-2.5 outline-none focus:border-fg/40"
              />
            </label>
            <p className="text-xs leading-relaxed text-muted">
              You can add more channels later, and link the real Instagram
              login from the Channels tab.
            </p>
            <button
              type="submit"
              className="mt-1 rounded-full bg-pill px-5 py-2.5 text-sm font-medium text-pill-fg"
            >
              Continue
            </button>
          </form>
        )}

        {step === 2 && (
          <div className="flex flex-col gap-4">
            <div className="flex items-baseline justify-between">
              <span className="text-sm font-medium">{ENGINE_PLAN.name}</span>
              <span className="text-sm text-muted">
                {formatPlanPrice(ENGINE_PLAN.priceMonthly)}/mo · cancel any time
              </span>
            </div>
            <ul className="flex flex-col gap-2 text-sm text-muted">
              {ENGINE_PLAN.includes.map((line) => (
                <li key={line} className="flex gap-2">
                  <span aria-hidden>—</span>
                  {line}
                </li>
              ))}
            </ul>
            <button
              onClick={subscribe}
              disabled={busy}
              className="mt-1 rounded-full bg-pill px-5 py-2.5 text-sm font-medium text-pill-fg disabled:opacity-60"
            >
              {busy ? "Opening checkout…" : "Subscribe & enter the studio"}
            </button>
            <p className="text-xs text-muted">
              Payments by Stripe. Your access works on this device right after
              checkout; the same email recovers it anywhere.
            </p>
          </div>
        )}

        {note && <p className="mt-4 text-sm text-muted">{note}</p>}
      </div>

      {step > 0 && (
        <button
          onClick={() => setStep((s) => Math.max(0, s - 1))}
          className="mt-4 self-start text-sm text-muted underline decoration-link-underline underline-offset-4"
        >
          Back
        </button>
      )}
    </main>
  );
}
