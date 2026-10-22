import {createHash, randomUUID} from "node:crypto";
import {promises as fs} from "node:fs";
import path from "node:path";
import {developmentDirectory,readDevelopmentRecord} from "./development-storage";
import {getAdminSupabase} from "@/lib/supabase/admin";
import {EMPTY_LIBRARY, parseLibrary, type EditorLibrary, type DesignDocument} from "./model";
import {checkLibrarySaveBudget} from "./library-budget";
import {listReviewLinks} from './review-inventory';
import {retainDocumentHistory} from './history-retention';
import {applyLibraryPatch, contentHash, sameContent, LibraryPatchConflict, packAssets, unpackAssets, type LibraryPatch} from "./library-sync";
import * as Y from "yjs";
import {createCollaborationDocument, readCollaborationDocument, writeCollaborationDocument, encodeCollaborationUpdate, decodeCollaborationUpdate} from "./collaboration-document";

export interface StoredLibrary {library: EditorLibrary; revision: string | null; storage: "cloud" | "local"; scope: string; assetKeys?: string[]; reconciled?: boolean}
export interface DocumentHistoryEntry {id: string; createdAt: string; name: string; document: DesignDocument}
type CollaborationState = {state: string; version: number; epoch: string};
interface LibraryEnvelope {library: EditorLibrary; revision: string; assets?: Record<string, string>; operations?: string[]; history?: Record<string, DocumentHistoryEntry[]>; collaborationStates?: Record<string, CollaborationState>}
export type StoredCollaborationDocument = Omit<StoredLibrary, "library"> & CollaborationState & {document: DesignDocument};
export class LibraryConflictError extends Error {
  constructor(public ids: string[] = []) { super("This document changed in another tab or device. Your edits have been kept in this browser."); this.name = "LibraryConflictError"; }
}
const storageKey = (owner: string) => `template-editor:${owner}`;
export const editorOwnerScope = (owner: string) => createHash("sha256").update(storageKey(owner)).digest("hex");
function readEnvelope(value: unknown): LibraryEnvelope {
  if (!value || typeof value !== "object") throw new Error("The saved library could not be read.");
  const candidate = value as LibraryEnvelope;
  const assets = candidate.assets ?? {};
  if (!assets || typeof assets !== "object" || Array.isArray(assets)) throw new Error("Saved assets could not be read.");
  const library = parseLibrary(unpackAssets(candidate.library, assets));
  if (!library || typeof candidate.revision !== "string" || !candidate.revision) throw new Error("The saved library could not be read. It has not been overwritten.");
  const history = candidate.history ? unpackAssets(candidate.history, assets) : {};
  const collaborationStates = candidate.collaborationStates ?? {};
  if (!collaborationStates || typeof collaborationStates !== "object" || Array.isArray(collaborationStates) || Object.keys(collaborationStates).length > 150) throw new Error("Saved collaboration state could not be read.");
  for (const [id, value] of Object.entries(collaborationStates)) if (!library.designs.some(document => document.id === id) || !value || typeof value.state !== "string" || value.state.length > 24 * 1024 * 1024 || !Number.isSafeInteger(value.version) || value.version < 0 || typeof value.epoch !== "string") throw new Error("Saved collaboration state could not be read.");
  return {library, revision: candidate.revision, assets, operations: Array.isArray(candidate.operations) ? candidate.operations.filter(id => typeof id === "string") : [], history, collaborationStates};
}
const FILE_DIRECTORY = developmentDirectory("template-editor");
let fileLock: Promise<unknown> = Promise.resolve();
function withFileLock<T>(fn: () => Promise<T>): Promise<T> { const run = fileLock.then(fn, fn); fileLock = run.catch(() => undefined); return run; }
function assertDevelopmentStorage() { if (process.env.NODE_ENV === "production") throw new Error("Cloud storage is not configured. No changes were saved."); }
async function readFile(scope: string): Promise<LibraryEnvelope | null> {
  return readDevelopmentRecord("template-editor",`${scope}.json`,readEnvelope);
}
async function readRecord(owner: string): Promise<{record: LibraryEnvelope | null; storage: "cloud" | "local"; scope: string}> {
  const scope = editorOwnerScope(owner), db = getAdminSupabase();
  if (!db) { assertDevelopmentStorage(); return {record: await readFile(scope), storage: "local", scope}; }
  const {data, error} = await db.from("gf_client_state").select("data").eq("owner", storageKey(owner)).maybeSingle();
  if (error) throw new Error("Cloud storage is unavailable. Your saved library has not been changed.");
  return {record: data ? readEnvelope(data.data) : null, storage: "cloud", scope};
}
function stored(record: LibraryEnvelope | null, storage: "cloud" | "local", scope: string): StoredLibrary {
  return {library: record?.library ?? EMPTY_LIBRARY, revision: record?.revision ?? null, storage, scope, assetKeys: Object.keys(record?.assets ?? {})};
}
export async function getEditorLibrary(owner: string): Promise<StoredLibrary> {
 const state=await readRecord(owner),value=stored(state.record,state.storage,state.scope),links=await listReviewLinks(owner);
 value.library={...value.library,designs:value.library.designs.map(doc=>{const documentLinks=links.filter(link=>link.documentId===doc.id),owned=documentLinks.filter(link=>!link.revokedAt&&Date.parse(link.expiresAt)>Date.now()).map(({id,url,expiresAt})=>({id,url,expiresAt}));return {...doc,reviewLinks:documentLinks.length?owned:doc.reviewLinks};})};return value;
}
export async function getDocumentHistory(owner: string, documentId: string): Promise<DocumentHistoryEntry[]> {
  const {record} = await readRecord(owner);
  // Owner is always supplied by the authenticated route, never by the browser.
  return record?.history?.[documentId] ?? [];
}
async function envelopeFor(current: LibraryEnvelope | null, library: EditorLibrary, operationId?: string, collaboration?: {documentId: string; value: CollaborationState}): Promise<LibraryEnvelope> {
  // Schema-2 clients from before the built-in catalog controls omit this
  // collection in whole-library saves. Omission leaves current choices intact;
  // explicit catalog decisions remain available to current clients.
  const savedLibrary = library.builtInTemplateStates === undefined && current?.library.builtInTemplateStates !== undefined
    ? {...library,builtInTemplateStates:structuredClone(current.library.builtInTemplateStates)}
    : library;
  const history = structuredClone(current?.history ?? {}), now = Date.now();
  for (const before of current?.library.designs ?? []) {
    const after = savedLibrary.designs.find(item => item.id === before.id);
    if (sameContent(before, after)) continue;
    const entries = history[before.id] ?? [];
    // Preserve a baseline then a checkpoint at most every 30 seconds. Named
    // versions in the document itself remain independent and are never sampled.
    if (!entries.length || now - Date.parse(entries[0].createdAt) >= 30_000 || !after || before.deletedAt !== after.deletedAt) {
      history[before.id] = [{id: randomUUID(), createdAt: new Date(now).toISOString(), name: before.name, document: before}, ...entries].slice(0, 30);
    }
  }
  // Prune history for permanently removed documents after retaining their latest
  // checkpoints for recovery; cap the total history to a practical shared budget.
  const retained=retainDocumentHistory(history,new Set(savedLibrary.designs.map(doc=>doc.id)),now);
  const packed = await packAssets({library:savedLibrary, history:retained});
  const collaborationStates: Record<string, CollaborationState> = {};
  for (const [id, state] of Object.entries(current?.collaborationStates ?? {})) {
    const before = current?.library.designs.find(document => document.id === id), after = savedLibrary.designs.find(document => document.id === id);
    // Ordinary saves invalidate the old room generation. Reconnecting clients
    // receive a new epoch instead of merging incompatible independently seeded roots.
    if (after && sameContent(before, after)) collaborationStates[id] = state;
  }
  if (collaboration) collaborationStates[collaboration.documentId] = collaboration.value;
  return {...packed.value, revision: randomUUID(), assets: packed.assets, operations: [...new Set([...(current?.operations ?? []), ...(operationId ? [operationId] : [])])].slice(-100), collaborationStates};
}
async function writeFile(scope: string, envelope: LibraryEnvelope) {
  await fs.mkdir(FILE_DIRECTORY, {recursive: true, mode: 0o700});
  const temporary = path.join(FILE_DIRECTORY, `${scope}.${randomUUID()}.tmp`);
  try { await fs.writeFile(temporary, JSON.stringify(envelope), {encoding: "utf8", mode: 0o600}); await fs.rename(temporary, path.join(FILE_DIRECTORY, `${scope}.json`)); }
  finally { await fs.unlink(temporary).catch(() => undefined); }
}
async function writeCloud(owner: string, envelope: LibraryEnvelope, expectedRevision: string | null) {
  const db = getAdminSupabase(); if (!db) throw new Error("Cloud storage is not configured.");
  const row = {owner: storageKey(owner), data: envelope, updated_at: new Date().toISOString()};
  if (expectedRevision === null) {
    const {error} = await db.from("gf_client_state").insert(row);
    if (error?.code === "23505") throw new LibraryConflictError(); if (error) throw new Error("Cloud save failed. Please retry.");
  } else {
    const {data, error} = await db.from("gf_client_state").update({data: envelope, updated_at: row.updated_at}).eq("owner", row.owner).eq("data->>revision", expectedRevision).select("owner").maybeSingle();
    if (error) throw new Error("Cloud save failed. Please retry."); if (!data) throw new LibraryConflictError();
  }
}
export async function saveEditorLibrary(owner: string, library: EditorLibrary, expectedRevision: string | null, operationId?: string): Promise<StoredLibrary> {
  if (!getAdminSupabase()) {
    assertDevelopmentStorage(); const scope = editorOwnerScope(owner);
    return withFileLock(async () => {
      const current = await readFile(scope);
      if (operationId && current?.operations?.includes(operationId)) return stored(current, "local", scope);
      if ((current?.revision ?? null) !== expectedRevision) throw new LibraryConflictError();
      const envelope = await envelopeFor(current, library, operationId); await writeFile(scope, envelope);
      return stored(readEnvelope(envelope), "local", scope);
    });
  }
  const {record, scope} = await readRecord(owner);
  if (operationId && record?.operations?.includes(operationId)) return stored(record, "cloud", scope);
  if ((record?.revision ?? null) !== expectedRevision) throw new LibraryConflictError();
  const envelope = await envelopeFor(record, library, operationId); await writeCloud(owner, envelope, expectedRevision);
  return stored(readEnvelope(envelope), "cloud", scope);
}
/** Atomically rebase independent document edits onto the latest workspace. */
export async function saveEditorPatch(owner: string, packedPatch: LibraryPatch, newAssets: Record<string, string>, expectedRevision: string | null, operationId: string): Promise<StoredLibrary> {
  if (!newAssets || typeof newAssets !== "object" || Array.isArray(newAssets)) throw new Error("Invalid assets.");
  for (const [key, asset] of Object.entries(newAssets)) if (!/^[a-f0-9]{64}$/.test(key) || typeof asset !== "string" || !/^data:image\//.test(asset) || await contentHash(asset) !== key) throw new Error("Invalid embedded asset.");
  for (let attempt = 0; attempt < 4; attempt++) {
    const {record, storage, scope} = await readRecord(owner);
    if (record?.operations?.includes(operationId)) return {...stored(record, storage, scope), reconciled: true};
    let library: EditorLibrary;
    try {
      const patch = unpackAssets(packedPatch, {...record?.assets, ...newAssets});
      const changed = await applyLibraryPatch(record?.library ?? EMPTY_LIBRARY, patch);
      const parsed = parseLibrary(changed); if (!parsed) throw new Error("Invalid document changes or workspace limit exceeded."); const budget = checkLibrarySaveBudget(parsed); if (!budget.ok) throw new Error(budget.error); library = parsed;
    } catch (error) { if (error instanceof LibraryPatchConflict) throw new LibraryConflictError(error.ids); if (error instanceof Error && /embedded asset is missing/.test(error.message)) throw new LibraryConflictError(["assets"]); throw error; }
    try {
      // The cloud write already compares the exact revision read above. Reuse
      // that envelope instead of reading and expanding the entire workspace a
      // second time; a racing save still retries through the CAS failure below.
      let saved: StoredLibrary;
      if (storage === "cloud") {
        const envelope = await envelopeFor(record, library, operationId);
        await writeCloud(owner, envelope, record?.revision ?? null);
        saved = stored(readEnvelope(envelope), storage, scope);
      } else {
        saved = await saveEditorLibrary(owner, library, record?.revision ?? null, operationId);
      }
      return {...saved, reconciled: (record?.revision ?? null) !== expectedRevision};
    } catch (error) { if (!(error instanceof LibraryConflictError) || attempt === 3) throw error; }
  }
  throw new LibraryConflictError();
}

function collaborationStored(record: LibraryEnvelope, documentId: string, storage: "cloud" | "local", scope: string): StoredCollaborationDocument {
  const document = record.library.designs.find(item => item.id === documentId && !item.deletedAt), state = record.collaborationStates?.[documentId];
  if (!document || !state) throw new Error("This document is not available in the signed-in workspace.");
  return {revision: record.revision, storage, scope, assetKeys: Object.keys(record.assets ?? {}), ...state, document};
}

async function collaborationOperation(owner: string, documentId: string, update?: string, expectedEpoch?: string): Promise<StoredCollaborationDocument> {
  const decoded = update === undefined ? undefined : decodeCollaborationUpdate(update);
  const run = async () => {
    for (let attempt = 0; attempt < 8; attempt++) {
      const {record, storage, scope} = await readRecord(owner);
      const before = record?.library.designs.find(document => document.id === documentId && !document.deletedAt);
      if (!record || !before) throw new Error("This document is not available in the signed-in workspace.");
      const cached = record.collaborationStates?.[documentId];
      if (cached && expectedEpoch !== undefined && expectedEpoch !== cached.epoch) throw new Error("The live document generation changed. Reconnect before sending edits.");
      if (!cached && decoded) throw new Error("The live document generation changed. Reconnect before sending edits.");
      if (cached && !decoded) return collaborationStored(record, documentId, storage, scope);
      const doc = createCollaborationDocument();
      try {
        if (cached) Y.applyUpdate(doc, decodeCollaborationUpdate(cached.state));
        else {
          const seed = createCollaborationDocument(before);
          try {Y.applyUpdate(doc, Y.encodeStateAsUpdate(seed));} finally {seed.destroy();}
        }
        if (decoded) Y.applyUpdate(doc, decoded, "engine-collaboration-server");
        const raw = readCollaborationDocument(doc);
        if (raw.id !== documentId) throw new Error("A collaboration room cannot change document identity.");
        const contentChanged = !sameContent({...before, updatedAt: undefined}, {...raw, createdAt: before.createdAt, updatedAt: undefined});
        const canonical = {...raw, createdAt: before.createdAt, updatedAt: contentChanged ? new Date().toISOString() : before.updatedAt};
        const candidate = {...record.library, designs: record.library.designs.map(document => document.id === documentId ? canonical : document)};
        const parsed = parseLibrary(candidate);
        if (!parsed) throw new Error("Invalid collaboration document or workspace limit exceeded.");
        const budget = checkLibrarySaveBudget(parsed);
        if (!budget.ok) throw new Error(budget.error);
        const document = parsed.designs.find(item => item.id === documentId)!;
        if (!sameContent(raw, document)) writeCollaborationDocument(doc, raw, document, "engine-collaboration-normalize");
        const state = encodeCollaborationUpdate(Y.encodeStateAsUpdate(doc));
        if (state.length > 24 * 1024 * 1024) throw new Error("Live collaboration exceeds its document size limit.");
        if (cached && state === cached.state) return collaborationStored(record, documentId, storage, scope);
        const value = {state, version: (cached?.version ?? 0) + 1, epoch: cached?.epoch ?? randomUUID()};
        const envelope = await envelopeFor(record, parsed, undefined, {documentId, value});
        try {
          if (storage === "local") await writeFile(scope, envelope); else await writeCloud(owner, envelope, record.revision);
          return collaborationStored(readEnvelope(envelope), documentId, storage, scope);
        } catch (error) {if (!(error instanceof LibraryConflictError) || attempt === 7) throw error;}
      } finally {doc.destroy();}
    }
    throw new LibraryConflictError([documentId]);
  };
  return getAdminSupabase() ? run() : withFileLock(run);
}

/** First readers atomically create the room's one shared CRDT baseline. Both
 * CRDT state and materialized artwork are committed in the same CAS envelope. */
export async function getCollaborationDocument(owner: string, documentId: string): Promise<StoredCollaborationDocument> {
  return collaborationOperation(owner, documentId);
}
/** Poll only the small revision projection; artwork is fetched when it changes. */
export async function getCollaborationRevision(owner: string): Promise<string | null> {
  const db = getAdminSupabase();
  if (!db) {assertDevelopmentStorage(); return (await readFile(editorOwnerScope(owner)))?.revision ?? null;}
  const {data, error} = await db.from("gf_client_state").select("revision:data->>revision").eq("owner", storageKey(owner)).maybeSingle();
  if (error) throw new Error("Live collaboration storage is unavailable.");
  return data?.revision ?? null;
}
export async function saveCollaborationDocument(owner: string, documentId: string, update: string, expectedEpoch: string): Promise<StoredCollaborationDocument> {
  if (typeof expectedEpoch !== "string" || !/^[a-f0-9-]{36}$/i.test(expectedEpoch)) throw new Error("Reload the live document before sending edits.");
  return collaborationOperation(owner, documentId, update, expectedEpoch);
}
