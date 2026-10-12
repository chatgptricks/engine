import { del } from "@vercel/blob";
import { handleUpload, type HandleUploadBody } from "@vercel/blob/client";
import { resolveEngineAccess } from "@/lib/engine/member";

export const runtime = "nodejs";

/**
 * Cloud uploads for the studio (Vercel Blob, client-upload pattern).
 *
 * The browser asks this route for a scoped upload token, then sends the file
 * DIRECTLY to Blob storage — so big videos never pass through a serverless
 * body limit. Files are public-read (they end up in Instagram posts anyway);
 * the token is minted only for an authed owner/member, restricted to image +
 * video types, capped at 512MB, and prefixed under gf/.
 *
 * GET reports whether Blob is connected, so the client can fall back to the
 * local data-URL path (images always; videos up to 8MB) when it isn't.
 */
export async function GET() {
  return Response.json({
    configured: Boolean(process.env.BLOB_READ_WRITE_TOKEN),
  });
}

/** Is this one of OUR blob files? Only store-hosted URLs under the gf/
 * prefix are deletable — never arbitrary URLs. */
function isOwnBlobUrl(url: string): boolean {
  try {
    const u = new URL(url);
    return (
      u.protocol === "https:" &&
      /(^|\.)public\.blob\.vercel-storage\.com$/.test(u.hostname) &&
      u.pathname.startsWith("/gf/")
    );
  } catch {
    return false;
  }
}

/** Delete uploaded files from Blob storage (called when a story is deleted,
 * so removed media doesn't keep accruing storage). Best-effort by design. */
export async function DELETE(request: Request) {
  if (!process.env.BLOB_READ_WRITE_TOKEN) {
    return Response.json({ deleted: 0 });
  }
  const access = await resolveEngineAccess();
  if (!access) {
    return Response.json({ error: "Unauthorized." }, { status: 401 });
  }
  const body = (await request.json().catch(() => null)) as {
    urls?: string[];
  } | null;
  const urls = (Array.isArray(body?.urls) ? body.urls : [])
    .filter((u): u is string => typeof u === "string")
    .filter(isOwnBlobUrl)
    .slice(0, 100);
  if (urls.length === 0) return Response.json({ deleted: 0 });
  try {
    await del(urls);
    return Response.json({ deleted: urls.length });
  } catch (err) {
    return Response.json(
      { error: err instanceof Error ? err.message : "Delete failed." },
      { status: 400 },
    );
  }
}

export async function POST(request: Request) {
  if (!process.env.BLOB_READ_WRITE_TOKEN) {
    return Response.json(
      {
        error:
          "Cloud uploads aren't connected — create a Blob store in Vercel (Storage → Blob) and BLOB_READ_WRITE_TOKEN appears automatically.",
      },
      { status: 503 },
    );
  }
  const access = await resolveEngineAccess();
  if (!access) {
    return Response.json({ error: "Unauthorized." }, { status: 401 });
  }

  const body = (await request.json().catch(() => null)) as HandleUploadBody | null;
  if (!body) return Response.json({ error: "Bad request." }, { status: 400 });

  try {
    const json = await handleUpload({
      body,
      request,
      onBeforeGenerateToken: async () => ({
        allowedContentTypes: [
          "image/jpeg",
          "image/png",
          "image/webp",
          "image/gif",
          "video/mp4",
          "video/webm",
          "video/quicktime",
        ],
        maximumSizeInBytes: 512 * 1024 * 1024,
        addRandomSuffix: true,
        tokenPayload: JSON.stringify({ owner: access.ownerKey }),
      }),
      // The story record is written client-side (curation lives in the
      // browser); nothing to persist here. (Note: this callback only fires
      // on publicly reachable deployments, never on localhost.)
      onUploadCompleted: async () => {},
    });
    return Response.json(json);
  } catch (err) {
    return Response.json(
      { error: err instanceof Error ? err.message : "Upload failed." },
      { status: 400 },
    );
  }
}
