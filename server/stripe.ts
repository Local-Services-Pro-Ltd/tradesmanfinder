// ─────────────────────────────────────────────────────────────────────────────
// Stripe wrapper module (PR-E1: foundation only).
//
// This file is intentionally thin — it exposes a configured Stripe client,
// product/price catalogue lookups, and a `productKindFromPriceId` resolver.
// All actual payment flow code (checkout session creation, webhook handlers)
// lands in PR-E2 (lead packs) and PR-E3 (Featured subscription).
//
// Env vars expected (Vercel: Production + Preview; Test Mode values for
// non-production):
//   STRIPE_SECRET_KEY              — sk_test_... in test, sk_live_... in prod
//   STRIPE_WEBHOOK_SECRET          — whsec_... from Stripe dashboard webhook config
//   STRIPE_PRICE_LEAD_PACK_5       — price_... for £25  → 5 lead credits
//   STRIPE_PRICE_LEAD_PACK_10      — price_... for £45  → 10 lead credits
//   STRIPE_PRICE_LEAD_PACK_20      — price_... for £80  → 20 lead credits
//   STRIPE_PRICE_FEATURED_MONTHLY  — price_... for £29/mo subscription
//
// Missing env vars cause module-load to throw in production (fail-fast) but
// only warn in development so local work without Stripe access is possible.
// ─────────────────────────────────────────────────────────────────────────────

import Stripe from "stripe";

const isProd = process.env.NODE_ENV === "production";

function requireEnv(key: string): string {
  const value = process.env[key];
  if (!value) {
    if (isProd) {
      throw new Error(`[stripe] Missing required env var ${key} in production`);
    }
    console.warn(`[stripe] ${key} is not set — Stripe flows will fail. OK in local dev.`);
    return "";
  }
  return value;
}

const STRIPE_SECRET_KEY = requireEnv("STRIPE_SECRET_KEY");

export const stripe: Stripe = new Stripe(STRIPE_SECRET_KEY || "sk_test_unset", {
  apiVersion: "2025-02-24.acacia",
  appInfo: {
    name: "TradesmanFinder",
    url: "https://tradesmanfinder.com",
  },
  // Stripe SDK's built-in retry — webhooks idempotency handles duplicate
  // event processing on our side, so we can be aggressive here.
  maxNetworkRetries: 2,
});

export const STRIPE_WEBHOOK_SECRET = requireEnv("STRIPE_WEBHOOK_SECRET");

// ── Product / price catalogue ───────────────────────────────────────────────
// Keep these tight: the union types act as guard rails downstream. Adding a
// new product = update both PRODUCT_KINDS and PRICE_TO_PRODUCT below.

export const PRODUCT_KINDS = [
  "lead_pack_5",
  "lead_pack_10",
  "lead_pack_20",
  "featured_monthly",
] as const;

export type ProductKind = (typeof PRODUCT_KINDS)[number];

/**
 * Lead-pack catalogue. Source of truth for credits-per-pack mapping.
 * Prices are stored in Stripe (not here) — this table only mirrors what's
 * shown in the dashboard UI for sanity. If you change pence here, also
 * update the Stripe price object and the dashboard credit-pack list.
 */
export const LEAD_PACKS: Record<
  Extract<ProductKind, `lead_pack_${number}`>,
  { credits: number; pricePence: number; displayPrice: string }
> = {
  lead_pack_5:  { credits: 5,  pricePence: 2500, displayPrice: "£25" },
  lead_pack_10: { credits: 10, pricePence: 4500, displayPrice: "£45" },
  lead_pack_20: { credits: 20, pricePence: 8000, displayPrice: "£80" },
};

export const FEATURED_LISTING = {
  pricePence: 2900,
  displayPrice: "£29/mo",
} as const;

/**
 * Resolve a Stripe price id back to our internal product kind.
 *
 * Webhooks arrive with price ids but no semantic meaning. This is the one
 * place we authoritatively map "price_xyz → which product was bought" so
 * downstream handlers can switch on a typed enum.
 *
 * Returns null if the price id matches none of our configured products —
 * webhook handler should log this to payments_log as 'flagged_for_review'
 * (could indicate a Stripe dashboard price that wasn't wired into env vars).
 */
export function productKindFromPriceId(priceId: string | null | undefined): ProductKind | null {
  if (!priceId) return null;
  const map: Record<string, ProductKind> = {};
  if (process.env.STRIPE_PRICE_LEAD_PACK_5)      map[process.env.STRIPE_PRICE_LEAD_PACK_5]      = "lead_pack_5";
  if (process.env.STRIPE_PRICE_LEAD_PACK_10)     map[process.env.STRIPE_PRICE_LEAD_PACK_10]     = "lead_pack_10";
  if (process.env.STRIPE_PRICE_LEAD_PACK_20)     map[process.env.STRIPE_PRICE_LEAD_PACK_20]     = "lead_pack_20";
  if (process.env.STRIPE_PRICE_FEATURED_MONTHLY) map[process.env.STRIPE_PRICE_FEATURED_MONTHLY] = "featured_monthly";
  return map[priceId] ?? null;
}

/**
 * Credits granted by a given product kind. Returns 0 for non-credit products
 * (e.g. Featured Listing subscription).
 */
export function creditsForProductKind(kind: ProductKind): number {
  if (kind === "featured_monthly") return 0;
  return LEAD_PACKS[kind].credits;
}

/**
 * True if the running process has Stripe configured well enough to attempt a
 * checkout. Lets API handlers return a clean 503 instead of crashing during
 * the brief window when env vars are mid-rotation in Vercel.
 */
export function stripeIsConfigured(): boolean {
  return Boolean(
    STRIPE_SECRET_KEY &&
    STRIPE_WEBHOOK_SECRET &&
    process.env.STRIPE_PRICE_LEAD_PACK_5 &&
    process.env.STRIPE_PRICE_LEAD_PACK_10 &&
    process.env.STRIPE_PRICE_LEAD_PACK_20 &&
    process.env.STRIPE_PRICE_FEATURED_MONTHLY
  );
}
