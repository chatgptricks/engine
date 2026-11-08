import {agentResponse as reply, allowedAgentOrigin, readAgentBody, resolveAgentRequest} from "@/lib/template-editor/agent-http";
import {BrandGuideError, guideBrief, guideSummary} from "@/lib/template-editor/brand-guide";
import {brandGuideVersions, deleteBrandGuide, getBrandGuide, getBrandGuideVersion, listBrandGuides, restoreBrandGuide, saveBrandGuide} from "@/lib/engine/brand-guides";
import {listPageProfiles} from "@/lib/engine/page-profiles";

/**
 * Engine — brand guides: what a brand looks and reads like, for people (Brand →
 * Guides in the editor) and agents (the engine_*_brand MCP tools).
 *
 *   GET                        → {guides}                  one line per guide
 *   GET ?id=…                  → {guide, brief, versions, pages}
 *   GET ?id=…&version=n        → {guide}                   an earlier version
 *   PUT {guide, expectedVersion?, note?} → {guide}         a new version (fields left out keep their value)
 *   POST {action: "restore", id, version} → {guide}        brings an earlier version back as a new one
 *   DELETE ?id=…               → {deleted, id}             custom guides only
 *
 * Signed-in people and Engine agent tokens are both accepted, scoped to the
 * caller's workspace owner. Saves by agent tokens are marked as the agent's.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Guides carry logos and examples; upload large images as assets and send their URLs. */
const MAX_BODY_BYTES = 1_500_000;

async function authorize(request: Request): Promise<{ownerKey: string; kind: "agent" | "session"} | {response: Response}> {
  const access = await resolveAgentRequest(request);
  if (!access) return {response: reply({error: "Use an active Engine agent token or sign in."}, 401)};
  if (!allowedAgentOrigin(request)) return {response: reply({error: "This origin is not allowed to access Engine."}, 403)};
  return access;
}

function failure(error: unknown) {
  if (error instanceof BrandGuideError) return reply({error: error.message, ...(error.issues.length ? {issues: error.issues} : {})}, error.status);
  console.error("[brands]", error instanceof Error ? error.message : error);
  return reply({error: "Brand guides are unavailable right now. Retry shortly."}, 503);
}

async function body(request: Request): Promise<Record<string, unknown> | Response> {
  try {
    return await readAgentBody(request, MAX_BODY_BYTES);
  } catch (error) {
    return reply({error: error instanceof Error ? error.message : "Invalid JSON request."}, error instanceof RangeError ? 413 : 400);
  }
}

export async function GET(request: Request) {
  try {
    const auth = await authorize(request);
    if ("response" in auth) return auth.response;
    const params = new URL(request.url).searchParams, id = params.get("id");
    if (id === null) return reply({guides: (await listBrandGuides(auth.ownerKey)).map(guide => ({...guideSummary(guide), builtIn: guide.builtIn, overridden: guide.overridden}))});
    const version = params.get("version");
    if (version !== null) {
      const earlier = /^\d{1,9}$/.test(version) ? await getBrandGuideVersion(auth.ownerKey, id, Number(version)) : null;
      return earlier ? reply({guide: earlier}) : reply({error: "That version of the guide isn't saved."}, 404);
    }
    const guide = await getBrandGuide(auth.ownerKey, id);
    if (!guide) return reply({error: "Brand guide not found."}, 404);
    const [versions, profiles] = await Promise.all([brandGuideVersions(auth.ownerKey, id), listPageProfiles(auth.ownerKey)]);
    return reply({
      guide, brief: guideBrief(guide), versions,
      pages: profiles.filter(profile => profile.brandId === id).map(profile => ({id: profile.id, name: profile.name, handle: profile.handle, language: profile.language, templateId: profile.templateId ?? null})),
    });
  } catch (error) {
    return failure(error);
  }
}

export async function PUT(request: Request) {
  try {
    const auth = await authorize(request);
    if ("response" in auth) return auth.response;
    const input = await body(request);
    if (input instanceof Response) return input;
    const guide = input.guide && typeof input.guide === "object" && !Array.isArray(input.guide) ? input.guide : input;
    const expectedVersion = typeof input.expectedVersion === "number" && Number.isSafeInteger(input.expectedVersion) ? input.expectedVersion : undefined;
    const saved = await saveBrandGuide(auth.ownerKey, guide, {expectedVersion, note: typeof input.note === "string" ? input.note : "", savedBy: auth.kind === "agent" ? "agent" : "person"});
    return reply({guide: saved, brief: guideBrief(saved)});
  } catch (error) {
    return failure(error);
  }
}

export async function POST(request: Request) {
  try {
    const auth = await authorize(request);
    if ("response" in auth) return auth.response;
    const input = await body(request);
    if (input instanceof Response) return input;
    if (input.action !== "restore") return reply({error: 'Unknown action. Use {"action": "restore", "id", "version"}.'}, 400);
    if (typeof input.id !== "string" || typeof input.version !== "number" || !Number.isSafeInteger(input.version)) return reply({error: "Pass the guide's id and the version number to restore."}, 400);
    const restored = await restoreBrandGuide(auth.ownerKey, input.id, input.version, {savedBy: auth.kind === "agent" ? "agent" : "person"});
    return reply({guide: restored});
  } catch (error) {
    return failure(error);
  }
}

export async function DELETE(request: Request) {
  try {
    const auth = await authorize(request);
    if ("response" in auth) return auth.response;
    const id = new URL(request.url).searchParams.get("id");
    if (!id) return reply({error: "Add ?id= with the brand guide to delete."}, 400);
    if (!(await deleteBrandGuide(auth.ownerKey, id))) return reply({error: "Brand guide not found."}, 404);
    return reply({deleted: true, id});
  } catch (error) {
    return failure(error);
  }
}
