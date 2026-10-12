/**
 * Engine — the app's subscription plan. One monthly plan for v1.
 *
 * Single source of truth: the onboarding page and the subscribe route both
 * read this. Set GF_STRIPE_PRICE_ID (a recurring Stripe Price) to charge for
 * real; without a Stripe key the flow runs in mock mode end to end.
 */

export interface EnginePlan {
  name: string;
  description: string;
  /** Monthly price in cents. */
  priceMonthly: number;
  /** Optional pre-created Stripe recurring Price ID. */
  priceId?: string;
  /** What the subscription includes — shown on the onboarding card. */
  includes: string[];
}

export const ENGINE_PLAN: EnginePlan = {
  name: "Engine",
  description:
    "The story studio — autonomous research, image curation, and Instagram-ready carousels for every channel you run.",
  priceMonthly: 2900, // $29.00 / mo — keep synced to GF_STRIPE_PRICE_ID
  priceId: process.env.GF_STRIPE_PRICE_ID,
  includes: [
    "Autonomous story research with live web verification",
    "Curated real-image pools for every story",
    "Carousel composer with templates and exact-pixel exports",
    "Multiple Instagram channels in one studio",
  ],
};

export function formatPlanPrice(cents: number): string {
  return `$${(cents / 100).toFixed(cents % 100 === 0 ? 0 : 2)}`;
}
