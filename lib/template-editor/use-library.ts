"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type SetStateAction,
} from "react";
import { EMPTY_LIBRARY, parseLibrary, type EditorLibrary, type DesignDocument } from "./model";
import type {CollaborationSnapshot} from "./collaboration-types";
import {sameContent, reconcileLibraries, unpackAssets, type LibraryPatch} from "./library-sync";
import {prepareSaveOffThread} from './asset-processing';
import { checkLibrarySaveBudget } from "./library-budget";
import {saveRetryDelay,autosaveDelay} from './save-retry';
import {validateLibraryMutation} from './incremental-validation';
import {
  getRecoveryDrafts,
  cacheWorkspace,
  getCachedWorkspace,
  clearCachedWorkspaceSelection,
  removeExactDraft,
  saveRecoveryDraft,
  RecoveryMigrationError,
  type RecoveryDraft,
} from "./recovery-storage";

export type LibrarySaveStatus =
  | "loading"
  | "saving"
  | "saved"
  | "local"
  | "error"
  | "conflict"
  | "offline";
type Storage = "cloud" | "local";
interface RemoteLibrary {
  library: EditorLibrary;
  revision: string | null;
  storage: Storage;
  scope: string;
  assetKeys?: string[];
}

const ENDPOINT = "/api/template-editor";
function responseError(value: unknown, fallback: string): string {
  return value &&
    typeof value === "object" &&
    "error" in value &&
    typeof value.error === "string"
    ? value.error
    : fallback;
}

function remoteLibrary(value: unknown): RemoteLibrary | null {
  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  if (record.assets !== undefined && (!record.assets || typeof record.assets !== "object" || Array.isArray(record.assets))) return null;
  let library: EditorLibrary | null;
  try {
    library = parseLibrary(record.assets === undefined ? record.library : unpackAssets(record.library, record.assets as Record<string, string>));
  } catch { return null; }
  if (
    !library ||
    !(record.revision === null || typeof record.revision === "string") ||
    (record.storage !== "cloud" && record.storage !== "local") ||
    (typeof record.scope !== "string" || !/^[a-f0-9]{64}$/.test(record.scope))
  )
    return null;
  return {
    library,
    revision: record.revision,
    storage: record.storage,
    scope: record.scope,
    assetKeys: Array.isArray(record.assetKeys) ? record.assetKeys.filter((key): key is string => typeof key === "string") : [],
  };
}

function browserTabId(): string {
  // A duplicated browser tab inherits sessionStorage. A fresh instance ID
  // keeps its recovery writes separate; reload discovers pending scope drafts.
  return crypto.randomUUID();
}

export function useEditorLibrary(expectedScope?: string, options: {preferCached?: boolean} = {}) {
  const trustedScope = useRef(expectedScope ?? "");
  const preferCached = useRef(options.preferCached === true);
  const [library, updateLibrary] = useState<EditorLibrary>(EMPTY_LIBRARY);
  const [workspaceScope, setWorkspaceScope] = useState(expectedScope ?? "");
  const [ready, setReady] = useState(false);
  const [canEdit, setCanEdit] = useState(false);
  const [status, setStatus] = useState<LibrarySaveStatus>("loading");
  const [error, setError] = useState<string | null>(null);
  const [mutationError, setMutationError] = useState<string | null>(null);
  const current = useRef(library);
  const baseline = useRef(library);
  const knownAssets = useRef(new Set<string>());
  const pendingSave = useRef<{id: string; library: EditorLibrary; stamp: string; revision: string | null; patch: LibraryPatch; assets: Record<string, string>; body:string} | null>(null);
  const [syncEpoch, setSyncEpoch] = useState(0);
  const [documentEpochs, setDocumentEpochs] = useState<Record<string, number>>({});
  const bumpChangedDocuments = useCallback((before: EditorLibrary, after: EditorLibrary) => {
    const old = new Map(before.designs.map(item => [item.id, item]));
    const ids = after.designs.filter(item => !sameContent(old.get(item.id), item)).map(item => item.id);
    if (ids.length) setDocumentEpochs(current => ({...current, ...Object.fromEntries(ids.map(id => [id, (current[id] ?? 0) + 1]))}));
  }, []);
  const revision = useRef<string | null>(null);
  const storage = useRef<Storage>("cloud");
  const scope = useRef("");
  const tabId = useRef("");
  const stamp = useRef("");
  const backedUpStamp = useRef("");
  const recovered = useRef<RecoveryDraft | null>(null);
  const dirty = useRef(false);
  const loaded = useRef(false);
  const conflict = useRef(false);
  const mounted = useRef(false);
  const backupFailure = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const retryAttempts=useRef(0),retryAt=useRef(0),autoRetryPaused=useRef(false);
  const retryablePause = useRef(false);
  const inFlight = useRef<Promise<void> | null>(null);
  const backupQueue = useRef<Promise<unknown>>(Promise.resolve());
  const loadController = useRef<AbortController | null>(null);
  const saveRef = useRef<() => Promise<void>>(async () => undefined);
  const loadRef = useRef<(discardPending?: boolean, background?: boolean) => Promise<void>>(async () => undefined);
  const reconnectTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const refreshNeeded = useRef(false);
  const backgroundRead = useRef(false);
  const liveDocumentId = useRef<string | undefined>(undefined);

  const scheduleReconnect = useCallback(function schedule(delay = 10_000) {
    if (reconnectTimer.current) return;
    reconnectTimer.current = setTimeout(() => {
      reconnectTimer.current = null;
      if (!mounted.current || !refreshNeeded.current) return;
      if (!navigator.onLine || conflict.current || inFlight.current) { schedule(); return; }
      if (dirty.current && autoRetryPaused.current) {
        // Exhausted transient saves may resume one request per cooldown. Auth,
        // invalid documents and conflicts still require explicit attention.
        if (!retryablePause.current) return;
        if (retryAt.current > Date.now()) {schedule(Math.max(10_000, retryAt.current - Date.now()));return;}
        autoRetryPaused.current = false;
        retryablePause.current = false;
      }
      if (dirty.current && retryAt.current > Date.now()) {schedule(Math.max(10_000, retryAt.current - Date.now()));return;}
      // A pending edit must go through revision-aware save reconciliation;
      // replacing it with a fresh GET could discard work typed during recovery.
      const operation = dirty.current ? saveRef.current() : loadRef.current(false, true);
      void operation.finally(() => { if (refreshNeeded.current) schedule(); });
    }, delay);
  }, []);

  const persistRecovery = useCallback((): Promise<boolean> => {
    if (!scope.current || !dirty.current) return Promise.resolve(true);
    const draft: RecoveryDraft = {
      key: `${scope.current}:${tabId.current}`,
      scope: scope.current,
      library: current.current,
      baseline:baseline.current,
      revision: revision.current,
      stamp: stamp.current,
      updatedAt: Date.now(),
    };
    const operation = backupQueue.current
      .then(async () => {
        // Rapid typing can enqueue several snapshots while IndexedDB is busy.
        // Only the newest queued edit needs a write, especially with big images.
        if (draft.stamp !== stamp.current) return true;
        await saveRecoveryDraft(draft);
        backedUpStamp.current = draft.stamp;
        backupFailure.current = false;
        return true;
      })
      .catch(() => {
        backupFailure.current = true;
        if (mounted.current && dirty.current) {
          setStatus("error");
          setError(
            "Browser recovery storage is full or unavailable. Keep this tab open until the server saves, or export a JSON backup.",
          );
        }
        return false;
      });
    backupQueue.current = operation;
    return operation;
  }, []);

  const clearSavedRecovery = useCallback(async (savedStamp: string) => {
    const own = { key: `${scope.current}:${tabId.current}`, stamp: savedStamp };
    const adopted = recovered.current;
    const operation = backupQueue.current
      .then(async () => {
        await removeExactDraft(own);
        if (adopted) await removeExactDraft(adopted);
        if (recovered.current === adopted) recovered.current = null;
      })
      .catch(() => undefined); // A stale recovery copy is safe; the server is already durable.
    backupQueue.current = operation;
    await operation;
  }, []);

  const save = useCallback(async () => {
    if (!loaded.current || !dirty.current || conflict.current || autoRetryPaused.current || backgroundRead.current) return;
    if (inFlight.current) return inFlight.current;
    if (typeof navigator !== "undefined" && !navigator.onLine) { setStatus("offline"); return; }
    // Live document operations have their own atomic CRDT persistence. Ordinary
    // workspace autosave still handles templates, brand kits and other designs,
    // but must never replace live artwork with a parallel snapshot writer.
    const ordinary = liveDocumentId.current ? {...current.current, designs: current.current.designs.map(document => document.id === liveDocumentId.current ? baseline.current.designs.find(saved => saved.id === document.id) ?? document : document)} : current.current;
    if (!pendingSave.current && sameContent(ordinary, baseline.current)) return;
    const sentLibrary = pendingSave.current?.library ?? ordinary;
    const sentBaseline = baseline.current;
    const sentAssetKeys = new Set(knownAssets.current);
    const sentStamp = pendingSave.current?.stamp ?? stamp.current;
    const expectedRevision = pendingSave.current?.revision ?? revision.current;
    const operation = (async () => {
      if (mounted.current) {
        setStatus("saving");
        setError(null);
      }
      await persistRecovery();
      let retryable=false,retryAfter:number|undefined;
      try {
        if (!pendingSave.current) {
          const id=crypto.randomUUID(),packed=await prepareSaveOffThread(sentBaseline,sentLibrary,sentAssetKeys,{revision:expectedRevision,operationId:id,expectedScope:scope.current,clientSchema:3});
          pendingSave.current={id,library:sentLibrary,stamp:sentStamp,revision:expectedRevision,patch:packed.value,assets:packed.assets,body:packed.body};
        }
        const request = pendingSave.current;
        const result = await fetch(ENDPOINT, {
          // Allow the serialized server read/write and response to finish
          // before retrying the same idempotent save operation.
          signal: AbortSignal.timeout(120_000),
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body:request.body,
        });
        const data = (await result.json().catch(() => null)) as Record<
          string,
          unknown
        > | null;
        if (!result.ok) {
          retryable=result.status===429||result.status>=500;
          const header=Number(result.headers.get('retry-after'));retryAfter=Number.isFinite(header)?header:undefined;
          if (result.status === 403 && data?.code === "workspace_owner_changed") { conflict.current = true; if (mounted.current) setCanEdit(false); clearCachedWorkspaceSelection(); }
          if (result.status === 409) {
            const remote = remoteLibrary(data?.remote);
            if (remote && remote.scope === scope.current) {
              const localLive = current.current.designs.find(document => document.id === liveDocumentId.current);
              const localOrdinary = localLive ? {...current.current, designs: current.current.designs.map(document => document.id === localLive.id ? baseline.current.designs.find(saved => saved.id === document.id) ?? document : document)} : current.current;
              const merged = reconcileLibraries(baseline.current, localOrdinary, remote.library);
              if (localLive && remote.library.designs.some(document => document.id === localLive.id)) merged.library.designs = merged.library.designs.map(document => document.id === localLive.id ? localLive : document);
              if (!parseLibrary(merged.library) || !checkLibrarySaveBudget(merged.library).ok) {
                conflict.current = true; if (mounted.current) setCanEdit(false);
                throw new Error("Concurrent edits need more workspace space. Download a backup, then load the saved workspace and remove older items before importing your local work.");
              }
              const beforeMerge = current.current;
              baseline.current = remote.library; current.current = merged.library;
              if (mounted.current) bumpChangedDocuments(beforeMerge, merged.library);
              revision.current = remote.revision; storage.current = remote.storage;
              knownAssets.current = new Set(remote.assetKeys); pendingSave.current = null;
              stamp.current = crypto.randomUUID(); dirty.current = !sameContent(merged.library, remote.library);
              conflict.current = false; await persistRecovery();
              if (mounted.current) { updateLibrary(merged.library); setSyncEpoch(value => value + 1); setCanEdit(true); setStatus(dirty.current ? "saving" : "saved"); setMutationError(merged.copies ? `Concurrent edits were kept as ${merged.copies} independent conflict ${merged.copies === 1 ? "copy" : "copies"} in your workspace. You can continue editing.` : "Changes from another tab were merged into your workspace."); }
              await cacheWorkspace(remote).catch(() => undefined);
              return;
            }
            conflict.current = true;
            if (mounted.current) setCanEdit(false);
          }
          if (result.status === 400 || result.status === 413 || result.status === 426) pendingSave.current = null;
          throw new Error(
            responseError(data, "The server could not save this library."),
          );
        }
        if (
          !data ||
          data.scope !== scope.current ||
          typeof data.revision !== "string" ||
          (data.storage !== "cloud" && data.storage !== "local")
        ) {
          if (data?.scope && data.scope !== scope.current) {conflict.current = true; if (mounted.current) setCanEdit(false);}
          throw new Error(
            "The server did not confirm the save. Retry before closing this tab.",
          );
        }
        const remote = parseLibrary(data.library) ?? sentLibrary;
        refreshNeeded.current = false;
        retryablePause.current = false;
        retryAttempts.current=0;retryAt.current=0;autoRetryPaused.current=false;
        const localLive = current.current.designs.find(document => document.id === liveDocumentId.current);
        const localOrdinary = localLive ? {...current.current, designs: current.current.designs.map(document => document.id === localLive.id ? sentLibrary.designs.find(saved => saved.id === document.id) ?? document : document)} : current.current;
        const merged = reconcileLibraries(sentLibrary, localOrdinary, remote).library;
        if (localLive && remote.designs.some(document => document.id === localLive.id)) merged.designs = merged.designs.map(document => document.id === localLive.id ? localLive : document);
        const changedByServer = !sameContent(merged, current.current);
        const beforeMerge = current.current;
        baseline.current = remote; current.current = merged; pendingSave.current = null;
        revision.current = data.revision; storage.current = data.storage;
        if (Array.isArray(data.assetKeys)) knownAssets.current = new Set(data.assetKeys.filter((key): key is string => typeof key === "string"));
        if (changedByServer) { stamp.current = crypto.randomUUID(); if (mounted.current) { updateLibrary(merged); bumpChangedDocuments(beforeMerge, merged); setSyncEpoch(value => value + 1); } }
        dirty.current = !sameContent(current.current, baseline.current);
        await cacheWorkspace({library: remote, revision: revision.current, storage: storage.current, scope: scope.current, assetKeys: [...knownAssets.current]}).catch(() => undefined);
        if (dirty.current) await persistRecovery();
        else await clearSavedRecovery(sentStamp);
        if (mounted.current) {
          setStatus(
            dirty.current
              ? "saving"
              : storage.current === "cloud"
                ? "saved"
                : "local",
          );
          setError(null);
        }
      } catch (cause) {
        const networkFailure=cause instanceof TypeError||cause instanceof DOMException&&['TimeoutError','NetworkError'].includes(cause.name);
        const canRetry = !conflict.current && (retryable || networkFailure) && navigator.onLine;
        const delay=canRetry?saveRetryDelay(retryAttempts.current,Math.random(),retryAfter):null;
        retryablePause.current = delay === null && canRetry;
        autoRetryPaused.current=delay===null&&navigator.onLine;
        retryAt.current=delay===null?(retryablePause.current?Date.now()+Math.max(10_000,Math.min(60_000,Math.max(0,retryAfter??0)*1000)):0):Date.now()+delay;
        if(delay!==null){retryAttempts.current++;if(timer.current)clearTimeout(timer.current);timer.current=setTimeout(()=>void saveRef.current(),delay);}
        if (mounted.current) {
          setStatus(typeof navigator !== "undefined" && !navigator.onLine ? "offline" : conflict.current ? "conflict" : "error");
          const message =
            cause instanceof Error ? cause.message : "Save failed.";
          const recoveryMessage = backupFailure.current
            ? " Browser recovery also failed. Keep this tab open and export a JSON backup."
            : " Your edits are stored in this browser.";
          setError(message + recoveryMessage+(delay!==null?` Retrying automatically (${retryAttempts.current}/5)…`:''));
        }
      }
    })();
    inFlight.current = operation;
    await operation;
    inFlight.current = null;
    // Continue newer edits after a confirmed save. Transient failures have their
    // own bounded retry timer; conflicts require explicit reconciliation.
    if (
      dirty.current &&
      !conflict.current &&
      revision.current !== expectedRevision &&
      mounted.current
    ) {
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => {
        void saveRef.current();
      }, 600);
    }
  }, [clearSavedRecovery, persistRecovery, bumpChangedDocuments]);

  useEffect(() => {
    saveRef.current = save;
  }, [save]);

  const load = useCallback(async (discardPending = false, backgroundRequest = false) => {
    const previousLibrary = current.current;
    const initialRevision = revision.current;
    const background = backgroundRequest && loaded.current && !discardPending;
    const cachedFirst = preferCached.current && !loaded.current && !discardPending;
    backgroundRead.current = background;
    loadController.current?.abort();
    const controller = new AbortController();
    loadController.current = controller;
    if (!background && timer.current) clearTimeout(timer.current);
    if (!background) loaded.current = false;
    retryAttempts.current=0;retryAt.current=0;autoRetryPaused.current=false;retryablePause.current=false;
    if (mounted.current && !background) {
      setCanEdit(false);
      setStatus("loading");
      setError(null);
      setMutationError(null);
    }
    const discardedOwn = {
      key: `${scope.current}:${tabId.current}`,
      stamp: stamp.current,
    };
    const discardedRecovered = recovered.current;
    // A deliberate reload must observe any save already in progress.
    if (inFlight.current) await inFlight.current;
    try {
      let remote: RemoteLibrary | null = null;
      let offline = false;
      if (cachedFirst && trustedScope.current) {
        remote = await getCachedWorkspace(trustedScope.current).catch(cause => {
          if (cause instanceof RecoveryMigrationError) throw cause;
          return null;
        });
        offline = Boolean(remote);
      }
      let retryableLoad = false;
      let rejectedAccess = false;
      try {
        if (!remote) {
          const result = await fetch(`${ENDPOINT}?packed=1`, {cache: "no-store", signal: AbortSignal.any([controller.signal, AbortSignal.timeout(15_000)])});
          retryableLoad = result.status === 429 || result.status >= 500;
          rejectedAccess = result.status === 401 || result.status === 403;
          const body = await result.json().catch(cause => {
            // A 200 response can still lose its connection while its large
            // body is streaming. Keep that retryable instead of treating a
            // cancelled read as a corrupt library and disabling cached edits.
            if (cause instanceof SyntaxError) return null;
            throw cause;
          });
          if (!result.ok) {
            if (result.status === 401) clearCachedWorkspaceSelection();
            throw new Error(responseError(body, "Your library could not be loaded."));
          }
          remote = remoteLibrary(body);
        }
      } catch (cause) {
        if (controller.signal.aborted) return;
        if (rejectedAccess) throw cause;
        const networkFailure = cause instanceof TypeError || cause instanceof DOMException && ["TimeoutError", "NetworkError"].includes(cause.name);
        if (!retryableLoad && !networkFailure && navigator.onLine) throw cause;
        if (background) {
          refreshNeeded.current = true;
          if (mounted.current) {setStatus("offline");setError("Cloud connection is unavailable. Your edits are kept in this browser; reconnecting automatically.");}
          scheduleReconnect();
          return;
        }
        remote = await getCachedWorkspace(trustedScope.current || scope.current); offline = true;
        if (!remote) throw new Error("No offline copy is available in this browser. Connect once to open your workspace.");
      }
      if (!remote)
        throw new Error(
          "The server returned an unreadable library. Your saved work has not been changed.",
        );
      if (controller.signal.aborted) return;
      if (trustedScope.current && remote.scope !== trustedScope.current) { clearCachedWorkspaceSelection(); throw new Error("The signed-in account changed. Reload this page to open the correct workspace. Pending edits remain in the original browser recovery store."); }
      tabId.current ||= browserTabId();
      let draft: RecoveryDraft | undefined;
      try {
        if (discardPending) {
          await backupQueue.current;
          await removeExactDraft(discardedOwn);
          if (discardedRecovered) await removeExactDraft(discardedRecovered);
        } else if (!background) {
          const drafts = await getRecoveryDrafts(remote.scope);
          draft =
            drafts.find(
              (item) => item.key === `${remote.scope}:${tabId.current}`,
            ) ?? drafts[0];
        }
        backupFailure.current = false;
      } catch (cause) {
        if (cause instanceof RecoveryMigrationError) throw cause;
        backupFailure.current = true;
      }
      if (controller.signal.aborted) return;
      if (background && revision.current !== initialRevision) {
        // Live collaboration may acknowledge a newer revision during the GET.
        // Keep that confirmed state and fetch again instead of rolling it back.
        refreshNeeded.current = true;
        scheduleReconnect();
        return;
      }
      if (background && dirty.current) {
        // Snapshot only after every read has finished, so typing while the
        // server was responding is included in the three-way merge below.
        draft = {key: `${scope.current}:${tabId.current}`, scope: scope.current, library: current.current, baseline: baseline.current, revision: revision.current, stamp: stamp.current, updatedAt: Date.now()};
      }
      trustedScope.current = remote.scope;
      scope.current = remote.scope;
      baseline.current = remote.library;
      knownAssets.current = new Set(remote.assetKeys);
      pendingSave.current = null;
      revision.current = remote.revision;
      storage.current = remote.storage;
      refreshNeeded.current = offline;
      // A save can reach the server just before the browser closes. If so,
      // matching content proves the pending recovery copy has already landed.
      if (
        draft &&
        sameContent(draft.library, remote.library)
      ) {
        void removeExactDraft(draft).catch(() => undefined);
        draft = undefined;
      }
      recovered.current = draft ?? null;
      current.current = draft?.library ?? remote.library;
      dirty.current = Boolean(draft);
      stamp.current = draft?.stamp ?? crypto.randomUUID();
      backedUpStamp.current = draft?.stamp ?? "";
      conflict.current = Boolean(draft && draft.revision !== remote.revision);
      if (conflict.current && draft?.baseline) {
        const merged = reconcileLibraries(draft.baseline??EMPTY_LIBRARY, draft.library, remote.library);
        if (parseLibrary(merged.library) && checkLibrarySaveBudget(merged.library).ok) {current.current = merged.library; conflict.current = false;}
      }
      if (draft && conflict.current) revision.current = draft.revision;
      if (draft && !conflict.current) {
        dirty.current = !sameContent(current.current, remote.library);
        if (dirty.current) await persistRecovery();
        // Reconciliation can prove an older draft landed even when the server
        // also contains newer edits. Retire only the adopted snapshot.
        else await clearSavedRecovery(stamp.current);
      }
      if (!offline && baseline.current === remote.library && revision.current === remote.revision) await cacheWorkspace(remote).catch(() => undefined);
      loaded.current = true;
      if (mounted.current) {
        updateLibrary(current.current);
        setWorkspaceScope(remote.scope);
        bumpChangedDocuments(previousLibrary, current.current);
        setCanEdit(!conflict.current);
        setReady(true);
        setStatus(
          offline
            ? "offline"
            : conflict.current
            ? "conflict"
            : dirty.current
              ? "saving"
              : remote.storage === "cloud"
                ? "saved"
                : "local",
        );
        setError(
          conflict.current
            ? "Recovered browser edits differ from the server. Export a JSON backup to keep them, then choose Load saved version before editing."
            : backupFailure.current
              ? "Browser recovery is unavailable. Server saving is available; keep this tab open until edits finish saving."
              : null,
        );
      }
      if (dirty.current && !conflict.current)
        timer.current = setTimeout(() => {
          void saveRef.current();
        }, 600);
      if (offline) scheduleReconnect(250);
    } catch (cause) {
      if (controller.signal.aborted || !mounted.current) return;
      refreshNeeded.current = false;
      if (background) conflict.current = true;
      setReady(true);
      setCanEdit(false);
      setStatus("error");
      setError(
        cause instanceof Error
          ? cause.message
          : "Your library could not be loaded. Retry before editing.",
      );
    } finally {
      if (loadController.current === controller) backgroundRead.current = false;
    }
  }, [bumpChangedDocuments, persistRecovery, clearSavedRecovery, scheduleReconnect]);

  useEffect(() => { loadRef.current = load; }, [load]);

  useEffect(() => {
    mounted.current = true;
    void load();
    return () => {
      mounted.current = false;
      loadController.current?.abort();
      if (timer.current) clearTimeout(timer.current);
      if (reconnectTimer.current) clearTimeout(reconnectTimer.current);
    };
  }, [load]);

  const setLibrary = useCallback(
    (next: SetStateAction<EditorLibrary>): boolean => {
      if (!loaded.current || conflict.current || !mounted.current) return false;
      let value: EditorLibrary;
      try {
        value = typeof next === "function" ? next(current.current) : next;
      } catch (reason) {
        setMutationError(reason instanceof Error ? reason.message : "This change could not be applied. Your current library has been kept.");
        return false;
      }
      if (value === current.current) {
        setMutationError(null);
        return true;
      }
      const parsed = validateLibraryMutation(current.current,value);
      if (!parsed) {setMutationError("This change is not a valid document and was not applied. Check dimensions, layout values, images and document limits."); return false;}
      value = parsed;
      const budget = checkLibrarySaveBudget(value);
      if (!budget.ok) {
        // A rejected edit never touches the library, history, recovery copy,
        // dirty stamp, or scheduled save. Editing remains available for cleanup.
        setMutationError(budget.error);
        return false;
      }
      setMutationError(null);
      current.current = value;
      stamp.current = crypto.randomUUID();
      dirty.current = true;
      updateLibrary(value);
      if (!conflict.current && !autoRetryPaused.current && retryAt.current<=Date.now()) {
        setStatus("saving");
        setError(null);
      }
      void persistRecovery();
      if (timer.current) clearTimeout(timer.current);
      const delay=autosaveDelay(retryAt.current,autoRetryPaused.current);
      if (!conflict.current && delay!==null)
        timer.current = setTimeout(() => {
          void saveRef.current();
        }, delay);
      return true;
    },
    [persistRecovery],
  );

  const retrySave = useCallback(() => {
    retryAttempts.current=0;retryAt.current=0;autoRetryPaused.current=false;retryablePause.current=false;
    if (!loaded.current) {
      void load();
      return;
    }
    if (conflict.current) return;
    if (timer.current) clearTimeout(timer.current);
    void saveRef.current();
  }, [load]);

  const reloadServer = useCallback(() => load(true), [load]);

  const setLiveDocument = useCallback((id: string | undefined) => {
    liveDocumentId.current = id;
    if (dirty.current && !inFlight.current) {if (timer.current) clearTimeout(timer.current); timer.current = setTimeout(() => void saveRef.current(), 600);}
  }, []);

  const receiveLiveDocument = useCallback((saved: DesignDocument, visible: DesignDocument, snapshot: CollaborationSnapshot) => {
    if (!loaded.current || snapshot.scope !== scope.current || saved.id !== visible.id) return;
    const next = {...current.current, designs: current.current.designs.map(document => document.id === visible.id ? visible : document)};
    const parsed = validateLibraryMutation(current.current, next);
    if (!parsed || !checkLibrarySaveBudget(parsed).ok) {setMutationError("Live edits exceed this workspace's limits. Your browser recovery remains available."); return;}
    baseline.current = {...baseline.current, designs: baseline.current.designs.map(document => document.id === saved.id ? saved : document)};
    current.current = parsed;
    revision.current = snapshot.revision; storage.current = snapshot.storage;
    if (snapshot.assetKeys) knownAssets.current = new Set(snapshot.assetKeys);
    // Retrying an old ordinary payload after a live acknowledgment is unsafe.
    // A request already in flight is reconciled when its response arrives.
    if (!inFlight.current) pendingSave.current = null;
    dirty.current = !sameContent(current.current, baseline.current);
    updateLibrary(parsed);
    if (dirty.current) {stamp.current = crypto.randomUUID(); void persistRecovery();}
    else void clearSavedRecovery(stamp.current);
    void cacheWorkspace({library: baseline.current, revision: snapshot.revision, storage: snapshot.storage, scope: scope.current, assetKeys: [...knownAssets.current]}).catch(() => undefined);
    if (mounted.current) {setStatus(dirty.current ? "saving" : snapshot.storage === "cloud" ? "saved" : "local"); setError(null);}
  }, [persistRecovery, clearSavedRecovery]);

  const livePending = useCallback(() => {if (mounted.current) setStatus(navigator.onLine ? "saving" : "offline");}, []);
  const liveError = useCallback((message: string) => {if (mounted.current) {setStatus(navigator.onLine ? "error" : "offline"); setError(message);}}, []);
  const confirmedDocument = useCallback((id: string | undefined) => baseline.current.designs.find(document => document.id === id), []);

  useEffect(() => {
    const flush = () => {
      if (!loaded.current || !dirty.current) return;
      void persistRecovery();
      if (conflict.current || inFlight.current) return;
      // IndexedDB recovery is durable before pagehide; pending document patches
      // resume on load. Never launch a second unacknowledged writer on unload.
    };
    const warnIfUnprotected = (event: BeforeUnloadEvent) => {
      if (dirty.current && backedUpStamp.current !== stamp.current) {
        event.preventDefault();
        event.returnValue = "";
      }
    };
    const resume = (event: PageTransitionEvent) => {
      // A keepalive save can succeed while this page is in the back/forward
      // cache. Refresh its revision before accepting the next edit.
      if (event.persisted) void load();
    };
    const online = () => { retryAttempts.current=0;retryAt.current=0;autoRetryPaused.current=false;retryablePause.current=false;if (dirty.current) void saveRef.current(); else void load(); };
    const offline = () => { if (mounted.current) setStatus("offline"); };
    window.addEventListener("online", online);
    window.addEventListener("offline", offline);
    window.addEventListener("pagehide", flush);
    window.addEventListener("pageshow", resume);
    window.addEventListener("beforeunload", warnIfUnprotected);
    return () => {
      window.removeEventListener("online", online);
      window.removeEventListener("offline", offline);
      window.removeEventListener("pagehide", flush);
      window.removeEventListener("pageshow", resume);
      window.removeEventListener("beforeunload", warnIfUnprotected);
    };
  }, [load, persistRecovery]);

  return {
    library,
    ready,
    canEdit,
    status,
    error: mutationError ?? error,
    setLibrary,
    retrySave,
    reloadServer,
    syncEpoch,
    documentEpochs,
    scope: workspaceScope,
    setLiveDocument,
    receiveLiveDocument,
    livePending,
    liveError,
    confirmedDocument,
  };
}
