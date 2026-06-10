// ─────────────────────────────────────────────────────────────────────────────
// Stripe Checkout Session creation (PR-E2: lead packs).
//
// Wraps Stripe's checkout.sessions.create() with TradesmanFinder-specific
// defaults: GBP currency, success/cancel URLs pointing at the dashboard, and
// metadata that lets the webhook handler resolve a session back to the
// tradesman + product without an extra DB lookup.
//
// We use Checkout (hosted by Stripe) rather than Stripe Elements / Payment
// Intents because:
//   1) PCI scope stays out of our server entirely
//   2) Stripe handles 3DS, wallets (Apple Pay, Google Pay) automatically
//   3) One code path for one-off (lead packs) and recurring (Featured) — only
//      `mode` and the price recurring flag differ
// ─────────────────────────────────────────────────────────────────────────────
import type Stripe from "stripe";
import { stripe, productKindFromPriceId, type ProductKind } from "./stripe";

const APP_BASE_URL =
  process.env.APP_BASE_URL ||
  (process.env.NODE_ENV === "production"
    ? "https://tradesmanfinder.com"
    : "http://localhost:5173");

export interface CreateLeadPackCheckoutInput {
  tradesmanId: number;
  tradesmanEmail: string;
  /** Existing Stripe customer id if we've ever charged this tradesman, else null. */
  stripeCustomerId: string | null;
  /** Stripe price id — must be one of the configured STRIPE_PRICE_LEAD_PACK_* env vars. */
  priceId: string;
}

export interface CreateLeadPackCheckoutResult {
  sessionId: string;
  url: string;
  productKind: ProductKind;
}

/**
 * Create a one-off Checkout Session for a lead pack purchase.
 *
 * Throws if the priceId doesn't match a configured lead pack — caller should
 * return 400 to the client. This prevents drive-by callers from passing
 * arbitrary Stripe prices (e.g. the Featured Listing price) through this
 * one-off endpoint.
 */
export async function createLeadPackCheckoutSession(
  input: CreateLeadPackCheckoutInput,
): Promise<CreateLeadPackCheckoutResult> {
  const productKind = productKindFromPriceId(input.priceId);
  if (!productKind || !productKind.startsWith("lead_pack_")) {
    throw new Error(`Price ${input.priceId} is not a valid lead pack`);
  }

  // Pass tradesmanId in metadata so the webhook can reconcile without a
  // customer-id lookup. `client_reference_id` is also set so the dashboard
  // shows it next to the session for debugging.
  const params: Stripe.Checkout.SessionCreateParams = {
    mode: "payment",
    line_items: [{ price: input.priceId, quantity: 1 }],
    // Stripe redirects via HTTP 303, which historically strips URL fragments
    // (#/...). Our SPA uses HashRouter, so a bare /#/dashboard?... target
    // intermittently lost its hash in browsers and produced a 404. To make this
    // deterministic, we route Stripe back to a server-side bounce endpoint
    // that issues a 302 to the proper hash-routed URL on the client. The 302
    // preserves the hash fragment reliably across all browsers we tested.
    success_url: `${APP_BASE_URL}/checkout/return?id=${input.tradesmanId}&result=success&session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${APP_BASE_URL}/checkout/return?id=${input.tradesmanId}&result=cancel`,
    client_reference_id: String(input.tradesmanId),
    metadata: {
      tradesman_id: String(input.tradesmanId),
      product_kind: productKind,
    },
    // Reuse the customer id if we have one (keeps the Stripe customer record
    // tied to billing history). Otherwise let Stripe create one and we'll
    // store it via the webhook.
    ...(input.stripeCustomerId
      ? { customer: input.stripeCustomerId }
      : { customer_email: input.tradesmanEmail, customer_creation: "always" }),
    // Payment-method-types defaults to card; explicit list keeps it predictable
    // across Stripe account configurations.
    payment_method_types: ["card"],
    // Allow promotion codes UI in case we later add discount campaigns —
    // no codes are active by default so this is free to leave on.
    allow_promotion_codes: true,
  };

  const session = await stripe.checkout.sessions.create(params);

  if (!session.url) {
    // Stripe.checkout.sessions.create should always return a url for hosted
    // mode — defensive check so callers get a clean error instead of a null
    // redirect.
    throw new Error("Stripe returned a checkout session without a URL");
  }

  return { sessionId: session.id, url: session.url, productKind };
}

// ─────────────────────────────────────────────────────────────────────────────
// Featured Listing subscription Checkout (PR-E3a).
//
// Mirrors createLeadPackCheckoutSession but in subscription mode. Webhook
// handling for invoice.paid / customer.subscription.* lands in PR-E3b — this
// PR only opens the Checkout session so the user can subscribe end-to-end.
// ─────────────────────────────────────────────────────────────────────────────

export interface CreateFeaturedCheckoutInput {
  tradesmanId: number;
  tradesmanEmail: string;
  /** Existing Stripe customer id if we've ever charged this tradesman, else null. */
  stripeCustomerId: string | null;
  /** Stripe price id — must be the configured STRIPE_PRICE_FEATURED_MONTHLY value. */
  priceId: string;
}

export interface CreateFeaturedCheckoutResult {
  sessionId: string;
  url: string;
  productKind: ProductKind;
}

/**
 * Create a subscription Checkout Session for the Featured Listing product.
 *
 * Throws if the priceId doesn't resolve to `featured_monthly` — caller should
 * return 400. This prevents drive-by callers from passing a lead-pack price
 * through this subscription endpoint (which would silently create a one-off-
 * looking subscription record).
 */
export async function createFeaturedCheckoutSession(
  input: CreateFeaturedCheckoutInput,
): Promise<CreateFeaturedCheckoutResult> {
  const productKind = productKindFromPriceId(input.priceId);
  if (productKind !== "featured_monthly") {
    throw new Error(`Price ${input.priceId} is not the Featured Listing subscription`);
  }

  // Subscription mode parity with the lead-pack flow: same metadata shape so
  // the webhook handler can treat session.metadata.tradesman_id as a single
  // source of truth across both modes.
  //
  // We intentionally do NOT pass `payment_method_collection: "if_required"` —
  // for a recurring product we always want a card on file so renewals
  // succeed without a customer interaction.
  const params: Stripe.Checkout.SessionCreateParams = {
    mode: "subscription",
    line_items: [{ price: input.priceId, quantity: 1 }],
    success_url: `${APP_BASE_URL}/checkout/return?id=${input.tradesmanId}&result=success&kind=featured&session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${APP_BASE_URL}/checkout/return?id=${input.tradesmanId}&result=cancel&kind=featured`,
    client_reference_id: String(input.tradesmanId),
    metadata: {
      tradesman_id: String(input.tradesmanId),
      product_kind: productKind,
    },
    // Subscription metadata is separate from session metadata — propagate the
    // same tradesman_id so future subscription.* events (renewal, cancellation)
    // can be reconciled without joining via the customer id alone.
    subscription_data: {
      metadata: {
        tradesman_id: String(input.tradesmanId),
        product_kind: productKind,
      },
    },
    ...(input.stripeCustomerId
      ? { customer: input.stripeCustomerId }
      : { customer_email: input.tradesmanEmail, customer_creation: "always" }),
    payment_method_types: ["card"],
    allow_promotion_codes: true,
  };

  const session = await stripe.checkout.sessions.create(params);

  if (!session.url) {
    throw new Error("Stripe returned a checkout session without a URL");
  }

  return { sessionId: session.id, url: session.url, productKind };
}
