import {agentResponse as reply, allowedAgentOrigin, readAgentBody, resolveAgentRequest} from "@/lib/template-editor/agent-http";
import {BrandGuideError} from "@/lib/template-editor/brand-guide";
import {draftTemplateFromGuide} from "@/lib/engine/brand-actions";
import {LibraryConflictError} from "@/lib/template-editor/persistence";

/**
 * Engine — draft a template from a brand guide.
 *
 *   POST {brandId, language: "en" | "es", baseTemplateId?} → {template, replaced, issues, pagesUsingIt}
 *
 * The draft is saved in the workspace's templates as "<brand>-guide-<language>",
 * replacing an earlier draft. No page uses it until someone picks it for the
 * page (its page profile's templateId).
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    const access = await resolveAgentRequest(request);
    if (!access) return reply({error: "Use an active Engine agent token or sign in."}, 401);
    if (!allowedAgentOrigin(request)) return reply({error: "This origin is not allowed to access Engine."}, 403);
    let input: Record<string, unknown>;
    try {
      input = await readAgentBody(request, 16 * 1024);
    } catch (error) {
      return reply({error: error instanceof Error ? error.message : "Invalid JSON request."}, error instanceof RangeError ? 413 : 400);
    }
    if (typeof input.brandId !== "string" || input.brandId.length > 48) return reply({error: "Pass brandId, the guide to draft from."}, 400);
    if (input.language !== "en" && input.language !== "es") return reply({error: 'language must be "en" or "es".'}, 400);
    const baseTemplateId = typeof input.baseTemplateId === "string" && input.baseTemplateId.length <= 200 ? input.baseTemplateId : undefined;
    return reply(await draftTemplateFromGuide(access.ownerKey, {brandId: input.brandId, language: input.language, baseTemplateId}), 201);
  } catch (error) {
    if (error instanceof BrandGuideError) return reply({error: error.message}, error.status);
    if (error instanceof LibraryConflictError) return reply({error: "The workspace changed while drafting. Retry."}, 409);
    console.error("[brands/templates]", error instanceof Error ? error.message : error);
    return reply({error: "The template couldn't be drafted right now. Retry shortly."}, 503);
  }
}
