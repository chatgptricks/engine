import {randomUUID} from "node:crypto";
import {after} from "next/server";
import {resolveEngineAccess} from "@/lib/engine/member";
import {agentResponse as reply, allowedAgentOrigin, readAgentBody} from "@/lib/template-editor/agent-http";
import {collaborationActor} from "@/lib/template-editor/collaboration-server";
import {getEditorLibrary} from "@/lib/template-editor/persistence";
import {answer, ChatError, isAssistantConfigured, type ChatEvent, type TurnContext} from "@/lib/engine/assistant/agent";
import {acknowledge, enqueue, isAnswering, liveAnswer, rememberUploads, ReplyLimitError, setLiveAnswer, takeReply, threadKey, uploadsOf, waitForEditor} from "@/lib/engine/assistant/replies";
import {getThread, ThreadError, threadView, type ThreadScope} from "@/lib/engine/assistant/threads";
import type {EditorAnswer} from "@/lib/engine/assistant/tools";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// An answer goes on after the browser leaves; this only bounds the request on platforms that enforce it.
export const maxDuration = 800;

/**
 * Engine chat: talk to the assistant about a post, or start one.
 *
 *   GET  ?deckId=…            → {thread, answering, configured, me}; without deckId, the person's own chat.
 *   POST {deckId?, text, uploads?, turn?, editor?, sessionId?} → a stream of events
 *        (`data: {json}` lines): message, reply, text, note, tool, card, deck_ops, open, done, error.
 *   POST {action: "ack", deckId?, id, applied, error?, gone?} → the editor says what it did with deck_ops.
 *
 * A post's chat is shared with everyone in the workspace. People only: agents use the MCP bridge.
 */

const MAX_BODY = 34 * 1024 * 1024, MAX_UPLOADS = 10, MAX_UPLOAD_CHARS = 11 * 1024 * 1024;
const ID = /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,159}$/;
const text = (value: unknown, max: number) => typeof value === "string" ? value.trim().slice(0, max) : "";

async function person(sessionId: unknown) {
  const access = await resolveEngineAccess();
  if (!access) return null;
  const session = typeof sessionId === "string" && /^[A-Za-z0-9-]{8,80}$/.test(sessionId) ? sessionId : "browser";
  const actor = await collaborationActor(access, session);
  return {ownerKey: access.ownerKey, person: {id: actor.id, name: actor.name, color: actor.color}};
}
function scopeOf(deckId: unknown, personId: string): ThreadScope {
  if (deckId === undefined || deckId === null || deckId === "") return {kind: "home", personId};
  if (typeof deckId !== "string" || !ID.test(deckId)) throw new ThreadError("That post isn't valid.");
  return {kind: "deck", deckId};
}
function turnOf(value: unknown, deck: boolean): TurnContext {
  const input = value && typeof value === "object" ? value as Record<string, unknown> : {};
  const number = (item: unknown) => typeof item === "number" && Number.isInteger(item) && item > 0 && item <= 100 ? item : undefined;
  const selection = Array.isArray(input.selection) ? input.selection.slice(0, 10).flatMap(item => {
    const entry = item && typeof item === "object" ? item as Record<string, unknown> : {};
    return typeof entry.id === "string" && ID.test(entry.id) ? [{id: entry.id, ...(text(entry.name, 80) ? {name: text(entry.name, 80)} : {}), ...(text(entry.type, 20) ? {type: text(entry.type, 20)} : {})}] : [];
  }) : [];
  return {
    where: deck ? "editor" : "library",
    ...(deck && text(input.deckName, 200) ? {deckName: text(input.deckName, 200)} : {}),
    ...(deck && number(input.slide) ? {slide: number(input.slide)} : {}),
    ...(deck && number(input.slideCount) ? {slideCount: number(input.slideCount)} : {}),
    ...(deck && selection.length ? {selection} : {}),
  };
}
function uploadsOfBody(value: unknown) {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value) || value.length > MAX_UPLOADS) throw new ThreadError(`Attach at most ${MAX_UPLOADS} images to one message.`);
  return value.map((item, index) => {
    const entry = item && typeof item === "object" ? item as Record<string, unknown> : {};
    const dataUrl = typeof entry.dataUrl === "string" ? entry.dataUrl : "";
    if (dataUrl.length > MAX_UPLOAD_CHARS || !/^data:image\/(?:png|jpeg|webp|gif);base64,[A-Za-z0-9+/]+={0,2}$/.test(dataUrl)) throw new ThreadError(`Attachment ${index + 1} must be a PNG, JPEG, WebP or GIF image under 8 MB.`);
    return {id: `upload-${randomUUID().slice(0, 8)}`, name: text(entry.name, 120) || `image-${index + 1}`, dataUrl};
  });
}
const failure = (error: unknown) => {
  if (error instanceof ThreadError || error instanceof ChatError || error instanceof ReplyLimitError) return reply({error: error.message}, error.status);
  console.error("[assistant] request failed", error instanceof Error ? error.message : error);
  return reply({error: "The chat couldn't do that. Try again."}, 500);
};

export async function GET(request: Request) {
  try {
    const params = new URL(request.url).searchParams;
    const who = await person(params.get("sessionId"));
    if (!who) return reply({error: "Sign in to use the chat."}, 401);
    const scope = scopeOf(params.get("deckId"), who.person.id), key = threadKey(who.ownerKey, scope);
    const view = threadView(await getThread(who.ownerKey, scope), scope);
    // The answer being written is fresher in memory than in the saved thread.
    const current = liveAnswer(key);
    const messages = current ? view.messages.map(message => message.id === current.id ? current : message) : view.messages;
    return reply({thread: {...view, messages}, answering: isAnswering(key), configured: isAssistantConfigured(), me: who.person});
  } catch (error) {
    return failure(error);
  }
}

export async function POST(request: Request) {
  if (!allowedAgentOrigin(request)) return reply({error: "This origin is not allowed to access Engine."}, 403);
  let body: Record<string, unknown>;
  try {
    body = await readAgentBody(request, MAX_BODY);
  } catch (error) {
    return reply({error: error instanceof RangeError ? "That's too much to send at once. Attach fewer or smaller images." : "Send a JSON request."}, error instanceof RangeError ? 413 : 400);
  }
  try {
    const who = await person(body.sessionId);
    if (!who) return reply({error: "Sign in to use the chat."}, 401);
    const scope = scopeOf(body.deckId, who.person.id), key = threadKey(who.ownerKey, scope);

    if (body.action === "ack") {
      const id = text(body.id, 80);
      // `gone`: this browser no longer has the post open, so the edits are saved on the server right away.
      const result: EditorAnswer = body.gone === true ? {gone: true} : body.applied === true ? {applied: true} : {applied: false, error: text(body.error, 400) || "The editor couldn't apply the edits."};
      return reply({ok: acknowledge(key, id, result)});
    }
    if (body.action !== undefined) return reply({error: "action is ack, or leave it out to send a message."}, 400);
    if (!isAssistantConfigured()) return reply({error: "The chat is not configured: add ANTHROPIC_API_KEY to the server environment."}, 503);

    const message = text(body.text, 8000), uploads = uploadsOfBody(body.uploads);
    if (!message && !uploads.length) return reply({error: "Write a message or attach an image."}, 400);
    if (scope.kind === "deck") {
      const {library} = await getEditorLibrary(who.ownerKey);
      if (!library.designs.some(design => design.id === scope.deckId && !design.deletedAt)) return reply({error: "That post isn't in the library."}, 404);
    }
    takeReply(who.person.id);
    rememberUploads(key, uploads);
    const turn = turnOf(body.turn, scope.kind === "deck"), editor = body.editor === true && scope.kind === "deck";

    const encoder = new TextEncoder(), runs: Promise<unknown>[] = [];
    let closed = false, controller!: ReadableStreamDefaultController<Uint8Array>;
    const write = (chunk: string) => {
      if (closed) return;
      try { controller.enqueue(encoder.encode(chunk)); } catch { closed = true; }
    };
    const emit = (event: ChatEvent | {type: "queued"; position: number}) => write(`data: ${JSON.stringify(event)}\n\n`);
    const stream = new ReadableStream<Uint8Array>({
      start(value) { controller = value; },
      cancel() { closed = true; },
    });
    const heartbeat = setInterval(() => write(": keep-alive\n\n"), 15_000);
    const job = enqueue(key, async () => {
      await answer({
        ownerKey: who.ownerKey, scope, person: who.person, text: message,
        attached: uploads.map(upload => ({id: upload.id, name: upload.name})), uploads: uploadsOf(key), turn, emit,
        // Edits go to this person's editor while it's connected; after that they're saved on the server.
        ...(editor ? {applyInEditor: async (operations: unknown[], changes: string[]) => {
          if (closed) return {gone: true} as const;
          const id = randomUUID(), waiting = waitForEditor(key, id);
          emit({type: "deck_ops", id, operations, changes});
          return waiting;
        }} : {}),
        keepAlive: work => { runs.push(work); },
        signal: AbortSignal.timeout(30 * 60_000),
        onProgress: current => setLiveAnswer(key, current),
      });
    });
    if (job.position) emit({type: "queued", position: job.position});
    void job.done.catch(error => {
      console.error("[assistant] answer crashed", error instanceof Error ? error.message : error);
      emit({type: "error", error: "Something went wrong while answering. Try again."});
    }).finally(() => {
      clearInterval(heartbeat);
      if (!closed) { closed = true; try { controller.close(); } catch { /* already closed */ } }
    });
    // `next start` waits for the answer and any run it started on a graceful shutdown.
    after(() => job.done.catch(() => undefined).then(() => Promise.allSettled(runs)));
    return new Response(stream, {headers: {
      "Content-Type": "text/event-stream; charset=utf-8", "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive", "X-Accel-Buffering": "no", "X-Content-Type-Options": "nosniff",
    }});
  } catch (error) {
    return failure(error);
  }
}
