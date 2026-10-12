import { NextResponse } from "next/server";
import { getStripe } from "@/lib/stripe";
import {
  MEMBER_COOKIE,
  MEMBER_TTL_DAYS,
  makeMemberToken,
  memberExpiry,
  membersEnabled,
} from "@/lib/engine/member";

export const runtime = "nodejs";

/**
 * Stripe redirects here after a successful Engine subscription
 * checkout. Re-fetch the session, confirm it's paid, mint the gf_member
 * cookie, and land the new member inside the studio.
 */
export async function GET(request: Request) {
  if (!membersEnabled()) {
    return NextResponse.json({ error: "Subscriptions are disabled." }, { status: 404 });
  }
  const url = new URL(request.url);
  const sessionId = url.searchParams.get("session_id");
  if (!sessionId) {
    return NextResponse.json({ error: "Missing session_id" }, { status: 400 });
  }
  const stripe = getStripe();
  if (!stripe) {
    return NextResponse.json({ error: "Stripe not configured" }, { status: 500 });
  }

  const session = await stripe.checkout.sessions.retrieve(sessionId);
  const email = session.customer_email ?? session.customer_details?.email;
  if (!email || (session.status !== "complete" && session.payment_status !== "paid")) {
    return NextResponse.redirect(new URL("/engine/start", url.origin));
  }

  const token = makeMemberToken(email, memberExpiry());
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
