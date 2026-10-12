import { NextResponse } from "next/server";
import { resolveEngineAccess } from "@/lib/engine/member";
import {
  deleteIgCredential,
  listIgConnections,
  refreshIgCredentialIfStale,
} from "@/lib/engine/ig-store";

export const runtime = "nodejs";

/**
 * Instagram connection status for the current user's channels.
 *
 * GET → { connections: [{ channelId, username, igUserId, expiresAt }] }
 * (token-free). This is the cross-device source of truth the Channels screen
 * reconciles against — a connection made on one device shows up everywhere.
 * Tokens nearing expiry are refreshed best-effort on read.
 *
 * DELETE ?channel=<id> → disconnect that channel's Instagram login.
 */
export async function GET() {
  const access = await resolveEngineAccess();
  if (!access) return NextResponse.json({ connections: [] });
  const connections = await listIgConnections(access.ownerKey);
  // Keep long-lived tokens alive while the curator is around to trigger it.
  for (const c of connections) {
    void refreshIgCredentialIfStale(access.ownerKey, c.channelId);
  }
  return NextResponse.json({ connections });
}

export async function DELETE(request: Request) {
  const access = await resolveEngineAccess();
  if (!access) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }
  const channel = new URL(request.url).searchParams.get("channel");
  if (!channel) {
    return NextResponse.json({ error: "Missing channel." }, { status: 400 });
  }
  await deleteIgCredential(access.ownerKey, channel);
  return NextResponse.json({ ok: true });
}
