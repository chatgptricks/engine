import { canEditElement, clearRichTextureRefs, isElementHidden, type SceneCommandResult } from "./commands";
import { parseShapeImageFill, richTextToPlain, sanitizeRichText, type CanvasScene, type ShapeImageFill, type TextElement } from "./model";

export type TextTextureWord = {
  /** Stable for this occurrence, including its UTF-16 offsets. */
  id: string;
  index: number;
  text: string;
  start: number;
  end: number;
  line: number;
  /** `whole` denotes the layer background; absent for mixed/untextured words. */
  textureId?: string;
};
export type TextWordTextureSelection = "all" | readonly (number | string | { start: number; end: number })[];
export type TextWordTextureOptions = {
  textureId?: string;
  baseTextureId?: string;
  /** Capture these when opening a dialog or before reading an upload. */
  expectedText?: string;
  expectedRichText?: string;
};

type Atom = { raw: string; text: string; start: number; end: number; textureId?: string };
type Token = { html: string } | { atoms: Atom[] };
type Source = { html: string; text: string; tokens: Token[] };
const MAX_WORD_TEXTURES = 30;
const validId = (value: string) => /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,119}$/.test(value);
const escapeText = (value: string) => value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const changedSelection = () => new Error("The text or selected words changed. Choose the words again.");

/** Parse the same small inline grammar as the model, without browser DOM APIs.
 * Keep original emphasis/style tags and entity spelling; texture inheritance is
 * recorded separately so clearing a word can really clear an ancestor texture. */
function sourceFor(element: TextElement): Source {
  const safe = sanitizeRichText(element.richText);
  const html = safe ?? escapeText(element.text).replace(/\r\n|\r|\n/g, "<br>");
  const tokens: Token[] = [], textures: (string | undefined)[] = [], emitted: boolean[] = [];
  let offset = 0, text = "";
  for (const chunk of html.split(/(<[^>]*>)/g)) {
    if (!chunk) continue;
    if (chunk === "<br>") {
      tokens.push({ atoms: [{ raw: "<br>", text: "\n", start: offset, end: offset + 1, textureId: textures.at(-1) }] });
      offset++; text += "\n";
    } else if (chunk.startsWith("</")) {
      if (emitted.pop()) tokens.push({ html: chunk });
      textures.pop();
    } else if (chunk.startsWith("<")) {
      const texture = chunk.match(/\sdata-texture-id="([a-zA-Z0-9_-]+)"/)?.[1];
      textures.push(texture ?? textures.at(-1));
      const clean = chunk.replace(/\sdata-texture-id="[a-zA-Z0-9_-]+"/, "");
      // A span used only as a texture reference no longer needs its old wrapper.
      // Preserve every actual style/emphasis tag, including nested overrides.
      emitted.push(clean !== "<span>");
      if (clean !== "<span>") tokens.push({ html: clean });
    } else {
      const atoms: Atom[] = [];
      for (const match of chunk.matchAll(/&(?:#x[\da-f]+|#\d+|amp|lt|gt|quot|apos|nbsp);|[\s\S]/giu)) {
        const raw = match[0], decoded = raw.startsWith("&") ? richTextToPlain(raw) : raw;
        atoms.push({ raw, text: decoded, start: offset, end: offset + decoded.length, textureId: textures.at(-1) });
        offset += decoded.length; text += decoded;
      }
      tokens.push({ atoms });
    }
  }
  return { html, text, tokens };
}

/** Occurrences are separate chips: repeated words never share an ID. Offsets
 * use UTF-16, matching DOM Range capture and native text selection. */
export function textTextureWords(element: TextElement): TextTextureWord[] {
  const source = sourceFor(element), words: TextTextureWord[] = [];
  const segments = typeof Intl.Segmenter === "function"
    ? Array.from(new Intl.Segmenter(undefined, { granularity: "word" }).segment(source.text)).filter(segment => segment.isWordLike).map(segment => ({ text: segment.segment, start: segment.index }))
    : Array.from(source.text.matchAll(/[\p{L}\p{N}\p{M}_]+(?:['’][\p{L}\p{N}\p{M}_]+)*/gu)).map(match => ({ text: match[0], start: match.index }));
  const atoms = source.tokens.flatMap(token => "atoms" in token ? token.atoms : []);
  let atomIndex = 0, line = 0, previousStart = 0;
  for (const segment of segments) {
    const index = words.length, end = segment.start + segment.text.length;
    while (atoms[atomIndex] && atoms[atomIndex].end <= segment.start) atomIndex++;
    const ids = new Set<string | undefined>();
    for (let position = atomIndex; atoms[position] && atoms[position].start < end; position++) ids.add(atoms[position].textureId ?? (element.textureFill ? "whole" : undefined));
    line += source.text.slice(previousStart, segment.start).split("\n").length - 1;
    previousStart = segment.start;
    const textureId = ids.size === 1 ? [...ids][0] : undefined;
    words.push({ id: `word-${index}-${segment.start}-${end}`, index, text: segment.text, start: segment.start, end, line, ...(textureId ? { textureId } : {}) });
  }
  return words;
}
export const getTextWords = textTextureWords;

function selectedIntervals(words: TextTextureWord[], selection: Exclude<TextWordTextureSelection, "all">, length: number): { start: number; end: number }[] {
  const selected = new Set<number>();
  for (const item of selection) {
    if (typeof item === "number" || typeof item === "string") {
      const word = typeof item === "number" && Number.isInteger(item) ? words[item] : typeof item === "string" ? words.find(word => word.id === item) : undefined;
      if (!word) throw changedSelection();
      selected.add(word.index);
    } else {
      if (!item || !Number.isInteger(item.start) || !Number.isInteger(item.end) || item.start < 0 || item.end <= item.start || item.end > length) throw changedSelection();
      for (const word of words) if (word.start < item.end && word.end > item.start) selected.add(word.index);
    }
  }
  return words.filter(word => selected.has(word.index)).map(({ start, end }) => ({ start, end }));
}

function sameFill(left: ShapeImageFill, right: ShapeImageFill): boolean {
  // Parsed fills have a canonical field order and never include their resource ID.
  return JSON.stringify(parseShapeImageFill(left)) === JSON.stringify(parseShapeImageFill(right));
}

/** Pure element transformation. Supply IDs for deterministic live previews;
 * omitted IDs are allocated only when a new active resource is necessary. */
export function applyWordTexture(element: TextElement, selection: TextWordTextureSelection, fill: ShapeImageFill | null, idOrOptions?: string | TextWordTextureOptions): TextElement {
  if (element.locked || element.hidden || element.protected?.some(property => property === "content" || property === "style")) return element;
  const options = typeof idOrOptions === "string" ? { textureId: idOrOptions } : idOrOptions ?? {};
  if ((options.expectedText !== undefined && options.expectedText !== element.text) || (options.expectedRichText !== undefined && options.expectedRichText !== element.richText)) throw changedSelection();
  const parsed = fill === null ? null : parseShapeImageFill(fill);
  if (fill !== null && !parsed) throw new Error("Choose a valid image and crop settings for this text texture.");
  if (selection === "all") {
    const hasWordResources = Boolean(element.wordTextures?.length || element.richText?.match(/\sdata-texture-id=/i));
    if (!hasWordResources && (parsed ? Boolean(element.textureFill && sameFill(element.textureFill, parsed)) : !element.textureFill)) return element;
    const next = { ...element };
    if (next.richText !== undefined) next.richText = clearRichTextureRefs(next.richText);
    delete next.wordTextures;
    if (parsed) next.textureFill = structuredClone(parsed);
    else delete next.textureFill;
    return next;
  }
  if (selection.length === 0) return element;
  const source = sourceFor(element), intervals = selectedIntervals(textTextureWords(element), selection, source.text.length);
  if (!intervals.length) return element;
  const atoms = source.tokens.flatMap(token => "atoms" in token ? token.atoms : []);
  const originallyActive = new Set(atoms.flatMap(atom => atom.textureId ? [atom.textureId] : []));
  const resources = (element.wordTextures ?? []).filter(resource => originallyActive.has(resource.id)).map(resource => ({ ...structuredClone(resource) }));
  const used = new Set(resources.map(resource => resource.id));
  for (const id of originallyActive) if (!used.has(id)) throw new Error("A word texture is missing. Choose its image again.");
  // Do not add wrappers or history entries when the chosen words already have
  // this appearance. This also keeps repeated preview/apply operations bounded.
  const resourceMap = new Map(resources.map(resource => [resource.id, resource]));
  let selectedIndex = 0, changesAppearance = false;
  for (const atom of atoms) {
    while (intervals[selectedIndex] && intervals[selectedIndex].end <= atom.start) selectedIndex++;
    const interval = intervals[selectedIndex];
    if (!interval || interval.start >= atom.end || interval.end <= atom.start) continue;
    const currentFill = atom.textureId ? resourceMap.get(atom.textureId) : element.textureFill;
    if (parsed ? !currentFill || !sameFill(currentFill, parsed) : Boolean(currentFill)) { changesAppearance = true; break; }
  }
  if (!changesAppearance) return element;
  const allocate = (descriptor: ShapeImageFill, requested?: string): string => {
    if (requested !== undefined && !validId(requested)) throw new Error("Use a valid text texture identifier.");
    const reusable = resources.find(resource => sameFill(resource, descriptor));
    if (reusable) return reusable.id;
    const id = requested ?? crypto.randomUUID();
    if (used.has(id)) throw new Error("This text texture identifier already belongs to another image.");
    resources.push({ ...structuredClone(descriptor), id }); used.add(id);
    return id;
  };
  // A whole-layer texture must become explicit refs before local removal, or
  // the cleared word would inherit the old background through the text frame.
  const baseId = element.textureFill ? allocate(element.textureFill, options.baseTextureId) : undefined;
  const nextId = parsed ? allocate(parsed, options.textureId) : undefined;
  const active = new Set<string>();
  const output: string[] = [];
  let intervalIndex = 0;
  for (const token of source.tokens) {
    if ("html" in token) { output.push(token.html); continue; }
    let chunk = "", chunkId: string | undefined;
    const flush = () => {
      if (!chunk) return;
      output.push(chunkId ? `<span data-texture-id="${chunkId}">${chunk}</span>` : chunk);
      if (chunkId) active.add(chunkId);
      chunk = "";
    };
    for (const atom of token.atoms) {
      if (atom.raw === "<br>") { flush(); output.push("<br>"); continue; }
      while (intervals[intervalIndex] && intervals[intervalIndex].end <= atom.start) intervalIndex++;
      const interval = intervals[intervalIndex], selected = interval && interval.start < atom.end && interval.end > atom.start;
      const id = selected ? nextId : atom.textureId ?? baseId;
      if (id !== chunkId) flush();
      chunkId = id; chunk += atom.raw;
    }
    flush();
  }
  const wordTextures = resources.filter(resource => active.has(resource.id));
  if (wordTextures.length > MAX_WORD_TEXTURES) throw new Error("Text supports up to 30 active word textures. Remove or replace one first.");
  const richText = sanitizeRichText(output.join(""));
  if (richText === undefined) throw new Error("This text has too much formatting. Simplify its formatting before adding another texture.");
  const next: TextElement = { ...element, text: source.text, richText };
  delete next.textureFill;
  if (wordTextures.length) next.wordTextures = wordTextures;
  else delete next.wordTextures;
  return next;
}
export const applyTextWordTextureToElement = applyWordTexture;

/** Scene command enforces inherited visibility/locks as well as both content
 * and style protection. One element replacement is one history transaction. */
export function applyTextWordTexture(scene: CanvasScene, elementId: string, selection: TextWordTextureSelection, fill: ShapeImageFill | null, idOrOptions?: string | TextWordTextureOptions): SceneCommandResult {
  const element = scene.elements.find(element => element.id === elementId);
  const selectedIds = element ? [element.id] : [];
  if (!element || element.type !== "text" || isElementHidden(scene, element) || !canEditElement(scene, element, "content") || !canEditElement(scene, element, "style")) return { scene, selectedIds, limited: false };
  const next = applyWordTexture(element, selection, fill, idOrOptions);
  return { scene: next === element ? scene : { ...scene, elements: scene.elements.map(item => item.id === elementId ? next : item) }, selectedIds, limited: false };
}
