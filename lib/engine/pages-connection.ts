export const PAGES_SESSION_KEY = "engine-pages-session";
export const PAGES_BINDING_KEY = "engine-pages-workspace";
const CONFIG_KEY = "engine-pages-connection";
type BrowserStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;

export interface PagesConnection {
  backend: string;
  supabaseUrl: string;
  supabaseKey: string;
  local: boolean;
}
export interface PagesWorkspaceBinding {
  backend: string;
  supabaseUrl: string;
  userId: string;
  scope: string;
}

function origin(value: unknown, local = false): string | null {
  if (typeof value !== "string") return null;
  try {
    const url = new URL(value);
    if (url.username || url.password || url.search || url.hash || !["", "/"].includes(url.pathname)) return null;
    return url.protocol === "https:" || local && url.protocol === "http:" && ["localhost", "127.0.0.1"].includes(url.hostname) ? url.origin : null;
  } catch { return null; }
}
export function parsePagesConnection(value: unknown, expectedBackend: string): PagesConnection | null {
  if (!value || typeof value !== "object") return null;
  const data = value as Record<string, unknown>;
  const backend = origin(data.backend, true), expected = origin(expectedBackend, true);
  if (!backend || backend !== expected) return null;
  if (data.local === true && ["localhost", "127.0.0.1"].includes(new URL(backend).hostname)) return {backend, supabaseUrl: "", supabaseKey: "", local: true};
  const supabaseUrl = origin(data.supabaseUrl);
  return supabaseUrl && typeof data.supabaseKey === "string" && data.supabaseKey.length > 0 && data.supabaseKey.length < 10000 ? {backend, supabaseUrl, supabaseKey: data.supabaseKey, local: false} : null;
}
function readJson(storage: BrowserStorage, key: string): unknown {
  try { return JSON.parse(storage.getItem(key) ?? "null"); } catch { return null; }
}
/** Local account selection only. Cloud requests still require verified JWTs. */
export function storedPagesUser(storage: BrowserStorage): string | null {
  const session = readJson(storage, PAGES_SESSION_KEY) as {user?: {id?: unknown}; access_token?: unknown; refresh_token?: unknown} | null;
  return session && typeof session.access_token === "string" && session.access_token.length > 0 && typeof session.refresh_token === "string" && session.refresh_token.length > 0 && typeof session.user?.id === "string" && session.user.id.length > 0 && session.user.id.length < 200 ? session.user.id : null;
}
/** Online SDK identity remains usable when browser persistence is disabled. */
export function pagesIdentityMatches(storage: BrowserStorage, expectedUser: string, currentUser: string | null): boolean {
  const persisted = storedPagesUser(storage);
  return persisted === null ? currentUser === expectedUser : persisted === expectedUser;
}
export function createPagesTransferGuard() {
  let generation = 0;
  return {
    invalidate() { generation++; },
    begin() { const selected = ++generation; return () => selected === generation; },
  };
}
/** A cancelled transfer cannot continue writing drafts for the previous user. */
export async function restorePagesDrafts<T>(drafts: readonly T[], current: () => boolean, restore: (draft: T) => Promise<void>): Promise<boolean> {
  for (const draft of drafts) {
    if (!current()) return false;
    await restore(draft);
  }
  return current();
}
export function cachedPagesBinding(storage: BrowserStorage, connection: PagesConnection): PagesWorkspaceBinding | null {
  const value = readJson(storage, PAGES_BINDING_KEY) as Partial<PagesWorkspaceBinding> | null;
  const userId = storedPagesUser(storage);
  return userId && value && value.backend === connection.backend && value.supabaseUrl === connection.supabaseUrl && value.userId === userId && typeof value.scope === "string" && /^[a-f0-9]{64}$/.test(value.scope) ? value as PagesWorkspaceBinding : null;
}
/** Call only after the backend confirms this user's authenticated scope. */
export function rememberPagesBinding(storage: BrowserStorage, connection: PagesConnection, userId: string, scope: string): boolean {
  if (!userId || storedPagesUser(storage) !== userId || !/^[a-f0-9]{64}$/.test(scope)) return false;
  try { storage.setItem(PAGES_BINDING_KEY, JSON.stringify({backend: connection.backend, supabaseUrl: connection.supabaseUrl, userId, scope})); return true; } catch { return false; }
}
export function forgetPagesBinding(storage: BrowserStorage): void { try { storage.removeItem(PAGES_BINDING_KEY); } catch {} }
export function cachedPagesConnection(storage: BrowserStorage, backend: string): PagesConnection | null { return parsePagesConnection(readJson(storage, CONFIG_KEY), backend); }
export function rememberPagesConnection(storage: BrowserStorage, connection: PagesConnection): void { try { storage.setItem(CONFIG_KEY, JSON.stringify(connection)); } catch {} }

export async function connectionDeadline<T>(operation: Promise<T>, milliseconds: number, message = "The connection is taking too long. Retrying automatically."): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try { return await Promise.race([operation, new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error(message)), milliseconds); })]); }
  finally { if (timer) clearTimeout(timer); }
}

/** Release the SDK auth lock when a network request stalls. */
export function createPagesAuthFetch(lifetime?: AbortSignal): typeof fetch {
  return (input, init) => {
    const supplied = init?.signal ?? (input instanceof Request ? input.signal : null);
    const signals = [AbortSignal.timeout(10_000)];
    if (supplied) signals.push(supplied);
    if (lifetime) signals.push(lifetime);
    const signal = AbortSignal.any(signals);
    signal.throwIfAborted();
    return fetch(input, {...init, signal}).then(response => { signal.throwIfAborted(); return response; });
  };
}
