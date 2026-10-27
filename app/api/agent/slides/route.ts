import {randomUUID} from "node:crypto";
import {agentResponse as reply, allowedAgentOrigin, readAgentBody, resolveAgentRequest} from "@/lib/template-editor/agent-http";
import {agentCapabilities, agentDeckSummary, agentTemplateSlots, agentDeckView, createAgentDeck, updateAgentDeck, editableDeckPackage, AgentDeckValidationError} from "@/lib/template-editor/agent-decks";
import {contentHash} from "@/lib/template-editor/library-sync";
import {getEditorLibrary, saveEditorLibrary, LibraryConflictError} from "@/lib/template-editor/persistence";
import {libraryTemplates} from "@/lib/template-editor/template-catalog";
import {formatDimensions, parseLibrary, type DesignDocument} from "@/lib/template-editor/model";
import {checkLibrarySaveBudget} from "@/lib/template-editor/library-budget";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const validId = (value: unknown): value is string => typeof value === "string" && /^[A-Za-z0-9._:-]{1,200}$/.test(value);
const validOperation = (value: unknown): value is string => typeof value === "string" && /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(value);
class RequestError extends Error {constructor(message: string, public status = 400) {super(message);}}
function pageRange(input: Record<string, unknown>) {
  const offset = input.offset ?? 0, limit = input.limit ?? 20;
  if (!Number.isInteger(offset) || Number(offset) < 0 || Number(offset) > 10000 || !Number.isInteger(limit) || Number(limit) < 1 || Number(limit) > 100) throw new RequestError("Use an integer offset from 0–10000 and limit from 1–100.");
  return {offset: Number(offset), limit: Number(limit)};
}
function editorUrl(document: DesignDocument) {const frontend=process.env.ENGINE_FRONTEND_URL;return `${frontend?frontend.replace(/\/$/, "")+"/":"/admin/engine"}?design=${encodeURIComponent(document.id)}`;}
async function deckResult(document: DesignDocument, extra = {}) {
  return {document, view: agentDeckView(document), hash: await contentHash(document), editorUrl: editorUrl(document), coordinates: {document: "360-wide scene units", authoring: "output pixels", pixelsPerSceneUnit: formatDimensions(document).width / 360}, ...extra};
}
function checkedDocument(id: unknown, documents: DesignDocument[]) {
  if (!validId(id)) throw new RequestError("A valid deckId is required.");
  const document = documents.find(item => item.id === id && !item.deletedAt);
  if (!document) throw new RequestError("Deck not found in this workspace.", 404);
  return document;
}
async function dispatch(ownerKey: string, input: Record<string, unknown>) {
  const action = input.action;
  if (action === "capabilities") return reply(agentCapabilities());
  if (!["list_templates", "list_decks", "get_deck", "create_deck", "update_deck", "export_deck"].includes(String(action))) throw new RequestError("Unknown action. Call capabilities for the supported tools.");
  if (action === "create_deck" || action === "update_deck") {
    if (!validOperation(input.operationId)) throw new RequestError("Supply a UUID operationId and reuse it only when retrying the same request.");
    const operationId = input.operationId;
    if (action === "create_deck" && (!input.spec || typeof input.spec !== "object" || Array.isArray(input.spec))) throw new RequestError("A deck spec object is required.");
    const spec = input.spec as Record<string, unknown>;
    const deckId = action === "create_deck" ? spec.id ?? `agent-${operationId}` : input.deckId;
    if (!validId(deckId)) throw new RequestError("A valid deckId is required.");
    if (action === "update_deck" && (typeof input.expectedHash !== "string" || !/^[a-f0-9]{64}$/.test(input.expectedHash))) throw new RequestError("Supply expectedHash from get_deck before updating a deck.");
    const inputHash = await contentHash(action === "create_deck" ? {action, spec} : {action, deckId, expectedHash: input.expectedHash, changes: input.changes});
    for (let attempt = 0; attempt < 4; attempt++) {
      const stored = await getEditorLibrary(ownerKey), existing = stored.library.designs.find(document => document.id === deckId);
      const receipt = existing?.agentOperations?.find(operation => operation.id === operationId);
      if (receipt) {
        if (receipt.inputHash !== inputHash) throw new RequestError("This operationId was already used with different input.", 409);
        if (existing?.deletedAt) throw new RequestError("This deck is in Trash. Restore it in Engine before editing.", 409);
        return reply(await deckResult(existing!, {replayed: true}));
      }
      let document: DesignDocument;
      if (action === "create_deck") {
        if (existing) throw new RequestError("A deck with this id already exists. Use update_deck to revise it.", 409);
        document = createAgentDeck({...spec, id: deckId}, libraryTemplates(stored.library));
      } else {
        const before = checkedDocument(deckId, stored.library.designs);
        if (await contentHash(before) !== input.expectedHash) throw new RequestError("This deck changed. Call get_deck and apply your edits to its latest hash.", 409);
        document = updateAgentDeck(before, input.changes);
      }
      document = {...document, agentOperations: [...(document.agentOperations ?? []), {id: operationId, inputHash}].slice(-20)};
      const next = parseLibrary({...stored.library, designs: existing ? stored.library.designs.map(item => item.id === deckId ? document : item) : [document, ...stored.library.designs]});
      if (!next) throw new RequestError("The deck exceeds Engine's document or workspace limits.");
      const budget = checkLibrarySaveBudget(next);
      if (!budget.ok) throw new RequestError(budget.error, 413);
      try {
        // Strict CAS, rather than a field merge: recheck the deck hash after any
        // concurrent library save and preserve all independent workspace edits.
        const saved = await saveEditorLibrary(ownerKey, next, stored.revision, randomUUID());
        return reply(await deckResult(checkedDocument(deckId, saved.library.designs)), action === "create_deck" ? 201 : 200);
      } catch (error) {if (!(error instanceof LibraryConflictError) || attempt === 3) throw error;}
    }
    throw new RequestError("The workspace is busy. Retry this operation after fetching the deck.", 409);
  }
  const {library} = await getEditorLibrary(ownerKey);
  if (action === "list_decks") {
    const {offset, limit} = pageRange(input), documents = library.designs.filter(document => !document.deletedAt && document.purpose !== "template");
    return reply({decks: documents.slice(offset, offset + limit).map(document => ({...agentDeckSummary(document), editorUrl: editorUrl(document)})), total: documents.length, offset, limit});
  }
  if (action === "list_templates") {
    const {offset, limit} = pageRange(input), templates = libraryTemplates(library);
    return reply({templates: templates.slice(offset, offset + limit).map(template => ({id: template.id, name: template.name, description: template.description, size: formatDimensions(template), slideCount: template.pages.length, slots: agentTemplateSlots(template)})), total: templates.length, offset, limit});
  }
  const document = checkedDocument(input.deckId, library.designs);
  if (action === "export_deck") return reply({filename: `${document.name.replace(/[^a-zA-Z0-9_-]+/g, "-").slice(0, 100) || "deck"}.engine.json`, package: editableDeckPackage(document), editorUrl: editorUrl(document)});
  return reply(await deckResult(document));
}
function failure(error: unknown) {
  if (error instanceof AgentDeckValidationError) return reply({error: error.message, issues: error.issues}, 400);
  if (error instanceof RequestError) return reply({error: error.message}, error.status);
  if (error instanceof LibraryConflictError) return reply({error: "This workspace changed. Fetch the latest deck before retrying."}, 409);
  return reply({error: "Engine could not complete this request. Retry with the same operationId."}, 503);
}
export async function POST(request: Request) {
  try {
    const access = await resolveAgentRequest(request);
    if (!access) return reply({error: "Use an active Engine agent token or sign in."}, 401);
    if (!allowedAgentOrigin(request)) return reply({error: "This origin is not allowed to access Engine."}, 403);
    let input: Record<string, unknown>;
    try {input = await readAgentBody(request, 12 * 1024 * 1024);} catch (error) {return reply({error: error instanceof Error ? error.message : "Invalid JSON request."}, error instanceof RangeError ? 413 : 400);}
    return await dispatch(access.ownerKey, input);
  } catch (error) {return failure(error);}
}
export async function GET(request: Request) {
  try {
    const access = await resolveAgentRequest(request);
    if (!access) return reply({error: "Use an active Engine agent token or sign in."}, 401);
    return reply(agentCapabilities());
  } catch (error) {return failure(error);}
}
