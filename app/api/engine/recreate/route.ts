import { after } from "next/server";
import { agentResponse as reply, allowedAgentOrigin, readAgentBody, resolveAgentRequest } from "@/lib/template-editor/agent-http";
import { approveRecreate, isRunning, resumeRecreate, rerunRecreateStage, startRecreate, stopRun, submitRecreateStage, type Started } from "@/lib/engine/agents/orchestrator";
import { playbook } from "@/lib/engine/agents/playbook";
import { isRecreateConfigured, RecreateError } from "@/lib/engine/recreate";
import { postIdFor, postView } from "@/lib/engine/recreate-jobs";
import { getPostFile, isPostFileId, POST_STAGES, PostFileError, type PostMode, type PostStage } from "@/lib/engine/post-files";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// The run continues after the response; this only bounds the request itself on platforms that enforce it.
export const maxDuration = 800;

const text = (value: unknown, max: number) => typeof value === "string" ? value.trim().slice(0, max) : undefined;

function parseStart(body: Record<string, unknown>) {
  const profileId = text(body.profileId, 120);
  if (!profileId) throw new RecreateError("Choose the page to recreate this post for.");
  const url = text(body.url, 2000);
  let uploads: { name: string; dataUrl: string }[] | undefined;
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
  if (body.mode !== undefined && body.mode !== "checkpoint" && body.mode !== "autopilot") throw new RecreateError("mode is checkpoint (pause for your approval) or autopilot.");
  // Autopilot by default, so clients written before the checkpoint get a finished deck as before.
  const mode: PostMode = body.mode === "checkpoint" ? "checkpoint" : "autopilot";
  return { profileId, url, uploads, caption: text(body.caption, 10_000), notes: text(body.notes, 2000), mode };
}

function postIdOf(body: Record<string, unknown> | URLSearchParams): string {
  const get = (key: string) => body instanceof URLSearchParams ? body.get(key) ?? undefined : body[key];
  const postId = get("postId"), jobId = get("jobId");
  const id = typeof postId === "string" && postId ? postId : typeof jobId === "string" && /^[0-9a-f-]{36}$/i.test(jobId) ? postIdFor(jobId) : "";
  if (!isPostFileId(id)) throw new RecreateError("A valid postId (or jobId) is required.");
  return id;
}
function stageOf(value: unknown): PostStage {
  if (typeof value !== "string" || !(POST_STAGES as readonly string[]).includes(value)) throw new RecreateError(`stage must be one of: ${POST_STAGES.join(", ")}.`);
  return value as PostStage;
}

async function act(ownerKey: string, by: "human" | "agent", body: Record<string, unknown>): Promise<Started | { file: null; postId: string }> {
  const action = body.action;
  if (action === "start" || action === undefined) return startRecreate(ownerKey, parseStart(body));
  const postId = postIdOf(body);
  switch (action) {
    case "approve": {
      const hook = (body.hook && typeof body.hook === "object" ? body.hook : {}) as Record<string, unknown>;
      return approveRecreate(ownerKey, postId, {
        outline: body.outline,
        option: typeof hook.option === "number" ? hook.option : typeof body.option === "number" ? body.option : undefined,
        text: text(hook.text ?? body.hookText, 400),
        notes: text(body.notes, 2000),
      }, by);
    }
    case "rerun_stage": return rerunRecreateStage(ownerKey, postId, stageOf(body.stage), text(body.instructions, 2000), by);
    case "submit_stage": return submitRecreateStage(ownerKey, postId, stageOf(body.stage), body.output, by);
    case "resume": return resumeRecreate(ownerKey, postId);
    case "stop": {
      const file = await getPostFile(ownerKey, postId);
      if (!file) throw new RecreateError("That post's working file doesn't exist or has expired.", 404);
      stopRun(postId);
      return { file: null, postId };
    }
    default: throw new RecreateError("action is start, approve, rerun_stage, submit_stage, resume or stop.");
  }
}

/**
 * Start a run: `{url?, uploads?, caption?, profileId, notes?, mode?}` → 202 `{jobId, postId, status}`.
 * Act on one: `{action: "approve" | "rerun_stage" | "submit_stage" | "resume" | "stop", postId, …}`.
 * People and agent tokens both work; only a person's hook pick is sent to the headline model.
 */
export async function POST(request: Request) {
  const access = await resolveAgentRequest(request);
  if (!access) return reply({ error: "Use an active Engine agent token or sign in." }, 401);
  if (!allowedAgentOrigin(request)) return reply({ error: "This origin is not allowed to access Engine." }, 403);
  if (!isRecreateConfigured()) return reply({ error: "Recreate is not configured: add ANTHROPIC_API_KEY to the server environment." }, 503);
  let body: Record<string, unknown>;
  try {
    body = await readAgentBody(request, 40 * 1024 * 1024);
  } catch (error) {
    return reply({ error: error instanceof RangeError ? "Uploads are too large. Send fewer or smaller images." : "Send a JSON request." }, error instanceof RangeError ? 413 : 400);
  }
  try {
    const started = await act(access.ownerKey, access.kind === "agent" ? "agent" : "human", body);
    if (!started.file) return reply({ postId: started.postId, stopped: true });
    const { file, done } = started;
    // The run goes on after the response; `next start` waits for it on a graceful shutdown.
    after(() => done);
    return reply(postView(file, isRunning(file.id)), 202);
  } catch (error) {
    if (error instanceof RecreateError || error instanceof PostFileError) return reply({ error: error.message }, error.status);
    console.error("[recreate] request failed", error instanceof Error ? error.message : error);
    return reply({ error: "Recreate couldn't do that. Try again." }, 500);
  }
}

/** Progress: `?postId=…` (or `?jobId=…`) → the run's view; `?playbook=1` → the team's role cards. */
export async function GET(request: Request) {
  const access = await resolveAgentRequest(request);
  if (!access) return reply({ error: "Use an active Engine agent token or sign in." }, 401);
  const params = new URL(request.url).searchParams;
  if (params.get("playbook")) return reply(playbook());
  try {
    const postId = postIdOf(params);
    const file = await getPostFile(access.ownerKey, postId);
    if (!file) return reply({ error: "That run wasn't found. Its working file may have expired; check your library for the post." }, 404);
    return reply(postView(file, isRunning(postId)));
  } catch (error) {
    if (error instanceof RecreateError || error instanceof PostFileError) return reply({ error: error.message }, error.status);
    throw error;
  }
}
