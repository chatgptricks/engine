import {createHash, randomUUID} from "node:crypto";
import {promises as fs} from "node:fs";
import path from "node:path";
import type Anthropic from "@anthropic-ai/sdk";
import {getAdminSupabase} from "@/lib/supabase/admin";
import {developmentDirectory} from "@/lib/template-editor/development-storage";

/**
 * Chat threads for the Engine assistant. A post's thread belongs to its deck
 * and is shared by everyone in the workspace, like comments; each person also
 * has a home thread for work that isn't on one post yet, such as starting a
 * recreation. A thread keeps two records:
 * - `messages`: what people see, with who said what and the cards.
 * - `conversation`: Claude's own messages. They are only ever added to, so
 *   Claude's earlier reasoning stays valid; a long conversation starts over
 *   from a summary while the messages people see stay whole.
 *
 * Stored per workspace owner in gf_client_state as one row per thread under
 * `assistant-thread:<owner>:<scope>` (never `template-editor:`), or as local
 * JSON files in development, with a revision check on every write.
 */

export type ThreadScope = {kind: "deck"; deckId: string} | {kind: "home"; personId: string};
export type ChatPerson = {id: string; name: string; color: string};
export type ChatPhoto = {url: string; description?: string; width?: number; height?: number; sourceUrl?: string};
export type ChatCard =
  /** A Recreate run; the panel follows it and shows the checkpoint and the result. */
  | {type: "run"; jobId: string; postId: string; mode: string; profileId: string; label: string}
  /** Photos to choose from; a tap places one on `target`. */
  | {type: "photos"; search: string; photos: ChatPhoto[]; target?: {pageId: string; elementId: string}}
  /** Hook options to read. Choosing one is a person's decision, never saved from here. */
  | {type: "hooks"; options: {text: string; note?: string}[]}
  /** Edits made to the open post: in the editor (one undo step) or on the server. */
  | {type: "edits"; id: string; changes: string[]; applied: "editor" | "server"};
export type ChatPart =
  | {type: "text"; text: string}
  /** A short progress note written between tool calls. */
  | {type: "note"; text: string}
  /** A step: `label` is what it's doing while it runs, `done` what it did, and `detail` what came of it ("6 photos") or what went wrong. */
  | {type: "tool"; id: string; name: string; label: string; done?: string; status: "running" | "done" | "error"; detail?: string}
  | {type: "card"; card: ChatCard};
export type ChatUpload = {id: string; name: string};
export type ChatMessage = {
  id: string;
  at: string;
  role: "person" | "assistant";
  /** Who wrote a person's message. */
  author?: ChatPerson;
  text?: string;
  uploads?: ChatUpload[];
  /** An answer's parts in the order they happened. */
  parts?: ChatPart[];
  status?: "running" | "done" | "error" | "stopped";
  /** When an answer finished; with `at`, how long it worked. */
  doneAt?: string;
  error?: string;
  /** Who asked, on an answer. */
  for?: ChatPerson;
};
export type ChatConversation = {
  startedAt: string;
  /** Claude's messages since the conversation started; only ever appended to. */
  messages: Anthropic.Beta.BetaMessageParam[];
  /** What happened before this conversation, when a long one started over. */
  summary?: string;
  restarts: number;
};
export type ChatThread = {
  id: string;
  version: 1;
  scope: ThreadScope;
  messages: ChatMessage[];
  conversation: ChatConversation;
  usage: {inputTokens: number; outputTokens: number; replies: number};
  createdAt: string;
  updatedAt: string;
  expiresAt: string;
  revision: string;
};

export class ThreadError extends Error {
  constructor(message: string, public status = 400) { super(message); }
}
class RevisionChanged extends Error {}

export const THREAD_LIMITS = {ttlDays: 90, maxBytes: 4_000_000, maxMessages: 300, maxText: 8000} as const;
const CLOUD_TIMEOUT_MS = 15_000;
const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,159}$/;
const hash = (value: string) => createHash("sha256").update(value).digest("hex");

export function scopeKey(scope: ThreadScope): string {
  if (scope?.kind === "deck" && typeof scope.deckId === "string" && SAFE_ID.test(scope.deckId)) return `deck:${scope.deckId}`;
  if (scope?.kind === "home" && typeof scope.personId === "string" && SAFE_ID.test(scope.personId)) return `home:${scope.personId}`;
  throw new ThreadError("That chat isn't valid.");
}
const rowKey = (ownerKey: string, scope: ThreadScope) => `assistant-thread:${ownerKey}:${hash(scopeKey(scope)).slice(0, 40)}`;
const directory = () => path.join(developmentDirectory("template-editor"), "assistant-threads");
const filename = (key: string) => `${hash(key)}.json`;
const unavailable = () => new ThreadError("The chat is unavailable right now. Retry shortly.", 503);

function checkedOwner(ownerKey: string): string {
  if (typeof ownerKey !== "string" || !ownerKey || ownerKey.length > 300) throw new ThreadError("A workspace owner is required.", 401);
  return ownerKey;
}
function assertDevelopmentStorage() {
  if (process.env.NODE_ENV === "production") throw new ThreadError("Cloud storage is not configured. The chat was not saved.", 503);
}
function decode(value: unknown, scope: ThreadScope): ChatThread | null {
  if (value === null || value === undefined) return null;
  const thread = value as ChatThread;
  if (typeof thread !== "object" || thread.version !== 1 || typeof thread.id !== "string" || typeof thread.revision !== "string" || !Array.isArray(thread.messages) || !thread.conversation || !Array.isArray(thread.conversation.messages)) {
    throw new ThreadError("The chat could not be read. It has not been changed.", 503);
  }
  if (scopeKey(thread.scope) !== scopeKey(scope)) throw new ThreadError("The chat could not be read. It has not been changed.", 503);
  return thread;
}
/** An expired thread reads as no thread; its row is replaced on the next write. */
const live = (thread: ChatThread | null) => thread && Date.parse(thread.expiresAt) >= Date.now() ? thread : null;
function encode(thread: ChatThread): ChatThread {
  const size = Buffer.byteLength(JSON.stringify(thread));
  if (size > THREAD_LIMITS.maxBytes) throw new ThreadError(`The chat is too large to save (${Math.round(size / 1000)} KB).`, 413);
  return thread;
}

async function readRecord(ownerKey: string, scope: ThreadScope): Promise<ChatThread | null> {
  const key = rowKey(ownerKey, scope), db = getAdminSupabase();
  if (db) {
    const {data, error} = await db.from("gf_client_state").select("data").eq("owner", key).abortSignal(AbortSignal.timeout(CLOUD_TIMEOUT_MS)).maybeSingle();
    if (error) throw unavailable();
    return decode(data?.data, scope);
  }
  assertDevelopmentStorage();
  try {
    return decode(JSON.parse(await fs.readFile(path.join(directory(), filename(key)), "utf8")), scope);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    if (error instanceof ThreadError) throw error;
    throw new ThreadError("The chat could not be read. It has not been changed.", 503);
  }
}

/** `expectedRevision` is the stored row's revision (expired or not), or null when there is no row. */
async function writeRecord(ownerKey: string, next: ChatThread, expectedRevision: string | null): Promise<void> {
  const key = rowKey(ownerKey, next.scope), db = getAdminSupabase();
  if (db) {
    const updated_at = next.updatedAt, signal = AbortSignal.timeout(CLOUD_TIMEOUT_MS);
    if (expectedRevision === null) {
      const {error} = await db.from("gf_client_state").insert({owner: key, data: next, updated_at}).abortSignal(signal);
      if (error?.code === "23505") throw new RevisionChanged();
      if (error) throw unavailable();
      return;
    }
    const {data, error} = await db.from("gf_client_state").update({data: next, updated_at}).eq("owner", key).eq("data->>revision", expectedRevision).select("owner").abortSignal(signal).maybeSingle();
    if (error) throw unavailable();
    if (!data) throw new RevisionChanged();
    return;
  }
  assertDevelopmentStorage();
  await fs.mkdir(directory(), {recursive: true, mode: 0o700});
  const destination = path.join(directory(), filename(key));
  if (((await readRecord(ownerKey, next.scope))?.revision ?? null) !== expectedRevision) throw new RevisionChanged();
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

function emptyThread(scope: ThreadScope): ChatThread {
  const now = new Date().toISOString();
  return {
    id: `thread-${randomUUID()}`, version: 1, scope, messages: [],
    conversation: {startedAt: now, messages: [], restarts: 0},
    usage: {inputTokens: 0, outputTokens: 0, replies: 0},
    createdAt: now, updatedAt: now, expiresAt: now, revision: "",
  };
}

export async function getThread(ownerKey: string, scope: ThreadScope): Promise<ChatThread | null> {
  checkedOwner(ownerKey); scopeKey(scope);
  return live(await readRecord(ownerKey, scope));
}

/**
 * Read-modify-write with a revision check, retried when another writer got
 * there first; the thread is created on its first write. `change` may run more
 * than once, so it must only edit the thread it's given.
 */
export async function updateThread(ownerKey: string, scope: ThreadScope, change: (thread: ChatThread) => void): Promise<ChatThread> {
  checkedOwner(ownerKey); scopeKey(scope);
  for (let attempt = 0; attempt < 6; attempt++) {
    try {
      return await withFileLock(async () => {
        const stored = await readRecord(ownerKey, scope), current = live(stored);
        const next: ChatThread = current ? structuredClone(current) : emptyThread(scope);
        change(next);
        next.messages = next.messages.slice(-THREAD_LIMITS.maxMessages);
        next.updatedAt = new Date().toISOString();
        // Threads in use stay; a thread nobody touches for 90 days goes.
        next.expiresAt = new Date(Date.now() + THREAD_LIMITS.ttlDays * 864e5).toISOString();
        next.revision = randomUUID();
        await writeRecord(ownerKey, encode(next), stored?.revision ?? null);
        return next;
      });
    } catch (error) {
      if (!(error instanceof RevisionChanged)) throw error;
      await new Promise(resolve => setTimeout(resolve, 40 * (attempt + 1)));
    }
  }
  throw new ThreadError("The chat is busy. Retry in a moment.", 409);
}

/** What the browser sees: never Claude's conversation or the owner key. */
export function threadView(thread: ChatThread | null, scope: ThreadScope) {
  return {
    id: thread?.id ?? null,
    scope: scope.kind === "deck" ? {kind: "deck" as const, deckId: scope.deckId} : {kind: "home" as const},
    messages: thread?.messages ?? [],
    updatedAt: thread?.updatedAt ?? null,
  };
}
export type ThreadView = ReturnType<typeof threadView>;

/** The conversation's size in characters, which decides when it starts over from a summary. */
export const conversationSize = (thread: ChatThread) => JSON.stringify(thread.conversation.messages).length;
