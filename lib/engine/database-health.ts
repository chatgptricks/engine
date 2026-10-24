import "server-only";
import {getAdminSupabase} from "@/lib/supabase/admin";

const SUCCESS_INTERVAL = 6 * 60 * 60 * 1000;
const FAILURE_INTERVAL = 60 * 60 * 1000;
const PROBE_TIMEOUT = 5000;
const STATE = Symbol.for("engine.database-health-probe");
type ProbeState = {nextAt: number; inFlight: Promise<void> | null};

/** Reuse Render's health requests for a bounded, infrequent database check.
 * No artwork, writes, scheduled jobs, or health-response dependencies. */
export function triggerDatabaseHealthProbe(): void {
  if (process.env.NODE_ENV !== "production" || process.env.RENDER !== "true" || process.env.IS_PULL_REQUEST === "true" || !process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) return;
  const shared = globalThis as typeof globalThis & {[STATE]?: ProbeState};
  const state = shared[STATE] ??= {nextAt: 0, inFlight: null};
  if (state.inFlight || Date.now() < state.nextAt) return;
  // Reserve synchronously across route bundles and concurrent health checks.
  // Deferring all client/query work keeps the version response independent.
  state.inFlight = Promise.resolve().then(async () => {
    let success = false;
    try {
      const db = getAdminSupabase();
      if (!db) throw new Error("Database client unavailable.");
      const {error} = await db.from("gf_client_state").select("owner").eq("owner", "template-editor:owner").limit(1).abortSignal(AbortSignal.timeout(PROBE_TIMEOUT));
      if (error) throw new Error("Database health check unavailable.");
      success = true;
      console.info("[engine] Database health check succeeded.");
    } catch {
      // Never log provider errors, rows, URLs, or credentials.
      console.warn("[engine] Database health check unavailable; retrying after cooldown.");
    } finally {
      state.nextAt = Date.now() + (success ? SUCCESS_INTERVAL : FAILURE_INTERVAL);
      state.inFlight = null;
    }
  });
}
