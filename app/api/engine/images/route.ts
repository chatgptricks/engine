import { resolveEngineAccess } from "@/lib/engine/member";
import { searchXImages } from "@/lib/engine/apify";
import { curateImages } from "@/lib/engine/image-curator";

export const runtime = "nodejs";
export const maxDuration = 300;

/**
 * Engine — on-demand X image fetch ("More from X").
 *
 * Owner-gated. X now runs automatically during research, so this endpoint is
 * the manual top-up: same X search, fired from the gallery dock when the
 * curator wants more options. Needs APIFY_TOKEN.
 */

interface DirectiveIn {
  directive: string;
  source: string;
  kind: string;
}

export async function POST(request: Request) {
  const access = await resolveEngineAccess();
  if (!access) {
    return Response.json({ error: "Unauthorized." }, { status: 401 });
  }
  if (!process.env.APIFY_TOKEN) {
    return Response.json(
      { error: "Apify is not configured (APIFY_TOKEN missing)." },
      { status: 503 },
    );
  }

  const body = (await request.json().catch(() => ({}))) as {
    subject?: string;
    directives?: DirectiveIn[];
    /** Story summary, for the vision curation pass. */
    summary?: string;
  };
  const subject = (body.subject ?? "").trim();
  const directives = Array.isArray(body.directives) ? body.directives : [];
  // Subject-first, quoted — X then matches the actual topic instead of
  // loosely co-occurring slop. The directive sentence is only a fallback.
  const xTerm = subject
    ? subject.split(/\s+/).length === 1
      ? subject
      : `"${subject}"`
    : directives.map((d) => d.directive).filter(Boolean)[0] || "";

  const found = await searchXImages(xTerm, 30);
  // Vision pass: drop the off-topic, describe the kept (~20 words each).
  const images = await curateImages(found, {
    title: subject || xTerm,
    summary: (body.summary ?? "").slice(0, 400),
  });
  return Response.json({ images });
}
