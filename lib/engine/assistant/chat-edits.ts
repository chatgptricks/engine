/**
 * The edits the chat makes to an open post. The same code runs on the server,
 * which checks edits against the live post before sending them, and in the
 * editor, which applies them through its normal change path as one undo step.
 *
 * Most edits are the agent API's deck operations (`updateAgentDeck`). One more,
 * `style_words`, colors or bolds words inside a text box ("make FREE green"),
 * which a deck operation can't do: it styles a whole text box.
 */
import {AGENT_UPDATE_SCHEMA, AgentDeckValidationError, updateAgentDeck, type AgentDeckIssue} from "@/lib/template-editor/agent-decks";
import {canEditElement} from "@/lib/template-editor/commands";
import {EMPTY_LIBRARY, parseLibrary, sanitizeRichText, sceneForPage, type DesignDocument} from "@/lib/template-editor/model";

type RecordValue = Record<string, unknown>;
const record = (value: unknown): value is RecordValue => value !== null && typeof value === "object" && !Array.isArray(value);
const fail = (path: string, message: string): never => { throw new AgentDeckValidationError(message, path); };

export const MAX_CHAT_EDITS = 60;
const COLOR = /^(?:#(?:[a-fA-F0-9]{3}|[a-fA-F0-9]{6})|black|white)$/;
const ID = /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,119}$/;

const styleWordsSchema = {
  type: "object", additionalProperties: false, required: ["op", "pageId", "elementId", "words"],
  description: "Color or bold words inside one text box, keeping the rest of its style. Give each word or phrase exactly as it appears. Template text with a fixed style takes colors but not bold.",
  properties: {
    op: {const: "style_words"},
    pageId: {type: "string"}, elementId: {type: "string"},
    words: {type: "array", minItems: 1, maxItems: 10, items: {type: "string", minLength: 1, maxLength: 200}},
    color: {type: "string", description: "A hex color such as #00D98A, or black or white"},
    bold: {type: "boolean"},
  },
};

/** The JSON Schema Claude sees for a list of edits: the deck operations plus style_words. */
export function chatEditsSchema(): RecordValue {
  const operations = structuredClone((AGENT_UPDATE_SCHEMA.properties as RecordValue).operations) as RecordValue;
  const items = operations.items as {oneOf: RecordValue[]};
  return {...operations, maxItems: MAX_CHAT_EDITS, items: {oneOf: [...items.oneOf, styleWordsSchema]}};
}

const escapeHtml = (value: string) => value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const plainHtml = (value: string) => escapeHtml(value).replace(/\n/g, "<br>");
const pattern = (value: string, flags: string) => new RegExp(escapeHtml(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), flags);

/** Wraps every occurrence of `word` in the HTML's text (never inside a tag) in a styled span. */
function wrapWord(html: string, word: string, style: string): string {
  for (const flags of ["g", "gi"]) {
    let found = false;
    const result = html.split(/(<[^>]*>)/g).map(chunk => chunk.startsWith("<") ? chunk : chunk.replace(pattern(word, flags), match => {
      found = true;
      return `<span style="${style}">${match}</span>`;
    })).join("");
    if (found) return result;
  }
  return html;
}

function styleWords(document: DesignDocument, operation: RecordValue, path: string): DesignDocument {
  const {pageId, elementId, words, color, bold} = operation;
  for (const key of Object.keys(operation)) if (!["op", "pageId", "elementId", "words", "color", "bold"].includes(key)) fail(`${path}.${key}`, "is not supported");
  if (typeof pageId !== "string" || !ID.test(pageId)) fail(`${path}.pageId`, "is required");
  if (typeof elementId !== "string" || !ID.test(elementId)) fail(`${path}.elementId`, "is required");
  if (!Array.isArray(words) || !words.length || words.length > 10 || words.some(word => typeof word !== "string" || !word.trim() || word.length > 200)) fail(`${path}.words`, "lists 1 to 10 words or phrases");
  if (color !== undefined && (typeof color !== "string" || !COLOR.test(color))) fail(`${path}.color`, "must be a hex color such as #00D98A");
  if (bold !== undefined && typeof bold !== "boolean") fail(`${path}.bold`, "must be true or false");
  if (color === undefined && bold === undefined) fail(path, "requires color or bold");
  const next = structuredClone(document);
  const page = next.pages.find(item => item.id === pageId) ?? fail(`${path}.pageId`, "slide was not found");
  const scene = page.canvas ?? sceneForPage(page, next.format);
  page.canvas = scene;
  const element = scene.elements.find(item => item.id === elementId);
  if (!element || element.type !== "text") return fail(`${path}.elementId`, "must identify a text box on this slide");
  // Styled words are part of a text box's content, as in the editor and in the page's own highlighted
  // key words, so a template's fixed style allows colors. Its fonts stay fixed, so bold doesn't.
  if (!canEditElement(scene, element, "content")) fail(path, "element is locked or its text is protected");
  if (bold !== undefined && !canEditElement(scene, element, "style")) fail(`${path}.bold`, "this text box's fonts are fixed by the template; color the words instead");
  const style = [color !== undefined ? `color: ${String(color).toLowerCase()}` : "", bold !== undefined ? `font-weight: ${bold ? 700 : 400}` : ""].filter(Boolean).join("; ");
  let html = element.richText ?? plainHtml(element.text);
  for (const word of words as string[]) {
    const wrapped = wrapWord(html, word.trim(), style);
    if (wrapped === html) fail(`${path}.words`, `"${word.trim()}" isn't in that text box. Use read_post to see its text.`);
    html = wrapped;
  }
  element.richText = sanitizeRichText(html) ?? fail(path, "those words couldn't be styled");
  next.updatedAt = new Date().toISOString();
  if (!parseLibrary({...structuredClone(EMPTY_LIBRARY), designs: [next]})) fail(path, "result exceeds Engine's editable document limits");
  return next;
}

/** Errors from a run of deck operations name their place in the whole list. */
function shifted(error: AgentDeckValidationError, offset: number): AgentDeckValidationError {
  const issues: AgentDeckIssue[] = error.issues.map(issue => ({...issue, path: issue.path.replace(/^\$\.operations\[(\d+)\]/, (_, index: string) => `$.operations[${Number(index) + offset}]`)}));
  return new AgentDeckValidationError(issues);
}

/**
 * Applies the chat's edits in order and returns the new post. Throws an
 * AgentDeckValidationError naming the first bad edit; nothing is applied then.
 */
export function applyChatEdits(document: DesignDocument, operations: unknown): DesignDocument {
  if (!Array.isArray(operations) || !operations.length || operations.length > MAX_CHAT_EDITS) fail("$.operations", `send between 1 and ${MAX_CHAT_EDITS} edits`);
  let next = document, batch: unknown[] = [], start = 0;
  const flush = () => {
    if (!batch.length) return;
    try { next = updateAgentDeck(next, {operations: batch}); }
    catch (error) { throw error instanceof AgentDeckValidationError ? shifted(error, start) : error; }
    batch = [];
  };
  (operations as unknown[]).forEach((operation, index) => {
    if (record(operation) && operation.op === "style_words") {
      flush();
      next = styleWords(next, operation, `$.operations[${index}]`);
      return;
    }
    if (!batch.length) start = index;
    batch.push(operation);
  });
  flush();
  return next;
}

/** Puts a person's uploaded photo in place of `upload:<id>` image sources. */
export function withUploads(operations: unknown, uploads: ReadonlyMap<string, {dataUrl: string}>): unknown {
  const swap = (value: unknown): unknown => {
    if (typeof value === "string" && value.startsWith("upload:")) {
      const upload = uploads.get(value.slice(7));
      if (!upload) throw new AgentDeckValidationError(`${value} isn't one of this chat's uploads, or it's no longer available. Ask for the photo again.`, "$.operations");
      return upload.dataUrl;
    }
    if (Array.isArray(value)) return value.map(swap);
    if (record(value)) return Object.fromEntries(Object.entries(value).map(([key, child]) => [key, swap(child)]));
    return value;
  };
  return swap(operations);
}
