/**
 * Deploy marker. The constant is baked into each deployment, so probing this
 * endpoint tells you which build the live site is actually serving — useful
 * for verifying that a push landed (a failed Vercel build keeps serving the
 * previous deployment, silently).
 */
export const ENGINE_BUILD = "2026-10-11-engine-rename";

export function GET() {
  return Response.json({ build: ENGINE_BUILD, commit: process.env.RENDER_GIT_COMMIT ?? null }, { headers: { "Cache-Control": "no-store" } });
}
