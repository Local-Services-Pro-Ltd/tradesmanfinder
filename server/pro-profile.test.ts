/**
 * Server tests for /api/pro/:slug — the public pro profile endpoint (#139).
 *
 * The DB is stubbed with an in-memory table so the assertions are about the
 * FIELD-VISIBILITY POLICY, not the SQL. What matters for #139 is that:
 *
 *   1. unclaimed / pending rows: no PII in response
 *   2. claimed rows: full claimed profile
 *   3. opted_out / deleted / missing rows: 404 (indistinguishable)
 *
 * If any of these regress, real user data leaks. That's the reason the
 * tests exercise the response shape directly rather than mocking through
 * an HTTP layer — the shape is the contract.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// Stub the drizzle client BEFORE the SUT imports it.
// The route calls db.select().from(...).where(...).limit(1) up to 3x per
// invocation, so we build a chainable stub whose .limit() pulls from a
// FIFO queue that each test primes.
const queue: any[][] = [];

vi.mock("./storage", () => {
  const chain: any = {
    select: () => chain,
    from: () => chain,
    where: () => chain,
    limit: async () => queue.shift() ?? [],
  };
  return { db: chain };
});

// After the mock is registered, import the SUT.
import { buildProProfileResponse } from "./pro-profile";

/**
 * Prime the queue. buildProProfileResponse issues up to 3 queries in this
 * order per call:
 *   1) tradesmen by slug
 *   2) categories by id (only if categories JSON parses to a non-empty array)
 *   3) areas by id (only if areaId is non-null)
 */
function primeQueue(rows: any[][]) {
  queue.length = 0;
  for (const r of rows) queue.push(r);
}

const baseRow = {
  id: 1,
  slug: "atlas-plumbing-ltd-12345678",
  claimStatus: "unclaimed",
  businessName: "Atlas Plumbing Ltd",
  bio: "Family-run plumbers since 2010",
  postcode: "SW18 7JH",
  areaId: 42,
  heroImageUrl: "https://cdn/hero.jpg",
  gallery: '["https://cdn/g1.jpg","https://cdn/g2.jpg"]',
  videoUrl: "https://cdn/v.mp4",
  categories: "[7]",
  yearsExperience: 15,
  verified: true,
  insured: true,
  licensed: true,
  gasSafeVerified: true,
  ratingAverage: 4.8,
  ratingCount: 27,
  responseTimeMinutes: 45,
  foundingPro: false,
  listingSource: "ch_public_data",
  chIncorporationDate: "2022-07-29",
};

describe("buildProProfileResponse", () => {
  beforeEach(() => {
    queue.length = 0;
  });

  it("returns null when the slug does not exist", async () => {
    primeQueue([[]]);
    const out = await buildProProfileResponse("does-not-exist");
    expect(out).toBeNull();
  });

  it("returns null when claim_status is opted_out (404 indistinguishability)", async () => {
    primeQueue([[{ ...baseRow, claimStatus: "opted_out" }]]);
    const out = await buildProProfileResponse(baseRow.slug);
    expect(out).toBeNull();
  });

  it("returns null when claim_status is deleted", async () => {
    primeQueue([[{ ...baseRow, claimStatus: "deleted" }]]);
    const out = await buildProProfileResponse(baseRow.slug);
    expect(out).toBeNull();
  });

  it("unclaimed: returns minimal fields, hides PII, no claimedProfile block", async () => {
    primeQueue([
      [{ ...baseRow, claimStatus: "unclaimed" }],
      [{ name: "Plumbing" }],
      [{ name: "London" }],
    ]);
    const out = await buildProProfileResponse(baseRow.slug);
    expect(out).not.toBeNull();
    expect(out!.claimStatus).toBe("unclaimed");
    expect(out!.businessName).toBe("Atlas Plumbing Ltd");
    expect(out!.primaryCategory).toBe("Plumbing");
    expect(out!.townLabel).toBe("London");
    // Data minimisation checks:
    expect(out!.postcodeDistrict).toBe("SW18"); // outward code only
    expect(out!.incorporationYear).toBe(2022);  // year band only
    expect(out!.claimedProfile).toBeNull();     // bio/gallery/reviews all hidden
    // Serialised shape must not contain any full-postcode / bio / hero URL.
    const asJson = JSON.stringify(out);
    expect(asJson).not.toContain("SW18 7JH");
    expect(asJson).not.toContain("Family-run plumbers");
    expect(asJson).not.toContain("hero.jpg");
    expect(asJson).not.toContain("2022-07-29");
  });

  it("pending: same minimisation as unclaimed", async () => {
    primeQueue([
      [{ ...baseRow, claimStatus: "pending" }],
      [{ name: "Plumbing" }],
      [{ name: "London" }],
    ]);
    const out = await buildProProfileResponse(baseRow.slug);
    expect(out!.claimStatus).toBe("pending");
    expect(out!.claimedProfile).toBeNull();
    expect(out!.postcodeDistrict).toBe("SW18");
  });

  it("claimed: returns full claimedProfile block", async () => {
    primeQueue([
      [{ ...baseRow, claimStatus: "claimed" }],
      [{ name: "Plumbing" }],
      [{ name: "London" }],
    ]);
    const out = await buildProProfileResponse(baseRow.slug);
    expect(out!.claimStatus).toBe("claimed");
    expect(out!.claimedProfile).not.toBeNull();
    expect(out!.claimedProfile!.bio).toBe("Family-run plumbers since 2010");
    expect(out!.claimedProfile!.gallery).toEqual([
      "https://cdn/g1.jpg",
      "https://cdn/g2.jpg",
    ]);
    expect(out!.claimedProfile!.heroImageUrl).toBe("https://cdn/hero.jpg");
    expect(out!.claimedProfile!.ratingAverage).toBe(4.8);
    expect(out!.claimedProfile!.gasSafeVerified).toBe(true);
    // Even on claimed, postcode district is what's public. The full
    // registered address is still admin-only.
    expect(out!.postcodeDistrict).toBe("SW18");
  });

  it("handles malformed categories JSON gracefully (no crash, no primary category)", async () => {
    primeQueue([
      [{ ...baseRow, claimStatus: "unclaimed", categories: "{not json" }],
      // no categories lookup because parse failed
      [{ name: "London" }],
    ]);
    const out = await buildProProfileResponse(baseRow.slug);
    expect(out!.primaryCategory).toBeNull();
  });

  it("handles null areaId (organic self-signups may lack area) — no town label", async () => {
    primeQueue([
      [{ ...baseRow, claimStatus: "claimed", areaId: null }],
      [{ name: "Plumbing" }],
      // no areas lookup because areaId is null
    ]);
    const out = await buildProProfileResponse(baseRow.slug);
    expect(out!.townLabel).toBeNull();
  });

  it("handles null incorporation date (organic rows) — no year band", async () => {
    primeQueue([
      [{ ...baseRow, claimStatus: "unclaimed", chIncorporationDate: null }],
      [{ name: "Plumbing" }],
      [{ name: "London" }],
    ]);
    const out = await buildProProfileResponse(baseRow.slug);
    expect(out!.incorporationYear).toBeNull();
  });

  it("postcodeDistrict extractor: handles common UK postcode shapes", async () => {
    // We exercise the extractor indirectly through the whole builder to
    // keep the assertion at the response-shape boundary (the module doesn't
    // export the helper deliberately).
    for (const [pc, expected] of [
      ["SW18 7JH", "SW18"],
      ["sw18 7jh", "SW18"],
      ["M1 1AA", "M1"],
      ["EC1A 1BB", "EC1A"],
      ["not-a-postcode", null],
      ["", null],
    ] as Array<[string, string | null]>) {
      primeQueue([
        [{ ...baseRow, claimStatus: "unclaimed", postcode: pc }],
        [{ name: "Plumbing" }],
        [{ name: "London" }],
      ]);
      const out = await buildProProfileResponse(baseRow.slug);
      expect(out!.postcodeDistrict).toBe(expected);
    }
  });
});
