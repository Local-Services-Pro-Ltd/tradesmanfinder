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
    updateTradesman: vi.fn(),
    getCredits: vi.fn(),
    setCredits: vi.fn().mockResolvedValue({ balance: 0 }),
    createCreditTransaction: vi.fn(),
  },
}));

import { handleStripeWebhook } from "./stripe-webhook";
import { stripe } from "./stripe";
import { storage } from "./storage";

const constructEvent = stripe.webhooks.constructEvent as unknown as ReturnType<typeof vi.fn>;
const listLineItems = stripe.checkout.sessions.listLineItems as unknown as ReturnType<typeof vi.fn>;
const storageMock = storage as unknown as {
  createPaymentsLog: ReturnType<typeof vi.fn>;
  getTradesmanById: ReturnType<typeof vi.fn>;
  updateTradesman: ReturnType<typeof vi.fn>;
  getCredits: ReturnType<typeof vi.fn>;
  setCredits: ReturnType<typeof vi.fn>;
  createCreditTransaction: ReturnType<typeof vi.fn>;
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

  it("does NOT process featured subscription via checkout.completed (PR-E3 territory)", async () => {
    constructEvent.mockReturnValue({
      id: "evt_featured",
      type: "checkout.session.completed",
      data: {
        object: {
          id: "cs_featured",
          payment_status: "paid",
          customer: "cus_x",
          metadata: { tradesman_id: "42" },
          amount_total: 2900,
          currency: "gbp",
          payment_intent: null,
          invoice: "in_1",
        },
      },
    });
    listLineItems.mockResolvedValue({ data: [{ price: { id: "price_featured" } }] });

    const res = mockRes();
    await handleStripeWebhook(
      mockReq({ rawBody: Buffer.from("{}"), signature: "sig" }),
      res,
    );

    expect(storageMock.setCredits).not.toHaveBeenCalled();
    expect(storageMock.createPaymentsLog).toHaveBeenCalledWith(
      expect.objectContaining({ action: "flagged_for_review" }),
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
