// Unit tests for the billing portal session builder. Stripe client is stubbed.
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("./stripe", () => {
  const create = vi.fn();
  return {
    stripe: { billingPortal: { sessions: { create } } },
  };
});

import { createBillingPortalSession } from "./stripe-portal";
import { stripe } from "./stripe";

const create = (stripe as unknown as {
  billingPortal: { sessions: { create: ReturnType<typeof vi.fn> } };
}).billingPortal.sessions.create;

describe("createBillingPortalSession", () => {
  beforeEach(() => {
    create.mockReset();
    create.mockResolvedValue({ id: "bps_test_123", url: "https://billing.stripe.test/p_test" });
  });

  it("passes customer id through and returns the portal url", async () => {
    const result = await createBillingPortalSession({ stripeCustomerId: "cus_abc" });
    expect(result.url).toBe("https://billing.stripe.test/p_test");
    expect(create).toHaveBeenCalledTimes(1);
    const [params] = create.mock.calls[0];
    expect(params.customer).toBe("cus_abc");
    expect(params.return_url).toContain("/checkout/return");
    expect(params.return_url).toContain("kind=portal");
  });

  it("honours returnPath when provided", async () => {
    await createBillingPortalSession({
      stripeCustomerId: "cus_abc",
      returnPath: "/dashboard/billing",
    });
    const [params] = create.mock.calls[0];
    expect(params.return_url).toMatch(/\/dashboard\/billing$/);
    // when returnPath wins, we must NOT also include the default kind=portal
    // bounce — the caller is explicitly steering somewhere else.
    expect(params.return_url).not.toContain("kind=portal");
  });

  it("propagates Stripe errors so the route can map them to 502", async () => {
    create.mockRejectedValue(new Error("No such customer: cus_missing"));
    await expect(
      createBillingPortalSession({ stripeCustomerId: "cus_missing" }),
    ).rejects.toThrow(/No such customer/);
  });
});
