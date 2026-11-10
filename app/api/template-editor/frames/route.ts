/** Frames in the editor: cuts a box of a frame slide's original into a picture of
 * its own and stores it. The editor places the result itself, so undo and live
 * collaboration work as for any edit; the deck isn't changed here. */
import {agentResponse as reply, allowedAgentOrigin, readAgentBody, resolveAgentRequest} from "@/lib/template-editor/agent-http";
import {cutFrame, FrameError, type RemoveBackground} from "@/lib/template-editor/frames-server";
import {FRAME_ASSET} from "@/lib/template-editor/model";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const finite = (value: unknown, min: number, max: number) => typeof value === "number" && Number.isFinite(value) && value >= min && value <= max;

export async function POST(request: Request) {
  const access = await resolveAgentRequest(request);
  if (!access) return reply({error: "Sign in to take a slide apart."}, 401);
  if (!allowedAgentOrigin(request)) return reply({error: "Take slides apart from the editor."}, 403);
  let input: Record<string, unknown>;
  try {input = await readAgentBody(request, 64 * 1024);} catch (error) {return reply({error: error instanceof Error ? error.message : "Invalid JSON request."}, error instanceof RangeError ? 413 : 400);}
  if (input.action !== "cut") return reply({error: "Unknown action."}, 400);
  const box = input.box as Record<string, unknown> | undefined;
  if (typeof input.original !== "string" || !FRAME_ASSET.test(input.original)) return reply({error: "original must be the frame's stored image."}, 400);
  if (!box || typeof box !== "object" || !finite(box.x, 0, 30_000) || !finite(box.y, 0, 30_000) || !finite(box.width, 1, 30_000) || !finite(box.height, 1, 30_000)) return reply({error: "box needs x, y, width and height in the image's pixels."}, 400);
  const removeBackground = (input.removeBackground ?? "none") as RemoveBackground;
  if (removeBackground !== "none" && removeBackground !== "flat") return reply({error: "removeBackground must be none or flat."}, 400);
  try {
    const cut = await cutFrame(access.ownerKey, input.original, {x: Number(box.x), y: Number(box.y), width: Number(box.width), height: Number(box.height)}, removeBackground);
    return reply(cut);
  } catch (error) {
    if (error instanceof FrameError) return reply({error: error.message}, 400);
    const message = error instanceof Error ? error.message : "";
    return reply({error: /storage|could not be saved/i.test(message) ? message : "Engine couldn't cut this area out."}, 503);
  }
}
