import { getCurrentAdminUser } from "@/lib/supabase/auth-server";
import { isOpenAIConfigured } from "@/lib/openai";
import {
  DEFAULT_SYSTEM_PROMPT,
  assembleSystemPrompt,
} from "@/lib/engine/profile";
import {
  payloadToStory,
  runResearchEngine,
} from "@/lib/engine/research-engine";
import {
  finishStory,
  getSchedule,
  markScheduleRan,
  recentStoryTitles,
  upsertResearchingStub,
} from "@/lib/engine/db";
import { emptyCuration } from "@/lib/engine/types";
import type { Story } from "@/lib/engine/types";
import { postType } from "@/lib/engine/post-types";

export const runtime = "nodejs";
// Research runs can exceed 300s; Pro + Fluid allows 800.
export const maxDuration = 800;

/**
 * Engine — the scheduled finder.
 *
 * Vercel hits this on a fixed cadence (hourly, see vercel.json). Each tick
 * reads the curator's schedule from Supabase and only generates a story when
 * it's ENABLED and the configured interval has elapsed — that's how the
 * adjustable interval + the stop toggle work on top of a fixed cron.
 *
 * Auth: Vercel cron sends `Authorization: Bearer $CRON_SECRET` (set that env
 * var to lock the route). A logged-in owner may also trigger it (and pass
 * ?force=1 to run immediately, ignoring enabled/interval — used by the
 * Profile "Run now" button). The research engine is called directly — no
 * internal HTTP hop, so CRON_SECRET is only an auth credential here.
 */
export async function GET(request: Request) {
  const cronSecret = process.env.CRON_SECRET;
  const isVercelCron =
    Boolean(cronSecret) &&
    request.headers.get("authorization") === `Bearer ${cronSecret}`;

  let authed = isVercelCron;
  if (!authed) {
    if (process.env.NEXT_PUBLIC_SUPABASE_URL) {
      authed = Boolean(await getCurrentAdminUser());
    } else if (process.env.NODE_ENV !== "production") {
      authed = true; // local/worktree dev (no auth configured)
    }
  }
  if (!authed) return Response.json({ error: "Unauthorized" }, { status: 401 });

  if (!isOpenAIConfigured()) {
    return Response.json(
      { error: "Research is not configured (OPENAI_API_KEY missing)." },
      { status: 503 },
    );
  }

  const url = new URL(request.url);
  const force = url.searchParams.get("force") === "1";
  // Optional: research a specific post TYPE.
  const reqType = postType(url.searchParams.get("type"));
  const schedule = await getSchedule();

  if (!schedule.enabled && !force) {
    return Response.json({ skipped: "disabled" });
  }
  if (!force && schedule.lastRunAt) {
    const elapsedMs = Date.now() - new Date(schedule.lastRunAt).getTime();
    const dueMs = schedule.intervalMinutes * 60_000;
    if (elapsedMs < dueMs) {
      return Response.json({
        skipped: "not_due",
        nextInMinutes: Math.ceil((dueMs - elapsedMs) / 60_000),
      });
    }
  }

  // Claim the slot and drop a live placeholder so the tool shows a
  // "Researching" card immediately (via the store's polling).
  await markScheduleRan();

  const id = `story_auto_${Date.now().toString(36)}_${Math.round(
    Math.random() * 1e6,
  ).toString(36)}`;
  const startedAt = new Date().toISOString();

  // Build the canonical finder prompt + tell it to pick a fresh subject.
  const systemPrompt = assembleSystemPrompt(DEFAULT_SYSTEM_PROMPT);
  const avoid = await recentStoryTitles(40);
  const prompt =
    (reqType
      ? `Surface ONE new story in the ${reqType.label} vein right now (postType "${reqType.id}"): ${reqType.blurb}`
      : "Surface ONE new story right now") +
    " Follow your territory, research protocol, filter, and alignment layer. Pick a single subject and research it end to end, then submit it." +
    (avoid.length
      ? `\n\nDo not repeat any of these recently surfaced subjects:\n- ${avoid.join("\n- ")}`
      : "");

  const stub: Story = {
    id,
    status: "researching",
    title: reqType
      ? `Researching a new ${reqType.label} story…`
      : "Researching a new story…",
    description: "",
    postType: reqType?.id,
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
    brief: {
      prompt,
      attachments: [],
      createdAt: startedAt,
      requestedType: reqType?.id,
    },
  };
  await upsertResearchingStub(stub);

  try {
    const payload = await runResearchEngine({
      prompt,
      systemPrompt,
      requestedType: reqType?.id,
      deadlineMs: (maxDuration - 120) * 1000,
    });
    const story = payloadToStory(id, payload, stub);
    await finishStory(id, story);
    return Response.json({ ok: true, title: story.title });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Research failed.";
    // Keep the row as a retryable failed card instead of silently vanishing.
    await finishStory(id, { ...stub, status: "failed", error: message });
    return Response.json({ error: message }, { status: 502 });
  }
}
