import {resolveEngineAccess} from "@/lib/engine/member";
import {resolveAgentToken} from "./agent-access";

export const agentResponse = (body: unknown, status = 200) => Response.json(body, {status, headers: {"Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff"}});
export function allowedAgentOrigin(request: Request): boolean {
  const origin = request.headers.get("origin");
  if (origin === null) return true;
  return [request.url, process.env.NEXT_PUBLIC_SITE_URL, process.env.RENDER_EXTERNAL_URL].some(value => {
    try {const url = new URL(value!); return ["http:", "https:"].includes(url.protocol) && !url.username && !url.password && url.origin === origin;}
    catch {return false;}
  });
}
export async function resolveAgentRequest(request: Request): Promise<{ownerKey: string; kind: "agent" | "session"} | null> {
  const authorization = request.headers.get("authorization");
  if (authorization !== null) {
    if (!/^Bearer \S+$/i.test(authorization)) return null;
    const agent = await resolveAgentToken(authorization.slice(7));
    return agent ? {ownerKey: agent.ownerKey, kind: "agent"} : null;
  }
  const access = await resolveEngineAccess();
  return access ? {ownerKey: access.ownerKey, kind: "session"} : null;
}
export async function readAgentBody(request: Request, maxBytes = 2 * 1024 * 1024): Promise<Record<string, unknown>> {
  if (Number(request.headers.get("content-length") ?? 0) > maxBytes) throw new RangeError("Agent request exceeds its size limit.");
  const reader = request.body?.getReader();
  if (!reader) throw new SyntaxError("A JSON request is required.");
  let bytes = 0, text = ""; const decoder = new TextDecoder();
  try {
    while (true) {const chunk = await reader.read(); if (chunk.done) break; bytes += chunk.value.byteLength; if (bytes > maxBytes) {await reader.cancel(); throw new RangeError("Agent request exceeds its size limit.");} text += decoder.decode(chunk.value, {stream: true});}
    const value = JSON.parse(text + decoder.decode());
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new SyntaxError("A JSON object is required.");
    return value;
  } finally {reader.releaseLock();}
}
