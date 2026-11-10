/** Agents upload an image here (raw bytes, up to 15 MB) and get back the path
 * decks use for it. Frames slides start from one (engine_frame_upload). */
import {agentResponse as reply, allowedAgentOrigin, resolveAgentRequest} from "@/lib/template-editor/agent-http";
import {MAX_ORIGINAL_BYTES, storeOriginalAsset} from "@/lib/template-editor/media-storage";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const access = await resolveAgentRequest(request);
  if (!access) return reply({error: "Use an active Engine agent token or sign in."}, 401);
  if (!allowedAgentOrigin(request)) return reply({error: "This origin is not allowed to access Engine."}, 403);
  if (Number(request.headers.get("content-length") ?? 0) > MAX_ORIGINAL_BYTES) return reply({error: "Send an image smaller than 15 MB."}, 413);
  const reader = request.body?.getReader();
  if (!reader) return reply({error: "Send the image's bytes as the request body."}, 400);
  const chunks: Buffer[] = []; let size = 0;
  try {
    while (true) {
      const chunk = await reader.read(); if (chunk.done) break;
      size += chunk.value.byteLength;
      if (size > MAX_ORIGINAL_BYTES) {await reader.cancel(); return reply({error: "Send an image smaller than 15 MB."}, 413);}
      chunks.push(Buffer.from(chunk.value));
    }
    let name = "Image";
    try {name = decodeURIComponent(request.headers.get("x-image-name") ?? "Image").slice(0, 200) || "Image";} catch { /* The name is optional. */ }
    const asset = await storeOriginalAsset(access.ownerKey, Buffer.concat(chunks), name);
    if (asset.mimeType === "image/svg+xml") return reply({error: "Send a PNG, JPG or WebP picture."}, 400);
    return reply({src: `/api/template-editor/assets/${asset.id}`, width: asset.width, height: asset.height, bytes: asset.bytes, mimeType: asset.mimeType}, 201);
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    const status = error instanceof RangeError ? 413 : /storage|could not be saved/i.test(message) ? 503 : 400;
    return reply({error: status === 400 ? "This image could not be read. Send a still PNG, JPG or WebP picture." : message || "Engine could not save this image."}, status);
  } finally {reader.releaseLock();}
}
