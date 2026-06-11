// ─────────────────────────────────────────────────────────────────────────────
// Stripe webhook handler (PR-E2: lead packs; PR-E3b: featured subscriptions).
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
// PR-E3b adds:
//   - checkout.session.completed for `featured_monthly`: persist
//     stripeCustomerId/stripeSubscriptionId/subscriptionStatus/featuredUntil.
//   - invoice.paid (renewals): bump featuredUntil to current_period_end.
//   - customer.subscription.updated: sync subscriptionStatus + featuredUntil;
//     past_due → action='featured_degraded' for dunning visibility.
//   - customer.subscription.deleted: mark canceled, clear stripeSubscriptionId,
//     but leave featuredUntil intact so the tradesperson keeps featured for
//     the remainder of the period they already paid for.
//
// Reconciliation order for subscription events:
//   subscription.metadata.tradesman_id → session.metadata.tradesman_id
//   → storage.getTradesmanByStripeSubscriptionId
//   → storage.getTradesmanByStripeCustomerId
//   → flagged_for_review.
//
// charge.refunded (PR-E3d): revoke lead-pack credits proportional to the
//   refund amount. Featured subscriptions are out of scope here — cancellation
//   flows through customer.subscription.deleted (PR-E3b).
// past_due degradation timer → PR-E3e.
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
    case "invoice.paid":
      await handleInvoicePaid(event);
      return;
    case "customer.subscription.updated":
      await handleSubscriptionUpdated(event);
      return;
    case "customer.subscription.deleted":
      await handleSubscriptionDeleted(event);
      return;
    case "charge.refunded":
      await handleChargeRefunded(event);
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

  if (productKind === "featured_monthly") {
    // Featured Listing subscription bought via Checkout — provision the row.
    await handleFeaturedCheckoutCompleted(event, session, tradesmanId, baseLog);
    return;
  }

  if (!productKind || !productKind.startsWith("lead_pack_")) {
    // Unmapped price id — probably a dashboard price not wired into env vars.
    await storage.createPaymentsLog({
      ...baseLog,
      tradesmanId,
      action: "flagged_for_review",
      creditsDelta: 0,
      notes: `Price ${priceId ?? "(none)"} did not resolve to a known product`,
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

// ── Featured Listing subscription handlers (PR-E3b) ─────────────────────────

/**
 * Subscription.current_period_end is unix-seconds in older API versions and
 * has moved to items[].current_period_end on newer ones. We check both for
 * forward-compat and return unix-ms (matching the rest of the schema, which
 * uses Date.now()-style timestamps).
 */
function periodEndMs(sub: Stripe.Subscription): number | null {
  const sec =
    (sub as unknown as { current_period_end?: number }).current_period_end ??
    (sub.items?.data?.[0] as unknown as { current_period_end?: number } | undefined)?.current_period_end ??
    null;
  return typeof sec === "number" ? sec * 1000 : null;
}

/**
 * Map Stripe's subscription state onto our product's `subscriptionStatus`.
 *
 * Stripe represents a portal-initiated "cancel at period end" as
 * `{ status: 'active', cancel_at_period_end: true }` until the period ends,
 * at which point it fires `subscription.deleted` and flips status to
 * 'canceled'. Mirroring Stripe's status verbatim would leave the dashboard
 * stuck in the green "active" state for the entire paid-through window
 * (up to ~a month) even after the user cancels, which is the opposite of
 * what the `lapsing` UX in shared/featured-state.ts is for.
 *
 * Treat customer intent-to-cancel as the product-level signal: when
 * cancel_at_period_end is true and Stripe still reports a paid state,
 * record "canceled" so featured-state.ts's `lapsing` branch fires.
 * `featuredUntil` is still set from the period end, so the user retains
 * Featured placement through the paid window.
 *
 * Incident 2026-06-11 (PR-D3b): portal cancel left DB in subscriptionStatus=active
 * because we mirrored Stripe verbatim. See shared/featured-state.ts for the
 * UX states this drives.
 */
function resolveSubscriptionStatus(sub: Stripe.Subscription): string {
  const cancelAtPeriodEnd =
    (sub as unknown as { cancel_at_period_end?: boolean }).cancel_at_period_end === true;
  if (cancelAtPeriodEnd && (sub.status === "active" || sub.status === "trialing")) {
    return "canceled";
  }
  return sub.status;
}

/**
 * Try every reasonable hook to attribute a subscription event back to a
 * tradesman. Order: subscription.metadata.tradesman_id, then DB lookup by
 * subscription id, then by customer id. Returns the resolved subscription
 * object too so callers don't double-fetch.
 */
async function resolveTradesmanForSubscription(
  subscription: Stripe.Subscription | string | null | undefined,
  customerId: string | null,
): Promise<{
  tradesmanId: number | null;
  subscription: Stripe.Subscription | null;
  notes: string | null;
}> {
  let sub: Stripe.Subscription | null = null;
  if (typeof subscription === "string") {
    try {
      sub = await stripe.subscriptions.retrieve(subscription);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return { tradesmanId: null, subscription: null, notes: `subscription retrieve failed: ${msg}` };
    }
  } else if (subscription && typeof subscription === "object") {
    sub = subscription;
  }

  const metaId = sub?.metadata?.tradesman_id;
  const parsed = metaId ? Number(metaId) : NaN;
  if (Number.isFinite(parsed)) {
    return { tradesmanId: parsed, subscription: sub, notes: null };
  }

  if (sub?.id) {
    const byId = await storage.getTradesmanByStripeSubscriptionId(sub.id);
    if (byId) return { tradesmanId: byId.id, subscription: sub, notes: null };
  }

  if (customerId) {
    const byCust = await storage.getTradesmanByStripeCustomerId(customerId);
    if (byCust) return { tradesmanId: byCust.id, subscription: sub, notes: null };
  }

  return {
    tradesmanId: null,
    subscription: sub,
    notes: "could not reconcile subscription to tradesman",
  };
}

async function handleFeaturedCheckoutCompleted(
  event: Stripe.Event,
  session: Stripe.Checkout.Session,
  tradesmanId: number,
  baseLog: Record<string, unknown>,
): Promise<void> {
  if (session.payment_status !== "paid") {
    await storage.createPaymentsLog({
      ...(baseLog as object),
      tradesmanId,
      action: "noop",
      creditsDelta: 0,
      notes: `featured checkout payment_status=${session.payment_status} — waiting for invoice.paid`,
    } as Parameters<typeof storage.createPaymentsLog>[0]);
    return;
  }

  const customerId = typeof session.customer === "string" ? session.customer : null;
  const { subscription: sub } = await resolveTradesmanForSubscription(
    session.subscription,
    customerId,
  );

  const subId =
    sub?.id ?? (typeof session.subscription === "string" ? session.subscription : null);
  const featuredUntil = sub ? periodEndMs(sub) : null;
  const status = sub ? resolveSubscriptionStatus(sub) : "active";

  const patch: Record<string, unknown> = { subscriptionStatus: status };
  if (customerId) patch.stripeCustomerId = customerId;
  if (subId) patch.stripeSubscriptionId = subId;
  if (featuredUntil) patch.featuredUntil = featuredUntil;
  await storage.updateTradesman(
    tradesmanId,
    patch as Parameters<typeof storage.updateTradesman>[1],
  );

  await storage.createPaymentsLog({
    ...(baseLog as object),
    tradesmanId,
    stripeSubscriptionId: subId,
    action: "featured_extended",
    creditsDelta: 0,
    notes: `Featured subscription started; status=${status}; featuredUntil=${featuredUntil ?? "unset"}`,
  } as Parameters<typeof storage.createPaymentsLog>[0]);
}

async function handleInvoicePaid(event: Stripe.Event): Promise<void> {
  const invoice = event.data.object as Stripe.Invoice;
  const customerId = typeof invoice.customer === "string" ? invoice.customer : null;
  // `invoice.subscription` exists on older api versions; on newer ones it
  // moved to invoice.lines[].subscription. Check both.
  const invoiceSubscription =
    (invoice as unknown as { subscription?: string | Stripe.Subscription | null }).subscription ??
    invoice.lines?.data?.[0]?.subscription ??
    null;

  const baseLog = {
    eventId: event.id,
    eventType: event.type,
    amountPence: invoice.amount_paid ?? null,
    currency: invoice.currency ?? null,
    stripeCustomerId: customerId,
    stripeSubscriptionId:
      typeof invoiceSubscription === "string"
        ? invoiceSubscription
        : invoiceSubscription?.id ?? null,
    stripeCheckoutSessionId: null,
    stripePaymentIntentId: null,
    stripeInvoiceId: invoice.id ?? null,
    stripeChargeId:
      typeof (invoice as unknown as { charge?: string }).charge === "string"
        ? ((invoice as unknown as { charge?: string }).charge as string)
        : null,
    productKind: "featured_monthly" as const,
    rawPayload: JSON.stringify(event).slice(0, 50_000),
  };

  if (!invoiceSubscription) {
    // Non-subscription invoice (e.g. one-off from dashboard). Out of scope.
    await storage.createPaymentsLog({
      ...baseLog,
      tradesmanId: null,
      productKind: null,
      action: "noop",
      creditsDelta: 0,
      notes: "invoice.paid without subscription — out of scope",
    });
    return;
  }

  const { tradesmanId, subscription: sub, notes } = await resolveTradesmanForSubscription(
    invoiceSubscription,
    customerId,
  );

  if (!tradesmanId) {
    await storage.createPaymentsLog({
      ...baseLog,
      tradesmanId: null,
      action: "flagged_for_review",
      creditsDelta: 0,
      notes: notes ?? "could not reconcile invoice.paid",
    });
    return;
  }

  const featuredUntil = sub ? periodEndMs(sub) : null;
  const status = sub ? resolveSubscriptionStatus(sub) : "active";
  const patch: Record<string, unknown> = { subscriptionStatus: status };
  if (featuredUntil) patch.featuredUntil = featuredUntil;
  if (sub?.id) patch.stripeSubscriptionId = sub.id;
  if (customerId) patch.stripeCustomerId = customerId;
  await storage.updateTradesman(
    tradesmanId,
    patch as Parameters<typeof storage.updateTradesman>[1],
  );

  await storage.createPaymentsLog({
    ...baseLog,
    tradesmanId,
    action: "featured_extended",
    creditsDelta: 0,
    notes: `Renewal; status=${status}; featuredUntil=${featuredUntil ?? "unchanged"}`,
  });
}

async function handleSubscriptionUpdated(event: Stripe.Event): Promise<void> {
  const sub = event.data.object as Stripe.Subscription;
  const customerId = typeof sub.customer === "string" ? sub.customer : null;
  const { tradesmanId, notes } = await resolveTradesmanForSubscription(sub, customerId);

  const baseLog = {
    eventId: event.id,
    eventType: event.type,
    amountPence: null,
    currency: sub.currency ?? null,
    stripeCustomerId: customerId,
    stripeSubscriptionId: sub.id,
    stripeCheckoutSessionId: null,
    stripePaymentIntentId: null,
    stripeInvoiceId: null,
    stripeChargeId: null,
    productKind: "featured_monthly" as const,
    rawPayload: JSON.stringify(event).slice(0, 50_000),
  };

  if (!tradesmanId) {
    await storage.createPaymentsLog({
      ...baseLog,
      tradesmanId: null,
      action: "flagged_for_review",
      creditsDelta: 0,
      notes: notes ?? "could not reconcile subscription.updated",
    });
    return;
  }

  const featuredUntil = periodEndMs(sub);
  const resolvedStatus = resolveSubscriptionStatus(sub);
  const patch: Record<string, unknown> = { subscriptionStatus: resolvedStatus };
  if (featuredUntil) patch.featuredUntil = featuredUntil;
  await storage.updateTradesman(
    tradesmanId,
    patch as Parameters<typeof storage.updateTradesman>[1],
  );

  // past_due is the dunning trigger — surface in action name so admin filters
  // on payments_log.action catch the transition immediately. Treat
  // cancel-at-period-end (resolved to "canceled") as a degrade signal too so
  // ops can spot churn intent without filtering on raw cancel_at flags.
  const action =
    resolvedStatus === "past_due" || resolvedStatus === "canceled"
      ? "featured_degraded"
      : "featured_extended";
  await storage.createPaymentsLog({
    ...baseLog,
    tradesmanId,
    action,
    creditsDelta: 0,
    notes: `subscription.updated → status=${sub.status} (resolved=${resolvedStatus}); featuredUntil=${featuredUntil ?? "unchanged"}`,
  });
}

async function handleSubscriptionDeleted(event: Stripe.Event): Promise<void> {
  const sub = event.data.object as Stripe.Subscription;
  const customerId = typeof sub.customer === "string" ? sub.customer : null;
  const { tradesmanId, notes } = await resolveTradesmanForSubscription(sub, customerId);

  const baseLog = {
    eventId: event.id,
    eventType: event.type,
    amountPence: null,
    currency: sub.currency ?? null,
    stripeCustomerId: customerId,
    stripeSubscriptionId: sub.id,
    stripeCheckoutSessionId: null,
    stripePaymentIntentId: null,
    stripeInvoiceId: null,
    stripeChargeId: null,
    productKind: "featured_monthly" as const,
    rawPayload: JSON.stringify(event).slice(0, 50_000),
  };

  if (!tradesmanId) {
    await storage.createPaymentsLog({
      ...baseLog,
      tradesmanId: null,
      action: "flagged_for_review",
      creditsDelta: 0,
      notes: notes ?? "could not reconcile subscription.deleted",
    });
    return;
  }

  // Deliberately leave featuredUntil intact — Stripe fires `deleted` at
  // period end for cancel-at-period-end. Clearing it here would cut the
  // tradesperson off prematurely on every cancel.
  await storage.updateTradesman(tradesmanId, {
    subscriptionStatus: "canceled",
    stripeSubscriptionId: null,
  } as Parameters<typeof storage.updateTradesman>[1]);

  await storage.createPaymentsLog({
    ...baseLog,
    tradesmanId,
    action: "featured_degraded",
    creditsDelta: 0,
    notes: "subscription.deleted — marked canceled, featuredUntil left intact through paid period",
  });
}

// ── Refund handler (PR-E3d) ─────────────────────────────────────────────────
//
// Stripe fires `charge.refunded` for both full and partial refunds. We:
//   1) Resolve the charge → its payment_intent → our original credits_granted
//      row in payments_log (the grant log is the only place we know how many
//      credits a given purchase added).
//   2) Compute revocation delta proportional to amount_refunded/amount.
//      For a full refund this exactly reverses the grant.
//      For a partial refund we round UP (revoke at least 1 credit if the user
//      got money back at all) — refusing to revoke a fractional credit would
//      let serial partial-refunders extract free leads.
//   3) Clamp post-revoke balance at 0. Credits the tradesman already SPENT
//      cannot be clawed back from leads they already received. This is the
//      core "we eat the cost of consumed leads" decision — encoded once here
//      so admin tooling doesn't need to reason about negative balances.
//   4) Log credits_revoked with the signed creditsDelta (negative).
//
// Featured subscription refunds are out of scope: cancellation runs through
// customer.subscription.deleted (PR-E3b). If a Stripe admin issues a refund
// on a featured charge we still log it (action=noop) for the audit trail
// but don't try to back-date featuredUntil — that policy call belongs to
// the admin who issued the refund.

async function handleChargeRefunded(event: Stripe.Event): Promise<void> {
  const charge = event.data.object as Stripe.Charge;
  const paymentIntentId =
    typeof charge.payment_intent === "string"
      ? charge.payment_intent
      : charge.payment_intent?.id ?? null;
  const customerId = typeof charge.customer === "string" ? charge.customer : null;

  const baseLog = {
    eventId: event.id,
    eventType: event.type,
    amountPence: charge.amount_refunded ?? null,
    currency: charge.currency ?? null,
    stripeCustomerId: customerId,
    stripeSubscriptionId: null,
    stripeCheckoutSessionId: null,
    stripePaymentIntentId: paymentIntentId,
    stripeInvoiceId: typeof charge.invoice === "string" ? charge.invoice : null,
    stripeChargeId: charge.id,
    productKind: null as string | null,
    rawPayload: JSON.stringify(event).slice(0, 50_000),
  };

  if (!paymentIntentId) {
    // Charge without a payment_intent shouldn't happen for our flows (Checkout
    // always creates one), but log so we notice.
    await storage.createPaymentsLog({
      ...baseLog,
      tradesmanId: null,
      action: "flagged_for_review",
      creditsDelta: 0,
      notes: "charge.refunded without payment_intent",
    });
    return;
  }

  const grant = await storage.findCreditsGrantByPaymentIntent(paymentIntentId);
  if (!grant) {
    // Either this charge was a Featured subscription invoice (no credits to
    // revoke — handled by subscription.deleted), or an out-of-band charge we
    // never issued credits for. Log and stop.
    await storage.createPaymentsLog({
      ...baseLog,
      tradesmanId: null,
      action: "noop",
      creditsDelta: 0,
      notes: "no matching credits_granted row — likely featured/non-credit charge",
    });
    return;
  }

  baseLog.productKind = grant.productKind;
  const tradesmanId = grant.tradesmanId;
  if (!tradesmanId) {
    await storage.createPaymentsLog({
      ...baseLog,
      tradesmanId: null,
      action: "flagged_for_review",
      creditsDelta: 0,
      notes: "matched grant row had null tradesmanId — cannot revoke",
    });
    return;
  }

  const granted = grant.creditsDelta; // positive
  const amount = charge.amount ?? 0;
  const refunded = charge.amount_refunded ?? 0;
  if (amount <= 0 || refunded <= 0) {
    await storage.createPaymentsLog({
      ...baseLog,
      tradesmanId,
      action: "noop",
      creditsDelta: 0,
      notes: `zero-amount refund (amount=${amount}, refunded=${refunded})`,
    });
    return;
  }

  // Round UP on partial refunds so any money-back triggers at least 1 credit
  // revoked — prevents salami-slicing refunds for free leads.
  const proportion = refunded / amount;
  const creditsToRevoke = Math.min(granted, Math.ceil(granted * proportion));

  const existing = await storage.getCredits(tradesmanId);
  const currentBalance = existing?.balance ?? 0;
  // Clamp at 0 — credits already spent on leads can't be clawed back.
  const actualRevoke = Math.min(creditsToRevoke, currentBalance);
  const newBalance = currentBalance - actualRevoke;

  if (actualRevoke > 0) {
    await storage.setCredits(tradesmanId, newBalance);
    await storage.createCreditTransaction({
      tradesmanId,
      amount: -actualRevoke,
      reason: `Stripe refund: charge ${charge.id} (refunded ${refunded}/${amount} of ${grant.productKind})`,
      relatedJobId: null,
    });
  }

  const noteParts: string[] = [
    `refunded ${refunded}/${amount} (${(proportion * 100).toFixed(0)}%)`,
    `granted=${granted}`,
    `wantedRevoke=${creditsToRevoke}`,
    `actualRevoke=${actualRevoke}`,
    `balance ${currentBalance}→${newBalance}`,
  ];
  if (actualRevoke < creditsToRevoke) {
    noteParts.push(
      `clamped at 0 — ${creditsToRevoke - actualRevoke} credits already spent`,
    );
  }

  await storage.createPaymentsLog({
    ...baseLog,
    tradesmanId,
    action: "credits_revoked",
    creditsDelta: -actualRevoke, // signed negative
    notes: noteParts.join("; "),
  });
}
