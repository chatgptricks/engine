import {createHash} from "node:crypto";
import type {DesignDocument} from "./model";

/** The only artwork fields needed to validate transient awareness. */
export type CollaborationValidationDocument = {
  id: string;
  pages: readonly {id: string; canvas?: {elements: readonly {id: string}[]}}[];
  masterScene?: {elements: readonly {id: string}[]};
  continuousCanvas?: {elements: readonly {id: string}[]};
};
export type CollaborationMetadata = {
  document: CollaborationValidationDocument;
  epoch: string;
  version: number;
  scope: string;
  revision: string | null;
};
const CACHE = Symbol.for("engine.template-editor.collaboration.metadata");
const MAX_ENTRIES = 32, IDLE_TTL_MS = 60_000;
type Entry = {expiresAt: number; metadata: CollaborationMetadata};
function cache(): Map<string, Entry> {
  const shared = globalThis as typeof globalThis & {[CACHE]?: Map<string, Entry>};
  return shared[CACHE] ??= new Map();
}
const key = (owner: string, id: string) => createHash("sha256").update(`${owner}\0${id}`).digest("hex");
function prune(entries: Map<string, Entry>, now: number) {
  for (const [id, entry] of entries) if (entry.expiresAt <= now) entries.delete(id);
  while (entries.size > MAX_ENTRIES) entries.delete(entries.keys().next().value!);
}

/** Copy IDs explicitly; never retain documents, images, CRDT or library refs. */
export function rememberCollaborationMetadata(owner: string, saved: Omit<CollaborationMetadata, "document"> & {document: DesignDocument}): CollaborationMetadata {
  const scene = (value: {elements: readonly {id: string}[]}) => ({elements: value.elements.map(element => ({id: element.id}))});
  const metadata: CollaborationMetadata = {
    epoch: saved.epoch, version: saved.version, scope: saved.scope, revision: saved.revision,
    document: {
      id: saved.document.id,
      pages: saved.document.pages.map(page => ({id: page.id, ...(page.canvas ? {canvas: scene(page.canvas)} : {})})),
      ...(saved.document.masterScene ? {masterScene: scene(saved.document.masterScene)} : {}),
      ...(saved.document.continuousCanvas ? {continuousCanvas: scene(saved.document.continuousCanvas)} : {}),
    },
  };
  const entries = cache(), id = key(owner, saved.document.id), now = Date.now();
  entries.delete(id); entries.set(id, {metadata, expiresAt: now + IDLE_TTL_MS}); prune(entries, now);
  return metadata;
}

/** Call with a freshly read database revision. Matching it is the authority;
 * browser resume parameters alone can never authenticate cached metadata. */
export function readCollaborationMetadata(owner: string, documentId: string, currentRevision: string | null): CollaborationMetadata | null {
  const entries = cache(), now = Date.now(), id = key(owner, documentId);
  prune(entries, now);
  const entry = entries.get(id);
  if (!entry) return null;
  if (entry.metadata.revision !== currentRevision) {entries.delete(id); return null;}
  // Sliding expiry is safe only after the database revision was checked.
  entries.delete(id); entries.set(id, {...entry, expiresAt: now + IDLE_TTL_MS});
  return entry.metadata;
}
