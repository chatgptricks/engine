import {agentResponse as reply, allowedAgentOrigin, readAgentBody, resolveAgentRequest} from "@/lib/template-editor/agent-http";
import {BrandGuideError} from "@/lib/template-editor/brand-guide";
import {checkAgainstGuide} from "@/lib/engine/brand-actions";

/**
 * Engine — check a deck or a template against a brand guide.
 *
 *   POST {deckId | templateId, brandId?} → {brand, target, checks, issues, summary}
 *
 * Without brandId, the brand comes from the template's brand tag or the page
 * that uses it. Code checks only: a critic still looks at the slides.
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
    const text = (value: unknown) => typeof value === "string" && value.length <= 200 ? value : undefined;
    return reply(await checkAgainstGuide(access.ownerKey, {brandId: text(input.brandId), deckId: text(input.deckId), templateId: text(input.templateId)}));
  } catch (error) {
    if (error instanceof BrandGuideError) return reply({error: error.message}, error.status);
    console.error("[brands/check]", error instanceof Error ? error.message : error);
    return reply({error: "The check couldn't run right now. Retry shortly."}, 503);
  }
}
