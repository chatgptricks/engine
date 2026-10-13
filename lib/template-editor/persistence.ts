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

export interface StoredLibrary {library: EditorLibrary; revision: string | null; storage: "cloud" | "local"; scope: string; assetKeys?: string[]; reconciled?: boolean}
export interface DocumentHistoryEntry {id: string; createdAt: string; name: string; document: DesignDocument}
interface LibraryEnvelope {library: EditorLibrary; revision: string; assets?: Record<string, string>; operations?: string[]; history?: Record<string, DocumentHistoryEntry[]>}
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
  return {library, revision: candidate.revision, assets, operations: Array.isArray(candidate.operations) ? candidate.operations.filter(id => typeof id === "string") : [], history};
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
async function envelopeFor(current: LibraryEnvelope | null, library: EditorLibrary, operationId?: string): Promise<LibraryEnvelope> {
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
  return {...packed.value, revision: randomUUID(), assets: packed.assets, operations: [...new Set([...(current?.operations ?? []), ...(operationId ? [operationId] : [])])].slice(-100)};
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
      const saved = await saveEditorLibrary(owner, library, record?.revision ?? null, operationId);
      return {...saved, reconciled: (record?.revision ?? null) !== expectedRevision};
    } catch (error) { if (!(error instanceof LibraryConflictError) || attempt === 3) throw error; }
  }
  throw new LibraryConflictError();
}
