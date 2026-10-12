"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type SetStateAction,
} from "react";
import { EMPTY_LIBRARY, parseLibrary, type EditorLibrary } from "./model";
import {sameContent, createLibraryPatch, packAssets, reconcileLibraries, type LibraryPatch} from "./library-sync";
import { checkLibrarySaveBudget } from "./library-budget";
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
  const library = parseLibrary(record.library);
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

export function useEditorLibrary(expectedScope?: string) {
  const trustedScope = useRef(expectedScope ?? "");
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
  const pendingSave = useRef<{id: string; library: EditorLibrary; stamp: string; revision: string | null; patch: LibraryPatch; assets: Record<string, string>} | null>(null);
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
  const inFlight = useRef<Promise<void> | null>(null);
  const backupQueue = useRef<Promise<unknown>>(Promise.resolve());
  const loadController = useRef<AbortController | null>(null);
  const saveRef = useRef<() => Promise<void>>(async () => undefined);

  const persistRecovery = useCallback((): Promise<boolean> => {
    if (!scope.current || !dirty.current) return Promise.resolve(true);
    const draft: RecoveryDraft = {
      key: `${scope.current}:${tabId.current}`,
      scope: scope.current,
      library: current.current,
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
    if (!loaded.current || !dirty.current || conflict.current) return;
    if (inFlight.current) return inFlight.current;
    if (typeof navigator !== "undefined" && !navigator.onLine) { setStatus("offline"); return; }
    const sentLibrary = pendingSave.current?.library ?? current.current;
    const sentStamp = pendingSave.current?.stamp ?? stamp.current;
    const expectedRevision = pendingSave.current?.revision ?? revision.current;
    const operation = (async () => {
      if (mounted.current) {
        setStatus("saving");
        setError(null);
      }
      await persistRecovery();
      try {
        if (!pendingSave.current) {
          const packed = await packAssets(await createLibraryPatch(baseline.current, sentLibrary), knownAssets.current);
          pendingSave.current = {id: crypto.randomUUID(), library: sentLibrary, stamp: sentStamp, revision: expectedRevision, patch: packed.value, assets: packed.assets};
        }
        const request = pendingSave.current;
        const result = await fetch(ENDPOINT, {
          signal: AbortSignal.timeout(30_000),
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            patch: request.patch,
            assets: request.assets,
            revision: request.revision,
            operationId: request.id,
            expectedScope: scope.current,
            clientSchema: 2,
          }),
        });
        const data = (await result.json().catch(() => null)) as Record<
          string,
          unknown
        > | null;
        if (!result.ok) {
          if (result.status === 403 && data?.code === "workspace_owner_changed") { conflict.current = true; if (mounted.current) setCanEdit(false); clearCachedWorkspaceSelection(); }
          if (result.status === 409) {
            const remote = remoteLibrary(data?.remote);
            if (remote && remote.scope === scope.current) {
              const merged = reconcileLibraries(baseline.current, current.current, remote.library);
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
        const merged = reconcileLibraries(sentLibrary, current.current, remote).library;
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
        if (mounted.current) {
          setStatus(typeof navigator !== "undefined" && !navigator.onLine ? "offline" : conflict.current ? "conflict" : "error");
          const message =
            cause instanceof Error ? cause.message : "Save failed.";
          const recoveryMessage = backupFailure.current
            ? " Browser recovery also failed. Keep this tab open and export a JSON backup."
            : " Your edits are stored in this browser.";
          setError(message + recoveryMessage);
        }
      }
    })();
    inFlight.current = operation;
    await operation;
    inFlight.current = null;
    // Only continue automatically after a confirmed save. Network failures and
    // conflicts require Retry; they never create an unbounded request loop.
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

  const load = useCallback(async (discardPending = false) => {
    const previousLibrary = current.current;
    loadController.current?.abort();
    const controller = new AbortController();
    loadController.current = controller;
    if (timer.current) clearTimeout(timer.current);
    loaded.current = false;
    if (mounted.current) {
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
      try {
        const result = await fetch(ENDPOINT, {cache: "no-store", signal: controller.signal});
        const body = await result.json();
        if (!result.ok) {
          if (result.status === 401) clearCachedWorkspaceSelection();
          throw new Error(responseError(body, "Your library could not be loaded."));
        }
        remote = remoteLibrary(body);
      } catch (cause) {
        if (controller.signal.aborted) return;
        if (!(cause instanceof TypeError) && navigator.onLine) throw cause;
        remote = await getCachedWorkspace(trustedScope.current || scope.current); offline = true;
        if (!remote) throw new Error("No offline copy is available in this browser. Connect once to open your workspace.");
      }
      if (!remote)
        throw new Error(
          "The server returned an unreadable library. Your saved work has not been changed.",
        );
      if (controller.signal.aborted) return;
      if (trustedScope.current && remote.scope !== trustedScope.current) { clearCachedWorkspaceSelection(); throw new Error("The signed-in account changed. Reload this page to open the correct workspace. Pending edits remain in the original browser recovery store."); }
      trustedScope.current = remote.scope;
      scope.current = remote.scope;
      baseline.current = remote.library;
      knownAssets.current = new Set(remote.assetKeys);
      pendingSave.current = null;
      if (!offline) await cacheWorkspace(remote).catch(() => undefined);
      revision.current = remote.revision;
      storage.current = remote.storage;
      tabId.current ||= browserTabId();
      let draft: RecoveryDraft | undefined;
      try {
        if (discardPending) {
          await backupQueue.current;
          await removeExactDraft(discardedOwn);
          if (discardedRecovered) await removeExactDraft(discardedRecovered);
        } else {
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
      // A save can reach the server just before the browser closes. If so,
      // matching content proves the pending recovery copy has already landed.
      if (
        draft &&
        sameContent(draft.library, remote.library)
      ) {
        await removeExactDraft(draft).catch(() => undefined);
        draft = undefined;
      }
      recovered.current = draft ?? null;
      current.current = draft?.library ?? remote.library;
      dirty.current = Boolean(draft);
      stamp.current = draft?.stamp ?? crypto.randomUUID();
      backedUpStamp.current = draft?.stamp ?? "";
      conflict.current = Boolean(draft && draft.revision !== remote.revision);
      if (conflict.current && draft) {
        const merged = reconcileLibraries(EMPTY_LIBRARY, draft.library, remote.library);
        if (parseLibrary(merged.library) && checkLibrarySaveBudget(merged.library).ok) {current.current = merged.library; conflict.current = false;}
      }
      if (draft && conflict.current) revision.current = draft.revision;
      if (draft && !conflict.current) {dirty.current = !sameContent(current.current, remote.library); await persistRecovery();}
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
            : draft
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
      if (draft && !conflict.current)
        timer.current = setTimeout(() => {
          void saveRef.current();
        }, 600);
    } catch (cause) {
      if (controller.signal.aborted || !mounted.current) return;
      setReady(true);
      setCanEdit(false);
      setStatus("error");
      setError(
        cause instanceof Error
          ? cause.message
          : "Your library could not be loaded. Retry before editing.",
      );
    }
  }, [bumpChangedDocuments, persistRecovery]);

  useEffect(() => {
    mounted.current = true;
    void load();
    return () => {
      mounted.current = false;
      loadController.current?.abort();
      if (timer.current) clearTimeout(timer.current);
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
      const parsed = parseLibrary(value);
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
      if (!conflict.current) {
        setStatus("saving");
        setError(null);
      }
      void persistRecovery();
      if (timer.current) clearTimeout(timer.current);
      if (!conflict.current)
        timer.current = setTimeout(() => {
          void saveRef.current();
        }, 600);
      return true;
    },
    [persistRecovery],
  );

  const retrySave = useCallback(() => {
    if (!loaded.current) {
      void load();
      return;
    }
    if (conflict.current) return;
    if (timer.current) clearTimeout(timer.current);
    void saveRef.current();
  }, [load]);

  const reloadServer = useCallback(() => load(true), [load]);

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
    const online = () => { if (dirty.current) void saveRef.current(); else void load(); };
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
  };
}
