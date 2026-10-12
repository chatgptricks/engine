import { NextResponse } from "next/server";
import { getStripe, isStripeConfigured } from "@/lib/stripe";
import { ENGINE_PLAN } from "@/lib/engine/plan";
import { makeMemberToken, membersEnabled } from "@/lib/engine/member";

export const runtime = "nodejs";

function siteUrl(request: Request): string {
  return (process.env.NEXT_PUBLIC_SITE_URL ?? new URL(request.url).origin).replace(
    /\/$/,
    "",
  );
}

/**
 * Engine — start a subscription checkout.
 *
 * POST { email, name? } → { url } to redirect the browser to.
 * Mock mode (no STRIPE_SECRET_KEY): skips Stripe entirely and returns the
 * member-grant URL directly, so the whole onboarding flow works in dev.
 */
export async function POST(request: Request) {
  if (!membersEnabled()) {
    return NextResponse.json({ error: "Subscriptions are disabled." }, { status: 404 });
  }
  const body = (await request.json().catch(() => ({}))) as {
    email?: string;
    name?: string;
  };
  const email = (body.email ?? "").trim().toLowerCase();
  if (!email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
    return NextResponse.json({ error: "Enter a valid email." }, { status: 400 });
  }
  const origin = siteUrl(request);

  // ---------- Mock mode ----------
  if (!isStripeConfigured()) {
    const token = makeMemberToken(email);
    return NextResponse.json({
      url: `${origin}/api/engine/member?token=${encodeURIComponent(token)}&mock=1`,
    });
  }

  // ---------- Real Stripe ----------
  const stripe = getStripe();
  if (!stripe) {
    return NextResponse.json({ error: "Stripe not initialized" }, { status: 500 });
  }
  const session = await stripe.checkout.sessions.create({
    mode: "subscription",
    customer_email: email,
    line_items: [
      ENGINE_PLAN.priceId
        ? { price: ENGINE_PLAN.priceId, quantity: 1 }
        : {
            quantity: 1,
            price_data: {
              currency: "usd",
              unit_amount: ENGINE_PLAN.priceMonthly,
              recurring: { interval: "month" },
              product_data: {
                name: ENGINE_PLAN.name,
                description: ENGINE_PLAN.description,
              },
            },
          },
    ],
    metadata: { product: "engine", name: body.name ?? "" },
    success_url: `${origin}/api/engine/subscribe/success?session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${origin}/engine/start?canceled=1`,
    allow_promotion_codes: true,
  });
  if (!session.url) {
    return NextResponse.json(
      { error: "Stripe returned no checkout URL" },
      { status: 500 },
    );
  }
  return NextResponse.json({ url: session.url });
}
