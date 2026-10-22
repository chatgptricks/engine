import * as Y from "yjs";
import {resolveEngineAccess} from "@/lib/engine/member";
import {editorOwnerScope, getCollaborationDocument, getCollaborationRevision, saveCollaborationDocument, type StoredCollaborationDocument} from "@/lib/template-editor/persistence";
import {collaborationActor, heartbeatCollaboration, readCollaborationParticipants, validateCollaborationAwareness} from "@/lib/template-editor/collaboration-server";
import {createCollaborationDocument, decodeCollaborationUpdate, readCollaborationDocument} from "@/lib/template-editor/collaboration-document";
import type {CollaborationActor, CollaborationParticipant, CollaborationSnapshot} from "@/lib/template-editor/collaboration-types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const PRIVATE = {"Cache-Control": "private, no-store"};
const MAX_BODY = 25 * 1024 * 1024;
const validId = (value: unknown): value is string => typeof value === "string" && /^[A-Za-z0-9._:-]{1,160}$/.test(value);
const validSession = (value: unknown): value is string => typeof value === "string" && /^[a-f0-9-]{36}$/i.test(value);
const reply = (body: unknown, status = 200) => Response.json(body, {status, headers: PRIVATE});
function originAllowed(request: Request) {
  const origin = request.headers.get("origin");
  if (origin === null) return true;
  return [request.url, process.env.NEXT_PUBLIC_SITE_URL, process.env.RENDER_EXTERNAL_URL].some(value => {
    try {const url = new URL(value!); return ["http:", "https:"].includes(url.protocol) && !url.username && !url.password && url.origin === origin;}
    catch {return false;}
  });
}
async function body(request: Request): Promise<Record<string, unknown>> {
  if (Number(request.headers.get("content-length") ?? 0) > MAX_BODY) throw new RangeError("Collaboration update exceeds its size limit.");
  const reader = request.body?.getReader();
  if (!reader) throw new Error("A collaboration request is required.");
  let bytes = 0, text = ""; const decoder = new TextDecoder();
  try {
    while (true) {const chunk = await reader.read(); if (chunk.done) break; bytes += chunk.value.byteLength; if (bytes > MAX_BODY) {await reader.cancel(); throw new RangeError("Collaboration update exceeds its size limit.");} text += decoder.decode(chunk.value, {stream: true});}
    const value = JSON.parse(text + decoder.decode());
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Invalid collaboration request.");
    return value;
  } finally {reader.releaseLock();}
}
function snapshot(stored: StoredCollaborationDocument, actor: CollaborationActor, participants: CollaborationParticipant[]): CollaborationSnapshot {
  return {state: stored.state, document: stored.document, revision: stored.revision, scope: stored.scope, version: stored.version, epoch: stored.epoch, storage: stored.storage, assetKeys: stored.assetKeys, actor, participants};
}
function statusFor(error: unknown) {
  const message = error instanceof Error ? error.message : "Live collaboration is unavailable.";
  const status = /not available.*workspace/.test(message) ? 404 : /generation changed/.test(message) ? 409 : /exceeds|12 MB|30 MB/.test(message) ? 413 : /Invalid|Choose|Reload|room cannot|limit exceeded/.test(message) ? 400 : /Sign in/.test(message) ? 401 : 503;
  return {message, status};
}

export async function POST(request: Request) {
  const access = await resolveEngineAccess();
  if (!access) return reply({error: "Sign in to collaborate."}, 401);
  if (!originAllowed(request)) return reply({error: "Open collaboration from the editor."}, 403);
  let input: Record<string, unknown>;
  try {input = await body(request);} catch (error) {return reply({error: error instanceof RangeError ? error.message : "Invalid collaboration request."}, error instanceof RangeError ? 413 : 400);}
  if (!validId(input.documentId) || !validSession(input.sessionId) || typeof input.expectedScope !== "string" || !Number.isSafeInteger(input.sequence) || Number(input.sequence) < 1 || Number(input.sequence) > 1_000_000_000 || (input.update !== undefined && typeof input.update !== "string") || (input.leave !== undefined && typeof input.leave !== "boolean") || (input.name !== undefined && typeof input.name !== "string")) return reply({error: "Invalid collaboration session."}, 400);
  if (input.expectedScope !== editorOwnerScope(access.ownerKey)) return reply({error: "The signed-in workspace changed.", code: "workspace_owner_changed"}, 403);
  try {
    const current = await getCollaborationDocument(access.ownerKey, input.documentId);
    const actor = await collaborationActor(access, input.sessionId, input.name as string | undefined);
    let awarenessDocument = current.document;
    if (typeof input.update === "string") {
      if (input.epoch !== current.epoch) return reply({error: "The live document generation changed. Reconnect before sending edits.", code: "generation_changed", snapshot: snapshot(current, actor, await readCollaborationParticipants(access.ownerKey, input.documentId))}, 409);
      const doc = createCollaborationDocument();
      try {Y.applyUpdate(doc, decodeCollaborationUpdate(current.state)); Y.applyUpdate(doc, decodeCollaborationUpdate(input.update)); awarenessDocument = readCollaborationDocument(doc);}
      finally {doc.destroy();}
    }
    const awareness = validateCollaborationAwareness(input.awareness, awarenessDocument);
    const saved = typeof input.update === "string" ? await saveCollaborationDocument(access.ownerKey, input.documentId, input.update, String(input.epoch)) : current;
    // A concurrent deletion can make an otherwise valid selection stale. It
    // never changes durable artwork and is cleared on the next heartbeat.
    const participants = await heartbeatCollaboration(access.ownerKey, input.documentId, input.sessionId, actor, awareness, Number(input.sequence), input.leave === true);
    return reply(snapshot(saved, actor, participants));
  } catch (error) {
    const {message, status} = statusFor(error);
    if (status === 409) {
      try {
        const [current, actor, participants] = await Promise.all([getCollaborationDocument(access.ownerKey, input.documentId), collaborationActor(access, input.sessionId, input.name as string | undefined), readCollaborationParticipants(access.ownerKey, input.documentId)]);
        return reply({error: message, code: "generation_changed", snapshot: snapshot(current, actor, participants)}, status);
      } catch { /* Preserve the original failure if storage is temporarily down. */ }
    }
    return reply({error: message, ...(status === 409 ? {code: "generation_changed"} : status === 404 ? {code: "not_found"} : {})}, status);
  }
}

export async function GET(request: Request) {
  const access = await resolveEngineAccess();
  if (!access) return reply({error: "Sign in to collaborate."}, 401);
  if (!originAllowed(request)) return reply({error: "Open collaboration from the editor."}, 403);
  const query = new URL(request.url).searchParams, documentId = query.get("documentId"), sessionId = query.get("sessionId");
  if (!validId(documentId) || !validSession(sessionId)) return reply({error: "Invalid collaboration session."}, 400);
  if (query.get("expectedScope") !== editorOwnerScope(access.ownerKey)) return reply({error: "The signed-in workspace changed.", code: "workspace_owner_changed"}, 403);
  let initial: StoredCollaborationDocument, actor: CollaborationActor, peers: CollaborationParticipant[];
  try {
    initial = await getCollaborationDocument(access.ownerKey, documentId);
    actor = await collaborationActor(access, sessionId, query.get("name") ?? undefined);
    peers = await heartbeatCollaboration(access.ownerKey, documentId, sessionId, actor, {selected: [], cursor: null}, 0);
  } catch (error) {const {message, status} = statusFor(error); return reply({error: message, ...(status === 404 ? {code: "not_found"} : {})}, status);}
  const encoder = new TextEncoder();
  let stopped = false, timer: ReturnType<typeof setTimeout> | undefined, rotation: ReturnType<typeof setTimeout> | undefined;
  let cleanup = () => {};
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      let revision = initial.revision;
      const signature = (participants: CollaborationParticipant[]) => JSON.stringify(participants.map(participant => ({...participant, seenAt: 0})));
      let presenceSignature = signature(peers);
      const send = (event: string, value: unknown) => {if (!stopped) controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(value)}\n\n`));};
      const stop = () => {if (stopped) return; stopped = true; if (timer) clearTimeout(timer); if (rotation) clearTimeout(rotation); request.signal.removeEventListener("abort", stop); try {controller.close();} catch { /* Reader already cancelled. */ }};
      cleanup = stop;
      request.signal.addEventListener("abort", stop, {once: true});
      send("snapshot", snapshot(initial, actor, peers));
      const poll = async () => {
        if (stopped) return;
        try {
          const [nextRevision, participants] = await Promise.all([getCollaborationRevision(access.ownerKey), readCollaborationParticipants(access.ownerKey, documentId)]);
          if (stopped) return;
          if (nextRevision !== revision) {
            const current = await getCollaborationDocument(access.ownerKey, documentId);
            revision = current.revision;
            send("update", snapshot(current, actor, participants));
          } else if (signature(participants) !== presenceSignature) send("presence", {scope: initial.scope, actor, participants});
          presenceSignature = signature(participants);
        } catch (error) {const failure = statusFor(error); send("error", {error: failure.message, ...(failure.status === 404 ? {code: "not_found"} : {})}); stop(); return;}
        if (!stopped) timer = setTimeout(() => {void poll();}, 350);
      };
      timer = setTimeout(() => {void poll();}, 350);
      // Reopen periodically so access is checked again after logout/revocation.
      // EventSource resumes automatically; snapshots are idempotent Yjs updates.
      rotation = setTimeout(stop, 25_000);
      if (request.signal.aborted) stop();
    },
    cancel() {cleanup();},
  });
  return new Response(stream, {headers: {...PRIVATE, "Content-Type": "text/event-stream; charset=utf-8", "Cache-Control": "private, no-cache, no-store, no-transform", "X-Accel-Buffering": "no", Connection: "keep-alive"}});
}
