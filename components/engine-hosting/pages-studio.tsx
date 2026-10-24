"use client";

import {useEffect, useRef, useState} from "react";
import {createClient, type SupabaseClient} from "@supabase/supabase-js";
import Studio from "@/components/template-editor/studio";
import {saveRecoveryDraft, type RecoveryDraft} from "@/lib/template-editor/recovery-storage";
import {parseLibrary} from "@/lib/template-editor/model";
import {createSessionTokenReader} from "@/lib/engine/session-token";
import {cachedPagesBinding, cachedPagesConnection, connectionDeadline, createPagesAuthFetch, createPagesTransferGuard, forgetPagesBinding, pagesIdentityMatches, parsePagesConnection, PAGES_SESSION_KEY, rememberPagesBinding, rememberPagesConnection, restorePagesDrafts, storedPagesUser, type PagesConnection} from "@/lib/engine/pages-connection";
import styles from "./pages-studio.module.css";

const backend = process.env.NEXT_PUBLIC_ENGINE_API_URL ?? "";
const base = process.env.NEXT_PUBLIC_ENGINE_BASE_PATH ?? "/engine";

export function PagesStudio() {
  const [scope, setScope] = useState<string | null>(null);
  const [userId, setUserId] = useState("");
  const [ready, setReady] = useState(false);
  const [needsSignIn, setNeedsSignIn] = useState(false);
  const [error, setError] = useState("");
  const auth = useRef<SupabaseClient | null>(null);
  const popup = useRef<Window | null>(null), signInState = useRef("");
  const retry = useRef<() => void>(() => undefined);

  useEffect(() => {
    let active = true, workerReady = false, authInitialized = false, connecting = false, booting = false, handoff = false;
    let currentUser: string | null = null, generation = 0;
    let connection: PagesConnection | null = null, stopAuth: (() => void) | undefined;
    let retryTimer: ReturnType<typeof setTimeout> | undefined;
    let handoffRetry: (() => Promise<void>) | null = null;
    const transferGuard = createPagesTransferGuard();
    let authLifetime: AbortController | null = null;
    const lifetime = new AbortController();
    const storage = {
      getItem(key: string) { try { return localStorage.getItem(key); } catch { return null; } },
      setItem(key: string, value: string) { localStorage.setItem(key, value); },
      removeItem(key: string) { localStorage.removeItem(key); },
    };
    const token = createSessionTokenReader(() => auth.current);
    const message = (cause: unknown) => cause instanceof Error ? cause.message : "The cloud connection is unavailable. Retrying automatically.";
    const cancelRetry = () => { if (retryTimer) clearTimeout(retryTimer); retryTimer = undefined; };
    const scheduleRetry = () => {
      if (!active || retryTimer) return;
      retryTimer = setTimeout(() => { retryTimer = undefined; retry.current(); }, 10_000);
    };
    const retireAuth = () => {
      // Retire the whole client's request lifetime. Its internal refresh
      // retries must never inherit the next account's fresh abort signal.
      authLifetime?.abort(); authLifetime = null;
      stopAuth?.(); stopAuth = undefined;
      const client = auth.current; auth.current = null; authInitialized = false;
      if (client) void client.auth.stopAutoRefresh().catch(() => undefined);
    };
    const requireSignIn = () => {
      generation++; currentUser = null;
      handoffRetry = null;
      transferGuard.invalidate();
      forgetPagesBinding(storage);
      if (active) { setScope(null); setUserId(""); setNeedsSignIn(true); setReady(workerReady); setError(""); }
      cancelRetry();
    };
    const selectUser = (id: string) => {
      if (currentUser === id) return;
      if (!handoff) { handoffRetry = null; transferGuard.invalidate(); }
      generation++; currentUser = id; forgetPagesBinding(storage);
      if (active) { setScope(null); setUserId(id); setNeedsSignIn(false); }
    };
    const workerMessage = (event: MessageEvent) => {
      if (event.source !== navigator.serviceWorker.controller || event.data?.type !== "engine-api-token" || !event.ports[0]) return;
      // A slow SDK initialization is retryable, rather than a signed-out 401.
      if (!authInitialized) { event.ports[0].postMessage({error: true}); return; }
      void connectionDeadline(token(event.data.refresh === true), 8000)
        .then(value => event.ports[0].postMessage({token: value}))
        .catch(() => event.ports[0].postMessage({error: true}));
    };
    const resolveScope = async (publish = true): Promise<string | null> => {
      if (!connection || !workerReady) throw Error("The workspace connection is still starting.");
      let accessToken: string | null = null;
      let identity = "local";
      const startingGeneration = generation;
      if (auth.current) {
        const result = await connectionDeadline(auth.current.auth.getSession(), 8000);
        if (!active) return null;
        if (result.error) throw result.error;
        authInitialized = true;
        const session = result.data.session;
        if (!session) { requireSignIn(); return null; }
        identity = session.user.id; accessToken = session.access_token;
        // The browser may have switched accounts while SDK refresh was pending.
        const persistedIdentity = storedPagesUser(storage);
        if (persistedIdentity !== null && persistedIdentity !== identity || startingGeneration !== generation && currentUser !== identity) { scheduleRetry(); return null; }
        selectUser(identity);
      }
      const observedGeneration = generation;
      const response = await fetch(`${backend}/api/engine/session`, {
        headers: accessToken ? {Authorization: `Bearer ${accessToken}`} : {},
        cache: "no-store", credentials: "omit", signal: AbortSignal.any([lifetime.signal, AbortSignal.timeout(10_000)]),
      });
      const data = await response.json().catch(() => null);
      if (!active) return null;
      if (generation !== observedGeneration || auth.current && !pagesIdentityMatches(storage, identity, currentUser)) { scheduleRetry(); return null; }
      if (response.status === 401 || response.status === 403) { requireSignIn(); return null; }
      if (!response.ok || typeof data?.scope !== "string" || !/^[a-f0-9]{64}$/.test(data.scope)) throw Error(data?.error ?? "The cloud connection is unavailable. Retrying automatically.");
      if (auth.current) rememberPagesBinding(storage, connection, identity, data.scope);
      if (publish && !handoff) {
        setUserId(identity); setScope(data.scope); setNeedsSignIn(false); setError(""); setReady(true);
      }
      return data.scope;
    };
    const connect = async () => {
      if (!active || connecting || handoff || handoffRetry) return;
      connecting = true;
      try { await resolveScope(); }
      catch (cause) {
        if (active) { setError(message(cause)); setReady(workerReady); scheduleRetry(); }
      } finally { connecting = false; }
    };
    const signedIn = (event: MessageEvent) => {
      if (event.origin !== backend || event.source !== popup.current || event.data?.type !== "engine-sign-in" || event.data?.state !== signInState.current || !signInState.current) return;
      signInState.current = "";
      const {session, drafts} = event.data;
      const transferCurrent = transferGuard.begin();
      let sessionApplied = false;
      const completeHandoff = async () => {
        if (handoff || !active || !transferCurrent()) return;
        handoff = true; setReady(false);
        try {
          if (!auth.current || typeof session?.access_token !== "string" || typeof session?.refresh_token !== "string") throw Error("Sign-in could not be completed.");
          if (!sessionApplied) {
            const result = await connectionDeadline(auth.current.auth.setSession(session), 10_000);
            if (!active || !transferCurrent()) return;
            if (result.error) throw result.error;
            sessionApplied = true;
          }
          authInitialized = true;
          const confirmed = await resolveScope(false);
          if (!confirmed || !transferCurrent()) return;
          const confirmedUser = currentUser, confirmedGeneration = generation;
          const stillSelected = () => active && transferCurrent() && generation === confirmedGeneration && currentUser === confirmedUser && (!auth.current || pagesIdentityMatches(storage, confirmedUser ?? "", currentUser));
          const restored = await restorePagesDrafts(Array.isArray(drafts) ? drafts as RecoveryDraft[] : [], stillSelected, async candidate => {
            const library = parseLibrary(candidate.library), baseline = candidate.baseline ? parseLibrary(candidate.baseline) : undefined;
            if (candidate.scope !== confirmed || !library || typeof candidate.key !== "string" || typeof candidate.stamp !== "string" || !Number.isFinite(candidate.updatedAt)) return;
            await saveRecoveryDraft({...candidate, library, ...(baseline ? {baseline} : {baseline: undefined})});
          });
          // Pending edits arrive before Studio reads this origin's recovery store.
          if (transferCurrent()) handoffRetry = null;
          if (restored && stillSelected()) {
            setScope(confirmed); setUserId(currentUser ?? ""); setNeedsSignIn(false); setError("");
          } else if (active) scheduleRetry();
        } catch (cause) { if (active && transferCurrent()) { setError(message(cause)); scheduleRetry(); } }
        finally { handoff = false; if (active) { setReady(workerReady); if (!transferCurrent()) scheduleRetry(); } }
      };
      // Retain the transfer until every pending draft has reached this origin.
      // Automatic retries must not open Studio around a failed migration.
      handoffRetry = completeHandoff;
      void completeHandoff();
    };
    const ensureWorker = async () => {
      if (!("serviceWorker" in navigator)) throw Error("Use a browser with secure workspace support enabled.");
      const registration = navigator.serviceWorker.register(`${base}/engine-api-worker.js`, {scope: `${base}/`, updateViaCache: "none"});
      // Existing controlled tabs can open their local library during an update.
      if (navigator.serviceWorker.controller) { void registration.catch(() => undefined); return; }
      await connectionDeadline(Promise.all([registration, navigator.serviceWorker.ready]), 12_000, "Workspace support did not start. Retry the connection.");
      if (navigator.serviceWorker.controller) return;
      await new Promise<void>((resolve, reject) => {
        const finish = () => { if (navigator.serviceWorker.controller) { clearTimeout(timer); navigator.serviceWorker.removeEventListener("controllerchange", finish); resolve(); } };
        const timer = setTimeout(() => { navigator.serviceWorker.removeEventListener("controllerchange", finish); reject(Error("Workspace support did not start. Retry the connection.")); }, 5000);
        navigator.serviceWorker.addEventListener("controllerchange", finish); finish();
      });
    };
    const getConnection = async () => {
      // Public static config lets auth initialize without waking the API server.
      try {
        const response = await fetch(`${base}/engine-connection.json`, {cache: "no-cache", signal: AbortSignal.any([lifetime.signal, AbortSignal.timeout(1500)])});
        const config = response.ok ? parsePagesConnection(await response.json(), backend) : null;
        if (config) { rememberPagesConnection(storage, config); return config; }
      } catch { /* An already verified public configuration remains usable offline. */ }
      const cached = cachedPagesConnection(storage, backend);
      if (cached) return cached;
      const response = await fetch(`${backend}/api/engine/config`, {cache: "no-store", credentials: "omit", signal: AbortSignal.any([lifetime.signal, AbortSignal.timeout(8000)])});
      const data = await response.json().catch(() => null);
      const config = response.ok ? parsePagesConnection({...data, backend}, backend) : null;
      if (!config) throw Error(data?.error ?? "The workspace connection is temporarily unavailable. Retrying automatically.");
      rememberPagesConnection(storage, config); return config;
    };
    const bootstrap = async () => {
      if (!active || booting) return;
      booting = true;
      try {
        if (!backend) throw Error("The workspace connection has not been configured.");
        // Worker setup and public configuration are independent of cloud auth.
        const [config] = await Promise.all([connection ? Promise.resolve(connection) : getConnection(), ensureWorker()]);
        if (!active) return;
        connection = config; workerReady = true;
        if (!auth.current && config.supabaseUrl && config.supabaseKey) {
          const binding = cachedPagesBinding(storage, config);
          currentUser = binding?.userId ?? storedPagesUser(storage);
          authLifetime = new AbortController();
          const client = createClient(config.supabaseUrl, config.supabaseKey, {
            auth: {storageKey: PAGES_SESSION_KEY, persistSession: true, autoRefreshToken: true, detectSessionInUrl: false},
            global: {fetch: createPagesAuthFetch(AbortSignal.any([lifetime.signal, authLifetime.signal]))},
          });
          auth.current = client;
          const subscription = client.auth.onAuthStateChange((event, session) => {
            if (!active || auth.current !== client) return;
            if (event === "SIGNED_OUT") {
              requireSignIn(); retireAuth();
              setTimeout(() => { if (active) void bootstrap(); }, 0);
              return;
            }
            if (session?.user.id) {
              authInitialized = true;
              if (session.user.id !== currentUser) selectUser(session.user.id);
              // Supabase holds its auth lock during this callback.
              // Defer SDK calls until the callback has returned.
              setTimeout(() => { if (active) void connect(); }, 0);
            }
          });
          stopAuth = () => subscription.data.subscription.unsubscribe();
          if (binding) { setUserId(binding.userId); setScope(binding.scope); setNeedsSignIn(false); setReady(true); }
        } else if (config.local) { authInitialized = true; currentUser = "local"; }
        setReady(true);
        void connect();
      } catch (cause) { if (active) { setError(message(cause)); setReady(true); scheduleRetry(); } }
      finally { booting = false; }
    };
    retry.current = () => { cancelRetry(); if (handoffRetry) void handoffRetry(); else if (connection && workerReady) void connect(); else void bootstrap(); };
    const storageChanged = (event: StorageEvent) => {
      if (event.key !== PAGES_SESSION_KEY && event.key !== null) return;
      const identity = storedPagesUser(storage);
      if (identity === currentUser) return;
      // External account changes cancel every retry of the previous popup,
      // even while that popup is awaiting auth, scope, or recovery storage.
      handoffRetry = null; transferGuard.invalidate();
      retireAuth();
      if (!identity) requireSignIn();
      else selectUser(identity);
      void bootstrap();
    };
    const online = () => retry.current();
    window.addEventListener("message", signedIn);
    window.addEventListener("storage", storageChanged);
    window.addEventListener("online", online);
    navigator.serviceWorker?.addEventListener("message", workerMessage);
    void bootstrap();
    return () => {
      active = false; lifetime.abort(); cancelRetry(); retireAuth();
      window.removeEventListener("message", signedIn);
      window.removeEventListener("storage", storageChanged);
      window.removeEventListener("online", online);
      navigator.serviceWorker?.removeEventListener("message", workerMessage);
    };
  }, []);

  if (scope && ready) return <Studio key={`${backend}:${userId}:${scope}`} workspaceScope={scope} preferCached/>;
  return <main className={styles.screen}><section className={styles.card} aria-label="Engine workspace connection">
    <h1 className={styles.brand}>Engine</h1>
    <p className={styles.status} role="status">{needsSignIn ? "Sign in to open your designs and templates." : ready ? "Reconnecting to your workspace…" : "Opening your workspace…"}</p>
    {error && <p className={styles.error} role="alert">{error}</p>}
    <div className={styles.actions}>
      {needsSignIn && <button className={`${styles.button} ${styles.primary}`} onClick={() => {
        signInState.current = crypto.randomUUID(); setError("");
        popup.current = window.open(`${backend}/admin/pages-connect?origin=${encodeURIComponent(location.origin)}&state=${signInState.current}`, "engine-sign-in", "popup,width=520,height=720");
        if (!popup.current) setError("Allow the sign-in window, then try again.");
      }}>Sign in</button>}
      <button className={styles.button} onClick={() => { setError(""); retry.current(); }}>Retry connection</button>
    </div>
    <p className={styles.hint}>Your saved browser workspace stays available during temporary cloud interruptions. Reconnection happens automatically.</p>
  </section></main>;
}
