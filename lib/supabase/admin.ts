/**
 * Service-role Supabase client for the /admin surface.
 *
 * The service_role key bypasses RLS. It can read every conversation,
 * signup, and application — exactly what the admin dashboard needs.
 *
 * Trust boundary:
 *   This client must NEVER be imported into a client component or any
 *   code that runs in the browser. The auth wall in front of /admin
 *   (lib/supabase/auth-server.ts + the (authed) route group's layout)
 *   ensures only OWNER_EMAIL can reach routes that use it.
 *
 *   The key itself is read from `SUPABASE_SERVICE_ROLE_KEY` (no
 *   NEXT_PUBLIC_ prefix on purpose — Next.js will refuse to bundle it
 *   into the client). If the env var is missing, this helper returns
 *   null so /admin can render a clear configuration error instead of
 *   a generic 500.
 */
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

let _admin: SupabaseClient | null = null;

export function getAdminSupabase(): SupabaseClient | null {
  if (_admin) return _admin;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  _admin = createClient(url, key, {
    auth: {
      // No session — this is a server-only privileged client.
      autoRefreshToken: false,
      persistSession: false,
    },
    global: {
      headers: {
        "x-application": "engine",
      },
    },
  });
  return _admin;
}
