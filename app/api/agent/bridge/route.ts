import {readFile} from "node:fs/promises";
import path from "node:path";
import {resolveEngineAccess} from "@/lib/engine/member";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET() {
  if (!await resolveEngineAccess()) return Response.json({error: "Sign in to download the agent bridge."}, {status: 401});
  const source = await readFile(path.join(process.cwd(), "scripts", "engine-agent-mcp.mjs"), "utf8");
  return new Response(source, {headers: {"Content-Type": "text/javascript; charset=utf-8", "Content-Disposition": 'attachment; filename="engine-agent-mcp.mjs"', "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff"}});
}
