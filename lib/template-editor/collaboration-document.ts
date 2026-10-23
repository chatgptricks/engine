import * as Y from "yjs";
import {sanitizeRichText, richTextToPlain, type DesignDocument} from "./model";

export const COLLABORATION_LOCAL_ORIGIN = "engine-collaboration-local";
export const COLLABORATION_REMOTE_ORIGIN = "engine-collaboration-remote";
const KIND = "__engineKind", ROWS = "__engineRows", ORDER = "__engineOrder", RICH = "__engineRichText";
type RecordValue = Record<string, unknown>;
const object = (value: unknown): value is RecordValue => Boolean(value && typeof value === "object" && !Array.isArray(value));
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
const keyed = (value: unknown): value is RecordValue[] => Array.isArray(value) && value.every(item => object(item) && typeof item.id === "string") && new Set(value.map(item => item.id)).size === value.length;
const textField = (key: string) => ["text", "caption", "name", "label", "publicDescription"].includes(key);
const simpleRich = (value: RecordValue) => typeof value.richText === "string" && !value.richText.replace(/<br\s*\/?\s*>/gi, "").includes("<") && richTextToPlain(value.richText) === value.text;
const plainHtml = (value: string) => value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/\n/g, "<br>");

function shared(value: unknown, key = ""): unknown {
  if (typeof value === "string" && textField(key)) return new Y.Text(value);
  if (Array.isArray(value)) {
    if (keyed(value)) {
      const result = new Y.Map<unknown>(), rows = new Y.Map<unknown>(), order = new Y.Array<string>();
      result.set(KIND, "keyed"); result.set(ROWS, rows); result.set(ORDER, order);
      for (const row of value) rows.set(String(row.id), shared(row));
      order.insert(0, value.map(row => String(row.id)));
      return result;
    }
    return structuredClone(value);
  }
  if (object(value)) {
    const result = new Y.Map<unknown>();
    const rich = value.type === "text" && typeof value.richText === "string";
    if (rich) {
      if (simpleRich(value)) {result.set(RICH, "plain"); result.set("text", shared(value.text, "text"));}
      else result.set(RICH, {text: value.text, richText: sanitizeRichText(value.richText)});
    }
    for (const [field, child] of Object.entries(value)) {
      if (child !== undefined && !(rich && (field === "text" || field === "richText"))) result.set(field, shared(child, field));
    }
    return result;
  }
  return value;
}

/** Plain strings are collaborative text. Rich HTML and its plain mirror are
 * one atomic value: concurrent edits cannot splice tags into invalid HTML. */
function patchMap(target: Y.Map<unknown>, before: RecordValue, next: RecordValue) {
  const richBefore = before.type === "text" && typeof before.richText === "string";
  const richNext = next.type === "text" && typeof next.richText === "string";
  if (richNext) {
    if (simpleRich(next)) {
      const existing = target.get("text");
      if (existing instanceof Y.Text && typeof before.text === "string") {if (before.text !== next.text) patchText(existing, before.text, String(next.text));}
      else target.set("text", shared(next.text, "text"));
      if (target.get(RICH) !== "plain") target.set(RICH, "plain");
    } else {
      if (!richBefore || before.text !== next.text || before.richText !== next.richText) target.set(RICH, {text: next.text, richText: sanitizeRichText(next.richText)});
      target.delete("text");
    }
    target.delete("richText");
  } else if (richBefore) {
    target.delete(RICH);
    target.set("text", shared(next.text, "text"));
  }
  for (const field of new Set([...Object.keys(before), ...Object.keys(next)])) {
    if ((richBefore || richNext) && (field === "text" || field === "richText")) continue;
    if (same(before[field], next[field])) continue;
    if (next[field] === undefined) target.delete(field);
    else patchValue(target, field, before[field], next[field]);
  }
}

function patchText(target: Y.Text, before: string, next: string) {
  let prefix = 0, suffix = 0;
  while (prefix < before.length && prefix < next.length && before[prefix] === next[prefix]) prefix++;
  while (suffix < before.length - prefix && suffix < next.length - prefix && before[before.length - suffix - 1] === next[next.length - suffix - 1]) suffix++;
  // A focused input can still hold its rendered baseline when a remote
  // prefix/suffix edit has already reached Y.Text. Rebase its range instead
  // of indexing into a different-length string or erasing the remote prefix.
  const current = target.toString();
  let sharedPrefix = 0, sharedSuffix = 0;
  while (sharedPrefix < before.length && sharedPrefix < current.length && before[sharedPrefix] === current[sharedPrefix]) sharedPrefix++;
  while (sharedSuffix < before.length - sharedPrefix && sharedSuffix < current.length - sharedPrefix && before[before.length - sharedSuffix - 1] === current[current.length - sharedSuffix - 1]) sharedSuffix++;
  const position = (offset: number) => Math.max(0, Math.min(current.length, offset <= sharedPrefix ? offset : offset >= before.length - sharedSuffix ? offset + current.length - before.length : sharedPrefix + Math.min(offset - sharedPrefix, current.length - sharedPrefix - sharedSuffix)));
  const start = position(prefix), end = position(before.length - suffix);
  if (end > start) target.delete(start, end - start);
  const inserted = next.slice(prefix, next.length - suffix);
  if (inserted) target.insert(start, inserted);
}

function patchRows(target: Y.Map<unknown>, before: RecordValue[], next: RecordValue[]) {
  const rows = target.get(ROWS) as Y.Map<unknown>, order = target.get(ORDER) as Y.Array<string>;
  const previous = new Map(before.map(row => [String(row.id), row])), current = new Map(next.map(row => [String(row.id), row]));
  for (const [id] of previous) if (!current.has(id)) rows.delete(id);
  for (const [id, row] of current) {
    const old = previous.get(id), existing = rows.get(id);
    if (same(old, row)) continue;
    if (old && existing instanceof Y.Map) patchMap(existing, old, row);
    else rows.set(id, shared(row));
  }
  // Apply only the ordering the local user changed. New remote rows remain
  // present even when they weren't in the caller's earlier rendered snapshot.
  const beforeIds = before.map(row => String(row.id)), nextIds = next.map(row => String(row.id));
  if (!same(beforeIds, nextIds)) {
    const removed = new Set(beforeIds.filter(id => !current.has(id)));
    for (let index = order.length - 1; index >= 0; index--) if (removed.has(order.get(index))) order.delete(index, 1);
    for (let index = 0; index < nextIds.length; index++) {
      const id = nextIds[index], present = order.toArray(), localOrder = present.filter(item => current.has(item));
      if (localOrder[index] === id) continue;
      const oldIndex = present.indexOf(id); if (oldIndex >= 0) order.delete(oldIndex, 1);
      const predecessor = index ? order.toArray().lastIndexOf(nextIds[index - 1]) : -1;
      order.insert(predecessor + 1, [id]);
    }
  }
}

function patchValue(target: Y.Map<unknown>, field: string, before: unknown, next: unknown) {
  const existing = target.get(field);
  if (existing instanceof Y.Text && typeof before === "string" && typeof next === "string") patchText(existing, before, next);
  else if (existing instanceof Y.Map && object(before) && object(next) && existing.get(KIND) !== "keyed") patchMap(existing, before, next);
  else if (existing instanceof Y.Map && existing.get(KIND) === "keyed" && keyed(before) && keyed(next)) patchRows(existing, before, next);
  else target.set(field, shared(next, field));
}

function materialize(value: unknown, depth = 0, budget = {nodes: 0, chars: 0, images: new Set<string>()}, field = ""): unknown {
  if (depth > 40 || ++budget.nodes > 150_000) throw new Error("Collaboration document exceeds its structure limit.");
  if (value instanceof Y.Text) {
    const text = value.toString(); budget.chars += text.length;
    if (budget.chars > 30 * 1024 * 1024) throw new Error("Collaboration document exceeds its size limit.");
    return text;
  }
  if (value instanceof Y.Map) {
    if (value.get(KIND) === "keyed") {
      const rows = value.get(ROWS), order = value.get(ORDER);
      if (!(rows instanceof Y.Map) || !(order instanceof Y.Array)) throw new Error("Invalid collaboration collection.");
      if (rows.size > 20_000 || order.length > 40_000) throw new Error("Collaboration collection exceeds its structure limit.");
      const ids = [...new Set([...order.toArray(), ...Array.from(rows.keys()).sort()])];
      if (ids.some(id => typeof id !== "string")) throw new Error("Invalid collaboration order.");
      return ids.filter(id => rows.has(id)).map(id => materialize(rows.get(id), depth + 1, budget));
    }
    const result: RecordValue = {};
    for (const [field, child] of value.entries()) {
      if (["__proto__", "constructor", "prototype"].includes(field)) throw new Error("Invalid collaboration field.");
      if (field === RICH) {
        if (child === "plain") continue;
        if (!object(child) || typeof child.text !== "string" || typeof child.richText !== "string" || sanitizeRichText(child.richText) !== child.richText) throw new Error("Invalid collaborative rich text.");
        result.text = child.text; result.richText = child.richText;
      } else result[field] = materialize(child, depth + 1, budget, field);
    }
    if (value.get(RICH) === "plain") {
      if (typeof result.text !== "string") throw new Error("Invalid collaborative text.");
      result.richText = plainHtml(result.text);
    }
    return result;
  }
  if (value instanceof Y.Array || value instanceof Y.Doc) throw new Error("Invalid collaboration value.");
  if (Array.isArray(value)) return value.map(child => materialize(child, depth + 1, budget));
  if (object(value)) return Object.fromEntries(Object.entries(value).map(([field, child]) => [field, materialize(child, depth + 1, budget, field)]));
  if (typeof value === "string") {
    const image = ["src", "url", "previewSrc"].includes(field) && value.startsWith("data:image/");
    budget.chars += image && budget.images.has(value) ? 79 : value.length;
    if (image) budget.images.add(value);
  }
  if (budget.chars > 30 * 1024 * 1024) throw new Error("Collaboration document exceeds its size limit.");
  return value;
}

export function createCollaborationDocument(document?: DesignDocument): Y.Doc {
  const doc = new Y.Doc();
  if (document) doc.transact(() => {const root = doc.getMap<unknown>("document"); for (const [key, value] of Object.entries(document)) if (value !== undefined) root.set(key, shared(value, key));}, "engine-collaboration-seed");
  return doc;
}
export function readCollaborationDocument(doc: Y.Doc): DesignDocument {
  if (Array.from(doc.share.keys()).some(key => key !== "document")) throw new Error("Invalid collaboration document root.");
  return materialize(doc.getMap("document")) as DesignDocument;
}
export function writeCollaborationDocument(doc: Y.Doc, before: DesignDocument, next: DesignDocument, origin: unknown = COLLABORATION_LOCAL_ORIGIN): void {
  if (before.id !== next.id) throw new Error("A collaboration room cannot change document identity.");
  const rootBefore = {...before} as RecordValue, rootNext = {...next} as RecordValue;
  if (origin === COLLABORATION_LOCAL_ORIGIN) {
    // Document identity and timestamps belong to the durable server snapshot.
    // Capturing a concurrent LWW timestamp in a user's UndoManager can remove
    // the required key when their write wins over a peer's timestamp.
    for (const field of ["id", "createdAt", "updatedAt"]) {delete rootBefore[field]; delete rootNext[field];}
  }
  doc.transact(() => patchMap(doc.getMap("document"), rootBefore, rootNext), origin);
}
export function encodeCollaborationUpdate(update: Uint8Array): string {
  let binary = "";
  for (let offset = 0; offset < update.length; offset += 8192) binary += String.fromCharCode(...update.subarray(offset, offset + 8192));
  return btoa(binary);
}
export function decodeCollaborationUpdate(encoded: string): Uint8Array {
  if (!encoded || encoded.length > 24 * 1024 * 1024 || encoded.length % 4 !== 0 || !/^[A-Za-z0-9+/]*={0,2}$/.test(encoded)) throw new Error("Invalid collaboration update.");
  const binary = atob(encoded), bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index++) bytes[index] = binary.charCodeAt(index);
  return bytes;
}
