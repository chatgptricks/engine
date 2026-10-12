import { resolveEngineAccess } from "@/lib/engine/member";
import {
  getClientState,
  saveClientState,
  type EngineClientState,
} from "@/lib/engine/db";

export const runtime = "nodejs";

/**
 * Durable mirror of the studio's localStorage state — DESIGNS (per-story
 * slideStyles / selection / caption edits / star / set-aside), manually-created
 * stories, channels, and the deleted-ids overlay. Owner-scoped. The store
 * fetches this on load (restoring after a browser wipe) and writes it through
 * on change. Degrades to a no-op when the gf_client_state table or the store
 * isn't available, so nothing breaks before the migration lands.
 */
export async function GET() {
  const access = await resolveEngineAccess();
  if (!access) return Response.json({ state: null });
  try {
    const state = await getClientState(access.ownerKey);
    return Response.json({ state });
  } catch {
    return Response.json({ state: null });
  }
}

export async function PUT(request: Request) {
  const access = await resolveEngineAccess();
  if (!access) return Response.json({ ok: false }, { status: 401 });
  const body = (await request.json().catch(() => null)) as {
    state?: EngineClientState;
  } | null;
  if (!body || typeof body.state !== "object" || body.state === null) {
    return Response.json({ ok: false }, { status: 400 });
  }
  try {
    const ok = await saveClientState(access.ownerKey, body.state);
    return Response.json({ ok });
  } catch {
    return Response.json({ ok: false }, { status: 500 });
  }
}
