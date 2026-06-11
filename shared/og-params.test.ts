/**
 * Tests for shared/og-params.ts — round-trip + defensive parsing.
 *
 * The renderer at /api/og and the SEO injector at server/main-host-spa.ts
 * both depend on this module. Bugs here ship broken Twitter cards
 * silently (the crawler still gets a 200, just with the wrong image).
 */

import { describe, it, expect } from "vitest";

import {
  buildOgImageQuery,
  parseOgImageQuery,
  OG_MAX_TRADE_LEN,
  OG_MAX_AREA_LEN,
  OG_MAX_SUPPLY,
} from "./og-params";

describe("buildOgImageQuery", () => {
  it("builds the canonical query for the happy path", () => {
    const q = buildOgImageQuery({ trade: "Plumber", area: "Manchester", supply: 3 });
    expect(q).toBe("?trade=Plumber&area=Manchester&n=3");
  });

  it("omits the `n` param when supply is 0", () => {
    const q = buildOgImageQuery({ trade: "Plumber", area: "Manchester", supply: 0 });
    expect(q).toBe("?trade=Plumber&area=Manchester");
  });

  it("URL-encodes spaces and special characters in the area name", () => {
    const q = buildOgImageQuery({
      trade: "Plumber",
      area: "Newcastle upon Tyne",
      supply: 2,
    });
    // URLSearchParams uses + for space (form-encoding); both Express and
    // Edge URL parsers decode it back to space.
    expect(q).toContain("area=Newcastle+upon+Tyne");
  });

  it("clamps trade names longer than the cap", () => {
    const longTrade = "A".repeat(OG_MAX_TRADE_LEN + 10);
    const q = buildOgImageQuery({ trade: longTrade, area: "X", supply: 0 });
    const params = new URLSearchParams(q.slice(1));
    expect(params.get("trade")!.length).toBe(OG_MAX_TRADE_LEN);
  });

  it("clamps supply above the max", () => {
    const q = buildOgImageQuery({ trade: "T", area: "A", supply: 100000 });
    expect(q).toContain(`n=${OG_MAX_SUPPLY}`);
  });

  it("clamps negative supply to 0 (which means omit)", () => {
    const q = buildOgImageQuery({ trade: "T", area: "A", supply: -5 });
    expect(q).not.toContain("n=");
  });
});

describe("parseOgImageQuery — happy path", () => {
  it("parses URLSearchParams input", () => {
    const params = new URLSearchParams("trade=Plumber&area=Manchester&n=3");
    expect(parseOgImageQuery(params)).toEqual({
      trade: "Plumber",
      area: "Manchester",
      supply: 3,
    });
  });

  it("parses Express-style req.query record input", () => {
    expect(parseOgImageQuery({ trade: "Plumber", area: "Manchester", n: "3" })).toEqual({
      trade: "Plumber",
      area: "Manchester",
      supply: 3,
    });
  });

  it("defaults supply to 0 when n is absent", () => {
    expect(parseOgImageQuery({ trade: "Plumber", area: "Manchester" })).toEqual({
      trade: "Plumber",
      area: "Manchester",
      supply: 0,
    });
  });

  it("trims surrounding whitespace from trade and area", () => {
    expect(parseOgImageQuery({ trade: "  Plumber  ", area: " Manchester " })).toEqual({
      trade: "Plumber",
      area: "Manchester",
      supply: 0,
    });
  });
});

describe("parseOgImageQuery — defensive", () => {
  it("returns null when trade is missing", () => {
    expect(parseOgImageQuery({ area: "Manchester" })).toBeNull();
  });

  it("returns null when area is missing", () => {
    expect(parseOgImageQuery({ trade: "Plumber" })).toBeNull();
  });

  it("returns null when both are missing", () => {
    expect(parseOgImageQuery({})).toBeNull();
  });

  it("returns null when trade exceeds the length cap (defence against URL spam)", () => {
    const longTrade = "A".repeat(OG_MAX_TRADE_LEN + 1);
    expect(parseOgImageQuery({ trade: longTrade, area: "X" })).toBeNull();
  });

  it("returns null when area exceeds the length cap", () => {
    const longArea = "B".repeat(OG_MAX_AREA_LEN + 1);
    expect(parseOgImageQuery({ trade: "X", area: longArea })).toBeNull();
  });

  it("clamps NaN supply to 0 rather than rejecting", () => {
    // Better to render an image with no count than 5xx the crawler.
    const parsed = parseOgImageQuery({ trade: "T", area: "A", n: "abc" });
    expect(parsed).toEqual({ trade: "T", area: "A", supply: 0 });
  });

  it("clamps huge supply to OG_MAX_SUPPLY", () => {
    const parsed = parseOgImageQuery({ trade: "T", area: "A", n: "999999" });
    expect(parsed?.supply).toBe(OG_MAX_SUPPLY);
  });

  it("clamps negative supply to 0", () => {
    const parsed = parseOgImageQuery({ trade: "T", area: "A", n: "-5" });
    expect(parsed?.supply).toBe(0);
  });

  it("ignores array-valued params (takes the first) — Express behaviour", () => {
    // Express's qs parser turns ?trade=a&trade=b into trade=['a','b']
    const parsed = parseOgImageQuery({ trade: ["Plumber", "Hacker"] as unknown as string, area: "X" });
    expect(parsed?.trade).toBe("Plumber");
  });
});

describe("buildOgImageQuery → parseOgImageQuery round-trip", () => {
  it.each([
    { trade: "Plumber", area: "Manchester", supply: 3 },
    { trade: "Electrician", area: "Newcastle upon Tyne", supply: 12 },
    { trade: "Roofer", area: "Stoke-on-Trent", supply: 0 },
    { trade: "Gardener", area: "Royal Tunbridge Wells", supply: 1 },
  ])("preserves $trade in $area (supply $supply) through the URL", (input) => {
    const q = buildOgImageQuery(input);
    const params = new URLSearchParams(q.slice(1));
    const parsed = parseOgImageQuery(params);
    expect(parsed).toEqual(input);
  });
});
