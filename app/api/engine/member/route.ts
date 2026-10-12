import { NextResponse } from "next/server";
import {
  MEMBER_COOKIE,
  MEMBER_TTL_DAYS,
  verifyMemberToken,
  membersEnabled,
} from "@/lib/engine/member";

export const runtime = "nodejs";

/**
 * Grant/recover Engine membership on this device.
 *
 * Visiting /api/engine/member?token=<token> validates the HMAC and
 * sets the gf_member cookie. Used by mock-mode checkout today and by emailed
 * recovery links later (same pattern as the skills subscriber unlock).
 */
export async function GET(request: Request) {
  if (!membersEnabled()) {
    return NextResponse.json({ error: "Membership is disabled." }, { status: 404 });
  }
  const url = new URL(request.url);
  const token = url.searchParams.get("token");
  if (!token) {
    return NextResponse.json({ error: "Missing token" }, { status: 400 });
  }
  const claim = verifyMemberToken(token);
  if (!claim) {
    return NextResponse.json({ error: "Invalid or expired token" }, { status: 400 });
  }
  const response = NextResponse.redirect(
    new URL("/admin/engine?welcome=1", url.origin),
  );
  response.cookies.set(MEMBER_COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: MEMBER_TTL_DAYS * 24 * 60 * 60,
  });
  return response;
}
