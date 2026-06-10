// ─────────────────────────────────────────────────────────────────────────────
// Stripe Billing Portal session creation (PR-E3c).
//
// The Customer Portal is Stripe's hosted page where customers can:
//   - update payment method
//   - download invoices
//   - cancel subscriptions (cancel-at-period-end, then we get
//     customer.subscription.{updated,deleted} → handled by PR-E3b)
//   - update billing address / tax id
//
// We hand them off to Stripe rather than building these screens ourselves —
// same PCI / regulatory rationale as Checkout. The only thing we own is the
// "Manage billing" button on the dashboard that POSTs to /api/billing/portal
// and a 302 redirect into the returned URL.
//
// Portal *behaviour* (which actions are exposed, which products are upgradable
// to which) is configured once in the Stripe Dashboard under
// Settings → Billing → Customer portal. We don't pass a configuration id here
// so Stripe uses the live-mode default; if we ever need test/live divergence
// we can thread STRIPE_PORTAL_CONFIGURATION_ID through here.
// ─────────────────────────────────────────────────────────────────────────────
import type Stripe from "stripe";
import { stripe } from "./stripe";

const APP_BASE_URL =
  process.env.APP_BASE_URL ||
  (process.env.NODE_ENV === "production"
    ? "https://tradesmanfinder.com"
    : "http://localhost:5173");

export interface CreatePortalSessionInput {
  /** Must be set on the tradesman row — i.e. they've completed at least one
   *  Checkout. If null, the route handler should 409 with a clear message. */
  stripeCustomerId: string;
  /** Where to send the user when they click "Return to TradesmanFinder" in the
   *  portal. Defaults to the dashboard. We bounce through /checkout/return to
   *  dodge the hash-fragment-drop bug documented in routes.ts. */
  returnPath?: string;
}

export interface CreatePortalSessionResult {
  url: string;
}

export async function createBillingPortalSession(
  input: CreatePortalSessionInput,
): Promise<CreatePortalSessionResult> {
  const returnUrl = `${APP_BASE_URL}/checkout/return?id=0&result=success&kind=portal`;
  const params: Stripe.BillingPortal.SessionCreateParams = {
    customer: input.stripeCustomerId,
    return_url: input.returnPath
      ? `${APP_BASE_URL}${input.returnPath}`
      : returnUrl,
  };
  const session = await stripe.billingPortal.sessions.create(params);
  return { url: session.url };
}
