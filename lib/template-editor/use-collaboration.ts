"use client";

import {useCallback, useEffect, useLayoutEffect, useRef, useState} from "react";
import * as Y from "yjs";
import {sameDocumentContent} from "./history";
import type {DesignDocument} from "./model";
import {createCollaborationDocument, readCollaborationDocument, writeCollaborationDocument, encodeCollaborationUpdate, decodeCollaborationUpdate, COLLABORATION_LOCAL_ORIGIN, COLLABORATION_REMOTE_ORIGIN} from "./collaboration-document";
import type {CollaborationAwareness, CollaborationSnapshot} from "./collaboration-types";

export type CollaborationConnection = "connecting" | "live" | "reconnecting" | "offline" | "error";
type Options = {
  baselineDocument?: DesignDocument;
  onDocument: (saved: DesignDocument, visible: DesignDocument, snapshot: CollaborationSnapshot) => void;
  onPending: () => void;
  onError: (message: string) => void;
};
type Controls = {submit: (before: DesignDocument, next: DesignDocument) => boolean; awareness: (value: Partial<CollaborationAwareness>) => void; name: (value: string) => void; undo: () => void; redo: () => void};
const ENDPOINT = "/api/template-editor/collaboration";
const EMPTY_AWARENESS: CollaborationAwareness = {selected: [], cursor: null, preview: null};
const NAME_KEY = "engine:collaboration-name";

/** A cookie-authenticated provider. Only local Yjs transactions enter this
 * participant's undo stack; remote transactions never become autosave edits. */
export function useLiveCollaboration(designDocument: DesignDocument | undefined, scope: string, options: Options) {
  const callbacks = useRef(options);
  const latest = useRef(designDocument);
  useLayoutEffect(() => {callbacks.current = options; latest.current = designDocument;}, [options, designDocument]);
  const [currentSession, setCurrentSession] = useState("");
  const controls = useRef<Controls | null>(null);
  const [status, setStatus] = useState<CollaborationConnection>("connecting");
  const [ready, setReady] = useState(false);
  const [snapshot, setSnapshot] = useState<CollaborationSnapshot | null>(null);
  const [stacks, setStacks] = useState({canUndo: false, canRedo: false});
  const [name, setNameState] = useState("");
  const documentId = designDocument?.id;

  useEffect(() => {
    if (!documentId || !scope) return;
    const opened = latest.current!;
    let disposed = false, initialized = false, sending = false, paused = false, epoch = "", version = -1, retry = 0;
    let localName = "";
    try {localName = sessionStorage.getItem(NAME_KEY) ?? "";} catch { /* Collaboration does not depend on browser preferences. */ }
    const sessionId = crypto.randomUUID();
    let sequence = 0, awareness: CollaborationAwareness = {...EMPTY_AWARENESS}, awarenessDirty = true;
    let doc = createCollaborationDocument(), undo: Y.UndoManager | null = null;
    let pending: Uint8Array[] = [], acknowledged: DesignDocument = callbacks.current.baselineDocument ?? opened, source: EventSource | null = null;
    let timer: ReturnType<typeof setTimeout> | undefined, reconnectTimer: ReturnType<typeof setTimeout> | undefined;
    const snapshotRef: {current: CollaborationSnapshot | null} = {current: null};
    const retiredEpochs = new Set<string>();
    const publishStacks = () => {if (!disposed) setStacks({canUndo: Boolean(undo?.undoStack.length), canRedo: Boolean(undo?.redoStack.length)});};
    const publishPending = () => {if (!disposed) callbacks.current.onPending();};
    const schedule = (delay = 70) => {
      if (disposed || paused || timer) return;
      timer = setTimeout(() => {timer = undefined; void send();}, delay);
    };
    const changed = (update: Uint8Array, origin: unknown) => {
      if (origin === COLLABORATION_REMOTE_ORIGIN || !initialized) return;
      pending.push(update); publishPending(); publishStacks(); schedule();
    };
    const observe = () => {
      doc.on("update", changed);
      undo = new Y.UndoManager(doc.getMap("document"), {trackedOrigins: new Set([COLLABORATION_LOCAL_ORIGIN]), captureTimeout: 650});
      undo.on("stack-item-added", publishStacks); undo.on("stack-item-popped", publishStacks); undo.on("stack-item-updated", publishStacks);
    };
    function receive(value: CollaborationSnapshot) {
      if (disposed || value.scope !== scope || value.document?.id !== documentId || typeof value.epoch !== "string" || typeof value.state !== "string") return;
      if (retiredEpochs.has(value.epoch)) return;
      if (epoch === value.epoch && value.version < version) return;
      const local = initialized ? readCollaborationDocument(doc) : latest.current;
      const previousSaved = acknowledged;
      if (epoch && epoch !== value.epoch) {
        retiredEpochs.add(epoch);
        doc.off("update", changed); undo?.destroy(); doc.destroy(); doc = createCollaborationDocument();
        pending = []; initialized = false; version = -1;
      }
      Y.applyUpdate(doc, decodeCollaborationUpdate(value.state), COLLABORATION_REMOTE_ORIGIN);
      epoch = value.epoch; version = value.version;
      if (!initialized) {
        observe(); initialized = true;
        // Changes made while the first connection was opening remain local
        // operations against the server's one atomically seeded document.
        if (local && !sameDocumentContent(previousSaved, local)) writeCollaborationDocument(doc, previousSaved, local);
      }
      acknowledged = value.document;
      snapshotRef.current = value;
      const visible = readCollaborationDocument(doc);
      setSnapshot(value); setReady(true); setStatus(navigator.onLine ? "live" : "offline");
      callbacks.current.onDocument(value.document, visible, value);
      publishStacks(); retry = 0;
      if (pending.length || awarenessDirty) schedule();
    }
    async function send() {
      if (disposed || paused || !initialized || sending || !navigator.onLine || (!pending.length && !awarenessDirty)) return;
      sending = true;
      const batch = pending; pending = [];
      const requestEpoch = epoch;
      const capturedAwareness = awareness;
      awarenessDirty = false;
      const payload = {documentId, expectedScope: scope, sessionId, sequence: ++sequence, epoch, awareness: capturedAwareness, ...(localName ? {name: localName} : {}), ...(batch.length ? {update: encodeCollaborationUpdate(Y.mergeUpdates(batch))} : {})};
      try {
        // A preflight read plus the queued read/write can take over 90 seconds.
        // Keep one request in flight while the server completes that bounded work.
        const response = await fetch(ENDPOINT, {method: "POST", headers: {"Content-Type": "application/json"}, body: JSON.stringify(payload), signal: AbortSignal.timeout(120_000)});
        const data = await response.json();
        // A restored/published document may start a new CRDT generation while
        // this request is in flight. receive() already rebased all local work;
        // late responses and retries must never bring old structs back.
        if (disposed || requestEpoch !== epoch) return;
        if (!response.ok) {
          if (response.status === 409 && data.snapshot) {pending.unshift(...batch); receive(data.snapshot); return;}
          if (response.status < 500 && response.status !== 429) {
            pending.unshift(...batch); source?.close();
            paused = true;
            if (!disposed) {setStatus("error"); callbacks.current.onError(data.error ?? "Collaboration access changed. Your edits remain in browser recovery.");}
            return;
          }
          throw new Error(data.error ?? "Live collaboration could not save. Your edits remain in this browser.");
        }
        receive(data);
      } catch (reason) {
        if (disposed || requestEpoch !== epoch) return;
        pending.unshift(...batch); awarenessDirty = true;
        if (!disposed) {
          setStatus(navigator.onLine ? "reconnecting" : "offline");
          if (++retry >= 5) callbacks.current.onError(reason instanceof Error ? reason.message : "Live collaboration is reconnecting.");
          schedule(Math.min(10_000, 500 * 2 ** Math.min(retry, 4)));
        }
      } finally {
        sending = false;
        if (!disposed && (pending.length || awarenessDirty) && retry === 0) schedule();
      }
    }
    const connect = () => {
      if (disposed || !navigator.onLine) return;
      source?.close();
      const params = new URLSearchParams({documentId, expectedScope: scope, sessionId, ...(localName ? {name: localName} : {})});
      source = new EventSource(`${ENDPOINT}?${params}`);
      const message = (event: MessageEvent) => {
        try {receive(JSON.parse(event.data));} catch (reason) {if (!disposed) callbacks.current.onError(reason instanceof Error ? reason.message : "Invalid collaboration response.");}
      };
      source.addEventListener("snapshot", message); source.addEventListener("update", message);
      source.addEventListener("presence", (event: MessageEvent) => {
        if (disposed) return;
        try {
          const presence = JSON.parse(event.data);
          if (presence.scope === scope && Array.isArray(presence.participants)) setSnapshot(previous => previous ? {...previous, participants: presence.participants, actor: presence.actor ?? previous.actor} : previous);
        } catch { /* The document stream remains the authoritative state. */ }
      });
      source.addEventListener("error", (event: Event) => {
        if (!(event instanceof MessageEvent) || disposed) return;
        try {
          const data = JSON.parse(event.data);
          if (data.code === "unauthorized" || data.code === "forbidden" || data.code === "not_found") {paused = true; source?.close(); setStatus("error");}
          callbacks.current.onError(data.error ?? "Live collaboration needs attention.");
        } catch { /* Network errors are handled by onerror. */ }
      });
      source.addEventListener("access-error", () => {source?.close(); if (!disposed) {setStatus("error"); callbacks.current.onError("Collaboration access changed. Reload to sign in again.");}});
      source.onerror = () => {
        if (disposed || paused) return;
        setStatus(navigator.onLine ? "reconnecting" : "offline");
        // Reopening renews the server-authenticated, bounded stream. The
        // same Y.Doc and unsent operations survive a lost connection.
        source?.close();
        if (reconnectTimer) clearTimeout(reconnectTimer);
        reconnectTimer = setTimeout(connect, 1200);
      };
    };
    const travel = (direction: "undo" | "redo") => {
      if (!initialized || !undo) return;
      undo.stopCapturing(); undo[direction]();
      const visible = readCollaborationDocument(doc);
      if (snapshotRef.current) callbacks.current.onDocument(acknowledged, visible, snapshotRef.current);
      publishStacks();
    };
    controls.current = {
      submit(before, next) {
        if (!initialized || disposed || paused || before.id !== documentId || next.id !== documentId) return false;
        writeCollaborationDocument(doc, before, next); publishStacks(); return true;
      },
      awareness(value) {awareness = {...awareness, ...value}; awarenessDirty = true; schedule(100);},
      name(value) {localName = value.trim().slice(0, 64); awarenessDirty = true; connect(); schedule(0);},
      undo: () => travel("undo"), redo: () => travel("redo"),
    };
    const heartbeat = setInterval(() => {if (documentId && document.visibilityState !== "hidden") {awarenessDirty = true; schedule(0);}}, 4000);
    const online = () => {if (!disposed && !paused) {setStatus("reconnecting"); awarenessDirty = true; retry = 0; connect(); schedule(0);}};
    const offline = () => {if (!disposed) setStatus("offline"); source?.close();};
    const visibility = () => {
      if (document.visibilityState === "hidden") {awareness = {...awareness, cursor: null, preview: null}; awarenessDirty = true; void send();}
      else online();
    };
    const leave = () => {
      if (!initialized) return;
      source?.close();
      const remaining = pending.length ? encodeCollaborationUpdate(Y.mergeUpdates(pending)) : undefined;
      const body = JSON.stringify({documentId, expectedScope: scope, sessionId, sequence: ++sequence, epoch, leave: true, ...(remaining ? {update: remaining} : {})});
      void fetch(ENDPOINT, {method: "POST", headers: {"Content-Type": "application/json"}, body, keepalive: body.length < 60_000}).catch(() => undefined);
      if (body.length >= 60_000) {
        // Browser keepalive requests have a shared 64 KiB budget. Presence
        // must still leave immediately when artwork remains in recovery.
        void fetch(ENDPOINT, {method: "POST", headers: {"Content-Type": "application/json"}, body: JSON.stringify({documentId, expectedScope: scope, sessionId, sequence: ++sequence, epoch, leave: true}), keepalive: true}).catch(() => undefined);
      }
    };
    const pageshow = (event: PageTransitionEvent) => {if (event.persisted) online();};
    queueMicrotask(() => {
      if (disposed) return;
      setCurrentSession(sessionId); setReady(false); setSnapshot(null); setStacks({canUndo: false, canRedo: false}); setNameState(localName); setStatus(navigator.onLine ? "connecting" : "offline");
    });
    connect();
    window.addEventListener("online", online); window.addEventListener("offline", offline); document.addEventListener("visibilitychange", visibility);
    window.addEventListener("pagehide", leave); window.addEventListener("pageshow", pageshow);
    return () => {
      disposed = true; controls.current = null; source?.close(); clearInterval(heartbeat);
      if (timer) clearTimeout(timer); if (reconnectTimer) clearTimeout(reconnectTimer);
      window.removeEventListener("online", online); window.removeEventListener("offline", offline); document.removeEventListener("visibilitychange", visibility);
      window.removeEventListener("pagehide", leave); window.removeEventListener("pageshow", pageshow);
      leave();
      doc.off("update", changed); undo?.destroy(); doc.destroy();
    };
  }, [documentId, scope]);

  const submitDocument = useCallback((before: DesignDocument, next: DesignDocument) => controls.current?.submit(before, next) ?? false, []);
  const setAwareness = useCallback((value: Partial<CollaborationAwareness>) => controls.current?.awareness(value), []);
  const setName = useCallback((value: string) => {
    setNameState(value); try {sessionStorage.setItem(NAME_KEY, value);} catch { /* Optional preference. */ }
    controls.current?.name(value);
  }, []);
  const undo = useCallback(() => controls.current?.undo(), []), redo = useCallback(() => controls.current?.redo(), []);
  const currentSnapshot = snapshot && snapshot.document.id === documentId && snapshot.scope === scope ? snapshot : null;
  return {ready: ready && Boolean(currentSnapshot), status: currentSnapshot ? status : "connecting" as CollaborationConnection, self: {...(currentSnapshot?.actor ?? {id: "self", name: name || "You", color: "#7965e9"}), id: currentSession || "self"}, peers: (currentSnapshot?.participants ?? []).filter(peer => peer.sessionId !== currentSession).map(peer => ({...peer, id: peer.sessionId})), name, setName: currentSnapshot?.actor.canRename ? setName : undefined, setAwareness, submitDocument, history: {...stacks, undo, redo}};
}
