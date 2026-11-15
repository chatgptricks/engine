import { CHAT_MODEL, getOpenAI } from "@/lib/openai";
import { guideBrief, runGuideChecks, type BrandGuide } from "@/lib/template-editor/brand-guide";
import type { CanvasScene, DesignFormat, TextElement } from "@/lib/template-editor/model";
import { TEXT_AI_TOOL, TextAiError, applyTextAiOption, keepTextAiAccents, parseTextAiOptions, textAiPrompt, type TextAiContext, type TextAiOption, type TextAiRequest } from "@/lib/template-editor/text-ai";
import { HeadlineModelError, isHeadlineModelConfigured, writeHeadlines } from "./headline-model";
import { guideForTemplateId } from "./brand-actions";

/**
 * Runs a text AI request (lib/template-editor/text-ai.ts) for the editor's AI
 * menu and for agents. Cover alternatives come from Engine's headline model
 * when it's set up; everything else from the chat model, told the brand guide.
 * Each option is checked against the guide's code checks.
 */

export type TextAiTarget = {
  /** The slide the box is on, for the brand check. */
  scene: CanvasScene;
  element: TextElement;
  format: DesignFormat;
  customSize?: { width: number; height: number };
  /** The deck's template: its brand guide and language. */
  templateId?: string;
};

export type TextAiResult = { options: TextAiOption[]; model: "chat" | "headline"; brand?: { id: string; name: string } };

/** Copy issues an option adds: the guide's checks on the slide with the new text, minus what the slide already had. */
function brandIssuesFor(guide: BrandGuide, language: "en" | "es", target: TextAiTarget, options: Omit<TextAiOption, "brandIssues">[]): TextAiOption[] {
  const check = (element: TextElement) => runGuideChecks(
    { format: target.format, customSize: target.customSize, pages: [{ id: "page", canvas: { ...target.scene, elements: target.scene.elements.map(item => item.id === element.id ? element : item) } }] } as never,
    guide, { scope: "deck", language },
  ).filter(issue => issue.route === "copy").map(issue => issue.problem);
  const before = new Set(check(target.element));
  return options.map(option => ({ ...option, brandIssues: check(applyTextAiOption(target.element, option)).filter(problem => !before.has(problem)).slice(0, 5) }));
}

async function chatOptions(request: TextAiRequest, context: TextAiContext, signal?: AbortSignal) {
  const client = getOpenAI();
  if (!client) throw new TextAiError("AI isn't set up on this server (no OpenAI key).", 503);
  const { instructions, input } = textAiPrompt(request, context);
  const response = await client.responses.create({
    model: CHAT_MODEL, instructions, input, tools: [TEXT_AI_TOOL], tool_choice: { type: "function", name: TEXT_AI_TOOL.name }, max_output_tokens: 3_000, store: false,
  }, { signal: signal ?? AbortSignal.timeout(60_000) });
  const call = response.output.find(item => item.type === "function_call" && item.name === TEXT_AI_TOOL.name);
  if (call?.type !== "function_call") throw new TextAiError("The AI didn't return any text. Try again.", 502);
  let raw: unknown;
  try { raw = JSON.parse(call.arguments); } catch { throw new TextAiError("The AI's answer couldn't be read. Try again.", 502); }
  return parseTextAiOptions(raw, request);
}

/** Cover alternatives from the headline model; undefined when it isn't set up or fails (the chat model takes over). */
async function headlineOptions(request: TextAiRequest, context: TextAiContext, signal?: AbortSignal) {
  if (!isHeadlineModelConfigured()) return undefined;
  try {
    const story = [request.text, ...context.slideTexts].join("\n").slice(0, 2_000);
    const lines = await writeHeadlines({ story, originalHeadline: request.text, count: request.count, timeoutMs: 90_000, signal });
    // A cover set in capitals stays in capitals.
    const upper = /\p{L}/u.test(request.text) && request.text === request.text.toLocaleUpperCase();
    const options = [...new Set(lines.map(line => upper ? line.text.trim().toLocaleUpperCase() : line.text.trim()))].filter(text => text && text !== request.text.trim()).slice(0, request.count);
    // Accent phrases that survive stay in the gradient.
    return options.length ? options.map(text => ({ text, accents: context.accents.filter(phrase => text.includes(phrase)) })) : undefined;
  } catch (error) {
    if (error instanceof HeadlineModelError) return undefined;
    throw error;
  }
}

export async function runTextAi(ownerKey: string, request: TextAiRequest, context: Omit<TextAiContext, "brief">, target: TextAiTarget, signal?: AbortSignal): Promise<TextAiResult> {
  const { guide, language } = await guideForTemplateId(ownerKey, target.templateId);
  const full: TextAiContext = { ...context, brief: guide ? guideBrief(guide) : undefined };
  let model: TextAiResult["model"] = "chat";
  let options = context.role === "cover" && request.action === "alternatives" && !request.selection ? await headlineOptions(request, full, signal) : undefined;
  if (options) model = "headline";
  else options = await chatOptions(request, full, signal);
  if (!options.length) throw new TextAiError("The AI had nothing new to suggest. Try another action.", 422);
  options = keepTextAiAccents(options, request, context);
  return {
    options: guide ? brandIssuesFor(guide, language, target, options) : options.map(option => ({ ...option, brandIssues: [] })),
    model,
    brand: guide ? { id: guide.id, name: guide.name } : undefined,
  };
}
