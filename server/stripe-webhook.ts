// ─────────────────────────────────────────────────────────────────────────────
// Stripe webhook handler (PR-E2: lead packs).
//
// Stripe POSTs events here. We:
//   1) Verify the signature using STRIPE_WEBHOOK_SECRET (rejecting forged
//      requests). Requires the raw request body — `req.rawBody` is attached
//      by the express.json verify hook in server/index.ts.
//   2) Dedupe by event.id against payments_log.event_id (UNIQUE constraint).
//   3) For `checkout.session.completed` of a lead_pack_* product:
//        - resolve tradesman from metadata.tradesman_id
//        - grant credits via storage.setCredits + createCreditTransaction
//        - persist stripe_customer_id on the tradesman if newly created
//        - write a payments_log row with action='credits_granted'
//   4) For unknown event types: write a payments_log row with action='noop'
//      so we have a trail for future debugging.
//
// Featured Listing subscription events (invoice.paid, customer.subscription.*,
// invoice.payment_failed) and refund events land in PR-E3 / PR-E4.
// ─────────────────────────────────────────────────────────────────────────────
import type { Request, Response } from "express";
import type Stripe from "stripe";
import {
  stripe,
  STRIPE_WEBHOOK_SECRET,
  productKindFromPriceId,
  creditsForProductKind,
  type ProductKind,
} from "./stripe";
import { storage } from "./storage";

/**
 * Resolve the price id used in a Checkout Session by re-fetching line items.
 * Stripe doesn't include line items in the webhook payload by default — we
 * have to do a follow-up API call. This is documented in Stripe's webhook
 * payload reference.
 */
async function priceIdFromSession(sessionId: string): Promise<string | null> {
  const items = await stripe.checkout.sessions.listLineItems(sessionId, { limit: 1 });
  return items.data[0]?.price?.id ?? null;
}

/**
 * Express handler for POST /api/stripe/webhook.
 *
 * Always returns 200 on successfully-received events (even if our internal
 * handler decides it's a noop) so Stripe doesn't retry indefinitely. Returns
 * 400 only for signature failures, 500 for unexpected exceptions.
 */
export async function handleStripeWebhook(req: Request, res: Response): Promise<void> {
  const signature = req.headers["stripe-signature"];
  if (!signature || typeof signature !== "string") {
    res.status(400).send("Missing Stripe-Signature header");
    return;
  }

  // express.json's verify hook in server/index.ts attaches the raw Buffer
  // here. The Express Request type doesn't include it, hence the cast.
  const rawBody = (req as Request & { rawBody?: Buffer }).rawBody;
  if (!rawBody) {
    // express.json with our verify hook should always populate this. If it's
    // missing, the route was mounted wrong (e.g. behind a middleware that
    // re-parsed the body).
    res.status(400).send("Missing raw body — webhook route misconfigured");
    return;
  }

  let event: Stripe.Event;
  try {
    event = stripe.webhooks.constructEvent(rawBody, signature, STRIPE_WEBHOOK_SECRET);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown signature error";
    console.error("[stripe-webhook] signature verification failed:", message);
    res.status(400).send(`Webhook signature failed: ${message}`);
    return;
  }

  // ── Dedupe ──
  // Stripe retries failed deliveries up to 3 days. event.id is stable across
  // retries, so we use it as the idempotency key. The UNIQUE constraint on
  // payments_log.event_id means a duplicate insert throws — we swallow and
  // 200 so Stripe stops retrying.
  try {
    await processStripeEvent(event);
    res.status(200).json({ received: true });
  } catch (err) {
    // Catch duplicate-key (already-processed) errors as success — see comment
    // above. Anything else is a real handler bug; let Stripe retry.
    const message = err instanceof Error ? err.message : String(err);
    if (/duplicate key|unique constraint/i.test(message)) {
      console.log(`[stripe-webhook] dedupe hit for event ${event.id}`);
      res.status(200).json({ received: true, deduped: true });
      return;
    }
    console.error(`[stripe-webhook] handler error for ${event.id}:`, err);
    res.status(500).send("Internal error");
  }
}

async function processStripeEvent(event: Stripe.Event): Promise<void> {
  switch (event.type) {
    case "checkout.session.completed":
      await handleCheckoutCompleted(event);
      return;
    default:
      // Log unknown types so we know what to support next without hunting
      // through Stripe's dashboard event feed.
      await storage.createPaymentsLog({
        eventId: event.id,
        eventType: event.type,
        action: "noop",
        creditsDelta: 0,
        rawPayload: JSON.stringify(event).slice(0, 50_000),
        amountPence: null,
        currency: null,
        stripeCustomerId: null,
        stripeSubscriptionId: null,
        stripeCheckoutSessionId: null,
        stripePaymentIntentId: null,
        stripeInvoiceId: null,
        stripeChargeId: null,
        tradesmanId: null,
        productKind: null,
        notes: null,
      });
  }
}

async function handleCheckoutCompleted(event: Stripe.Event): Promise<void> {
  const session = event.data.object as Stripe.Checkout.Session;

  // Pull metadata we set when creating the session.
  const tradesmanIdRaw = session.metadata?.tradesman_id ?? session.client_reference_id;
  const tradesmanId = tradesmanIdRaw ? Number(tradesmanIdRaw) : null;

  // Resolve price → product kind. Featured subscriptions go through
  // `customer.subscription.created` instead; we ignore non-lead-pack checkout
  // sessions here (PR-E3 will add featured-via-checkout handling).
  const priceId = await priceIdFromSession(session.id);
  const productKind = productKindFromPriceId(priceId);

  const baseLog = {
    eventId: event.id,
    eventType: event.type,
    amountPence: session.amount_total ?? null,
    currency: session.currency ?? null,
    stripeCustomerId: typeof session.customer === "string" ? session.customer : null,
    stripeSubscriptionId: null,
    stripeCheckoutSessionId: session.id,
    stripePaymentIntentId:
      typeof session.payment_intent === "string" ? session.payment_intent : null,
    stripeInvoiceId: typeof session.invoice === "string" ? session.invoice : null,
    stripeChargeId: null,
    productKind,
    rawPayload: JSON.stringify(event).slice(0, 50_000),
  };

  // Guard rails — anything off → flag for admin, do not grant credits.
  if (!tradesmanId || Number.isNaN(tradesmanId)) {
    await storage.createPaymentsLog({
      ...baseLog,
      tradesmanId: null,
      action: "flagged_for_review",
      creditsDelta: 0,
      notes: "checkout.session.completed missing tradesman_id in metadata",
    });
    return;
  }

  if (!productKind || !productKind.startsWith("lead_pack_")) {
    // Not a lead pack — could be featured subscription (handled later) or an
    // unmapped price id. Either way, log and skip credit grant.
    await storage.createPaymentsLog({
      ...baseLog,
      tradesmanId,
      action: "flagged_for_review",
      creditsDelta: 0,
      notes: `Price ${priceId ?? "(none)"} did not resolve to a lead pack`,
    });
    return;
  }

  if (session.payment_status !== "paid") {
    // E.g. delayed bank-debit payment that's still pending. Don't grant yet —
    // Stripe will fire `checkout.session.async_payment_succeeded` later (not
    // yet handled; future work in PR-E4).
    await storage.createPaymentsLog({
      ...baseLog,
      tradesmanId,
      action: "noop",
      creditsDelta: 0,
      notes: `payment_status=${session.payment_status} — not granting yet`,
    });
    return;
  }

  const creditsToGrant = creditsForProductKind(productKind as ProductKind);

  // Persist customer id on the tradesman if Stripe created one this session.
  if (typeof session.customer === "string") {
    const t = await storage.getTradesmanById(tradesmanId);
    if (t && !t.stripeCustomerId) {
      await storage.updateTradesman(tradesmanId, { stripeCustomerId: session.customer });
    }
  }

  // Grant credits + ledger entry.
  const existing = await storage.getCredits(tradesmanId);
  const newBalance = (existing?.balance ?? 0) + creditsToGrant;
  await storage.setCredits(tradesmanId, newBalance);
  await storage.createCreditTransaction({
    tradesmanId,
    amount: creditsToGrant,
    reason: `Stripe purchase: ${productKind} (session ${session.id})`,
    relatedJobId: null,
  });

  await storage.createPaymentsLog({
    ...baseLog,
    tradesmanId,
    action: "credits_granted",
    creditsDelta: creditsToGrant,
    notes: null,
  });
}
