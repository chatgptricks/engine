import { parseLibrary, type EditorLibrary } from "./model";
import {unpackAssets} from './library-sync';
import {packAssetsOffThread} from './asset-processing';

export interface RecoveryDraft {
  key: string;
  scope: string;
  library: EditorLibrary;
  /** The confirmed base makes offline recovery a genuine three-way merge. */
  baseline?:EditorLibrary;
  revision: string | null;
  stamp: string;
  updatedAt: number;
}

export class RecoveryMigrationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RecoveryMigrationError";
  }
}

const DATABASE_NAME = "engine-template-editor";
let database: Promise<IDBDatabase> | null = null;

function validDraft(value: unknown): RecoveryDraft | null {
  if (!value || typeof value !== "object") return null;
  const draft = value as RecoveryDraft;
  let decoded:RecoveryDraft;
  try{const stored=draft as RecoveryDraft&{recoveryAssets?:Record<string,string>};decoded=stored.recoveryAssets?unpackAssets(stored,stored.recoveryAssets):draft;}catch{return null;}
  const library = parseLibrary(decoded.library);
  // Pending artwork can remain valid when its baseline is damaged. Treat that
  // record as legacy recovery, never as a confirmed base for automatic merging.
  const {baseline:baselineValue,...data}=decoded;
  const baseline=baselineValue===undefined?null:parseLibrary(baselineValue);
  return library &&
    typeof draft.key === "string" &&
    typeof draft.scope === "string" &&
    typeof draft.stamp === "string" &&
    Number.isFinite(draft.updatedAt) &&
    (draft.revision === null || typeof draft.revision === "string")
    ? { ...data, library, ...(baseline?{baseline}:{}) }
    : null;
}

function sameSnapshot(a: RecoveryDraft, b: RecoveryDraft): boolean {
  return a.scope === b.scope &&
    a.stamp === b.stamp &&
    a.revision === b.revision &&
    a.updatedAt === b.updatedAt &&
    JSON.stringify(a.library) === JSON.stringify(b.library);
}

function transaction<T>(
  db: IDBDatabase,
  mode: IDBTransactionMode,
  operation: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
  return new Promise((resolve, reject) => {
    const tx = db.transaction("drafts", mode);
    const request = operation(tx.objectStore("drafts"));
    tx.oncomplete = () => resolve(request.result);
    tx.onerror = () => reject(tx.error ?? request.error ?? new Error("Browser recovery failed."));
    tx.onabort = () => reject(tx.error ?? new Error("Browser recovery was interrupted."));
  });
}

// Enumeration finds prior editor stores by their stable suffix and schema,
// without retaining any previous product name in the application.
function openExistingDatabase(name: string): Promise<IDBDatabase | null> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(name);
    let vanished = false;
    request.onupgradeneeded = () => {
      // The candidate may have been removed after enumeration. Do not create it.
      vanished = true;
      request.transaction?.abort();
    };
    request.onsuccess = () => {
      const db = request.result;
      db.onversionchange = () => db.close();
      resolve(db);
    };
    request.onerror = () => vanished ? resolve(null) : reject(request.error);
    request.onblocked = () => reject(new Error("Another tab is changing browser recovery storage."));
  });
}

async function copyDraft(db: IDBDatabase, draft: RecoveryDraft): Promise<string> {
  let copiedKey = draft.key;
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction("drafts", "readwrite");
    const store = tx.objectStore("drafts");
    const request = store.get(draft.key);
    request.onsuccess = () => {
      const existing = validDraft(request.result);
      if (existing && !sameSnapshot(existing, draft)) {
        // Divergent edits from two app versions must both survive. The latest
        // snapshot keeps its normal key; the other remains independently recoverable.
        if (existing.updatedAt >= draft.updatedAt) {
          copiedKey = `${draft.key}:migrated:${draft.stamp}`;
        } else {
          store.put({ ...existing, key: `${existing.key}:migrated:${existing.stamp}` });
        }
      }
      store.put({ ...draft, key: copiedKey });
    };
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? request.error);
    tx.onabort = () => reject(tx.error);
  });
  const copied = validDraft(await transaction(db, "readonly", (store) => store.get(copiedKey)));
  if (!copied || !sameSnapshot(copied, draft))
    throw new Error("The copied browser draft could not be verified.");
  return copiedKey;
}

async function removeCopiedDraft(db: IDBDatabase, draft: RecoveryDraft): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction("drafts", "readwrite");
    const store = tx.objectStore("drafts");
    const request = store.get(draft.key);
    request.onsuccess = () => {
      const current = validDraft(request.result);
      if (current && sameSnapshot(current, draft)) store.delete(draft.key);
    };
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? request.error);
    tx.onabort = () => reject(tx.error);
  });
}

function deleteEmptyDatabase(name: string, version: number): Promise<void> {
  return new Promise((resolve, reject) => {
    // Acquire exclusive access before cleanup. A blocked delete request cannot
    // be cancelled and could later erase new edits from an old open tab.
    // A blocked upgrade can instead be aborted when that tab eventually closes.
    const probe = indexedDB.open(name, version + 1);
    let blocked = false;
    let empty = false;
    probe.onblocked = () => { blocked = true; resolve(); };
    probe.onupgradeneeded = () => {
      const tx = probe.transaction;
      if (!tx) return;
      if (blocked || probe.result.objectStoreNames.length !== 1 || !probe.result.objectStoreNames.contains("drafts")) {
        tx.abort();
        return;
      }
      const count = tx.objectStore("drafts").count();
      count.onsuccess = () => {
        empty = count.result === 0;
        if (!empty) tx.abort();
        // Retire the empty store under the exclusive version-change lock.
        // Old version-1 clients cannot reopen it, and a late unversioned
        // opener has no drafts store in which it could add unprotected work.
        else probe.result.deleteObjectStore("drafts");
      };
    };
    probe.onsuccess = () => {
      if (!empty) { probe.result.close(); return resolve(); }
      // Enqueue cleanup before releasing our exclusive connection. Any later
      // opener queues behind deletion rather than writing between close/delete.
      const request = indexedDB.deleteDatabase(name);
      request.onsuccess = () => resolve();
      request.onblocked = () => reject(new Error("Another connection is delaying empty recovery database cleanup. Retry after closing other editor tabs."));
      request.onerror = () => reject(request.error);
      probe.result.close();
    };
    probe.onerror = () => resolve();
  });
}

async function migrateRecoveryDatabases(target: IDBDatabase): Promise<void> {
  if (typeof indexedDB.databases !== "function")
    throw new RecoveryMigrationError(
      "This browser cannot discover pending editor drafts. Update the browser before editing so saved recovery work stays accessible.",
    );
  try {
    const candidates = await indexedDB.databases();
    for (const candidate of candidates) {
      const name = candidate.name;
      if (!name || name === DATABASE_NAME || !name.endsWith("-template-editor")) continue;
      const source = await openExistingDatabase(name);
      if (!source) continue;
      const version = source.version;
      let empty = false;
      try {
        if (!source.objectStoreNames.contains("drafts")) continue;
        const schema = source.transaction("drafts", "readonly").objectStore("drafts");
        if (schema.keyPath !== "key" || !schema.indexNames.contains("scope")) continue;
        // A finishing old tab may change a draft while it is being copied.
        // Retry the latest snapshot; never erase an unverified revision.
        for (let attempt = 0; attempt < 3; attempt++) {
          const values = await transaction(source, "readonly", (store) => store.getAll());
          const drafts = values.flatMap((value) => {
            const draft = validDraft(value);
            return draft ? [draft] : [];
          });
          for (const draft of drafts) {
            await copyDraft(target, draft);
            await removeCopiedDraft(source, draft);
          }
          const remaining = await transaction(source, "readonly", (store) => store.getAll());
          empty = remaining.length === 0;
          if (!remaining.some((value) => validDraft(value))) break;
          if (attempt === 2)
            throw new Error("Another open editor tab is still changing its pending drafts.");
        }
      } finally {
        source.close();
      }
      // Unknown/corrupt records stay in their original database for recovery.
      if (empty) await deleteEmptyDatabase(name, version);
    }
  } catch (cause) {
    throw new RecoveryMigrationError(
      `Pending browser edits could not be migrated. They have been kept; close other editor tabs and retry before editing.${cause instanceof Error ? ` ${cause.message}` : ""}`,
    );
  }
}

function openRecoveryDatabase(): Promise<IDBDatabase> {
  if (database) return database;
  database = new Promise<IDBDatabase>((resolve, reject) => {
    if (!globalThis.indexedDB)
      return reject(new Error("Browser recovery storage is unavailable."));
    const request = indexedDB.open(DATABASE_NAME, 2);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains("drafts")) {
        const store = request.result.createObjectStore("drafts", { keyPath: "key" });
        store.createIndex("scope", "scope");
      }
      if (!request.result.objectStoreNames.contains("workspaces")) request.result.createObjectStore("workspaces", {keyPath: "scope"});
    };
    request.onsuccess = () => {
      const db = request.result;
      db.onversionchange = () => { db.close(); database = null; };
      void migrateRecoveryDatabases(db).then(
        () => resolve(db),
        (error) => { db.close(); reject(error); },
      );
    };
    request.onerror = () => reject(request.error ?? new Error("Browser recovery storage could not open."));
    request.onblocked = () => reject(new Error("Browser recovery storage is blocked by another tab."));
  });
  database.catch(() => { database = null; });
  return database;
}

export async function saveRecoveryDraft(draft: RecoveryDraft): Promise<void> {
  const packed=await packAssetsOffThread(draft);
  await transaction(await openRecoveryDatabase(), "readwrite", (store) => store.put({...packed.value,recoveryAssets:packed.assets}));
}

export async function getRecoveryDrafts(scope: string): Promise<RecoveryDraft[]> {
  const values = await transaction(await openRecoveryDatabase(), "readonly", (store) => store.index("scope").getAll(scope));
  return values.flatMap((value) => {
    const draft = validDraft(value);
    return draft?.scope === scope ? [draft] : [];
  }).sort((a, b) => b.updatedAt - a.updatedAt);
}

// Delete only the exact saved snapshot, including when adopted from another tab.
export async function removeExactDraft(draft: Pick<RecoveryDraft, "key" | "stamp">): Promise<void> {
  const db = await openRecoveryDatabase();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction("drafts", "readwrite");
    const store = tx.objectStore("drafts");
    const request = store.get(draft.key);
    request.onsuccess = () => {
      if ((request.result as RecoveryDraft | undefined)?.stamp === draft.stamp) store.delete(draft.key);
    };
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? request.error);
    tx.onabort = () => reject(tx.error);
  });
}


export interface CachedWorkspace {library: EditorLibrary; revision: string | null; storage: "cloud" | "local"; scope: string; assetKeys?: string[]; updatedAt?: number}
const LAST_WORKSPACE_KEY = "engine-template-editor:last-workspace";
export async function cacheWorkspace(workspace: CachedWorkspace): Promise<void> {
  const db = await openRecoveryDatabase();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction("workspaces", "readwrite");
    tx.objectStore("workspaces").put({...workspace, updatedAt: Date.now()});
    tx.oncomplete = () => resolve(); tx.onerror = () => reject(tx.error); tx.onabort = () => reject(tx.error);
  });
  try { localStorage.setItem(LAST_WORKSPACE_KEY, workspace.scope); } catch { /* The cache remains readable by explicit scope. */ }
}
export async function getCachedWorkspace(trustedScope?: string): Promise<CachedWorkspace | null> {
  // A last-used pointer cannot prove the current account. Scope comes from the
  // authenticated Server Component, or from this tab's confirmed GET response.
  if (!trustedScope || !/^[a-f0-9]{64}$/.test(trustedScope)) return null;
  const scope = trustedScope;
  const db = await openRecoveryDatabase();
  const value = await new Promise<CachedWorkspace | undefined>((resolve, reject) => {
    const tx = db.transaction("workspaces", "readonly"), request = tx.objectStore("workspaces").get(scope);
    tx.oncomplete = () => resolve(request.result); tx.onerror = () => reject(tx.error);
  });
  const library = value && parseLibrary(value.library);
  return value && value.scope === scope && library ? {...value, library} : null;
}
export function clearCachedWorkspaceSelection(): void { try { localStorage.removeItem(LAST_WORKSPACE_KEY); } catch {} }
