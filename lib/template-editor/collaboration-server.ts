import {createHash, randomUUID} from "node:crypto";
import {promises as fs} from "node:fs";
import path from "node:path";
import {getAdminSupabase} from "@/lib/supabase/admin";
import {getCurrentAdminUser} from "@/lib/supabase/auth-server";
import type {EngineAccess} from "@/lib/engine/member";
import {developmentDirectory} from "./development-storage";
import {COLLABORATION_PRESENCE_TTL, type CollaborationActor, type CollaborationAwareness, type CollaborationParticipant} from "./collaboration-types";
import type {DesignDocument} from "./model";

type Session = CollaborationParticipant & {sequence: number; left?: boolean};
type PresenceRecord = {revision: string; sessions: Session[]};
// Presence is transient. Do not leave an editor request waiting indefinitely
// when the database or a response body stalls during a provider outage.
const PRESENCE_REQUEST_TIMEOUT_MS = 12_000;
const hash = (value: string) => createHash("sha256").update(value).digest("hex");
const key = (owner: string, documentId: string) => `template-collaboration-presence:${hash(`${owner}\0${documentId}`)}`;
const directory = () => path.join(developmentDirectory("template-editor-presence"), "collaboration");
const filename = (owner: string, documentId: string) => path.join(directory(), `${hash(key(owner, documentId))}.json`);
const colors = ["#20805c", "#7c3aed", "#2563eb", "#db2777", "#d97706", "#0891b2", "#be123c", "#4d7c0f"];
export async function collaborationActor(access: EngineAccess, sessionId: string, requestedName?: string): Promise<CollaborationActor> {
  let identity: string, name: string;
  if (access.kind === "member") {identity = access.email; name = access.email.split("@")[0];}
  else if (process.env.NEXT_PUBLIC_SUPABASE_URL) {
    const admin = await getCurrentAdminUser();
    if (!admin) throw new Error("Sign in again to collaborate.");
    identity = admin.email; name = admin.email.split("@")[0];
  } else {identity = `development:${sessionId}`; name = typeof requestedName === "string" && requestedName.trim() ? requestedName.trim().slice(0, 64) : "Local editor";}
  const id = hash(identity.trim().toLowerCase()).slice(0, 20);
  return {id, name: name.slice(0, 64), color: colors[parseInt(id.slice(0, 4), 16) % colors.length], ...(!process.env.NEXT_PUBLIC_SUPABASE_URL ? {canRename: true} : {})};
}

function decode(value: unknown): PresenceRecord {
  const record = value as PresenceRecord;
  if (!record || typeof record.revision !== "string" || !Array.isArray(record.sessions) || record.sessions.length > 200) throw new Error("Live presence is unavailable.");
  return record;
}
async function read(owner: string, documentId: string): Promise<PresenceRecord | null> {
  const db = getAdminSupabase();
  if (db) {const {data, error} = await db.from("gf_client_state").select("data").eq("owner", key(owner, documentId)).abortSignal(AbortSignal.timeout(PRESENCE_REQUEST_TIMEOUT_MS)).maybeSingle(); if (error) throw new Error("Live presence is unavailable."); return data ? decode(data.data) : null;}
  if (process.env.NODE_ENV === "production") throw new Error("Live presence is unavailable.");
  try {return decode(JSON.parse(await fs.readFile(filename(owner, documentId), "utf8")));}
  catch (error) {if ((error as NodeJS.ErrnoException).code === "ENOENT") return null; throw error;}
}
class ConcurrentPresence extends Error {}
async function write(owner: string, documentId: string, record: PresenceRecord, revision: string | null) {
  const db = getAdminSupabase();
  if (db) {
    const row = {owner: key(owner, documentId), data: record, updated_at: new Date().toISOString()};
    const signal = AbortSignal.timeout(PRESENCE_REQUEST_TIMEOUT_MS);
    if (revision === null) {const {error} = await db.from("gf_client_state").insert(row).abortSignal(signal); if (error?.code === "23505") throw new ConcurrentPresence(); if (error) throw new Error("Live presence is unavailable.");}
    else {const {data, error} = await db.from("gf_client_state").update(row).eq("owner", row.owner).eq("data->>revision", revision).select("owner").abortSignal(signal).maybeSingle(); if (error) throw new Error("Live presence is unavailable."); if (!data) throw new ConcurrentPresence();}
    return;
  }
  if (process.env.NODE_ENV === "production") throw new Error("Live presence is unavailable.");
  await fs.mkdir(directory(), {recursive: true, mode: 0o700});
  const temporary = path.join(directory(), `${randomUUID()}.tmp`);
  try {await fs.writeFile(temporary, JSON.stringify(record), {mode: 0o600}); await fs.rename(temporary, filename(owner, documentId));}
  finally {await fs.unlink(temporary).catch(() => undefined);}
}
const active = (sessions: Session[], now = Date.now()) => sessions.filter(session => Number.isFinite(session.seenAt) && session.seenAt > now - COLLABORATION_PRESENCE_TTL && session.seenAt <= now);
const participants = (sessions: Session[]): CollaborationParticipant[] => active(sessions).filter(session => !session.left).map(session => ({id: session.id, name: session.name, color: session.color, pageId: session.pageId, selected: session.selected, cursor: session.cursor, preview: session.preview, sessionId: session.sessionId, seenAt: session.seenAt}));
let queue: Promise<unknown> = Promise.resolve();
export async function readCollaborationParticipants(owner: string, documentId: string): Promise<CollaborationParticipant[]> {return participants((await read(owner, documentId))?.sessions ?? []);}
export async function heartbeatCollaboration(owner: string, documentId: string, sessionId: string, actor: CollaborationActor, awareness: CollaborationAwareness, sequence: number, leave = false): Promise<CollaborationParticipant[]> {
  const run = async () => {
    for (let attempt = 0; attempt < 8; attempt++) {
      const current = await read(owner, documentId), sessions = active(current?.sessions ?? []), before = sessions.find(session => session.sessionId === sessionId);
      if (before && before.sequence >= sequence) return participants(sessions);
      const others = sessions.filter(session => session.sessionId !== sessionId);
      if (others.length >= 200) throw new Error("Too many editor sessions are open.");
      const next = [...others, {...actor, ...awareness, sessionId, sequence, seenAt: Date.now(), ...(leave ? {left: true} : {})}];
      try {await write(owner, documentId, {revision: randomUUID(), sessions: next}, current?.revision ?? null); return participants(next);}
      catch (error) {if (!(error instanceof ConcurrentPresence) || attempt === 7) throw error;}
    }
    return [];
  };
  if (getAdminSupabase()) return run();
  const task = queue.then(run, run); queue = task.catch(() => undefined); return task;
}

/** Awareness cannot reference another document or inject nonfinite geometry. */
export function validateCollaborationAwareness(value: unknown, document: DesignDocument): CollaborationAwareness {
  if (value === undefined) return {selected: [], cursor: null};
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Invalid collaboration presence.");
  const input = value as Record<string, unknown>;
  if (input.pageId !== undefined && (typeof input.pageId !== "string" || (!/^[A-Za-z0-9._:-]{1,160}$/.test(input.pageId) && input.pageId !== "@master" && input.pageId !== "@continuous"))) throw new Error("Invalid collaboration page.");
  const page = document.pages.find(page => page.id === input.pageId);
  const special = input.pageId === "@master" ? document.masterScene : input.pageId === "@continuous" ? document.continuousCanvas : undefined;
  const stalePage = input.pageId !== undefined && !page && !special;
  const elements = new Set((special?.elements ?? page?.canvas?.elements ?? []).map(element => element.id));
  if (!Array.isArray(input.selected) || input.selected.length > 100 || input.selected.some(id => typeof id !== "string" || !/^[A-Za-z0-9._:-]{1,160}$/.test(id)) || new Set(input.selected).size !== input.selected.length) throw new Error("Invalid collaboration selection.");
  const bounded = (value: unknown, minimum = -100_000, maximum = 100_000): value is number => typeof value === "number" && Number.isFinite(value) && value >= minimum && value <= maximum;
  let cursor: CollaborationAwareness["cursor"] = null;
  if (input.cursor !== undefined && input.cursor !== null) {
    const point = input.cursor as Record<string, unknown>;
    if (!point || typeof point !== "object" || !bounded(point.x) || !bounded(point.y)) throw new Error("Invalid collaboration cursor.");
    cursor = {x: point.x, y: point.y};
  }
  let preview: CollaborationAwareness["preview"] = null;
  if (input.preview !== undefined && input.preview !== null) {
    const candidate = input.preview as {elements?: unknown};
    if (!candidate || !Array.isArray(candidate.elements) || candidate.elements.length > 100) throw new Error("Invalid collaboration preview.");
    const seen = new Set<string>();
    preview = {elements: candidate.elements.map((element: Record<string, unknown>) => {
      if (!element || typeof element !== "object" || typeof element.id !== "string" || !/^[A-Za-z0-9._:-]{1,160}$/.test(element.id) || seen.has(element.id) || !bounded(element.x) || !bounded(element.y) || !bounded(element.width, 0) || !bounded(element.height, 0) || !bounded(element.rotation) || (element.fontSize !== undefined && !bounded(element.fontSize, 1, 500))) throw new Error("Invalid collaboration preview geometry.");
      seen.add(element.id);
      return {id: element.id, x: element.x, y: element.y, width: element.width, height: element.height, rotation: element.rotation, ...(element.fontSize === undefined ? {} : {fontSize: element.fontSize as number})};
    }).filter(element => elements.has(element.id))};
  }
  return {...(input.pageId !== undefined && !stalePage ? {pageId: String(input.pageId)} : {}), selected: (input.selected as string[]).filter(id => elements.has(id)), cursor: stalePage ? null : cursor, preview: stalePage ? null : preview};
}
