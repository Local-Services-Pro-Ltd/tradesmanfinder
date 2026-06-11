/**
 * Tests for the main-host /sitemap.xml + /robots.txt module (PR-#19-C).
 *
 * The handlers themselves are thin shells around three pure pieces:
 *   - buildMainSitemap(origin) — does the DB read + manifest build
 *   - buildMainRobots(origin)  — string template
 *   - registerMainSiteRoutes(app) — Express wiring
 *
 * We test the pure pieces directly. The DB reads are mocked via vi.mock
 * on './storage' BEFORE importing the module under test, so we don't
 * need a live Postgres for the suite.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock storage BEFORE importing main-sitemap (hoisted by vi).
// Fixtures mirror the real schema shape: ints for id, JSON strings for
// tradesmen.categories. Realistic enough that parseCategoriesJson works.
vi.mock("./storage", () => ({
  storage: {
    getAreas: vi.fn().mockResolvedValue([
      { id: 1, slug: "manchester",  name: "Manchester", region: "Greater Manchester M1", latitude: 53.48, longitude: -2.24 },
      { id: 2, slug: "cambridge",   name: "Cambridge",  region: "Cambridgeshire CB1",    latitude: 52.20, longitude: 0.12 },
      { id: 3, slug: "abbey-wood",  name: "Abbey Wood", region: "London SE2",            latitude: 51.49, longitude: 0.11 },
    ]),
    getCategories: vi.fn().mockResolvedValue([
      { id: 1, slug: "builder",     name: "Builder",     icon: "hammer", description: "" },
      { id: 2, slug: "plumber",     name: "Plumber",     icon: "wrench", description: "" },
      { id: 3, slug: "electrician", name: "Electrician", icon: "bolt",   description: "" },
    ]),
    getTradesmen: vi.fn().mockResolvedValue([
      // 3 plumbers in Cambridge → 'dense' tier for plumber-in-cambridge
      { id: 10, areaId: 2, categories: "[2]" },
      { id: 11, areaId: 2, categories: "[2]" },
      { id: 12, areaId: 2, categories: "[2]" },
      // 1 builder in Manchester → 'sparse'
      { id: 13, areaId: 1, categories: "[1]" },
      // 1 electrician in Abbey Wood (London ward → default population)
      { id: 14, areaId: 3, categories: "[3]" },
      // Defensive cases: null area, malformed categories
      { id: 15, areaId: null,  categories: "[2]" },
      { id: 16, areaId: 2,     categories: null },
      { id: 17, areaId: 2,     categories: "not-json" },
    ]),
  },
}));

import {
  buildMainSitemap,
  buildMainRobots,
  _resetMainSitemapCache,
} from "./main-sitemap";

const ORIGIN = "https://tradesmanfinder.com";

beforeEach(() => {
  _resetMainSitemapCache();
});

describe("buildMainRobots", () => {
  it("allows everything by default and disallows private surfaces", () => {
    const body = buildMainRobots(ORIGIN);
    expect(body).toContain("User-agent: *");
    expect(body).toContain("Allow: /");
    expect(body).toContain("Disallow: /api/");
    expect(body).toContain("Disallow: /admin/");
    expect(body).toContain("Disallow: /dashboard");
    expect(body).toContain("Disallow: /checkout/");
  });

  it("advertises the absolute sitemap URL", () => {
    expect(buildMainRobots(ORIGIN)).toContain(`Sitemap: ${ORIGIN}/sitemap.xml`);
  });

  it("ends with a trailing newline so curl/cat output is clean", () => {
    expect(buildMainRobots(ORIGIN).endsWith("\n")).toBe(true);
  });
});

describe("buildMainSitemap — shape + structure", () => {
  it("emits a valid XML sitemap document", async () => {
    const xml = await buildMainSitemap(ORIGIN);
    expect(xml.startsWith('<?xml version="1.0" encoding="UTF-8"?>')).toBe(true);
    expect(xml).toContain('<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">');
    expect(xml.endsWith("</urlset>")).toBe(true);
  });

  it("includes the homepage with priority 1.0", async () => {
    const xml = await buildMainSitemap(ORIGIN);
    expect(xml).toContain(`<loc>${ORIGIN}/</loc>`);
    // Match the homepage block specifically — first <url> entry.
    const firstBlock = xml.split("<url>")[1] ?? "";
    expect(firstBlock).toContain(`<loc>${ORIGIN}/</loc>`);
    expect(firstBlock).toContain("<priority>1.0</priority>");
  });

  it("includes single-axis category and area URLs", async () => {
    const xml = await buildMainSitemap(ORIGIN);
    expect(xml).toContain(`<loc>${ORIGIN}/category/plumber</loc>`);
    expect(xml).toContain(`<loc>${ORIGIN}/area/cambridge</loc>`);
  });

  it("emits hyperlocal routes under /{cat}-in-{area}", async () => {
    const xml = await buildMainSitemap(ORIGIN);
    // Cross-product of 3 cats x 3 areas = 9 hyperlocal routes
    expect(xml).toContain(`<loc>${ORIGIN}/plumber-in-cambridge</loc>`);
    expect(xml).toContain(`<loc>${ORIGIN}/builder-in-manchester</loc>`);
    expect(xml).toContain(`<loc>${ORIGIN}/electrician-in-abbey-wood</loc>`);
  });

  it("assigns higher priority to dense hyperlocal routes than empty ones", async () => {
    const xml = await buildMainSitemap(ORIGIN);

    // Find the <url> block for plumber-in-cambridge (dense: 3 plumbers)
    const denseBlock = xml
      .split("<url>")
      .find((b) => b.includes(`/plumber-in-cambridge</loc>`));
    expect(denseBlock).toBeDefined();
    expect(denseBlock).toContain("<priority>0.7</priority>");

    // Find the <url> block for an empty pair (e.g. plumber-in-manchester:
    // 0 plumbers in Manchester in our fixture)
    const emptyBlock = xml
      .split("<url>")
      .find((b) => b.includes(`/plumber-in-manchester</loc>`));
    expect(emptyBlock).toBeDefined();
    expect(emptyBlock).toContain("<priority>0.3</priority>");
  });

  it("counts tradesmen tolerantly (skips null areaId + malformed JSON)", async () => {
    // Tradesmen 15-17 in the fixture have null areaId / null categories /
    // malformed JSON. The dense tier for plumber-in-cambridge still resolves
    // from the 3 well-formed plumbers (ids 10/11/12), not from the malformed
    // rows leaking into the count.
    const xml = await buildMainSitemap(ORIGIN);
    const denseBlock = xml
      .split("<url>")
      .find((b) => b.includes(`/plumber-in-cambridge</loc>`));
    // priority 0.7 (dense). If malformed rows counted, it might still be
    // dense, so this is a smoke check — the deeper invariant is "doesn't
    // throw" which the rest of the suite already covers.
    expect(denseBlock).toContain("<priority>0.7</priority>");
  });

  it("escapes ampersands in <loc> (defensive: slugs shouldn't contain them, but…)", async () => {
    // Verify the XML never contains a raw & — important so external
    // validators don't bail out. Our fixture has no &, but the entity
    // should not appear in URLs we generated.
    const xml = await buildMainSitemap(ORIGIN);
    // No literal '&' in the document (every & must be &amp; etc.)
    const ampMatches = xml.match(/&(?!amp;|lt;|gt;|quot;|apos;)/g);
    expect(ampMatches).toBeNull();
  });

  it("uses the supplied origin for every <loc> URL", async () => {
    const xml = await buildMainSitemap("https://staging.example.com");
    // Every <loc> we emit should start with our staging origin.
    const locs = Array.from(xml.matchAll(/<loc>([^<]+)<\/loc>/g)).map((m) => m[1]);
    expect(locs.length).toBeGreaterThan(0);
    for (const loc of locs) {
      expect(loc.startsWith("https://staging.example.com")).toBe(true);
    }
  });
});

describe("buildMainSitemap — route limit", () => {
  it("caps hyperlocal routes at the default limit (smoke check)", async () => {
    // With 3 cats × 3 areas we only generate 9 hyperlocal routes — well
    // under the 400 cap. This test confirms we don't OVER-emit on a small
    // dataset (no duplicate URLs, no crash). The real >400 behaviour is
    // tested in shared/seo-routes.test.ts.
    const xml = await buildMainSitemap(ORIGIN);
    const locs = Array.from(xml.matchAll(/<loc>([^<]+)<\/loc>/g)).map((m) => m[1]);
    const dupes = locs.filter((u, i) => locs.indexOf(u) !== i);
    expect(dupes).toEqual([]);
  });
});
