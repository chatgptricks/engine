import { resolveEngineAccess } from "@/lib/engine/member";
import { isOpenAIConfigured } from "@/lib/openai";
import { runResearchEngine } from "@/lib/engine/research-engine";

export const runtime = "nodejs";
// Live research with web search can take a while; allow a long ceiling
// (Pro + Fluid allows 800; the engine's 8-min deadline bounds the run).
export const maxDuration = 800;

/**
 * Engine — synchronous research route (the Create flow).
 *
 * Thin wrapper over the shared research engine: the caller holds the request
 * open and receives the finished payload to apply client-side. The Home type
 * buttons use /research-start instead (server-persisted, survives reloads).
 */
export async function POST(request: Request) {
  // Owner or paying member only. The tool UI is gated, but this endpoint runs
  // paid OpenAI + web-search calls, so lock it too. (The legacy x-gf-cron
  // header bypass remains for any older deploy still HTTP-hopping.)
  const cronSecret = process.env.CRON_SECRET;
  const isInternalCron =
    Boolean(cronSecret) && request.headers.get("x-gf-cron") === cronSecret;
  if (!isInternalCron) {
    const access = await resolveEngineAccess();
    if (!access) {
      return Response.json({ error: "Unauthorized." }, { status: 401 });
    }
  }

  if (!isOpenAIConfigured()) {
    return Response.json(
      { error: "Research is not configured (OPENAI_API_KEY missing)." },
      { status: 503 },
    );
  }

  const body = (await request.json().catch(() => ({}))) as {
    prompt?: string;
    attachments?: string[];
    systemPrompt?: string;
    requestedType?: string;
  };
  const prompt = typeof body.prompt === "string" ? body.prompt.trim() : "";
  if (!prompt) {
    return Response.json({ error: "No prompt." }, { status: 400 });
  }

  try {
    const story = await runResearchEngine({
      prompt,
      attachments: Array.isArray(body.attachments) ? body.attachments : [],
      systemPrompt:
        typeof body.systemPrompt === "string" ? body.systemPrompt : undefined,
      requestedType:
        typeof body.requestedType === "string" ? body.requestedType : undefined,
    });
    return Response.json({ story });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return Response.json({ error: message }, { status: 502 });
  }
}
