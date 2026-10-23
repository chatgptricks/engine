/**
 * Server-side Supabase auth client for the /admin surface.
 *
 * Uses @supabase/ssr's createServerClient so session cookies set by the
 * magic-link callback persist across requests. The publishable (anon)
 * key is fine here — the auth client only needs to read its own
 * session cookies and validate the user, not bypass RLS. Privileged
 * reads of the archive tables go through lib/supabase/admin.ts.
 *
 * The cookie adapter writes are wrapped in try/catch because Server
 * Components in Next.js 16 cannot mutate cookies during render — only
 * Server Actions and Route Handlers can. The auth helper silently
 * drops the write when called from a Server Component, matching the
 * pattern recommended in @supabase/ssr's docs.
 */
import { createServerClient } from "@supabase/ssr";
import { cookies, headers } from "next/headers";
import { isOwnerEmail } from "@/lib/owners";

export async function getAuthServerClient() {
  const cookieStore = await cookies();
  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL ?? "",
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? "",
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options),
            );
          } catch {
            // Server Component — cookies are read-only here. The next
            // round-trip through a Route Handler or Server Action will
            // refresh the session cookies if needed.
          }
        },
      },
    },
  );
}

/**
 * Resolve the current admin user, returning null when there's no
 * session OR when the session belongs to an email that isn't the
 * owner (see lib/owners.ts). Use this in admin layouts/pages to gate access.
 */
export async function getCurrentAdminUser(): Promise<{
  email: string;
} | null> {
  const authorization=(await headers()).get("authorization");
  if(authorization!==null&&!/^Bearer [A-Za-z0-9._-]+$/.test(authorization))return null;
  const supabase = await getAuthServerClient();
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser(authorization?.slice(7));
  // An upstream outage is retryable, not evidence that the user signed out.
  if(error && ((error.status ?? 0) >= 500 || error.name === "AuthRetryableFetchError")) throw error;
  if (!user?.email) return null;
  if (!isOwnerEmail(user.email)) return null;
  return { email: user.email };
}
