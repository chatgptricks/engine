/** The editor's AI menu on a text box. The editor sends the box and its slide as
 * the person sees them (saved or not), and places the option they pick itself,
 * so undo and live collaboration work as for any edit. Agents use the same
 * request through engine_text_ai (app/api/agent/slides). */
import {agentResponse as reply, allowedAgentOrigin, readAgentBody, resolveAgentRequest} from "@/lib/template-editor/agent-http";
import {FORMATS, type CanvasScene, type DesignFormat, type TextElement} from "@/lib/template-editor/model";
import {TextAiError, parseTextAiRequest, textAiContextFor} from "@/lib/template-editor/text-ai";
import {runTextAi} from "@/lib/engine/text-ai";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

const isObject = (value: unknown): value is Record<string, unknown> => Boolean(value) && typeof value === "object" && !Array.isArray(value);

export async function POST(request: Request) {
  const access = await resolveAgentRequest(request);
  if (!access) return reply({error: "Sign in to use AI on text."}, 401);
  if (!allowedAgentOrigin(request)) return reply({error: "Use AI on text from the editor."}, 403);
  let input: Record<string, unknown>;
  try {input = await readAgentBody(request, 2 * 1024 * 1024);} catch (error) {return reply({error: error instanceof Error ? error.message : "Invalid JSON request."}, error instanceof RangeError ? 413 : 400);}
  try {
    const scene = input.scene, elementId = input.elementId;
    if (!isObject(scene) || !Array.isArray(scene.elements) || scene.elements.length > 1000 || !scene.elements.every(isObject)) throw new TextAiError("scene must be the slide's scene.");
    const element = (scene.elements as Record<string, unknown>[]).find(item => item.id === elementId);
    if (!element || element.type !== "text" || typeof element.text !== "string") throw new TextAiError("elementId must be a text box on this slide.");
    const format = typeof input.format === "string" && input.format in FORMATS ? input.format as DesignFormat : "portrait";
    const size = isObject(input.customSize) && Number.isFinite(input.customSize.width) && Number.isFinite(input.customSize.height) ? {width: Number(input.customSize.width), height: Number(input.customSize.height)} : undefined;
    const ask = parseTextAiRequest({...input, text: element.text});
    const text = element as unknown as TextElement, slide = scene as unknown as CanvasScene;
    const result = await runTextAi(access.ownerKey, ask, textAiContextFor(slide, text), {
      scene: slide, element: text, format, customSize: size,
      templateId: typeof input.templateId === "string" ? input.templateId : undefined,
    }, request.signal);
    return reply(result);
  } catch (error) {
    if (error instanceof TextAiError) return reply({error: error.message}, error.status);
    return reply({error: "Engine's AI couldn't answer. Try again."}, 503);
  }
}
