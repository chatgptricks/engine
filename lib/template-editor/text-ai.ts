import { richTextToPlain, type CanvasScene, type TextElement } from "./model";
import { ACCENT_STYLE, accentedText, textAccents, type TextAccent } from "./text-accents";

/**
 * AI on a text box, after Notion's: alternatives, shorten, expand, simplify,
 * rephrase, punchier, tone, fix, fit the box, follow the brand, translate,
 * highlight the key phrase, or the person's own instruction. The editor's AI
 * menu and the agent tool (engine_text_ai) send the same request and get the
 * same options back. This file is the shared part: what can be asked, the
 * prompt, and how an option goes back into the box. The model call is server
 * side (lib/engine/text-ai.ts).
 */

export const TEXT_AI_ACTIONS = [
  { id: "alternatives", label: "Give me alternatives", hint: "5 options" },
  { id: "punchier", label: "Make it punchier", hint: "hook" },
  { id: "shorten", label: "Shorten", hint: "" },
  { id: "expand", label: "Expand", hint: "" },
  { id: "simplify", label: "Simplify", hint: "" },
  { id: "rephrase", label: "Rephrase", hint: "" },
  { id: "tone", label: "Change tone", hint: "" },
  { id: "fit", label: "Fit the box", hint: "" },
  { id: "brand", label: "Follow the brand", hint: "" },
  { id: "translate", label: "Translate", hint: "" },
  { id: "highlight", label: "Highlight the key phrase", hint: "accent" },
  { id: "fix", label: "Fix spelling and grammar", hint: "" },
  { id: "custom", label: "Your own instruction", hint: "" },
] as const;
export type TextAiAction = (typeof TEXT_AI_ACTIONS)[number]["id"];
export const TEXT_AI_TONES = ["direct", "curious", "playful", "formal"] as const;
export type TextAiTone = (typeof TEXT_AI_TONES)[number];
export const TEXT_AI_LANGUAGES = ["Spanish", "English", "Portuguese", "French", "German", "Italian"] as const;
export const TEXT_AI_MAX_CHARS = 4000;
export const TEXT_AI_MAX_OPTIONS = 5;

export class TextAiError extends Error {
  constructor(message: string, public status = 400) { super(message); }
}

export type TextAiRequest = {
  action: TextAiAction;
  /** The box's text. */
  text: string;
  /** Only these characters change (offsets into text); the rest stays. */
  selection?: { start: number; end: number };
  tone?: TextAiTone;
  /** Any language name, for translate. */
  language?: string;
  /** For custom: what to do. For other actions: an extra note. */
  instruction?: string;
  /** How many options; alternatives default to 5, others to 1. */
  count: number;
};

/** What the model is told about where the text sits. */
export type TextAiContext = {
  role: "cover" | "heading" | "body" | "list" | "other";
  /** The other words on the slide, so a rewrite doesn't repeat them. */
  slideTexts: string[];
  /** The line count the box is made for, when it has one. */
  lines?: number;
  /** About how many characters fit, when known. */
  maxChars?: number;
  /** The phrases now in the accent gradient. */
  accents: string[];
  /** The brand guide in plain words, when the deck follows one. */
  brief?: string;
};

export type TextAiOption = {
  /** The new text of the whole box. */
  text: string;
  /** Phrases to draw in the accent gradient. */
  accents: string[];
  /** Brand rules this option breaks, from the guide's code checks. */
  brandIssues: string[];
};

const isAction = (value: unknown): value is TextAiAction => TEXT_AI_ACTIONS.some(action => action.id === value);
const isTone = (value: unknown): value is TextAiTone => TEXT_AI_TONES.includes(value as TextAiTone);

/** Checks a request from the editor or an agent. */
export function parseTextAiRequest(input: unknown): TextAiRequest {
  if (!input || typeof input !== "object" || Array.isArray(input)) throw new TextAiError("Send an object with action and text.");
  const value = input as Record<string, unknown>;
  if (!isAction(value.action)) throw new TextAiError(`action must be one of ${TEXT_AI_ACTIONS.map(action => action.id).join(", ")}.`);
  if (typeof value.text !== "string" || !value.text.trim()) throw new TextAiError("The text box is empty.");
  if (value.text.length > TEXT_AI_MAX_CHARS) throw new TextAiError(`The text is longer than ${TEXT_AI_MAX_CHARS} characters.`);
  const action = value.action, text = value.text;
  let selection: TextAiRequest["selection"];
  if (value.selection !== undefined && value.selection !== null) {
    const range = value.selection as Record<string, unknown>;
    const start = Number(range.start), end = Number(range.end);
    if (!Number.isInteger(start) || !Number.isInteger(end) || start < 0 || end <= start || end > text.length) throw new TextAiError(`selection must be {start, end} with 0 ≤ start < end ≤ ${text.length}.`);
    if (start > 0 || end < text.length) selection = { start, end };
  }
  if (value.tone !== undefined && !isTone(value.tone)) throw new TextAiError(`tone must be one of ${TEXT_AI_TONES.join(", ")}.`);
  if (action === "tone" && !value.tone) throw new TextAiError("Pick a tone.");
  const language = typeof value.language === "string" ? value.language.trim().slice(0, 40) : undefined;
  if (action === "translate" && !language) throw new TextAiError("Pick a language.");
  if (language !== undefined && !/^[\p{L} ()-]{2,40}$/u.test(language)) throw new TextAiError("language must be a language name, such as Spanish.");
  const instruction = typeof value.instruction === "string" ? value.instruction.trim().slice(0, 500) : undefined;
  if (action === "custom" && !instruction) throw new TextAiError("Write what the AI should do.");
  const fallback = action === "alternatives" ? TEXT_AI_MAX_OPTIONS : 1;
  const count = value.count === undefined ? fallback : Number(value.count);
  if (!Number.isInteger(count) || count < 1 || count > TEXT_AI_MAX_OPTIONS) throw new TextAiError(`count must be 1 to ${TEXT_AI_MAX_OPTIONS}.`);
  return { action, text, selection, tone: isTone(value.tone) ? value.tone : undefined, language, instruction, count };
}

/** Where a text box sits: its role, the slide's other words, how much fits. */
export function textAiContextFor(scene: CanvasScene, element: TextElement): Omit<TextAiContext, "brief"> {
  const role = element.smartText?.role ?? (element.slot === "title" ? "heading" : element.listStyle && element.listStyle !== "none" ? "list" : element.fontSize >= 24 ? "heading" : element.fontSize > 0 ? "body" : "other");
  const lines = element.smartText?.lines || undefined;
  // About half an em per character; a box made for N lines holds N of them.
  const perLine = Math.max(8, Math.round(element.width / Math.max(1, element.fontSize * 0.5)));
  const fitLines = lines ?? Math.max(1, Math.floor(element.height / Math.max(1, element.fontSize * (element.lineHeight || 1.2))));
  const slideTexts = scene.elements.filter((item): item is TextElement => item.type === "text" && item.id !== element.id && !item.hidden && Boolean(item.text.trim())).map(item => item.text.trim().slice(0, 400)).slice(0, 12);
  const accents = textAccents(element).filter(accent => accent.style === ACCENT_STYLE).map(accent => element.text.slice(accent.start, accent.end));
  return { role, slideTexts, lines, maxChars: perLine * fitLines, accents };
}

const ASKS: Record<TextAiAction, (request: TextAiRequest) => string> = {
  alternatives: request => `Write ${request.count} different versions. Keep the same facts and about the same length. Make each one a real alternative, not a small edit of another.`,
  punchier: () => "Make it punchier: lead with the most surprising fact, use the real names and numbers in it, cut filler. It should stop a scroll.",
  shorten: () => "Make it clearly shorter, about a third fewer words. Keep the meaning and every fact, name and number.",
  expand: () => "Make it a little longer and clearer. Add no facts that aren't in the text or on the slide.",
  simplify: () => "Use plain words a 25-year-old with no context understands. Keep every fact.",
  rephrase: () => "Say the same thing a different way.",
  tone: request => `Rewrite it in a ${request.tone} tone. Keep every fact.`,
  fit: () => "Rewrite it to fit the box (the line count and character budget below) so the type can stay at its size. Keep the key facts.",
  brand: () => "Fix it so it follows the brand guide's writing rules (case, final full stops, dashes, banned words). Change only what a rule asks for.",
  translate: request => `Translate it into ${request.language}. Keep names, numbers and product names as they are.`,
  highlight: () => "Don't change the words. Pick the key phrase (two to five words) that should be in the accent color.",
  fix: () => "Fix spelling, grammar and punctuation only. Change nothing else.",
  custom: request => `Do this: ${request.instruction}`,
};

/** The instructions and input for the model. */
export function textAiPrompt(request: TextAiRequest, context: TextAiContext): { instructions: string; input: string } {
  const part = request.selection ? request.text.slice(request.selection.start, request.selection.end) : undefined;
  const instructions = [
    "You edit the words in one text box of a social media carousel slide. You return options with the submit_options tool.",
    "Rules:",
    "- Never invent facts, numbers, names, dates or quotes. If something the text needs is missing, write it in [square brackets].",
    "- Keep the language of the text unless asked to translate.",
    "- Keep line breaks where they make sense for the box; use \\n for one.",
    "- No emojis or hashtags unless the text already has them.",
    "- accents: the exact phrases of your text to draw in the brand's accent gradient. Keep accented phrases that survive, add none unless asked or the text is a cover. Each phrase must appear in your text exactly.",
    part ? "- Only the selected part changes. Return the WHOLE box text with just that part rewritten." : "",
    context.brief ? `\n${context.brief}` : "",
  ].filter(Boolean).join("\n");
  const input = [
    `Task: ${ASKS[request.action](request)}${request.action !== "custom" && request.instruction ? ` Also: ${request.instruction}` : ""}`,
    `Options to return: ${request.action === "alternatives" ? request.count : request.count === 1 ? 1 : request.count}.`,
    `This box is a ${context.role === "cover" ? "cover headline" : context.role}${context.lines ? `, made for ${context.lines} lines` : ""}${context.maxChars ? `, about ${context.maxChars} characters fit` : ""}.`,
    `Text:\n"""${request.text}"""`,
    part ? `Selected part to change:\n"""${part}"""` : "",
    context.accents.length ? `Phrases now in the accent color: ${context.accents.map(item => `"${item}"`).join(", ")}` : "",
    context.slideTexts.length ? `Other words on the slide (context only, don't repeat them):\n${context.slideTexts.map(item => `- ${item.replace(/\n/g, " ")}`).join("\n")}` : "",
  ].filter(Boolean).join("\n\n");
  return { instructions, input };
}

/** The function the model must call. */
export const TEXT_AI_TOOL = {
  type: "function" as const,
  name: "submit_options",
  description: "Return the rewritten text options.",
  strict: true,
  parameters: {
    type: "object",
    additionalProperties: false,
    required: ["options"],
    properties: {
      options: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          required: ["text", "accents"],
          properties: {
            text: { type: "string", description: "The whole box's new text." },
            accents: { type: "array", items: { type: "string" }, description: "Exact phrases of text to draw in the accent gradient." },
          },
        },
      },
    },
  },
};

/** The model's options, cleaned: text kept to the box's limit, accents that
 * really appear, duplicates and unchanged text dropped (but highlight keeps
 * its own words). */
export function parseTextAiOptions(raw: unknown, request: TextAiRequest): Omit<TextAiOption, "brandIssues">[] {
  const list = raw && typeof raw === "object" && Array.isArray((raw as { options?: unknown }).options) ? (raw as { options: unknown[] }).options : [];
  const seen = new Set<string>(), out: Omit<TextAiOption, "brandIssues">[] = [];
  for (const item of list) {
    if (!item || typeof item !== "object") continue;
    const record = item as Record<string, unknown>;
    if (typeof record.text !== "string") continue;
    let text = record.text.replace(/\r\n?/g, "\n").replace(/^\s*"""|"""\s*$/g, "").trim().slice(0, TEXT_AI_MAX_CHARS);
    if (request.action === "highlight") text = request.text;
    if (!text || seen.has(text) || request.action !== "highlight" && text === request.text.trim() && request.action !== "fix" && request.action !== "brand") continue;
    seen.add(text);
    const accents = (Array.isArray(record.accents) ? record.accents : []).filter((phrase): phrase is string => typeof phrase === "string" && Boolean(phrase.trim()) && text.includes(phrase.trim())).map(phrase => phrase.trim()).slice(0, 6);
    out.push({ text, accents: [...new Set(accents)] });
    if (out.length >= request.count) break;
  }
  return out;
}

/** The accent rule, in code: a box gets new accents only when it's a cover, already
 * has some, or the ask is highlight; and an accent never covers the whole text. */
export function keepTextAiAccents<T extends Pick<TextAiOption, "text" | "accents">>(options: T[], request: Pick<TextAiRequest, "action">, context: Pick<TextAiContext, "role" | "accents">): T[] {
  const allowed = request.action === "highlight" || context.role === "cover" || context.accents.length > 0;
  return options.map(option => ({ ...option, accents: allowed ? option.accents.filter(phrase => phrase !== option.text.trim()) : [] }));
}

/** Accent ranges for phrases: each phrase's first place in the text, not overlapping. */
export function accentRanges(text: string, phrases: readonly string[]): TextAccent[] {
  const ranges: TextAccent[] = [];
  for (const phrase of phrases) {
    let from = 0;
    while (from <= text.length) {
      const start = text.indexOf(phrase, from);
      if (start < 0) break;
      const end = start + phrase.length;
      if (!ranges.some(range => start < range.end && end > range.start)) { ranges.push({ start, end, style: ACCENT_STYLE }); break; }
      from = start + 1;
    }
  }
  return ranges.sort((a, b) => a.start - b.start);
}

/** The box with an option's text. Accent phrases get the gradient; colored
 * words (not gradient) keep their color when the same words survive. */
export function applyTextAiOption(element: TextElement, option: Pick<TextAiOption, "text" | "accents">): TextElement {
  const text = option.text;
  const kept = textAccents(element).filter(accent => accent.style !== ACCENT_STYLE).map(accent => ({ phrase: element.text.slice(accent.start, accent.end), style: accent.style }));
  const ranges = accentRanges(text, option.accents);
  for (const { phrase, style } of kept) {
    const start = text.indexOf(phrase), end = start + phrase.length;
    if (start >= 0 && !ranges.some(range => start < range.end && end > range.start)) ranges.push({ start, end, style });
  }
  const styled = accentedText(text, ranges.sort((a, b) => a.start - b.start));
  const next: TextElement = { ...element, text, richText: styled.richText, wordTextures: styled.wordTextures };
  if (!next.richText) delete next.richText;
  if (!next.wordTextures) delete next.wordTextures;
  return next;
}

/** Plain text of a box, the way the AI reads it. */
export const textAiSource = (element: TextElement) => element.richText ? richTextToPlain(element.richText) : element.text;
