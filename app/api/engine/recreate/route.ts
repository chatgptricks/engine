import { after } from "next/server";
import { agentResponse as reply, allowedAgentOrigin, readAgentBody, resolveAgentRequest } from "@/lib/template-editor/agent-http";
import { isRecreateConfigured, RecreateError, runRecreate, type RecreateInput } from "@/lib/engine/recreate";
import { createJob, getJob, publicJob, updateJob } from "@/lib/engine/recreate-jobs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// Research with live web search plus writing can take several minutes.
export const maxDuration = 800;

const RUN_DEADLINE_MS = 12 * 60 * 1000;
const text = (value: unknown, max: number) => typeof value === "string" ? value.trim().slice(0, max) : undefined;

function parseInput(body: Record<string, unknown>): RecreateInput {
  const profileId = text(body.profileId, 120);
  if (!profileId) throw new RecreateError("Choose the page to recreate this post for.");
  const url = text(body.url, 2000);
  let uploads: RecreateInput["uploads"];
  if (body.uploads !== undefined) {
    if (!Array.isArray(body.uploads) || body.uploads.length > 20) throw new RecreateError("Upload between 1 and 20 slides.");
    uploads = body.uploads.map((item, index) => {
      if (!item || typeof item !== "object") throw new RecreateError(`Upload ${index + 1} is not valid.`);
      const { name, dataUrl } = item as Record<string, unknown>;
      if (typeof dataUrl !== "string" || !dataUrl.startsWith("data:image/")) throw new RecreateError(`Upload ${index + 1} must be an image.`);
      return { name: text(name, 200) || `slide-${index + 1}`, dataUrl };
    });
  }
  if (!url && !uploads?.length) throw new RecreateError("Paste an Instagram post link or upload the post's slides.");
  return { profileId, url, uploads, caption: text(body.caption, 10_000), notes: text(body.notes, 2000) };
}

/** Start a run: `{url?, uploads?, caption?, profileId, notes?}` → 202 `{jobId}`. People and agent tokens both work. */
export async function POST(request: Request) {
  const access = await resolveAgentRequest(request);
  if (!access) return reply({ error: "Use an active Engine agent token or sign in." }, 401);
  if (!allowedAgentOrigin(request)) return reply({ error: "This origin is not allowed to access Engine." }, 403);
  if (!isRecreateConfigured()) return reply({ error: "Recreate is not configured: add ANTHROPIC_API_KEY to the server environment." }, 503);
  let input: RecreateInput;
  try {
    input = parseInput(await readAgentBody(request, 40 * 1024 * 1024));
  } catch (error) {
    if (error instanceof RecreateError) return reply({ error: error.message }, error.status);
    return reply({ error: error instanceof RangeError ? "Uploads are too large. Send fewer or smaller images." : "Send a JSON request." }, error instanceof RangeError ? 413 : 400);
  }
  const job = createJob(access.ownerKey);
  if (!job) return reply({ error: "Four recreations are already running for this workspace. Wait for one to finish." }, 429);
  after(async () => {
    const controller = new AbortController(), timer = setTimeout(() => controller.abort(), RUN_DEADLINE_MS);
    try {
      const result = await runRecreate(access.ownerKey, input, (status, message) => updateJob(job.jobId, { status, message }), controller.signal);
      updateJob(job.jobId, { status: "done", message: `Created ${result.slideCount} editable slides`, result });
    } catch (error) {
      const message = controller.signal.aborted ? "This run took too long and was stopped. Try again."
        : error instanceof RecreateError ? error.message
        : error instanceof Error && /APIFY|Apify|Instagram|instagram/.test(error.message) ? error.message
        : "Recreate failed. Try again, or upload the slides as screenshots.";
      if (!(error instanceof RecreateError)) console.error("[recreate] run failed", error instanceof Error ? error.message : error);
      updateJob(job.jobId, { status: "error", message, error: message });
    } finally {
      clearTimeout(timer);
    }
  });
  return reply({ jobId: job.jobId }, 202);
}

/** Progress: `?jobId=…` → `{jobId, status, message, startedAt, updatedAt, result?, error?}`. */
export async function GET(request: Request) {
  const access = await resolveAgentRequest(request);
  if (!access) return reply({ error: "Use an active Engine agent token or sign in." }, 401);
  const jobId = new URL(request.url).searchParams.get("jobId") ?? "";
  if (!/^[0-9a-f-]{36}$/i.test(jobId)) return reply({ error: "A valid jobId is required." }, 400);
  const job = getJob(access.ownerKey, jobId);
  if (!job) return reply({ error: "That run wasn't found. It may have expired or the server restarted; check your library for the post." }, 404);
  return reply(publicJob(job));
}
