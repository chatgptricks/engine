/**
 * Deploy marker. The constant is baked into each deployment, so probing this
 * endpoint tells you which build the live site is actually serving — useful
 * for verifying that a push landed even when a failed build leaves the
 * previous deployment serving traffic.
 */
import {triggerDatabaseHealthProbe} from "@/lib/engine/database-health";

const ENGINE_BUILD = "2026-10-23-workspace-availability";

export function GET() {
  triggerDatabaseHealthProbe();
  return Response.json({ build: ENGINE_BUILD, commit: process.env.RENDER_GIT_COMMIT ?? null }, { headers: { "Cache-Control": "no-store" } });
}
