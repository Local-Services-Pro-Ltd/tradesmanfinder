// Unit tests for the lead-pack checkout session builder. We stub the Stripe
// client so no network calls happen and we can assert on the params we'd
// pass to stripe.checkout.sessions.create.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Stub the stripe wrapper module BEFORE importing the file under test.
vi.mock("./stripe", async () => {
  const create = vi.fn();
  return {
    stripe: { checkout: { sessions: { create } } },
    productKindFromPriceId: (id: string | null | undefined) => {
      if (id === "price_pack5") return "lead_pack_5";
      if (id === "price_featured") return "featured_monthly";
      return null;
    },
    PRODUCT_KINDS: ["lead_pack_5", "lead_pack_10", "lead_pack_20", "featured_monthly"],
  };
});

import { createLeadPackCheckoutSession } from "./stripe-checkout";
import { stripe } from "./stripe";

const create = stripe.checkout.sessions.create as unknown as ReturnType<typeof vi.fn>;

describe("createLeadPackCheckoutSession", () => {
  beforeEach(() => {
    create.mockReset();
    create.mockResolvedValue({ id: "cs_test_123", url: "https://stripe.test/cs_test_123" });
  });
  afterEach(() => {
    delete process.env.APP_BASE_URL;
  });

  it("creates a Checkout Session with the expected params", async () => {
    process.env.APP_BASE_URL = "https://tradesmanfinder.com";
    const result = await createLeadPackCheckoutSession({
      tradesmanId: 42,
      tradesmanEmail: "trade@example.com",
      stripeCustomerId: null,
      priceId: "price_pack5",
    });

    expect(result).toEqual({
      sessionId: "cs_test_123",
      url: "https://stripe.test/cs_test_123",
      productKind: "lead_pack_5",
    });

    expect(create).toHaveBeenCalledTimes(1);
    const params = create.mock.calls[0][0];
    expect(params.mode).toBe("payment");
    expect(params.line_items).toEqual([{ price: "price_pack5", quantity: 1 }]);
    expect(params.client_reference_id).toBe("42");
    expect(params.metadata).toEqual({ tradesman_id: "42", product_kind: "lead_pack_5" });
    // Stripe's 303 redirect strips the hash fragment in some browsers, so we
    // route through a server-side bounce that 302's onto the hash route.
    expect(params.success_url).toContain("/checkout/return?id=42&result=success");
    expect(params.success_url).toContain("session_id={CHECKOUT_SESSION_ID}");
    expect(params.cancel_url).toContain("/checkout/return?id=42&result=cancel");
    expect(params.customer_email).toBe("trade@example.com");
    expect(params.customer_creation).toBe("always");
    expect(params.customer).toBeUndefined();
  });

  it("reuses an existing Stripe customer id when provided", async () => {
    await createLeadPackCheckoutSession({
      tradesmanId: 7,
      tradesmanEmail: "trade@example.com",
      stripeCustomerId: "cus_existing",
      priceId: "price_pack5",
    });
    const params = create.mock.calls[0][0];
    expect(params.customer).toBe("cus_existing");
    expect(params.customer_email).toBeUndefined();
    expect(params.customer_creation).toBeUndefined();
  });

  it("rejects a price id that is not a lead pack (e.g. Featured)", async () => {
    await expect(
      createLeadPackCheckoutSession({
        tradesmanId: 1,
        tradesmanEmail: "x@y.com",
        stripeCustomerId: null,
        priceId: "price_featured",
      }),
    ).rejects.toThrow(/not a valid lead pack/);
    expect(create).not.toHaveBeenCalled();
  });

  it("rejects an unknown price id", async () => {
    await expect(
      createLeadPackCheckoutSession({
        tradesmanId: 1,
        tradesmanEmail: "x@y.com",
        stripeCustomerId: null,
        priceId: "price_unknown",
      }),
    ).rejects.toThrow(/not a valid lead pack/);
  });

  it("throws if Stripe returns a session without a url", async () => {
    create.mockResolvedValueOnce({ id: "cs_no_url", url: null });
    await expect(
      createLeadPackCheckoutSession({
        tradesmanId: 1,
        tradesmanEmail: "x@y.com",
        stripeCustomerId: null,
        priceId: "price_pack5",
      }),
    ).rejects.toThrow(/without a URL/);
  });
});
