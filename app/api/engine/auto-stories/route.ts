import { resolveEngineAccess } from "@/lib/engine/member";
import { deleteStory, listAutoStories } from "@/lib/engine/db";

export const runtime = "nodejs";

/**
 * Stories the server-side research flows have generated, for the current
 * user's partition (the owner or a paying member). The tool merges these with
 * the in-repo seed + any localStorage-created stories. Returns an empty list
 * (not an error) when unauthorized, so the tool always renders.
 */
export async function GET() {
  const access = await resolveEngineAccess();
  if (!access) return Response.json({ stories: [] });
  return Response.json({ stories: await listAutoStories(100, access.ownerKey) });
}

/**
 * Delete a server-stored story by id, scoped to the caller's partition (a
 * member can only delete their own). No-ops gracefully when the store isn't
 * configured — the client's deleted-ids overlay hides it locally regardless.
 */
export async function DELETE(request: Request) {
  const access = await resolveEngineAccess();
  if (!access) {
    return Response.json({ error: "Unauthorized." }, { status: 401 });
  }
  const id = new URL(request.url).searchParams.get("id");
  if (!id) return Response.json({ error: "No id." }, { status: 400 });
  await deleteStory(id, access.ownerKey);
  return Response.json({ ok: true });
}
