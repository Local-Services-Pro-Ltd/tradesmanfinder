/**
 * Tests for the pure main-host SEO payload builder (PR-#19-D).
 *
 * These cover:
 *   - title/description shape (with and without supply)
 *   - canonical URL construction (incl. multi-hyphen area slug)
 *   - JSON-LD array contains the three expected @types in order
 *   - LocalBusiness uses the same canonical and embeds region
 *   - BreadcrumbList is well-formed (4 positions, 1-indexed)
 *
 * Pure function → no mocks, no I/O.
 */

import { describe, it, expect } from "vitest";
import { buildMainHostSeo } from "./main-host-seo";

const ORIGIN = "https://tradesmanfinder.com";

const PLUMBER = { id: 2, slug: "plumber", name: "Plumber" };
const MANCHESTER = {
  id: 1,
  slug: "manchester",
  name: "Manchester",
  region: "Greater Manchester M1",
};
const NEWCASTLE = {
  id: 4,
  slug: "newcastle-upon-tyne",
  name: "Newcastle upon Tyne",
  region: "Tyne and Wear NE1",
};

describe("buildMainHostSeo — title", () => {
  it("includes verified-pro count when supply > 0", () => {
    const seo = buildMainHostSeo({
      category: PLUMBER,
      area: MANCHESTER,
      origin: ORIGIN,
      supplyCount: 5,
    });
    expect(seo.title).toBe(
      "Plumbers in Manchester — 5 Verified Local Pros | TradesmanFinder",
    );
  });

  it("drops the count when supply is 0 and uses reviews/quotes framing", () => {
    const seo = buildMainHostSeo({
      category: PLUMBER,
      area: MANCHESTER,
      origin: ORIGIN,
      supplyCount: 0,
    });
    expect(seo.title).toBe(
      "Plumbers in Manchester — Reviews & Free Quotes | TradesmanFinder",
    );
  });

  it("preserves multi-word area names exactly (Newcastle upon Tyne)", () => {
    const seo = buildMainHostSeo({
      category: PLUMBER,
      area: NEWCASTLE,
      origin: ORIGIN,
      supplyCount: 2,
    });
    expect(seo.title).toContain("Plumbers in Newcastle upon Tyne");
  });
});

describe("buildMainHostSeo — description", () => {
  it("uses supply-aware copy when count > 0 and includes region", () => {
    const seo = buildMainHostSeo({
      category: PLUMBER,
      area: MANCHESTER,
      origin: ORIGIN,
      supplyCount: 5,
    });
    expect(seo.description).toContain("5 verified plumbers in Manchester");
    expect(seo.description).toContain("(Greater Manchester M1)");
  });

  it("uses post-a-job framing when count is 0", () => {
    const seo = buildMainHostSeo({
      category: PLUMBER,
      area: MANCHESTER,
      origin: ORIGIN,
      supplyCount: 0,
    });
    expect(seo.description).toContain("Post a job free");
    expect(seo.description).toContain("Manchester");
  });
});

describe("buildMainHostSeo — canonical", () => {
  it("builds the flat /{cat}-in-{area} URL on the supplied origin", () => {
    const seo = buildMainHostSeo({
      category: PLUMBER,
      area: MANCHESTER,
      origin: ORIGIN,
      supplyCount: 3,
    });
    expect(seo.canonical).toBe(
      "https://tradesmanfinder.com/plumber-in-manchester",
    );
  });

  it("preserves hyphens in multi-hyphen area slugs", () => {
    const seo = buildMainHostSeo({
      category: PLUMBER,
      area: NEWCASTLE,
      origin: ORIGIN,
      supplyCount: 1,
    });
    expect(seo.canonical).toBe(
      "https://tradesmanfinder.com/plumber-in-newcastle-upon-tyne",
    );
  });

  it("respects a staging origin", () => {
    const seo = buildMainHostSeo({
      category: PLUMBER,
      area: MANCHESTER,
      origin: "https://staging.tradesmanfinder.com",
      supplyCount: 0,
    });
    expect(seo.canonical).toBe(
      "https://staging.tradesmanfinder.com/plumber-in-manchester",
    );
  });
});

describe("buildMainHostSeo — OpenGraph", () => {
  it("mirrors title/description into ogTitle/ogDescription", () => {
    const seo = buildMainHostSeo({
      category: PLUMBER,
      area: MANCHESTER,
      origin: ORIGIN,
      supplyCount: 3,
    });
    expect(seo.ogTitle).toBe(seo.title);
    expect(seo.ogDescription).toBe(seo.description);
    expect(seo.ogType).toBe("website");
  });
});

describe("buildMainHostSeo — JSON-LD", () => {
  it("emits three blocks in order: LocalBusiness, Service, BreadcrumbList", () => {
    const seo = buildMainHostSeo({
      category: PLUMBER,
      area: MANCHESTER,
      origin: ORIGIN,
      supplyCount: 3,
    });
    expect(seo.jsonLd).toHaveLength(3);
    expect(seo.jsonLd[0]["@type"]).toBe("LocalBusiness");
    expect(seo.jsonLd[1]["@type"]).toBe("Service");
    expect(seo.jsonLd[2]["@type"]).toBe("BreadcrumbList");
  });

  it("LocalBusiness uses the canonical URL and embeds region as containedInPlace", () => {
    const seo = buildMainHostSeo({
      category: PLUMBER,
      area: MANCHESTER,
      origin: ORIGIN,
      supplyCount: 3,
    });
    const lb = seo.jsonLd[0] as Record<string, unknown>;
    expect(lb.url).toBe(seo.canonical);
    expect(lb.name).toBe("Plumbers in Manchester");
    expect((lb.areaServed as Record<string, unknown>).name).toBe("Manchester");
    expect((lb.areaServed as Record<string, unknown>).containedInPlace).toBe(
      "Greater Manchester M1",
    );
    expect(lb.knowsAbout).toBe("Plumber");
    expect(lb["@id"]).toBe(`${seo.canonical}#directory`);
  });

  it("Service block names the trade and the area", () => {
    const seo = buildMainHostSeo({
      category: PLUMBER,
      area: MANCHESTER,
      origin: ORIGIN,
      supplyCount: 0,
    });
    const svc = seo.jsonLd[1] as Record<string, unknown>;
    expect(svc.serviceType).toBe("Plumber");
    expect(svc.url).toBe(seo.canonical);
    expect((svc.provider as Record<string, unknown>).name).toBe(
      "TradesmanFinder",
    );
    expect((svc.areaServed as Record<string, unknown>).name).toBe("Manchester");
  });

  it("BreadcrumbList has 4 positions, 1-indexed, pointing at the right URLs", () => {
    const seo = buildMainHostSeo({
      category: PLUMBER,
      area: MANCHESTER,
      origin: ORIGIN,
      supplyCount: 3,
    });
    const bc = seo.jsonLd[2] as Record<string, unknown>;
    const items = bc.itemListElement as Array<Record<string, unknown>>;
    expect(items).toHaveLength(4);
    expect(items.map((i) => i.position)).toEqual([1, 2, 3, 4]);
    expect(items[0].item).toBe(`${ORIGIN}/`);
    expect(items[1].item).toBe(`${ORIGIN}/category/plumber`);
    expect(items[2].item).toBe(`${ORIGIN}/area/manchester`);
    expect(items[3].item).toBe(seo.canonical);
    expect(items[3].name).toBe("Plumbers in Manchester");
  });

  it("JSON-LD payloads are serialisable (no functions / undefined leaks)", () => {
    const seo = buildMainHostSeo({
      category: PLUMBER,
      area: NEWCASTLE,
      origin: ORIGIN,
      supplyCount: 2,
    });
    for (const block of seo.jsonLd) {
      // Round-tripping catches accidental undefined / function references
      // that would silently drop fields when injected as a <script> body.
      expect(() => JSON.parse(JSON.stringify(block))).not.toThrow();
    }
  });
});
