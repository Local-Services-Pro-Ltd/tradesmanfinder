// Unit tests for the Stripe webhook handler.
//
// We stub:
//   - the stripe wrapper (so no network calls + we can fake constructEvent)
//   - the storage layer (so no DB calls)
//
// The goal is to verify the *decision logic* (which events grant credits,
// which get flagged, dedupe, signature failure) rather than re-test Stripe.
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Request, Response } from "express";

// vi.mock factories are hoisted above imports — keep their bodies
// self-contained (no references to outer-scope variables).
vi.mock("./stripe", () => ({
  stripe: {
    webhooks: { constructEvent: vi.fn() },
    checkout: { sessions: { listLineItems: vi.fn() } },
    subscriptions: { retrieve: vi.fn() },
  },
  STRIPE_WEBHOOK_SECRET: "whsec_test",
  productKindFromPriceId: (id: string | null) => {
    if (id === "price_pack5") return "lead_pack_5";
    if (id === "price_pack10") return "lead_pack_10";
    if (id === "price_featured") return "featured_monthly";
    return null;
  },
  creditsForProductKind: (kind: string) => {
    if (kind === "lead_pack_5") return 5;
    if (kind === "lead_pack_10") return 10;
    return 0;
  },
}));

vi.mock("./storage", () => ({
  storage: {
    createPaymentsLog: vi.fn().mockResolvedValue({ id: 1 }),
    getTradesmanById: vi.fn(),
    getTradesmanByStripeCustomerId: vi.fn(),
    getTradesmanByStripeSubscriptionId: vi.fn(),
    updateTradesman: vi.fn(),
    getCredits: vi.fn(),
    setCredits: vi.fn().mockResolvedValue({ balance: 0 }),
    createCreditTransaction: vi.fn(),
    findCreditsGrantByPaymentIntent: vi.fn(),
  },
}));

import { handleStripeWebhook } from "./stripe-webhook";
import { stripe } from "./stripe";
import { storage } from "./storage";

const constructEvent = stripe.webhooks.constructEvent as unknown as ReturnType<typeof vi.fn>;
const listLineItems = stripe.checkout.sessions.listLineItems as unknown as ReturnType<typeof vi.fn>;
const retrieveSubscription = (stripe as unknown as { subscriptions: { retrieve: ReturnType<typeof vi.fn> } }).subscriptions.retrieve;
const storageMock = storage as unknown as {
  createPaymentsLog: ReturnType<typeof vi.fn>;
  getTradesmanById: ReturnType<typeof vi.fn>;
  getTradesmanByStripeCustomerId: ReturnType<typeof vi.fn>;
  getTradesmanByStripeSubscriptionId: ReturnType<typeof vi.fn>;
  updateTradesman: ReturnType<typeof vi.fn>;
  getCredits: ReturnType<typeof vi.fn>;
  setCredits: ReturnType<typeof vi.fn>;
  createCreditTransaction: ReturnType<typeof vi.fn>;
  findCreditsGrantByPaymentIntent: ReturnType<typeof vi.fn>;
};

function mockRes() {
  const res: Partial<Response> & { _status?: number; _json?: unknown; _send?: unknown } = {};
  res.status = vi.fn().mockImplementation((code: number) => {
    res._status = code;
    return res as Response;
  });
  res.json = vi.fn().mockImplementation((body: unknown) => {
    res._json = body;
    return res as Response;
  });
  res.send = vi.fn().mockImplementation((body: unknown) => {
    res._send = body;
    return res as Response;
  });
  return res as Response & { _status?: number; _json?: unknown; _send?: unknown };
}

function mockReq(opts: { rawBody?: Buffer; signature?: string | string[] }): Request {
  return {
    headers: opts.signature !== undefined ? { "stripe-signature": opts.signature } : {},
    rawBody: opts.rawBody,
  } as unknown as Request;
}

beforeEach(() => {
  Object.values(storageMock).forEach((fn) => fn.mockClear());
  storageMock.createPaymentsLog.mockResolvedValue({ id: 1 });
  storageMock.setCredits.mockResolvedValue({ balance: 0 });
  constructEvent.mockReset();
  listLineItems.mockReset();
  retrieveSubscription.mockReset();
});

describe("handleStripeWebhook — request validation", () => {
  it("rejects requests without a stripe-signature header", async () => {
    const res = mockRes();
    await handleStripeWebhook(mockReq({ rawBody: Buffer.from("{}") }), res);
    expect(res._status).toBe(400);
    expect(constructEvent).not.toHaveBeenCalled();
  });

  it("rejects requests without a raw body", async () => {
    const res = mockRes();
    await handleStripeWebhook(mockReq({ signature: "sig" }), res);
    expect(res._status).toBe(400);
    expect(constructEvent).not.toHaveBeenCalled();
  });

  it("rejects when signature verification fails", async () => {
    constructEvent.mockImplementation(() => {
      throw new Error("Invalid signature");
    });
    const res = mockRes();
    await handleStripeWebhook(
      mockReq({ rawBody: Buffer.from("{}"), signature: "bad" }),
      res,
    );
    expect(res._status).toBe(400);
  });
});

describe("handleStripeWebhook — checkout.session.completed", () => {
  it("grants credits and logs success for a paid lead pack", async () => {
    constructEvent.mockReturnValue({
      id: "evt_1",
      type: "checkout.session.completed",
      data: {
        object: {
          id: "cs_1",
          payment_status: "paid",
          customer: "cus_new",
          metadata: { tradesman_id: "42" },
          amount_total: 2500,
          currency: "gbp",
          payment_intent: "pi_1",
          invoice: null,
        },
      },
    });
    listLineItems.mockResolvedValue({ data: [{ price: { id: "price_pack5" } }] });
    storageMock.getTradesmanById.mockResolvedValue({ id: 42, stripeCustomerId: null });
    storageMock.getCredits.mockResolvedValue({ balance: 3 });

    const res = mockRes();
    await handleStripeWebhook(
      mockReq({ rawBody: Buffer.from("{}"), signature: "sig" }),
      res,
    );

    expect(res._status).toBe(200);
    expect(storageMock.setCredits).toHaveBeenCalledWith(42, 8); // 3 + 5
    expect(storageMock.updateTradesman).toHaveBeenCalledWith(42, { stripeCustomerId: "cus_new" });
    expect(storageMock.createCreditTransaction).toHaveBeenCalledWith(
      expect.objectContaining({ tradesmanId: 42, amount: 5 }),
    );
    expect(storageMock.createPaymentsLog).toHaveBeenCalledWith(
      expect.objectContaining({
        eventId: "evt_1",
        action: "credits_granted",
        creditsDelta: 5,
        tradesmanId: 42,
        productKind: "lead_pack_5",
      }),
    );
  });

  it("does NOT grant credits if payment_status is not 'paid'", async () => {
    constructEvent.mockReturnValue({
      id: "evt_pending",
      type: "checkout.session.completed",
      data: {
        object: {
          id: "cs_pending",
          payment_status: "unpaid",
          customer: "cus_x",
          metadata: { tradesman_id: "42" },
          amount_total: 2500,
          currency: "gbp",
          payment_intent: null,
          invoice: null,
        },
      },
    });
    listLineItems.mockResolvedValue({ data: [{ price: { id: "price_pack5" } }] });

    const res = mockRes();
    await handleStripeWebhook(
      mockReq({ rawBody: Buffer.from("{}"), signature: "sig" }),
      res,
    );

    expect(res._status).toBe(200);
    expect(storageMock.setCredits).not.toHaveBeenCalled();
    expect(storageMock.createPaymentsLog).toHaveBeenCalledWith(
      expect.objectContaining({ action: "noop", creditsDelta: 0 }),
    );
  });

  it("flags for review when tradesman_id is missing", async () => {
    constructEvent.mockReturnValue({
      id: "evt_no_meta",
      type: "checkout.session.completed",
      data: {
        object: {
          id: "cs_no_meta",
          payment_status: "paid",
          customer: "cus_x",
          metadata: {},
          client_reference_id: null,
          amount_total: 2500,
          currency: "gbp",
          payment_intent: null,
          invoice: null,
        },
      },
    });
    listLineItems.mockResolvedValue({ data: [{ price: { id: "price_pack5" } }] });

    const res = mockRes();
    await handleStripeWebhook(
      mockReq({ rawBody: Buffer.from("{}"), signature: "sig" }),
      res,
    );

    expect(res._status).toBe(200);
    expect(storageMock.setCredits).not.toHaveBeenCalled();
    expect(storageMock.createPaymentsLog).toHaveBeenCalledWith(
      expect.objectContaining({ action: "flagged_for_review", tradesmanId: null }),
    );
  });

  it("flags when price id is unknown (not a configured lead pack)", async () => {
    constructEvent.mockReturnValue({
      id: "evt_bad_price",
      type: "checkout.session.completed",
      data: {
        object: {
          id: "cs_bad_price",
          payment_status: "paid",
          customer: "cus_x",
          metadata: { tradesman_id: "42" },
          amount_total: 2500,
          currency: "gbp",
          payment_intent: null,
          invoice: null,
        },
      },
    });
    listLineItems.mockResolvedValue({ data: [{ price: { id: "price_random" } }] });

    const res = mockRes();
    await handleStripeWebhook(
      mockReq({ rawBody: Buffer.from("{}"), signature: "sig" }),
      res,
    );

    expect(res._status).toBe(200);
    expect(storageMock.setCredits).not.toHaveBeenCalled();
    expect(storageMock.createPaymentsLog).toHaveBeenCalledWith(
      expect.objectContaining({ action: "flagged_for_review", tradesmanId: 42 }),
    );
  });

  it("provisions featured subscription on checkout.completed (PR-E3b)", async () => {
    constructEvent.mockReturnValue({
      id: "evt_featured",
      type: "checkout.session.completed",
      data: {
        object: {
          id: "cs_featured",
          payment_status: "paid",
          customer: "cus_x",
          subscription: "sub_new",
          metadata: { tradesman_id: "42" },
          amount_total: 2900,
          currency: "gbp",
          payment_intent: null,
          invoice: "in_1",
        },
      },
    });
    listLineItems.mockResolvedValue({ data: [{ price: { id: "price_featured" } }] });
    retrieveSubscription.mockResolvedValue({
      id: "sub_new",
      status: "active",
      current_period_end: 1_800_000_000,
      metadata: { tradesman_id: "42" },
    });

    const res = mockRes();
    await handleStripeWebhook(
      mockReq({ rawBody: Buffer.from("{}"), signature: "sig" }),
      res,
    );

    expect(res._status).toBe(200);
    expect(storageMock.setCredits).not.toHaveBeenCalled();
    expect(storageMock.updateTradesman).toHaveBeenCalledWith(
      42,
      expect.objectContaining({
        subscriptionStatus: "active",
        stripeCustomerId: "cus_x",
        stripeSubscriptionId: "sub_new",
        featuredUntil: 1_800_000_000_000,
      }),
    );
    expect(storageMock.createPaymentsLog).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "featured_extended",
        productKind: "featured_monthly",
        tradesmanId: 42,
      }),
    );
  });
});

describe("handleStripeWebhook — unknown event type", () => {
  it("logs a noop and returns 200", async () => {
    constructEvent.mockReturnValue({
      id: "evt_unknown",
      type: "balance.available",
      data: { object: {} },
    });
    const res = mockRes();
    await handleStripeWebhook(
      mockReq({ rawBody: Buffer.from("{}"), signature: "sig" }),
      res,
    );
    expect(res._status).toBe(200);
    expect(storageMock.createPaymentsLog).toHaveBeenCalledWith(
      expect.objectContaining({ eventType: "balance.available", action: "noop" }),
    );
  });
});

describe("handleStripeWebhook — dedupe", () => {
  it("returns 200 with deduped:true when storage rejects a duplicate event_id", async () => {
    constructEvent.mockReturnValue({
      id: "evt_dup",
      type: "balance.available",
      data: { object: {} },
    });
    storageMock.createPaymentsLog.mockRejectedValueOnce(
      new Error('duplicate key value violates unique constraint "payments_log_event_id_unique"'),
    );
    const res = mockRes();
    await handleStripeWebhook(
      mockReq({ rawBody: Buffer.from("{}"), signature: "sig" }),
      res,
    );
    expect(res._status).toBe(200);
    expect(res._json).toEqual({ received: true, deduped: true });
  });
});

describe("handleStripeWebhook — invoice.paid (PR-E3b renewals)", () => {
  it("extends featuredUntil on a subscription renewal", async () => {
    constructEvent.mockReturnValue({
      id: "evt_inv_paid",
      type: "invoice.paid",
      data: {
        object: {
          id: "in_renew",
          customer: "cus_x",
          subscription: "sub_x",
          amount_paid: 2900,
          currency: "gbp",
          charge: "ch_1",
          lines: { data: [] },
        },
      },
    });
    retrieveSubscription.mockResolvedValue({
      id: "sub_x",
      status: "active",
      current_period_end: 1_900_000_000,
      metadata: { tradesman_id: "42" },
    });

    const res = mockRes();
    await handleStripeWebhook(
      mockReq({ rawBody: Buffer.from("{}"), signature: "sig" }),
      res,
    );

    expect(res._status).toBe(200);
    expect(storageMock.updateTradesman).toHaveBeenCalledWith(
      42,
      expect.objectContaining({
        subscriptionStatus: "active",
        featuredUntil: 1_900_000_000_000,
      }),
    );
    expect(storageMock.createPaymentsLog).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "featured_extended",
        eventType: "invoice.paid",
        tradesmanId: 42,
      }),
    );
  });

  it("falls back to customerId lookup when subscription metadata is missing", async () => {
    constructEvent.mockReturnValue({
      id: "evt_inv_fallback",
      type: "invoice.paid",
      data: {
        object: {
          id: "in_fb",
          customer: "cus_orphan",
          subscription: "sub_orphan",
          amount_paid: 2900,
          currency: "gbp",
          lines: { data: [] },
        },
      },
    });
    retrieveSubscription.mockResolvedValue({
      id: "sub_orphan",
      status: "active",
      current_period_end: 1_900_000_000,
      metadata: {},
    });
    storageMock.getTradesmanByStripeSubscriptionId.mockResolvedValue(undefined);
    storageMock.getTradesmanByStripeCustomerId.mockResolvedValue({ id: 77 });

    const res = mockRes();
    await handleStripeWebhook(
      mockReq({ rawBody: Buffer.from("{}"), signature: "sig" }),
      res,
    );

    expect(res._status).toBe(200);
    expect(storageMock.updateTradesman).toHaveBeenCalledWith(
      77,
      expect.objectContaining({ subscriptionStatus: "active" }),
    );
  });

  it("flags for review when no tradesman can be reconciled", async () => {
    constructEvent.mockReturnValue({
      id: "evt_inv_orphan",
      type: "invoice.paid",
      data: {
        object: {
          id: "in_o",
          customer: "cus_zzz",
          subscription: "sub_zzz",
          amount_paid: 2900,
          currency: "gbp",
          lines: { data: [] },
        },
      },
    });
    retrieveSubscription.mockResolvedValue({
      id: "sub_zzz",
      status: "active",
      current_period_end: 1_900_000_000,
      metadata: {},
    });
    storageMock.getTradesmanByStripeSubscriptionId.mockResolvedValue(undefined);
    storageMock.getTradesmanByStripeCustomerId.mockResolvedValue(undefined);

    const res = mockRes();
    await handleStripeWebhook(
      mockReq({ rawBody: Buffer.from("{}"), signature: "sig" }),
      res,
    );

    expect(res._status).toBe(200);
    expect(storageMock.updateTradesman).not.toHaveBeenCalled();
    expect(storageMock.createPaymentsLog).toHaveBeenCalledWith(
      expect.objectContaining({ action: "flagged_for_review", tradesmanId: null }),
    );
  });
});

describe("handleStripeWebhook — customer.subscription.updated", () => {
  it("syncs status + featuredUntil on a normal update", async () => {
    constructEvent.mockReturnValue({
      id: "evt_sub_upd",
      type: "customer.subscription.updated",
      data: {
        object: {
          id: "sub_u",
          customer: "cus_x",
          status: "active",
          currency: "gbp",
          current_period_end: 2_000_000_000,
          metadata: { tradesman_id: "42" },
          items: { data: [] },
        },
      },
    });

    const res = mockRes();
    await handleStripeWebhook(
      mockReq({ rawBody: Buffer.from("{}"), signature: "sig" }),
      res,
    );

    expect(res._status).toBe(200);
    expect(storageMock.updateTradesman).toHaveBeenCalledWith(
      42,
      expect.objectContaining({
        subscriptionStatus: "active",
        featuredUntil: 2_000_000_000_000,
      }),
    );
    expect(storageMock.createPaymentsLog).toHaveBeenCalledWith(
      expect.objectContaining({ action: "featured_extended", tradesmanId: 42 }),
    );
  });

  it("marks past_due as featured_degraded for dunning visibility", async () => {
    constructEvent.mockReturnValue({
      id: "evt_sub_pd",
      type: "customer.subscription.updated",
      data: {
        object: {
          id: "sub_pd",
          customer: "cus_x",
          status: "past_due",
          currency: "gbp",
          current_period_end: 2_000_000_000,
          metadata: { tradesman_id: "42" },
          items: { data: [] },
        },
      },
    });

    const res = mockRes();
    await handleStripeWebhook(
      mockReq({ rawBody: Buffer.from("{}"), signature: "sig" }),
      res,
    );

    expect(storageMock.updateTradesman).toHaveBeenCalledWith(
      42,
      expect.objectContaining({ subscriptionStatus: "past_due" }),
    );
    expect(storageMock.createPaymentsLog).toHaveBeenCalledWith(
      expect.objectContaining({ action: "featured_degraded", tradesmanId: 42 }),
    );
  });
});

describe("handleStripeWebhook — customer.subscription.deleted", () => {
  it("marks canceled and clears subscription id but preserves featuredUntil", async () => {
    constructEvent.mockReturnValue({
      id: "evt_sub_del",
      type: "customer.subscription.deleted",
      data: {
        object: {
          id: "sub_del",
          customer: "cus_x",
          status: "canceled",
          currency: "gbp",
          current_period_end: 2_000_000_000,
          metadata: { tradesman_id: "42" },
          items: { data: [] },
        },
      },
    });

    const res = mockRes();
    await handleStripeWebhook(
      mockReq({ rawBody: Buffer.from("{}"), signature: "sig" }),
      res,
    );

    expect(res._status).toBe(200);
    const [, patch] = storageMock.updateTradesman.mock.calls[0];
    expect(patch).toEqual({ subscriptionStatus: "canceled", stripeSubscriptionId: null });
    // featuredUntil must NOT be touched — Stripe sends `deleted` at period
    // end for cancel-at-period-end, so we keep what the user paid for.
    expect(patch).not.toHaveProperty("featuredUntil");
    expect(storageMock.createPaymentsLog).toHaveBeenCalledWith(
      expect.objectContaining({ action: "featured_degraded", tradesmanId: 42 }),
    );
  });
});

describe("handleStripeWebhook — charge.refunded (PR-E3d)", () => {
  function refundEvent(opts: {
    chargeId?: string;
    paymentIntent?: string | null;
    amount?: number;
    amountRefunded?: number;
    customer?: string | null;
  } = {}) {
    return {
      id: `evt_refund_${Math.random().toString(36).slice(2, 8)}`,
      type: "charge.refunded",
      data: {
        object: {
          id: opts.chargeId ?? "ch_abc",
          // explicit `null` should pass through — use `in` check to distinguish
          // "not set" (default to pi_abc) from "explicitly null".
          payment_intent:
            "paymentIntent" in opts ? opts.paymentIntent : "pi_abc",
          customer: opts.customer ?? "cus_x",
          amount: opts.amount ?? 2500,
          amount_refunded: opts.amountRefunded ?? 2500,
          currency: "gbp",
        },
      },
    };
  }

  it("full refund reverses the full credit grant", async () => {
    constructEvent.mockReturnValue(refundEvent({ amount: 2500, amountRefunded: 2500 }));
    storageMock.findCreditsGrantByPaymentIntent.mockResolvedValue({
      tradesmanId: 42,
      creditsDelta: 5,
      productKind: "lead_pack_5",
    });
    storageMock.getCredits.mockResolvedValue({ balance: 5 });

    const res = mockRes();
    await handleStripeWebhook(
      mockReq({ rawBody: Buffer.from("{}"), signature: "sig" }),
      res,
    );

    expect(res._status).toBe(200);
    expect(storageMock.setCredits).toHaveBeenCalledWith(42, 0);
    expect(storageMock.createCreditTransaction).toHaveBeenCalledWith(
      expect.objectContaining({ tradesmanId: 42, amount: -5 }),
    );
    expect(storageMock.createPaymentsLog).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "credits_revoked",
        tradesmanId: 42,
        creditsDelta: -5,
        productKind: "lead_pack_5",
      }),
    );
  });

  it("partial refund rounds UP credits revoked (no salami slicing)", async () => {
    // 40% refund of a 10-credit pack → ceil(10*0.4) = 4 credits revoked
    constructEvent.mockReturnValue(refundEvent({ amount: 4500, amountRefunded: 1800 }));
    storageMock.findCreditsGrantByPaymentIntent.mockResolvedValue({
      tradesmanId: 42,
      creditsDelta: 10,
      productKind: "lead_pack_10",
    });
    storageMock.getCredits.mockResolvedValue({ balance: 10 });

    const res = mockRes();
    await handleStripeWebhook(
      mockReq({ rawBody: Buffer.from("{}"), signature: "sig" }),
      res,
    );

    expect(storageMock.setCredits).toHaveBeenCalledWith(42, 6);
    expect(storageMock.createCreditTransaction).toHaveBeenCalledWith(
      expect.objectContaining({ amount: -4 }),
    );
    expect(storageMock.createPaymentsLog).toHaveBeenCalledWith(
      expect.objectContaining({ action: "credits_revoked", creditsDelta: -4 }),
    );
  });

  it("clamps revocation at current balance — already-spent credits are not clawed back", async () => {
    // Tradesman bought 10, spent 7, now full refund. Can only revoke remaining 3.
    constructEvent.mockReturnValue(refundEvent({ amount: 4500, amountRefunded: 4500 }));
    storageMock.findCreditsGrantByPaymentIntent.mockResolvedValue({
      tradesmanId: 42,
      creditsDelta: 10,
      productKind: "lead_pack_10",
    });
    storageMock.getCredits.mockResolvedValue({ balance: 3 });

    const res = mockRes();
    await handleStripeWebhook(
      mockReq({ rawBody: Buffer.from("{}"), signature: "sig" }),
      res,
    );

    expect(storageMock.setCredits).toHaveBeenCalledWith(42, 0);
    expect(storageMock.createCreditTransaction).toHaveBeenCalledWith(
      expect.objectContaining({ amount: -3 }),
    );
    expect(storageMock.createPaymentsLog).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "credits_revoked",
        creditsDelta: -3,
        notes: expect.stringContaining("clamped at 0"),
      }),
    );
  });

  it("refund of featured/non-credit charge is a noop (no grant to reverse)", async () => {
    constructEvent.mockReturnValue(refundEvent({ paymentIntent: "pi_featured" }));
    storageMock.findCreditsGrantByPaymentIntent.mockResolvedValue(undefined);

    const res = mockRes();
    await handleStripeWebhook(
      mockReq({ rawBody: Buffer.from("{}"), signature: "sig" }),
      res,
    );

    expect(res._status).toBe(200);
    expect(storageMock.setCredits).not.toHaveBeenCalled();
    expect(storageMock.createCreditTransaction).not.toHaveBeenCalled();
    expect(storageMock.createPaymentsLog).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "noop",
        tradesmanId: null,
        notes: expect.stringContaining("no matching credits_granted"),
      }),
    );
  });

  it("refund without payment_intent flags for review", async () => {
    constructEvent.mockReturnValue(refundEvent({ paymentIntent: null }));

    const res = mockRes();
    await handleStripeWebhook(
      mockReq({ rawBody: Buffer.from("{}"), signature: "sig" }),
      res,
    );

    expect(storageMock.findCreditsGrantByPaymentIntent).not.toHaveBeenCalled();
    expect(storageMock.createPaymentsLog).toHaveBeenCalledWith(
      expect.objectContaining({ action: "flagged_for_review" }),
    );
  });

  it("zero-amount refund logs noop without touching credits", async () => {
    constructEvent.mockReturnValue(refundEvent({ amount: 2500, amountRefunded: 0 }));
    storageMock.findCreditsGrantByPaymentIntent.mockResolvedValue({
      tradesmanId: 42,
      creditsDelta: 5,
      productKind: "lead_pack_5",
    });

    const res = mockRes();
    await handleStripeWebhook(
      mockReq({ rawBody: Buffer.from("{}"), signature: "sig" }),
      res,
    );

    expect(storageMock.setCredits).not.toHaveBeenCalled();
    expect(storageMock.createPaymentsLog).toHaveBeenCalledWith(
      expect.objectContaining({ action: "noop", tradesmanId: 42 }),
    );
  });
});
