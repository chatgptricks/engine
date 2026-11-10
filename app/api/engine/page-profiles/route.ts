import {agentResponse as reply, allowedAgentOrigin, readAgentBody, resolveAgentRequest} from "@/lib/template-editor/agent-http";
import {deletePageProfile, getPageProfile, listPageProfiles, savePageProfile, PageProfileError} from "@/lib/engine/page-profiles";

/**
 * Engine — page profiles for "Recreate post".
 *
 *   GET            → {profiles}        built-ins (with overrides) + saved pages
 *   GET ?id=…      → {profile}         one profile, 404 when unknown
 *   PUT {profile}  → {profile}         create or update one (a bare profile body works too)
 *   DELETE ?id=…   → {deleted, id}     custom profiles only
 *
 * Signed-in people and Engine agent tokens (Authorization: Bearer eng1…) are
 * both accepted, exactly like /api/agent/slides. Everything is scoped to the
 * caller's workspace owner.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_BODY_BYTES = 64 * 1024;

async function authorize(request: Request): Promise<{ownerKey: string} | {response: Response}> {
  const access = await resolveAgentRequest(request);
  if (!access) return {response: reply({error: "Use an active Engine agent token or sign in."}, 401)};
  if (!allowedAgentOrigin(request)) return {response: reply({error: "This origin is not allowed to access Engine."}, 403)};
  return {ownerKey: access.ownerKey};
}

function failure(error: unknown) {
  if (error instanceof PageProfileError) return reply({error: error.message, ...(error.issues.length ? {issues: error.issues} : {})}, error.status);
  return reply({error: "Page profiles are unavailable right now. Retry shortly."}, 503);
}

export async function GET(request: Request) {
  try {
    const auth = await authorize(request);
    if ("response" in auth) return auth.response;
    const id = new URL(request.url).searchParams.get("id");
    if (id !== null) {
      const profile = await getPageProfile(auth.ownerKey, id);
      return profile ? reply({profile}) : reply({error: "Page profile not found."}, 404);
    }
    return reply({profiles: await listPageProfiles(auth.ownerKey)});
  } catch (error) {
    return failure(error);
  }
}

export async function PUT(request: Request) {
  try {
    const auth = await authorize(request);
    if ("response" in auth) return auth.response;
    let body: Record<string, unknown>;
    try {
      body = await readAgentBody(request, MAX_BODY_BYTES);
    } catch (error) {
      return reply({error: error instanceof Error ? error.message : "Invalid JSON request."}, error instanceof RangeError ? 413 : 400);
    }
    const input = body.profile && typeof body.profile === "object" && !Array.isArray(body.profile) ? body.profile : body;
    return reply({profile: await savePageProfile(auth.ownerKey, input)});
  } catch (error) {
    return failure(error);
  }
}

export async function DELETE(request: Request) {
  try {
    const auth = await authorize(request);
    if ("response" in auth) return auth.response;
    const id = new URL(request.url).searchParams.get("id");
    if (!id) return reply({error: "Add ?id= with the page profile to delete."}, 400);
    if (!(await deletePageProfile(auth.ownerKey, id))) return reply({error: "Page profile not found."}, 404);
    return reply({deleted: true, id});
  } catch (error) {
    return failure(error);
  }
}
