/**
 * Featured Listing UX state machine (PR-D2).
 *
 * Reduces the (featuredUntil, subscriptionStatus) pair to one of four UX
 * buckets so the dashboard's Featured card can switch on a single
 * discriminant. Lives in shared/ so the same rules can be unit-tested by the
 * server test runner and reused on any future SSR surface that needs to
 * decide whether to render a Featured badge.
 *
 * State mapping:
 *   none      — never featured, or featuredUntil has lapsed and there is no
 *               recoverable subscription. Render the upsell CTA.
 *   active    — featuredUntil is in the future AND subscriptionStatus is one
 *               of {active, trialing}. Show "Featured until DATE" + portal.
 *   past_due  — subscriptionStatus is "past_due" regardless of featuredUntil.
 *               Stripe Smart Retries are still attempting the charge; we
 *               warn the user but keep Featured visible until the past-due
 *               sweep cron clears featuredUntil (PR-E3e). The CTA points at
 *               the customer billing portal so they can fix the card.
 *   lapsing   — user cancelled (or status === "unpaid") but featuredUntil is
 *               still in the future, i.e. Featured remains live through the
 *               paid period. Show "Ends DATE, resubscribe" CTA.
 */
export type FeaturedState = "none" | "active" | "past_due" | "lapsing";

export function getFeaturedState(
  featuredUntil: number | null | undefined,
  subscriptionStatus: string | null | undefined,
  now: number = Date.now(),
): FeaturedState {
  const isPaidThrough = typeof featuredUntil === "number" && featuredUntil > now;

  // past_due wins regardless of featuredUntil — the sweep cron (PR-E3e)
  // may not yet have cleared featuredUntil even if grace days have elapsed.
  if (subscriptionStatus === "past_due") return "past_due";

  // "canceled" + paid-through means: user cancelled but is still featured
  // until the current period ends. "unpaid" lands the same — Stripe gave up
  // retrying but the period hasn't elapsed yet.
  if (isPaidThrough && (subscriptionStatus === "canceled" || subscriptionStatus === "unpaid")) {
    return "lapsing";
  }

  if (isPaidThrough && (subscriptionStatus === "active" || subscriptionStatus === "trialing")) {
    return "active";
  }

  // Anything else — no subscription, expired featuredUntil, unrecognised
  // status — falls through to the upsell.
  return "none";
}

/** en-GB short month, e.g. "7 Jul 2026". UK-only marketplace, no i18n needed. */
export function formatFeaturedDate(ms: number): string {
  return new Date(ms).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
}
