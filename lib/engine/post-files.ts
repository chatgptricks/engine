import {createHash, randomUUID} from "node:crypto";
import {promises as fs} from "node:fs";
import path from "node:path";
import {getAdminSupabase} from "@/lib/supabase/admin";
import {developmentDirectory} from "@/lib/template-editor/development-storage";

/**
 * The post file: one saved record per Recreate run, shared by every agent on
 * the team. Each stage (source, research, verdict, brief, headline, approval,
 * design, review) writes its output here, so a run can stop or pause at the
 * check, pause at the human checkpoint, resume after a server restart, rerun
 * one stage, or let an outside agent do a stage itself. People see a short
 * summary on the deck; agents read the file.
 *
 * Version 2 is the current team. Version-1 files, from the first team, still
 * open until they expire, but only to be looked at: no action runs on them.
 *
 * Stored per workspace owner in gf_client_state as one row per post under
 * `post-file:<owner>:<id>` (never `template-editor:`), or as local JSON files
 * in development, with a revision check on every write.
 */

/** The version new post files are written in. */
export const POST_FILE_VERSION = 2;
/** Every stage of a run, in order. A full recreation runs them all; an exact copy runs source, research (a quick check), verdict, design and review. */
export const POST_STAGES = ["source", "research", "verdict", "brief", "headline", "approval", "design", "review"] as const;
export type PostStage = typeof POST_STAGES[number];
/**
 * The first team's stages. Version-1 files record these, and the first team's
 * modules still use their names until the cleanup step deletes them.
 */
export const LEGACY_STAGES = ["transcript", "brief", "facts", "data", "reactions", "visuals", "outline", "hooks", "approval", "copy", "charts", "images", "deck", "review"] as const;
export type LegacyStage = typeof LEGACY_STAGES[number];
/** A stage of either version, as a post file records it. */
export type StageName = PostStage | LegacyStage;
export type StageStatus = "pending" | "running" | "done" | "error" | "skipped";
export type StageActor = "engine" | "agent" | "human";
export type StageRecord = {
  status: StageStatus;
  output?: unknown;
  error?: string;
  startedAt?: string;
  finishedAt?: string;
  by?: StageActor;
  model?: string;
  usage?: {inputTokens: number; outputTokens: number};
  /** Fix rounds after a critic review (0 for the first pass). */
  round?: number;
  /** Extra instructions for a rerun, from a person or an agent. */
  instructions?: string;
  /** Set each time the stage starts, so a result from a run that was superseded is dropped. */
  attempt?: string;
};
/** checkpoint and autopilot run the full team (checkpoint pauses for a person's approval); exact rebuilds the post as it is. */
export type PostMode = "checkpoint" | "autopilot" | "exact";
/** `stopped`: the check found the story shouldn't be made (fabricated, untraceable, stale or saturated), so there is no deck. */
export type PostStatus = "running" | "paused" | "done" | "error" | "stopped";
/** What a paused run waits for: a person's answer to the check, or their approval of the plan. */
export type PostWaiting = "verdict" | "approval";
export type PostSource = {
  url?: string; caption: string; owner?: string; notes: string; slideCount: number; imageIds: string[];
  /** Links to posts on X the person added for the reaction slides (https://x.com/i/status/<id>). */
  xPosts?: string[];
  /** The story's original (the first post or article), added by a person when research couldn't find it. */
  originUrl?: string;
};
export type PostFile = {
  id: string;
  /** 2 for the current team; 1 for the first team's runs, which open read-only. */
  version: 1 | 2;
  profileId: string;
  mode: PostMode;
  status: PostStatus;
  /** Set while the run is paused. */
  waiting?: PostWaiting;
  message: string;
  source: PostSource;
  stages: Partial<Record<StageName, StageRecord>>;
  history: {at: string; stage: StageName | "run"; event: string; by: StageActor}[];
  deckId?: string;
  createdAt: string;
  updatedAt: string;
  expiresAt: string;
  revision: string;
};

export class PostFileError extends Error {
  constructor(message: string, public status = 400) { super(message); }
}
class RevisionChanged extends Error {}

const TTL_DAYS = 30, MAX_BYTES = 1_500_000, MAX_HISTORY = 200, CLOUD_TIMEOUT_MS = 15_000;
const ID = /^post-[0-9a-f-]{36}$/;
export const isPostFileId = (value: unknown): value is string => typeof value === "string" && ID.test(value);
const rowKey = (ownerKey: string, id: string) => `post-file:${ownerKey}:${id}`;
const directory = () => path.join(developmentDirectory("template-editor"), "post-files");
const filename = (ownerKey: string, id: string) => `${createHash("sha256").update(rowKey(ownerKey, id)).digest("hex")}.json`;
const unavailable = () => new PostFileError("The post's working file is unavailable right now. Retry shortly.", 503);

function checkedOwner(ownerKey: string): string {
  if (typeof ownerKey !== "string" || !ownerKey || ownerKey.length > 300) throw new PostFileError("A workspace owner is required.", 401);
  return ownerKey;
}
function assertDevelopmentStorage() {
  if (process.env.NODE_ENV === "production") throw new PostFileError("Cloud storage is not configured. The post's working file was not saved.", 503);
}
function decode(value: unknown): PostFile | null {
  if (value === null || value === undefined) return null;
  const file = value as PostFile;
  if (typeof file !== "object" || (file.version !== 1 && file.version !== POST_FILE_VERSION) || !isPostFileId(file.id) || typeof file.revision !== "string" || typeof file.stages !== "object") {
    throw new PostFileError("The post's working file could not be read. It has not been changed.", 503);
  }
  return Date.parse(file.expiresAt) < Date.now() ? null : file;
}
function encode(file: PostFile): PostFile {
  const size = Buffer.byteLength(JSON.stringify(file));
  if (size > MAX_BYTES) throw new PostFileError(`The post's working file is too large (${Math.round(size / 1000)} KB). Shorten the research or rerun with fewer slides.`, 413);
  return file;
}

async function readRecord(ownerKey: string, id: string): Promise<PostFile | null> {
  const db = getAdminSupabase();
  if (db) {
    const {data, error} = await db.from("gf_client_state").select("data").eq("owner", rowKey(ownerKey, id)).abortSignal(AbortSignal.timeout(CLOUD_TIMEOUT_MS)).maybeSingle();
    if (error) throw unavailable();
    return decode(data?.data);
  }
  assertDevelopmentStorage();
  try {
    return decode(JSON.parse(await fs.readFile(path.join(directory(), filename(ownerKey, id)), "utf8")));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    if (error instanceof PostFileError) throw error;
    throw new PostFileError("The post's working file could not be read. It has not been changed.", 503);
  }
}

async function writeRecord(ownerKey: string, next: PostFile, expectedRevision: string | null): Promise<void> {
  const db = getAdminSupabase();
  if (db) {
    const owner = rowKey(ownerKey, next.id), updated_at = next.updatedAt, signal = AbortSignal.timeout(CLOUD_TIMEOUT_MS);
    if (expectedRevision === null) {
      const {error} = await db.from("gf_client_state").insert({owner, data: next, updated_at}).abortSignal(signal);
      if (error?.code === "23505") throw new RevisionChanged();
      if (error) throw unavailable();
      return;
    }
    const {data, error} = await db.from("gf_client_state").update({data: next, updated_at}).eq("owner", owner).eq("data->>revision", expectedRevision).select("owner").abortSignal(signal).maybeSingle();
    if (error) throw unavailable();
    if (!data) throw new RevisionChanged();
    return;
  }
  assertDevelopmentStorage();
  await fs.mkdir(directory(), {recursive: true, mode: 0o700});
  const destination = path.join(directory(), filename(ownerKey, next.id));
  if (expectedRevision !== null) {
    const current = await readRecord(ownerKey, next.id);
    if (current?.revision !== expectedRevision) throw new RevisionChanged();
  }
  const temporary = `${destination}.${randomUUID()}.tmp`;
  try {
    await fs.writeFile(temporary, JSON.stringify(next), {encoding: "utf8", mode: 0o600});
    await fs.rename(temporary, destination);
  } finally {
    await fs.unlink(temporary).catch(() => undefined);
  }
}

let fileLock: Promise<unknown> = Promise.resolve();
function withFileLock<T>(operation: () => Promise<T>): Promise<T> {
  if (getAdminSupabase()) return operation();
  const run = fileLock.then(operation, operation);
  fileLock = run.then(() => undefined, () => undefined);
  return run;
}

export async function createPostFile(ownerKey: string, init: {profileId: string; mode: PostMode; source: PostSource}): Promise<PostFile> {
  checkedOwner(ownerKey);
  const now = new Date().toISOString();
  const file: PostFile = {
    id: `post-${randomUUID()}`, version: POST_FILE_VERSION, profileId: init.profileId, mode: init.mode, status: "running", message: "Starting",
    source: init.source, stages: {}, history: [{at: now, stage: "run", event: `Started in ${init.mode} mode`, by: "engine"}],
    createdAt: now, updatedAt: now, expiresAt: new Date(Date.now() + TTL_DAYS * 864e5).toISOString(), revision: randomUUID(),
  };
  await withFileLock(() => writeRecord(ownerKey, encode(file), null));
  return file;
}

export async function getPostFile(ownerKey: string, id: string): Promise<PostFile | null> {
  checkedOwner(ownerKey);
  if (!isPostFileId(id)) return null;
  return readRecord(ownerKey, id);
}

/**
 * Read-modify-write with a revision check; retried when another writer (a
 * parallel stage, a person approving, an agent submitting) got there first.
 * `change` may run more than once, so it must only edit the file it's given.
 */
export async function updatePostFile(ownerKey: string, id: string, change: (file: PostFile) => void): Promise<PostFile> {
  checkedOwner(ownerKey);
  for (let attempt = 0; attempt < 6; attempt++) {
    try {
      return await withFileLock(async () => {
        const current = await readRecord(ownerKey, id);
        if (!current) throw new PostFileError("That post's working file doesn't exist or has expired.", 404);
        const next: PostFile = structuredClone(current);
        change(next);
        next.history = next.history.slice(-MAX_HISTORY);
        next.updatedAt = new Date().toISOString();
        next.revision = randomUUID();
        await writeRecord(ownerKey, encode(next), current.revision);
        return next;
      });
    } catch (error) {
      if (!(error instanceof RevisionChanged)) throw error;
      await new Promise(resolve => setTimeout(resolve, 40 * (attempt + 1)));
    }
  }
  throw new PostFileError("The post's working file is busy. Retry in a moment.", 409);
}

/** Records a stage's state and appends it to the history in one write. */
export function setStage(file: PostFile, stage: PostStage, record: Partial<StageRecord> & {status: StageStatus}, by: StageActor = "engine", event?: string): void {
  const now = new Date().toISOString(), previous = file.stages[stage];
  file.stages[stage] = {
    ...previous, ...record,
    ...(record.status === "running" ? {startedAt: now, finishedAt: undefined, error: undefined} : {}),
    ...(record.status === "done" || record.status === "error" || record.status === "skipped" ? {finishedAt: now} : {}),
    by,
  };
  file.history.push({at: now, stage, event: event ?? record.status, by});
}

/** True for a file the current team can act on; a version-1 file only opens to be looked at. */
export const isCurrentPostFile = (file: PostFile) => file.version === POST_FILE_VERSION;

/**
 * What each stage of a full recreation reads. A stage must rerun when one it
 * reads changes. A stage that reads the verdict also waits for it to say
 * proceed (or for a person to answer it so); the orchestrator holds that gate.
 */
export const STAGE_INPUTS: Record<PostStage, PostStage[]> = {
  source: [], research: ["source"], verdict: ["research"],
  brief: ["source", "research", "verdict"], headline: ["source", "research", "brief"], approval: ["brief", "headline"],
  design: ["source", "research", "brief", "approval"], review: ["source", "brief", "design"],
};
/** An exact copy: the original read slide by slide, a quick check of where it comes from, the gate, then the design and its check. */
export const EXACT_STAGES: PostStage[] = ["source", "research", "verdict", "design", "review"];
const EXACT_INPUTS: Partial<Record<PostStage, PostStage[]>> = {
  source: [], research: ["source"], verdict: ["research"], design: ["source", "verdict"], review: ["source", "design"],
};

/** The stages a run in this mode goes through, in order. */
export function stagesFor(mode: PostMode): PostStage[] {
  return mode === "exact" ? [...EXACT_STAGES] : [...POST_STAGES];
}
/** What a stage reads in this mode. */
export function inputsOf(stage: PostStage, mode: PostMode): PostStage[] {
  return mode === "exact" ? EXACT_INPUTS[stage] ?? [] : STAGE_INPUTS[stage] ?? [];
}
/** Stages that must rerun when one changes: everything that read its output, in this mode (a full recreation by default). */
export function downstreamOf(stage: PostStage, mode: PostMode = "autopilot"): PostStage[] {
  const stages = stagesFor(mode), result = new Set<PostStage>();
  const visit = (current: PostStage) => {
    for (const candidate of stages) if (inputsOf(candidate, mode).includes(current) && !result.has(candidate)) { result.add(candidate); visit(candidate); }
  };
  visit(stage);
  return stages.filter(candidate => result.has(candidate));
}

/** A version-1 run's stages, in order, for showing its file. */
export function legacyStagesFor(mode: PostMode): LegacyStage[] {
  return mode === "exact" ? ["transcript", "data", "deck", "review"] : LEGACY_STAGES.filter(stage => stage !== "transcript");
}
