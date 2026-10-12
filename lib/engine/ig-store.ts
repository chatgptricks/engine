import { promises as fs } from "fs";
import path from "path";
import { getAdminSupabase } from "@/lib/supabase/admin";

/**
 * Server-side Instagram credentials, one per (owner, channel).
 *
 * Written by /api/instagram/callback after the user logs in to Instagram and
 * grants access; read by the status route (and the future publish flow).
 * Living server-side is what makes a connection ManyChat-like: it works from
 * any device, survives cleared cookies, and the token never reaches the
 * browser.
 *
 * Primary backend: Supabase (gf_ig_credentials, migration 0016). Fallback:
 * the dev file store (.engine-dev/ig-credentials.json) when Supabase isn't
 * configured, mirroring db.ts.
 *
 * NEVER import this into a client component — it handles access tokens.
 */

export interface IgCredential {
  igUserId: string;
  username: string;
  token: string;
  /** ISO timestamp the long-lived token expires (~60 days from issue). */
  expiresAt: string | null;
  updatedAt: string;
}

/** The public (token-free) view, safe to send to the browser. */
export interface IgConnection {
  channelId: string;
  igUserId: string;
  username: string;
  expiresAt: string | null;
}

/* ─── File fallback (dev) ──────────────────────────────────────────────── */

type FileMap = Record<string, IgCredential>; // key: `${owner} ${channelId}`

const FILE_DIR = path.join(process.cwd(), ".engine-dev");
const FILE_PATH = path.join(FILE_DIR, "ig-credentials.json");
const keyOf = (owner: string, channelId: string) => `${owner} ${channelId}`;

let fileLock: Promise<unknown> = Promise.resolve();
function withFileLock<T>(fn: () => Promise<T>): Promise<T> {
  const run = fileLock.then(fn, fn);
  fileLock = run.catch(() => {});
  return run;
}

async function fileRead(): Promise<FileMap> {
  try {
    const parsed = JSON.parse(await fs.readFile(FILE_PATH, "utf8"));
    return parsed && typeof parsed === "object" ? (parsed as FileMap) : {};
  } catch {
    return {};
  }
}

async function fileWrite(map: FileMap): Promise<void> {
  try {
    await fs.mkdir(FILE_DIR, { recursive: true });
    await fs.writeFile(FILE_PATH, JSON.stringify(map), "utf8");
  } catch {
    /* best-effort dev store */
  }
}

/* ─── API ──────────────────────────────────────────────────────────────── */

export async function saveIgCredential(
  owner: string,
  channelId: string,
  cred: Omit<IgCredential, "updatedAt">,
): Promise<boolean> {
  const db = getAdminSupabase();
  const updatedAt = new Date().toISOString();
  if (!db) {
    await withFileLock(async () => {
      const map = await fileRead();
      map[keyOf(owner, channelId)] = { ...cred, updatedAt };
      await fileWrite(map);
    });
    return true;
  }
  const { error } = await db.from("gf_ig_credentials").upsert(
    {
      owner,
      channel_id: channelId,
      ig_user_id: cred.igUserId,
      username: cred.username,
      token: cred.token,
      expires_at: cred.expiresAt,
      updated_at: updatedAt,
    },
    { onConflict: "owner,channel_id" },
  );
  return !error;
}

export async function getIgCredential(
  owner: string,
  channelId: string,
): Promise<IgCredential | null> {
  const db = getAdminSupabase();
  if (!db) {
    const map = await fileRead();
    return map[keyOf(owner, channelId)] ?? null;
  }
  const { data, error } = await db
    .from("gf_ig_credentials")
    .select("ig_user_id, username, token, expires_at, updated_at")
    .eq("owner", owner)
    .eq("channel_id", channelId)
    .maybeSingle();
  if (error || !data) return null;
  return {
    igUserId: String(data.ig_user_id ?? ""),
    username: String(data.username ?? ""),
    token: String(data.token),
    expiresAt: data.expires_at ?? null,
    updatedAt: data.updated_at ?? new Date(0).toISOString(),
  };
}

/** Token-free list of an owner's connections, for the Channels screen. */
export async function listIgConnections(owner: string): Promise<IgConnection[]> {
  const db = getAdminSupabase();
  if (!db) {
    const map = await fileRead();
    return Object.entries(map)
      .filter(([k]) => k.startsWith(`${owner} `))
      .map(([k, c]) => ({
        channelId: k.slice(owner.length + 1),
        igUserId: c.igUserId,
        username: c.username,
        expiresAt: c.expiresAt,
      }));
  }
  const { data, error } = await db
    .from("gf_ig_credentials")
    .select("channel_id, ig_user_id, username, expires_at")
    .eq("owner", owner);
  if (error || !data) return [];
  return data.map((r) => ({
    channelId: String(r.channel_id),
    igUserId: String(r.ig_user_id ?? ""),
    username: String(r.username ?? ""),
    expiresAt: r.expires_at ?? null,
  }));
}

export async function deleteIgCredential(
  owner: string,
  channelId: string,
): Promise<void> {
  const db = getAdminSupabase();
  if (!db) {
    await withFileLock(async () => {
      const map = await fileRead();
      const k = keyOf(owner, channelId);
      if (k in map) {
        delete map[k];
        await fileWrite(map);
      }
    });
    return;
  }
  await db
    .from("gf_ig_credentials")
    .delete()
    .eq("owner", owner)
    .eq("channel_id", channelId);
}

/**
 * Keep a long-lived token alive. Instagram long-lived tokens last ~60 days
 * and can be refreshed once they're older than 24h. Refresh when inside the
 * final 21 days; best-effort (the old token keeps working until it expires).
 */
export async function refreshIgCredentialIfStale(
  owner: string,
  channelId: string,
): Promise<void> {
  const cred = await getIgCredential(owner, channelId);
  if (!cred?.expiresAt) return;
  const msLeft = new Date(cred.expiresAt).getTime() - Date.now();
  if (msLeft > 21 * 24 * 60 * 60 * 1000 || msLeft <= 0) return;
  try {
    const url = new URL("https://graph.instagram.com/refresh_access_token");
    url.searchParams.set("grant_type", "ig_refresh_token");
    url.searchParams.set("access_token", cred.token);
    const res = await fetch(url, { signal: AbortSignal.timeout(15_000) });
    if (!res.ok) return;
    const j = (await res.json()) as { access_token?: string; expires_in?: number };
    if (!j.access_token) return;
    await saveIgCredential(owner, channelId, {
      igUserId: cred.igUserId,
      username: cred.username,
      token: j.access_token,
      expiresAt: new Date(
        Date.now() + (Number(j.expires_in) || 60 * 24 * 60 * 60) * 1000,
      ).toISOString(),
    });
  } catch {
    /* best-effort */
  }
}
