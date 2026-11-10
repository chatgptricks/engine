import {scopeKey, type ChatMessage, type ThreadScope} from "./threads";
import type {ChatUploadFile, EditorAnswer} from "./tools";

/**
 * Answers running in this server process, per thread. One answer runs at a
 * time in a thread and the next message waits its turn. While an answer
 * runs, people who reload see its live state, and the editor that asked
 * confirms the edits it was sent. Attached files are held here for a few
 * hours so later messages can still use them.
 */

type Live = {
  waiting: number;
  tail: Promise<void>;
  message?: ChatMessage;
  acks: Map<string, (answer: EditorAnswer) => void>;
  uploads: Map<string, ChatUploadFile & {at: number; bytes: number}>;
};
type Registry = {threads: Map<string, Live>; rate: Map<string, number[]>};
const REGISTRY = Symbol.for("engine.assistant.replies");
const registry = (): Registry => {
  const global = globalThis as typeof globalThis & {[REGISTRY]?: Registry};
  return global[REGISTRY] ??= {threads: new Map(), rate: new Map()};
};

export const REPLY_LIMITS = {waiting: 3, perHour: 30, uploadHours: 6, uploadsPerThread: 40, uploadBytesPerThread: 80 * 1024 * 1024, editorWaitMs: 15_000} as const;

export class ReplyLimitError extends Error { constructor(message: string, public status = 429) { super(message); } }

export const threadKey = (ownerKey: string, scope: ThreadScope) => `${ownerKey}\u0000${scopeKey(scope)}`;
function live(key: string): Live {
  const threads = registry().threads;
  let entry = threads.get(key);
  if (!entry) { entry = {waiting: 0, tail: Promise.resolve(), acks: new Map(), uploads: new Map()}; threads.set(key, entry); }
  return entry;
}
function forget(key: string) {
  const entry = registry().threads.get(key);
  if (entry && !entry.waiting && !entry.message && !entry.acks.size && !entry.uploads.size) registry().threads.delete(key);
}

/** At most 30 answers per person per hour, across their chats. */
export function takeReply(personId: string, now = Date.now()): void {
  const rate = registry().rate, recent = (rate.get(personId) ?? []).filter(time => time > now - 3600_000);
  if (recent.length >= REPLY_LIMITS.perHour) throw new ReplyLimitError("That's 30 messages in the last hour. Take a short break and try again.");
  recent.push(now); rate.set(personId, recent);
}

/**
 * Runs `work` after the answers already running or waiting in this thread.
 * `position` is how many are ahead of it.
 */
export function enqueue(key: string, work: () => Promise<void>): {position: number; done: Promise<void>} {
  const entry = live(key);
  if (entry.waiting >= REPLY_LIMITS.waiting) throw new ReplyLimitError("A few messages are already waiting in this chat. Let Claude catch up first.");
  const position = entry.waiting;
  entry.waiting++;
  const done = entry.tail.then(work).finally(() => { entry.waiting--; entry.message = undefined; forget(key); });
  entry.tail = done.catch(() => undefined);
  return {position, done};
}

export const isAnswering = (key: string) => (registry().threads.get(key)?.waiting ?? 0) > 0;
/** The answer being written now, fresher than the saved thread. */
export const liveAnswer = (key: string) => registry().threads.get(key)?.message;
export function setLiveAnswer(key: string, message: ChatMessage) { live(key).message = message; }

/** Waits for the editor to say what it did with edits it was sent. No answer in time means it's gone. */
export function waitForEditor(key: string, id: string, timeoutMs: number = REPLY_LIMITS.editorWaitMs): Promise<EditorAnswer> {
  const entry = live(key);
  return new Promise(resolve => {
    const timer = setTimeout(() => { entry.acks.delete(id); forget(key); resolve({gone: true}); }, timeoutMs);
    entry.acks.set(id, answer => { clearTimeout(timer); entry.acks.delete(id); resolve(answer); });
  });
}
export function acknowledge(key: string, id: string, answer: EditorAnswer): boolean {
  const resolve = registry().threads.get(key)?.acks.get(id);
  if (!resolve) return false;
  resolve(answer);
  return true;
}

/** Keeps a message's attached files for later messages in the same thread. */
export function rememberUploads(key: string, files: {id: string; name: string; dataUrl: string}[], now = Date.now()) {
  const uploads = live(key).uploads;
  for (const [id, file] of uploads) if (file.at < now - REPLY_LIMITS.uploadHours * 3600_000) uploads.delete(id);
  for (const file of files) uploads.set(file.id, {name: file.name, dataUrl: file.dataUrl, at: now, bytes: file.dataUrl.length});
  // Oldest go first past the caps.
  let total = [...uploads.values()].reduce((sum, file) => sum + file.bytes, 0);
  for (const [id, file] of uploads) {
    if (uploads.size <= REPLY_LIMITS.uploadsPerThread && total <= REPLY_LIMITS.uploadBytesPerThread) break;
    uploads.delete(id); total -= file.bytes;
  }
}
export function uploadsOf(key: string, now = Date.now()): ReadonlyMap<string, ChatUploadFile> {
  const uploads = registry().threads.get(key)?.uploads;
  if (!uploads) return new Map();
  return new Map([...uploads].filter(([, file]) => file.at >= now - REPLY_LIMITS.uploadHours * 3600_000).map(([id, file]) => [id, {name: file.name, dataUrl: file.dataUrl}]));
}
