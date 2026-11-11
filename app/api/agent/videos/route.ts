/** Agents store a video file from their computer here (the Engine MCP bridge does it for
 * `video: {path}` and engine_video_upload). The bytes never pass through this route's
 * body in production: `start` returns a signed Storage URL the bridge sends the file to,
 * then `finish` checks what arrived and records it. In development the file comes in
 * 4 MB parts by PUT. The result's `src` is a video layer's src (or an image's `video: {src}`). */
import {agentResponse as reply, allowedAgentOrigin, readAgentBody, resolveAgentRequest} from "@/lib/template-editor/agent-http";
import {MAX_VIDEO_BYTES} from "@/lib/template-editor/model";
import {appendVideoChunk, beginVideoUpload, checkVideoMeta, finishUpload, VideoError, videoSrc, type VideoRecord} from "@/lib/template-editor/video-storage";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const AGENT_VIDEO_TYPES = ["video/mp4", "video/quicktime", "video/webm"] as const;
const facts = (record: VideoRecord) => ({src: videoSrc(record.id), mimeType: record.mimeType, duration: record.duration, width: record.width, height: record.height, bytes: record.bytes});

function failure(error: unknown) {
  if (error instanceof VideoError) return reply({error: error.message}, error.status);
  if (error instanceof RangeError || error instanceof SyntaxError) return reply({error: error.message}, 400);
  return reply({error: "Video storage is temporarily unavailable."}, 503);
}

function meta(body: Record<string, unknown>) {
  if (typeof body.id !== "string" || !/^[a-f0-9]{64}$/.test(body.id)) throw new VideoError("id must be the file's SHA-256, in lowercase hex.", 400);
  if (typeof body.bytes !== "number" || !Number.isInteger(body.bytes) || body.bytes < 1) throw new VideoError("bytes must be the file's size.", 400);
  if (body.bytes > MAX_VIDEO_BYTES) throw new VideoError(`Send a video smaller than ${MAX_VIDEO_BYTES / 1024 ** 2} MB.`, 413);
  if (!AGENT_VIDEO_TYPES.includes(body.mimeType as (typeof AGENT_VIDEO_TYPES)[number])) throw new VideoError("Send an MP4, MOV or WebM video.", 415);
  const name = typeof body.name === "string" && body.name.trim() ? body.name.trim().slice(0, 200) : "Video";
  return {id: body.id, bytes: body.bytes, mimeType: body.mimeType as string, name};
}
/** Engine reads an MP4 or MOV's length and size from its header; a WebM's are sent along (the MCP bridge reads them with ffprobe). */
function claimed(body: Record<string, unknown>) {
  if (body.mimeType !== "video/webm") return null;
  if (body.duration === undefined || body.width === undefined || body.height === undefined) throw new VideoError("A WebM needs duration, width and height.", 400);
  return checkVideoMeta(body);
}

/** `{action: "start", id, bytes, mimeType, name}` → a clip already stored, or where to send it;
 * `{action: "finish", id, bytes, mimeType, name}` → the stored clip's src and facts. */
export async function POST(request: Request) {
  const access = await resolveAgentRequest(request);
  if (!access) return reply({error: "Use an active Engine agent token or sign in."}, 401);
  if (!allowedAgentOrigin(request)) return reply({error: "This origin is not allowed to access Engine."}, 403);
  try {
    const body = await readAgentBody(request, 16 * 1024);
    const clip = meta(body), webm = claimed(body);
    if (body.action === "start") {
      const start = await beginVideoUpload(access.ownerKey, clip, {signedOnly: true});
      if ("existing" in start) return reply({existing: true, ...facts(start.record)});
      return reply(start);
    }
    if (body.action === "finish") return reply(facts(await finishUpload(access.ownerKey, clip, webm)), 201);
    return reply({error: "action must be start or finish."}, 400);
  } catch (error) { return failure(error); }
}

/** Development: one part of at most 4 MB, at `?offset=` of `?total=` bytes of clip `?id=`. */
export async function PUT(request: Request) {
  const access = await resolveAgentRequest(request);
  if (!access) return reply({error: "Use an active Engine agent token or sign in."}, 401);
  if (!allowedAgentOrigin(request)) return reply({error: "This origin is not allowed to access Engine."}, 403);
  const query = new URL(request.url).searchParams;
  try {
    const data = Buffer.from(await request.arrayBuffer());
    return reply({received: await appendVideoChunk(access.ownerKey, query.get("id") ?? "", Number(query.get("offset")), data, Number(query.get("total")))});
  } catch (error) { return failure(error); }
}
