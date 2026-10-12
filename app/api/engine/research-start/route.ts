import { after } from "next/server";
import { resolveEngineAccess } from "@/lib/engine/member";
import { isOpenAIConfigured } from "@/lib/openai";
import {
  payloadToStory,
  runResearchEngine,
} from "@/lib/engine/research-engine";
import { finishStory, upsertResearchingStub } from "@/lib/engine/db";
import { emptyCuration } from "@/lib/engine/types";
import type { Story } from "@/lib/engine/types";

export const runtime = "nodejs";
// News-heavy runs (Pulse) can exceed 300s on Vercel; Pro + Fluid allows 800.
// The engine's own deadline (8 min) still bounds the run well inside this.
export const maxDuration = 800;

/**
 * Engine — server-persisted research start (the Home type buttons +
 * Retry on a failed card).
 *
 * Reliability contract: the run does NOT live in the browser. We write a
 * "researching" stub to the server store immediately, then run the engine in
 * this same invocation — if the curator reloads or navigates away, the
 * function keeps running and the result (queue, or failed-with-reason) lands
 * in the store, where the tool's polling picks it up. A run can therefore
 * never strand a spinner: it ends in queue or failed, and a stub whose
 * function died (deploy/crash) is surfaced as failed by listAutoStories.
 */
export async function POST(request: Request) {
  const access = await resolveEngineAccess();
  if (!access) {
    return Response.json({ error: "Unauthorized." }, { status: 401 });
  }
  const owner = access.ownerKey;
  if (!isOpenAIConfigured()) {
    return Response.json(
      { error: "Research is not configured (OPENAI_API_KEY missing)." },
      { status: 503 },
    );
  }

  const body = (await request.json().catch(() => ({}))) as {
    id?: string;
    prompt?: string;
    systemPrompt?: string;
    requestedType?: string;
    title?: string;
    channelId?: string;
  };
  const prompt = typeof body.prompt === "string" ? body.prompt.trim() : "";
  if (!prompt) return Response.json({ error: "No prompt." }, { status: 400 });
  const id =
    typeof body.id === "string" && /^story_[a-z0-9_]{1,80}$/i.test(body.id)
      ? body.id
      : `story_auto_${Date.now().toString(36)}_${Math.round(
          Math.random() * 1e6,
        ).toString(36)}`;
  const requestedType =
    typeof body.requestedType === "string" ? body.requestedType : undefined;
  const startedAt = new Date().toISOString();

  const stub: Story = {
    id,
    status: "researching",
    title:
      typeof body.title === "string" && body.title.trim()
        ? body.title.trim().slice(0, 120)
        : "Researching a new story…",
    description: "",
    postType: requestedType,
    channelId:
      typeof body.channelId === "string" && body.channelId
        ? body.channelId.slice(0, 80)
        : undefined,
    researchCompletedAt: startedAt,
    leadImageId: "",
    techOvert: false,
    dossier: {
      verificationStatus: "partial",
      verifiedFacts: [],
      primarySources: [],
      contestedPoints: [],
    },
    caption: { draft: "", titleOverImage: { use: false, text: "" } },
    images: [],
    curation: emptyCuration(),
    // Kept on the row (success or failure) so Retry re-runs the same brief.
    brief: { prompt, attachments: [], createdAt: startedAt, requestedType },
  };
  // If the store can't take the stub, stop BEFORE the (paid) research run —
  // the result would have nowhere to land and the card would silently vanish.
  const stored = await upsertResearchingStub(stub, owner);
  if (!stored) {
    return Response.json(
      {
        error:
          "The story store rejected the write — apply Supabase migration 0015 (gf_stories.owner), then retry.",
        id,
      },
      { status: 503 },
    );
  }

  // Run the engine AFTER the response is sent (next/server `after`): the
  // browser gets its ack in milliseconds and the run is fully decoupled from
  // the request — a reload/disconnect can't wedge it (a held-open response
  // could, under `next start`). On Vercel, `after` keeps the function alive
  // (waitUntil semantics) within maxDuration. The outcome lands in the store
  // either way; the client polls for it.
  const systemPrompt =
    typeof body.systemPrompt === "string" ? body.systemPrompt : undefined;
  after(async () => {
    try {
      const payload = await runResearchEngine({
        prompt,
        systemPrompt,
        requestedType,
        // Leave generous room inside maxDuration for the failure write.
        deadlineMs: (maxDuration - 120) * 1000,
      });
      const story = payloadToStory(id, payload, stub);
      await finishStory(id, story, owner);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Research failed.";
      await finishStory(id, { ...stub, status: "failed", error: message }, owner);
    }
  });
  return Response.json({ ok: true, id, started: true }, { status: 202 });
}
