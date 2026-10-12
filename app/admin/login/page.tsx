import { Suspense } from "react";
import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getCurrentAdminUser } from "@/lib/supabase/auth-server";
import { AdminLoginForm } from "./login-form";

export const metadata: Metadata = {
  title: "Sign in · Engine",
  robots: { index: false, follow: false },
};

/**
 * /admin/login — the only unauthenticated page in the /admin tree.
 *
 * If the visitor already has a valid admin session, redirect straight
 * to the dashboard so they don't have to re-authenticate. Otherwise
 * render the email-link form. The form posts to
 * /api/admin/send-magic-link which silently no-ops for any email
 * not listed in OWNER_EMAIL.
 */
export default async function AdminLoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  // Local development stays open; a production deployment must have auth.
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL) {
    if (process.env.NODE_ENV !== "production") redirect("/admin/engine");
    return <main className="mx-auto flex min-h-screen max-w-md items-center px-6 text-muted">Sign-in is not configured.</main>;
  }

  const user = await getCurrentAdminUser();
  if (user) redirect("/admin/engine");

  const { error } = await searchParams;

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-md flex-col items-center justify-center px-6">
      <div className="w-full space-y-6">
        <header className="space-y-2 text-center">
          <p className="text-[11px] font-medium uppercase tracking-[0.2em] text-muted">
            Engine
          </p>
          <h1 className="text-[28px] font-semibold tracking-tight text-fg">
            Sign in
          </h1>
          <p className="text-[14px] leading-[1.65] text-muted">
            Enter your email. If you&rsquo;re on the allowlist, a sign-in
            link will arrive in your inbox.
          </p>
        </header>
        <Suspense>
          <AdminLoginForm initialError={errorMessage(error)} />
        </Suspense>
      </div>
    </main>
  );
}

function errorMessage(code: string | undefined): string | null {
  if (!code) return null;
  if (code === "not-authorized") return "That email isn't authorized.";
  if (code === "link-expired") return "That link has expired. Try again.";
  return code;
}
