import { resolveEngineAccess } from "@/lib/engine/member";
import { parseLibrary } from "@/lib/template-editor/model";
import { jsonByteStream } from "@/lib/template-editor/json-stream";
import {
  getEditorLibrary,
  getPackedEditorLibrary,
  LibraryConflictError,
  saveEditorLibrary,
  saveEditorPatch,
  getDocumentHistory,
  editorOwnerScope,
} from "@/lib/template-editor/persistence";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const MAX_BODY_BYTES = 12 * 1024 * 1024;
const PRIVATE_HEADERS = { "Cache-Control": "private, no-store" };

function response(body: unknown, status = 200) {
  return new Response(jsonByteStream(body), { status, headers: { ...PRIVATE_HEADERS, "Content-Type": "application/json" } });
}

function httpOrigin(value: string | undefined): string | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    if (
      (url.protocol !== "http:" && url.protocol !== "https:") ||
      url.username ||
      url.password
    ) return null;
    return url.origin;
  } catch {
    return null;
  }
}

function allowedSaveOrigin(request: Request): boolean {
  const origin = request.headers.get("origin");
  if (origin === null) return true;
  // Origin headers contain one serialized origin, never a URL path or an
  // opaque "null" origin. Configured site URLs may include a trailing slash.
  if (httpOrigin(origin) !== origin) return false;
  // Next can construct request.url from an internal hostname/port behind
  // Render's proxy. Trust only explicit deployment URLs, not forwarded headers.
  return [
    request.url,
    process.env.NEXT_PUBLIC_SITE_URL,
    process.env.RENDER_EXTERNAL_URL,
    process.env.ENGINE_FRONTEND_URL,
  ].some((value) => httpOrigin(value) === origin);
}

export async function GET(request: Request) {
  const access = await resolveEngineAccess();
  if (!access)
    return response({ error: "Sign in to open your template library." }, 401);
  try {
    const url = request ? new URL(request.url) : null;
    const documentId = url?.searchParams.get("documentId");
    if (url?.searchParams.get("history") === "1" && documentId) return response({versions: await getDocumentHistory(access.ownerKey, documentId)});
    if (url?.searchParams.get("packed") === "1") {
      return response(await getPackedEditorLibrary(access.ownerKey));
    }
    return response(await getEditorLibrary(access.ownerKey));
  } catch (error) {
    console.error("Template library read failed", error);
    return response(
      {
        error:
          "Your library could not be loaded. Retry before editing; your saved work has not been changed.",
      },
      503,
    );
  }
}

async function readBoundedBody(request: Request): Promise<unknown> {
  const declaredLength = Number(request.headers.get("content-length") ?? 0);
  if (declaredLength > MAX_BODY_BYTES)
    throw new RangeError("Library exceeds the 12 MB save limit.");
  const reader = request.body?.getReader();
  if (!reader) throw new SyntaxError("A library is required.");
  const decoder = new TextDecoder();
  let bytes = 0;
  let text = "";
  try {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      bytes += chunk.value.byteLength;
      if (bytes > MAX_BODY_BYTES) {
        await reader.cancel();
        throw new RangeError(
          "Library exceeds the 12 MB save limit. Remove large embedded images or export a backup.",
        );
      }
      text += decoder.decode(chunk.value, { stream: true });
    }
    text += decoder.decode();
    return JSON.parse(text);
  } finally {
    reader.releaseLock();
  }
}

export async function PUT(request: Request) {
  const access = await resolveEngineAccess();
  if (!access)
    return response({ error: "Sign in again to save your library." }, 401);
  if (!allowedSaveOrigin(request)) {
    return response({ error: "This save must come from the editor." }, 403);
  }
  let body: Record<string, unknown>;
  try {
    const parsed = await readBoundedBody(request);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed))
      throw new SyntaxError("Invalid save request.");
    body = parsed as Record<string, unknown>;
  } catch (error) {
    return response(
      {
        error:
          error instanceof RangeError
            ? error.message
            : "Invalid library payload.",
      },
      error instanceof RangeError ? 413 : 400,
    );
  }
  if(body.clientSchema !== 3) return response({error: "Refresh the editor before saving this workspace."},426);
  const operationId = body.operationId;
  if (operationId !== undefined && (typeof operationId !== "string" || !/^[a-f0-9-]{36}$/i.test(operationId))) return response({error: "Invalid save operation."}, 400);
  if (body.patch !== undefined) {
    if (body.clientSchema !== 3) return response({error: "Refresh the editor before saving this workspace."}, 426);
    if (typeof body.expectedScope !== "string" || !/^[a-f0-9]{64}$/.test(body.expectedScope)) return response({error: "Reload the editor to confirm the signed-in workspace."}, 400);
    if (body.expectedScope !== editorOwnerScope(access.ownerKey)) return response({error: "The signed-in account changed. Your original workspace edits were kept locally. Download a backup or sign in to the original account before reloading.", code: "workspace_owner_changed"}, 403);
    if (typeof operationId !== "string" || !(body.revision === null || (typeof body.revision === "string" && /^[a-f0-9-]{36}$/i.test(body.revision)))) return response({error: "Invalid document save revision."}, 400);
    try {
      const saved = await saveEditorPatch(access.ownerKey, body.patch as Parameters<typeof saveEditorPatch>[1], (body.assets ?? {}) as Record<string, string>, body.revision, operationId);
      return response({revision: saved.revision, storage: saved.storage, scope: saved.scope, assetKeys: saved.assetKeys, ...(saved.reconciled ? {library: saved.library} : {})});
    } catch (error) {
      if (error instanceof LibraryConflictError) return response({error: error.message, conflicts: error.ids, remote: await getEditorLibrary(access.ownerKey)}, 409);
      const message = error instanceof Error ? error.message : "Document save failed.";
      const status = /Cloud|storage.*unavailable|save failed|not configured/i.test(message) ? 503 : /12 MB|30 MB/.test(message) ? 413 : 400;
      return response({error: status === 503 ? "The server could not save this document. Your browser copy has been kept; retry when the connection is available." : message}, status);
    }
  }
  if (body.library && typeof body.library === "object" && (body.library as {version?: unknown}).version === 1) {
    const existing = await getEditorLibrary(access.ownerKey);
    if (existing.revision !== null && existing.library.version === 2) return response({error: "This workspace uses a newer editor version. Refresh before saving; your local edits have been kept."}, 426);
  }
  const library = parseLibrary(body.library);
  const revision = body.revision;
  if (
    !library ||
    !(
      revision === null ||
      (typeof revision === "string" && /^[a-f0-9-]{36}$/i.test(revision))
    )
  ) {
    return response({ error: "Invalid library or save revision." }, 400);
  }
  try {
    const saved = await saveEditorLibrary(access.ownerKey, library, revision, operationId as string | undefined);
    // Avoid echoing every image on each keystroke autosave.
    return response({
      revision: saved.revision,
      storage: saved.storage,
      scope: saved.scope,
    });
  } catch (error) {
    if (error instanceof LibraryConflictError)
      return response({ error: error.message }, 409);
    console.error("Template library save failed", error);
    return response(
      {
        error:
          "Your library could not be saved to the server. Keep this tab open and retry.",
      },
      503,
    );
  }
}
