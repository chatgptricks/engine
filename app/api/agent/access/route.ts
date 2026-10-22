import {resolveEngineAccess} from "@/lib/engine/member";
import {createAgentCredential, listAgentCredentials, revokeAgentCredential} from "@/lib/template-editor/agent-access";
import {agentResponse as reply, allowedAgentOrigin, readAgentBody} from "@/lib/template-editor/agent-http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET(request?: Request) {
  const access = await resolveEngineAccess();
  if (!access) return reply({error: "Sign in to manage agent access."}, 401);
  const rawOffset = request ? new URL(request.url).searchParams.get("offset") : null;
  const offset = rawOffset === null ? 0 : Number(rawOffset);
  if ((rawOffset !== null && !/^\d+$/.test(rawOffset)) || !Number.isInteger(offset) || offset < 0 || offset > 10000) return reply({error: "Use an integer offset from 0–10000."}, 400);
  try {
    const credentials = await listAgentCredentials(access.ownerKey, offset);
    return reply({credentials, nextOffset: credentials.length === 100 ? offset + 100 : null});
  }
  catch {return reply({error: "Agent access is temporarily unavailable."}, 503);}
}
async function mutate(request: Request, revoke: boolean) {
  const access = await resolveEngineAccess();
  if (!access) return reply({error: "Sign in to manage agent access."}, 401);
  if (!allowedAgentOrigin(request)) return reply({error: "Manage agent access from Engine."}, 403);
  let input: Record<string, unknown>;
  try {input = await readAgentBody(request, 4096);} catch (error) {return reply({error: error instanceof Error ? error.message : "Invalid agent request."}, error instanceof RangeError ? 413 : 400);}
  if (revoke ? typeof input.id !== "string" : typeof input.name !== "string" || !input.name.trim() || input.name.trim().length > 80) return reply({error: revoke ? "Choose an agent connection." : "Choose an agent name of 1–80 characters."}, 400);
  try {
    if (revoke) return await revokeAgentCredential(access.ownerKey, input.id as string) ? reply({revoked: true}) : reply({error: "Agent connection not found."}, 404);
    return reply(await createAgentCredential(access.ownerKey, input.name as string), 201);
  } catch {return reply({error: "Agent access could not be saved. Please retry."}, 503);}
}
export const POST = (request: Request) => mutate(request, false);
export const DELETE = (request: Request) => mutate(request, true);
