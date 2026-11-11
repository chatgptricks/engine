import {randomUUID} from "node:crypto";
import {agentResponse as reply, allowedAgentOrigin, readAgentBody, resolveAgentRequest} from "@/lib/template-editor/agent-http";
import {htmlTokensForTemplate} from "@/lib/engine/brand-actions";
import {addsHtmlLayers, agentCapabilities, agentDeckSummary, agentTemplatePages, agentTemplateSlots, agentDeckView, createAgentDeck, updateAgentDeck, editableDeckPackage, withHtmlLayerTokens, AgentDeckValidationError} from "@/lib/template-editor/agent-decks";
import {contentHash} from "@/lib/template-editor/library-sync";
import {getEditorLibrary, saveEditorLibrary, LibraryConflictError} from "@/lib/template-editor/persistence";
import {libraryTemplates} from "@/lib/template-editor/template-catalog";
import {formatDimensions, parseLibrary, type DesignDocument} from "@/lib/template-editor/model";
import {checkLibrarySaveBudget} from "@/lib/template-editor/library-budget";
import {listPageProfiles} from "@/lib/engine/page-profiles";
import {storeNewImages} from "@/lib/template-editor/stored-images";
import {resolveAgentVideos} from "@/lib/template-editor/agent-videos";
import {frameCutSource, isFrameOperation, validateAgentUpdate, type FrameResolution} from "@/lib/template-editor/agent-decks";
import {cutFrame, FrameError, prepareFrameImage, viewFrame, type RemoveBackground} from "@/lib/template-editor/frames-server";
import {frameBackground, sceneToImage} from "@/lib/template-editor/frames";

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
type Operation = Record<string, unknown>;
const pixelBox = (value: unknown) => value as {x: number; y: number; width: number; height: number};
/** Frames operations need the server first: it stores the image, or cuts the
 * original, and the deck edit then places the result (frames-server.ts). */
async function resolveFrame(ownerKey: string, document: DesignDocument, operation: Operation, path: string): Promise<FrameResolution> {
  try {
    if (operation.op === "frame_slide") return {slide: await prepareFrameImage(ownerKey, String(operation.src), typeof operation.name === "string" ? operation.name : undefined)};
    const source = frameCutSource(document, String(operation.pageId), pixelBox(operation.box));
    if (!source) throw new AgentDeckValidationError("is not a Frames slide; add one with frame_slide", `${path}.pageId`);
    const cut = await cutFrame(ownerKey, source.original, source.box, (operation.removeBackground ?? "none") as RemoveBackground, typeof operation.name === "string" ? operation.name : "Cut out");
    return {cut: {src: cut.src, box: cut.box}};
  } catch (error) {
    if (error instanceof FrameError) throw new AgentDeckValidationError(error.message, path);
    throw error;
  }
}
/** Applies an update. Frames operations go one at a time, each with what the
 * server worked out for it, on the same in-memory deck, so the whole update
 * still saves at once or not at all. */
async function applyUpdate(ownerKey: string, before: DesignDocument, changes: unknown): Promise<DesignDocument> {
  const operations = changes && typeof changes === "object" && Array.isArray((changes as Operation).operations) ? (changes as {operations: unknown[]}).operations : null;
  if (!operations?.some(isFrameOperation)) return updateAgentDeck(before, changes);
  validateAgentUpdate(changes);
  let next = before;
  for (const [index, operation] of operations.entries()) {
    const path = `$.operations[${index}]`;
    try {next = updateAgentDeck(next, {operations: [operation]}, isFrameOperation(operation) ? await resolveFrame(ownerKey, next, operation as Operation, path) : {});}
    catch (error) {
      if (error instanceof AgentDeckValidationError) throw new AgentDeckValidationError(error.issues.map(issue => ({...issue, path: issue.path.replace("$.operations[0]", path)})));
      throw error;
    }
  }
  return next;
}
/** A look at a Frames slide's original image for the agent's own model. */
async function frameView(ownerKey: string, document: DesignDocument, input: Record<string, unknown>) {
  const page = document.pages.find(item => item.id === input.pageId), background = page && frameBackground(page);
  if (!page?.frame || !background) throw new RequestError("pageId must be a Frames slide (made with frame_slide).");
  const size = formatDimensions(document), scale = 360 / size.width;
  let box: {x: number; y: number; width: number; height: number} | undefined;
  if (input.box !== undefined) {
    const b = input.box as Record<string, unknown>;
    if (!b || typeof b !== "object" || !["x", "y", "width", "height"].every(key => typeof b[key] === "number" && Number.isFinite(b[key]))) throw new RequestError("box needs numeric x, y, width and height in output pixels.");
    box = sceneToImage(background, page.frame, {x: Number(b.x) * scale, y: Number(b.y) * scale, width: Number(b.width) * scale, height: Number(b.height) * scale});
  }
  try {
    const view = await viewFrame(ownerKey, page.frame.original, box);
    const slideBox = {x: background.x / scale, y: background.y / scale, width: background.width / scale, height: background.height / scale};
    return reply({image: {base64: view.base64, mimeType: view.mimeType}, shown: {width: view.width, height: view.height}, imageBox: view.box, original: {width: page.frame.width, height: page.frame.height}, slide: size, imageOnSlide: slideBox, note: "Boxes for frame_cut are slide output pixels. The image covers imageOnSlide; a pixel (px, py) of the original is at imageOnSlide.x + px * imageOnSlide.width / original.width, and the same for y."});
  } catch (error) {if (error instanceof FrameError) throw new RequestError(error.message); throw error;}
}
async function dispatch(ownerKey: string, input: Record<string, unknown>) {
  const action = input.action;
  if (action === "capabilities") return reply(agentCapabilities());
  if (!["list_templates", "list_decks", "get_deck", "create_deck", "update_deck", "export_deck", "frame_view"].includes(String(action))) throw new RequestError("Unknown action. Call capabilities for the supported tools.");
  if (action === "create_deck" || action === "update_deck") {
    if (!validOperation(input.operationId)) throw new RequestError("Supply a UUID operationId and reuse it only when retrying the same request.");
    const operationId = input.operationId;
    if (action === "create_deck" && (!input.spec || typeof input.spec !== "object" || Array.isArray(input.spec))) throw new RequestError("A deck spec object is required.");
    const spec = input.spec as Record<string, unknown>;
    const deckId = action === "create_deck" ? spec.id ?? `agent-${operationId}` : input.deckId;
    if (!validId(deckId)) throw new RequestError("A valid deckId is required.");
    if (action === "update_deck" && (typeof input.expectedHash !== "string" || !/^[a-f0-9]{64}$/.test(input.expectedHash))) throw new RequestError("Supply expectedHash from get_deck before updating a deck.");
    const inputHash = await contentHash(action === "create_deck" ? {action, spec} : {action, deckId, expectedHash: input.expectedHash, changes: input.changes});
    const images = new Map<string, string | null>();
    // Video links are copied into storage once, before any retry; the deck stores only their paths.
    const videoSpec = action === "create_deck" ? await resolveAgentVideos(ownerKey, spec, "$") : spec;
    const videoChanges = action === "update_deck" ? await resolveAgentVideos(ownerKey, input.changes, "$") : input.changes;
    for (let attempt = 0; attempt < 4; attempt++) {
      const stored = await getEditorLibrary(ownerKey), existing = stored.library.designs.find(document => document.id === deckId);
      const receipt = existing?.agentOperations?.find(operation => operation.id === operationId);
      if (receipt) {
        if (receipt.inputHash !== inputHash) throw new RequestError("This operationId was already used with different input.", 409);
        if (existing?.deletedAt) throw new RequestError("This deck is in Trash. Restore it in Engine before editing.", 409);
        return reply(await deckResult(existing!, {replayed: true}));
      }
      let document: DesignDocument;
      const templates = libraryTemplates(stored.library);
      // HTML layers get the brand guide's colors, fonts and sizes as CSS variables.
      const brandTokens = (templateId: unknown) => htmlTokensForTemplate(ownerKey, templates.find(template => template.id === templateId));
      if (action === "create_deck") {
        if (existing) throw new RequestError("A deck with this id already exists. Use update_deck to revise it.", 409);
        if (spec.pageId !== undefined && typeof spec.pageId === "string" && !(await listPageProfiles(ownerKey)).some(profile => profile.id === spec.pageId)) throw new RequestError(`Unknown pageId "${spec.pageId.slice(0, 120)}". Use a page profile id from engine_list_page_profiles, or omit pageId.`);
        const tokens = addsHtmlLayers(spec) ? await brandTokens(spec.templateId) : undefined;
        document = createAgentDeck(withHtmlLayerTokens({...videoSpec, id: deckId}, tokens), templates);
      } else {
        const before = checkedDocument(deckId, stored.library.designs);
        if (await contentHash(before) !== input.expectedHash) throw new RequestError("This deck changed. Call get_deck and apply your edits to its latest hash.", 409);
        const tokens = addsHtmlLayers(input.changes) ? await brandTokens(before.templateId) : undefined;
        document = await applyUpdate(ownerKey, before, withHtmlLayerTokens(videoChanges, tokens));
      }
      document = {...document, agentOperations: [...(document.agentOperations ?? []), {id: operationId, inputHash}].slice(-20)};
      // data: images the agent sent are stored as media files and the deck points to them, so they
      // don't count against the library limit. Template artwork and images already saved stay (stored-images.ts).
      document = (await storeNewImages(ownerKey, document, stored.library, images)).value;
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
    return reply({templates: templates.slice(offset, offset + limit).map(template => ({id: template.id, name: template.name, description: template.description, size: formatDimensions(template), slideCount: template.pages.length, pageTypes: agentTemplatePages(template), slots: agentTemplateSlots(template)})), total: templates.length, offset, limit});
  }
  const document = checkedDocument(input.deckId, library.designs);
  if (action === "frame_view") return await frameView(ownerKey, document, input);
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
