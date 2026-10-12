import { promises as fs } from "fs";
import path from "path";
import { getAdminSupabase } from "@/lib/supabase/admin";
import type { Story } from "./types";

/**
 * Server-only story store for the Engine research flows.
 *
 * Primary backend: Supabase (gf_stories / gf_schedule, migration 0014) — used
 * in production so research started from any device lands for every device.
 *
 * Fallback backend: a project-local JSON file (`.engine-dev/stories.json`,
 * gitignored) used whenever the service-role client isn't configured — i.e.
 * local/worktree dev. This gives dev the same reliability property as prod:
 * a research run persists server-side and survives page reloads.
 *
 * NEVER import this into a client component — it pulls the service-role key.
 */

export interface EngineSchedule {
  enabled: boolean;
  intervalMinutes: number;
  lastRunAt: string | null;
}

const DEFAULT_SCHEDULE: EngineSchedule = {
  enabled: false,
  intervalMinutes: 1440,
  lastRunAt: null,
};

// A "researching" row older than this is a run whose function died (deploy,
// crash, killed dev server). Surface it as failed-but-retryable, not a spinner.
const STALE_RESEARCHING_MS = 8 * 60_000;

/**
 * True when a Supabase error means gf_stories has no `owner` column yet
 * (migration 0015 not applied). The owner's flows fall back to the legacy
 * un-partitioned queries so a deploy-before-migrate window never hides
 * stories or breaks research; member flows (which require real isolation)
 * stay unavailable until the migration lands.
 */
function missingOwnerColumn(error: { code?: string; message?: string } | null): boolean {
  if (!error) return false;
  if (error.code === "42703") return true; // undefined_column
  return /column .*owner.* does not exist/i.test(error.message ?? "");
}

/* ─── File fallback (dev) ──────────────────────────────────────────────── */

interface FileRow {
  data: Story;
  status: string;
  created_at: string;
  /** Partition key: 'owner' for the site owner, a member hash otherwise. */
  owner?: string;
}

const FILE_DIR = path.join(process.cwd(), ".engine-dev");
const FILE_PATH = path.join(FILE_DIR, "stories.json");
const STATE_FILE = path.join(FILE_DIR, "client-state.json");

// Serialize file writes so two finishing runs can't clobber each other.
let fileLock: Promise<unknown> = Promise.resolve();
function withFileLock<T>(fn: () => Promise<T>): Promise<T> {
  const run = fileLock.then(fn, fn);
  fileLock = run.catch(() => {});
  return run;
}

async function fileRead(): Promise<Record<string, FileRow>> {
  try {
    const raw = await fs.readFile(FILE_PATH, "utf8");
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object"
      ? (parsed as Record<string, FileRow>)
      : {};
  } catch {
    return {};
  }
}

async function fileWrite(map: Record<string, FileRow>): Promise<void> {
  try {
    await fs.mkdir(FILE_DIR, { recursive: true });
    await fs.writeFile(FILE_PATH, JSON.stringify(map), "utf8");
  } catch {
    /* best-effort dev store */
  }
}

/* ─── Durable client state (designs + created stories + channels) ───────── */

/**
 * The studio's localStorage state, mirrored server-side so a browser wipe
 * (Safari ITP eviction, "clear data", a new device) can't lose the curator's
 * DESIGNS, manually-created stories, channels, or deletes. One JSON blob per
 * owner. Shape is the store's own — kept loose here on purpose (the store
 * owns the contract). Falls back to a dev file when Supabase isn't configured.
 */
export type EngineClientState = Record<string, unknown>;

export async function getClientState(owner = "owner"): Promise<EngineClientState | null> {
  const db = getAdminSupabase();
  if (!db) {
    try {
      const raw = await fs.readFile(STATE_FILE, "utf8");
      const map = JSON.parse(raw) as Record<string, EngineClientState>;
      return map?.[owner] ?? null;
    } catch {
      return null;
    }
  }
  const { data, error } = await db
    .from("gf_client_state")
    .select("data")
    .eq("owner", owner)
    .maybeSingle();
  if (error || !data) return null;
  return (data.data as EngineClientState) ?? null;
}

export async function saveClientState(
  owner: string,
  state: EngineClientState,
): Promise<boolean> {
  const db = getAdminSupabase();
  if (!db) {
    await withFileLock(async () => {
      let map: Record<string, EngineClientState> = {};
      try {
        map = JSON.parse(await fs.readFile(STATE_FILE, "utf8"));
      } catch {
        /* fresh file */
      }
      map[owner] = state;
      await fs.mkdir(FILE_DIR, { recursive: true });
      await fs.writeFile(STATE_FILE, JSON.stringify(map), "utf8");
    });
    return true;
  }
  const { error } = await db
    .from("gf_client_state")
    .upsert(
      { owner, data: state, updated_at: new Date().toISOString() },
      { onConflict: "owner" },
    );
  return !error;
}

/* ─── Schedule (Supabase only — the cron is a production feature) ───────── */

export async function getSchedule(): Promise<EngineSchedule> {
  const db = getAdminSupabase();
  if (!db) return DEFAULT_SCHEDULE;
  const { data, error } = await db
    .from("gf_schedule")
    .select("enabled, interval_minutes, last_run_at")
    .eq("id", 1)
    .maybeSingle();
  if (error || !data) return DEFAULT_SCHEDULE;
  return {
    enabled: Boolean(data.enabled),
    intervalMinutes: Number(data.interval_minutes) || 1440,
    lastRunAt: data.last_run_at ?? null,
  };
}

export async function saveSchedule(
  patch: Partial<Pick<EngineSchedule, "enabled" | "intervalMinutes">>,
): Promise<EngineSchedule | null> {
  const db = getAdminSupabase();
  if (!db) return null;
  const row: Record<string, unknown> = { id: 1, updated_at: new Date().toISOString() };
  if (typeof patch.enabled === "boolean") row.enabled = patch.enabled;
  if (typeof patch.intervalMinutes === "number") {
    // Clamp to a sane band: 1 hour .. 30 days.
    row.interval_minutes = Math.max(60, Math.min(43200, Math.round(patch.intervalMinutes)));
  }
  const { error } = await db.from("gf_schedule").upsert(row, { onConflict: "id" });
  if (error) return null;
  return getSchedule();
}

export async function markScheduleRan(): Promise<void> {
  const db = getAdminSupabase();
  if (!db) return;
  await db
    .from("gf_schedule")
    .upsert({ id: 1, last_run_at: new Date().toISOString() }, { onConflict: "id" });
}

/* ─── Stories ───────────────────────────────────────────────────────────── */

/** A stale "researching" row (its run died) becomes a retryable failed card. */
function presentRow(row: { data: Story; status: string; created_at: string }): Story | null {
  const story = row.data;
  if (!story || !story.id) return null;
  if (row.status === "researching") {
    const t = row.created_at ? new Date(row.created_at).getTime() : 0;
    if (Date.now() - t > STALE_RESEARCHING_MS) {
      return {
        ...story,
        status: "failed",
        error: story.error ?? "Research was interrupted — retry to run it again.",
      };
    }
  }
  return story;
}

/** Newest-first stories the server-side research flows have generated, for
 * one owner partition ('owner' = the site owner; members get an email hash —
 * see lib/engine/member.ts). In-progress "researching" stubs are
 * included (live placeholder); stale ones are surfaced as failed so they're
 * retryable instead of stuck spinning. */
export async function listAutoStories(limit = 100, owner = "owner"): Promise<Story[]> {
  const db = getAdminSupabase();
  if (!db) {
    const map = await fileRead();
    return Object.values(map)
      .filter((row) => (row.owner ?? "owner") === owner)
      .sort((a, b) => +new Date(b.created_at) - +new Date(a.created_at))
      .slice(0, limit)
      .map(presentRow)
      .filter((s): s is Story => Boolean(s));
  }
  let { data, error } = await db
    .from("gf_stories")
    .select("data, status, created_at")
    .eq("owner", owner)
    .order("created_at", { ascending: false })
    .limit(limit);
  if (missingOwnerColumn(error) && owner === "owner") {
    // Pre-migration table: every row belongs to the site owner.
    ({ data, error } = await db
      .from("gf_stories")
      .select("data, status, created_at")
      .order("created_at", { ascending: false })
      .limit(limit));
  }
  if (error || !data) return [];
  return data
    .map((row) => presentRow(row as { data: Story; status: string; created_at: string }))
    .filter((s): s is Story => Boolean(s));
}

/** Titles of recent stories, so the finder can avoid repeating subjects. */
export async function recentStoryTitles(limit = 40, owner = "owner"): Promise<string[]> {
  const stories = await listAutoStories(limit, owner);
  return stories.map((s) => s.title).filter(Boolean);
}

/** Insert-or-reset a placeholder row the moment research starts, so the tool
 * shows a live "Researching" card. Upserts so Retry can reuse the same id. */
export async function upsertResearchingStub(
  story: Story,
  owner = "owner",
): Promise<boolean> {
  const db = getAdminSupabase();
  if (!db) {
    await withFileLock(async () => {
      const map = await fileRead();
      map[story.id] = {
        data: story,
        status: "researching",
        created_at: new Date().toISOString(),
        owner,
      };
      await fileWrite(map);
    });
    return true;
  }
  const row = {
    id: story.id,
    data: story,
    status: "researching",
    source: "auto",
    created_at: new Date().toISOString(),
  };
  const { error } = await db
    .from("gf_stories")
    .upsert({ ...row, owner }, { onConflict: "id" });
  if (missingOwnerColumn(error) && owner === "owner") {
    const retry = await db.from("gf_stories").upsert(row, { onConflict: "id" });
    return !retry.error;
  }
  return !error;
}

/** Fill in a stub once research completes (researching → queue), or record the
 * failure (researching → failed) so the card offers Retry. */
export async function finishStory(
  id: string,
  story: Story,
  owner = "owner",
): Promise<boolean> {
  const db = getAdminSupabase();
  if (!db) {
    await withFileLock(async () => {
      const map = await fileRead();
      if (map[id] && (map[id].owner ?? "owner") !== owner) return;
      map[id] = {
        data: story,
        status: story.status,
        created_at: map[id]?.created_at ?? new Date().toISOString(),
        owner,
      };
      await fileWrite(map);
    });
    return true;
  }
  const { error } = await db
    .from("gf_stories")
    .update({ data: story, status: story.status })
    .eq("id", id)
    .eq("owner", owner);
  if (missingOwnerColumn(error) && owner === "owner") {
    const retry = await db
      .from("gf_stories")
      .update({ data: story, status: story.status })
      .eq("id", id);
    return !retry.error;
  }
  return !error;
}

/** Remove a row (the curator deleted the story). Scoped to the owner so a
 * member can only ever delete their own. */
export async function deleteStory(id: string, owner = "owner"): Promise<void> {
  const db = getAdminSupabase();
  if (!db) {
    await withFileLock(async () => {
      const map = await fileRead();
      if (id in map && (map[id].owner ?? "owner") === owner) {
        delete map[id];
        await fileWrite(map);
      }
    });
    return;
  }
  const { error } = await db
    .from("gf_stories")
    .delete()
    .eq("id", id)
    .eq("owner", owner);
  if (missingOwnerColumn(error) && owner === "owner") {
    await db.from("gf_stories").delete().eq("id", id);
  }
}
