import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { productKindFromPriceId, creditsForProductKind, LEAD_PACKS } from "./stripe";

describe("productKindFromPriceId", () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    process.env.STRIPE_PRICE_LEAD_PACK_5      = "price_test_5";
    process.env.STRIPE_PRICE_LEAD_PACK_10     = "price_test_10";
    process.env.STRIPE_PRICE_LEAD_PACK_20     = "price_test_20";
    process.env.STRIPE_PRICE_FEATURED_MONTHLY = "price_test_featured";
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it("maps each configured price id to its product kind", () => {
    expect(productKindFromPriceId("price_test_5")).toBe("lead_pack_5");
    expect(productKindFromPriceId("price_test_10")).toBe("lead_pack_10");
    expect(productKindFromPriceId("price_test_20")).toBe("lead_pack_20");
    expect(productKindFromPriceId("price_test_featured")).toBe("featured_monthly");
  });

  it("returns null for an unknown price id (prevents granting credits for unrecognised products)", () => {
    expect(productKindFromPriceId("price_unknown")).toBeNull();
    expect(productKindFromPriceId("price_attacker_supplied")).toBeNull();
  });

  it("returns null for null/undefined/empty inputs", () => {
    expect(productKindFromPriceId(null)).toBeNull();
    expect(productKindFromPriceId(undefined)).toBeNull();
    expect(productKindFromPriceId("")).toBeNull();
  });

  it("does NOT match a price that isn't configured in env (defends against env-var typos)", () => {
    delete process.env.STRIPE_PRICE_LEAD_PACK_10;
    expect(productKindFromPriceId("price_test_10")).toBeNull();
    expect(productKindFromPriceId("price_test_5")).toBe("lead_pack_5"); // others unaffected
  });
});

describe("creditsForProductKind", () => {
  it("returns the lead-pack credit count for each pack", () => {
    expect(creditsForProductKind("lead_pack_5")).toBe(5);
    expect(creditsForProductKind("lead_pack_10")).toBe(10);
    expect(creditsForProductKind("lead_pack_20")).toBe(20);
  });

  it("returns 0 for the Featured subscription (it grants no credits)", () => {
    expect(creditsForProductKind("featured_monthly")).toBe(0);
  });
});

describe("LEAD_PACKS catalogue invariants", () => {
  it("has prices stored in pence (no fractional pounds)", () => {
    for (const pack of Object.values(LEAD_PACKS)) {
      expect(Number.isInteger(pack.pricePence)).toBe(true);
      expect(pack.pricePence).toBeGreaterThan(0);
    }
  });

  it("matches the display prices we promised on the dashboard UI", () => {
    expect(LEAD_PACKS.lead_pack_5.displayPrice).toBe("£25");
    expect(LEAD_PACKS.lead_pack_10.displayPrice).toBe("£45");
    expect(LEAD_PACKS.lead_pack_20.displayPrice).toBe("£80");
  });

  it("display price matches the pricePence (£25 == 2500p)", () => {
    expect(LEAD_PACKS.lead_pack_5.pricePence).toBe(2500);
    expect(LEAD_PACKS.lead_pack_10.pricePence).toBe(4500);
    expect(LEAD_PACKS.lead_pack_20.pricePence).toBe(8000);
  });
});
