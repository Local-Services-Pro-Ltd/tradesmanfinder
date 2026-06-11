import { describe, it, expect } from "vitest";
import {
  buildSeoRouteManifest,
  scoreRoute,
  supplyKey,
  populationForArea,
  tierStats,
  parseCategoriesJson,
  type SeoArea,
  type SeoCategory,
  type SupplyCounts,
} from "./seo-routes";

// Fixtures shared across tests. Kept minimal so it's obvious how the
// scorer behaves at the boundary cases (0, 1, 3 supply).
const cats: SeoCategory[] = [
  { id: 1, slug: "plumber",    name: "Plumber" },
  { id: 2, slug: "electrician", name: "Electrician" },
];

const areas: (SeoArea & { id: number })[] = [
  { id: 10, slug: "manchester",  name: "Manchester", region: "Greater Manchester M1" },
  { id: 11, slug: "abbey-wood",  name: "Abbey Wood", region: "London SE2" },
  { id: 12, slug: "cambridge",   name: "Cambridge",  region: "Cambridgeshire CB1" },
];

describe("supplyKey", () => {
  it("formats keys consistently for lookup", () => {
    expect(supplyKey(1, 10)).toBe("1:10");
    expect(supplyKey(42, 999)).toBe("42:999");
  });
});

describe("populationForArea", () => {
  it("returns the seeded population for known SEO cities", () => {
    expect(populationForArea("manchester")).toBeGreaterThan(500_000);
    expect(populationForArea("cambridge")).toBeGreaterThan(100_000);
  });

  it("falls back to the London-area default for unknown slugs", () => {
    expect(populationForArea("abbey-wood")).toBe(25_000);
    expect(populationForArea("totally-made-up-place")).toBe(25_000);
  });
});

describe("scoreRoute — tier dominance", () => {
  // The scorer's core invariant: a single tradesperson outweighs population
  // because empty pages don't convert no matter how big the city is.
  it("ranks any sparse-tier route above any empty-tier route", () => {
    const sparseSmallTown = scoreRoute(1, 50_000);
    const emptyMegacity = scoreRoute(0, 10_000_000);
    expect(sparseSmallTown).toBeGreaterThan(emptyMegacity);
  });

  it("ranks any dense-tier route above any sparse-tier route", () => {
    const denseSmallTown = scoreRoute(3, 50_000);
    const sparseMegacity = scoreRoute(2, 10_000_000);
    expect(denseSmallTown).toBeGreaterThan(sparseMegacity);
  });

  it("uses population as a tie-breaker within a tier", () => {
    const bigSparse = scoreRoute(1, 1_000_000);
    const smallSparse = scoreRoute(1, 50_000);
    expect(bigSparse).toBeGreaterThan(smallSparse);
  });

  it("handles zero population gracefully (no NaN, no -Infinity)", () => {
    const score = scoreRoute(0, 0);
    expect(Number.isFinite(score)).toBe(true);
    expect(score).toBeGreaterThanOrEqual(0);
  });

  it("never returns NaN or Infinity for negative-but-typed inputs (defensive)", () => {
    const score = scoreRoute(0, -100);
    expect(Number.isFinite(score)).toBe(true);
  });
});

describe("buildSeoRouteManifest — cross product", () => {
  it("emits cats × areas routes (default keeps empty)", () => {
    const routes = buildSeoRouteManifest(areas, cats, {});
    // 2 cats × 3 areas = 6 routes
    expect(routes).toHaveLength(6);
  });

  it("paths follow the /<cat>-in-<area> convention", () => {
    const routes = buildSeoRouteManifest(areas, cats, {});
    const paths = routes.map((r) => r.path).sort();
    expect(paths).toContain("/plumber-in-manchester");
    expect(paths).toContain("/electrician-in-cambridge");
    expect(paths).toContain("/plumber-in-abbey-wood");
  });

  it("tier is derived from supplyCount thresholds (0 / 1-2 / 3+)", () => {
    const supply: SupplyCounts = {
      [supplyKey(1, 10)]: 0,
      [supplyKey(1, 11)]: 1,
      [supplyKey(1, 12)]: 5,
    };
    const routes = buildSeoRouteManifest(areas, [cats[0]], supply);
    const byArea = Object.fromEntries(routes.map((r) => [r.areaSlug, r.tier]));
    expect(byArea["manchester"]).toBe("empty");
    expect(byArea["abbey-wood"]).toBe("sparse");
    expect(byArea["cambridge"]).toBe("dense");
  });
});

describe("buildSeoRouteManifest — sort + limit", () => {
  it("sorts dense > sparse > empty regardless of population", () => {
    // Manchester (largest pop) gets 0 supply; Cambridge (smallest pop) gets 5.
    // Cambridge must come first because dense beats empty.
    const supply: SupplyCounts = {
      [supplyKey(1, 10)]: 0,   // Manchester
      [supplyKey(1, 11)]: 1,   // Abbey Wood
      [supplyKey(1, 12)]: 5,   // Cambridge
    };
    const routes = buildSeoRouteManifest(areas, [cats[0]], supply);
    expect(routes[0].areaSlug).toBe("cambridge");   // dense, small pop
    expect(routes[1].areaSlug).toBe("abbey-wood");  // sparse
    expect(routes[2].areaSlug).toBe("manchester");  // empty, large pop
  });

  it("respects the limit option", () => {
    const routes = buildSeoRouteManifest(areas, cats, {}, { limit: 2 });
    expect(routes).toHaveLength(2);
  });

  it("excludes empty routes when excludeEmpty=true", () => {
    const supply: SupplyCounts = { [supplyKey(1, 10)]: 1 };
    const routes = buildSeoRouteManifest(areas, [cats[0]], supply, { excludeEmpty: true });
    expect(routes).toHaveLength(1);
    expect(routes[0].areaSlug).toBe("manchester");
  });

  // Deterministic ordering is critical for sitemap stability (Google
  // penalises sitemap churn). Same inputs must yield the same output.
  it("produces identical output across repeated calls (deterministic)", () => {
    const supply: SupplyCounts = {
      [supplyKey(1, 11)]: 1,
      [supplyKey(2, 11)]: 1,
    };
    const a = buildSeoRouteManifest(areas, cats, supply);
    const b = buildSeoRouteManifest(areas, cats, supply);
    expect(a.map((r) => r.path)).toEqual(b.map((r) => r.path));
  });

  it("breaks ties on (categorySlug, areaSlug) when scores are equal", () => {
    // No supply data → all routes are empty-tier with identical pop default
    // except for the SEO cities. Cambridge and Manchester have different pops,
    // but abbey-wood routes share the same score across categories.
    const routes = buildSeoRouteManifest(areas, cats, {});
    const abbeyWoodRoutes = routes.filter((r) => r.areaSlug === "abbey-wood");
    expect(abbeyWoodRoutes).toHaveLength(2);
    // electrician sorts after plumber alphabetically
    expect(abbeyWoodRoutes[0].categorySlug).toBe("electrician");
    expect(abbeyWoodRoutes[1].categorySlug).toBe("plumber");
  });
});

describe("tierStats", () => {
  it("counts routes per tier", () => {
    const supply: SupplyCounts = {
      [supplyKey(1, 10)]: 0,
      [supplyKey(1, 11)]: 1,
      [supplyKey(1, 12)]: 5,
      [supplyKey(2, 10)]: 3,
      [supplyKey(2, 11)]: 0,
      [supplyKey(2, 12)]: 0,
    };
    const routes = buildSeoRouteManifest(areas, cats, supply);
    expect(tierStats(routes)).toEqual({ dense: 2, sparse: 1, empty: 3 });
  });
});

describe("parseCategoriesJson", () => {
  it("parses well-formed JSON array of integers", () => {
    expect(parseCategoriesJson("[1,2,3]")).toEqual([1, 2, 3]);
    expect(parseCategoriesJson("[42]")).toEqual([42]);
  });

  it("returns empty array for null/undefined/empty input", () => {
    expect(parseCategoriesJson(null)).toEqual([]);
    expect(parseCategoriesJson(undefined)).toEqual([]);
    expect(parseCategoriesJson("")).toEqual([]);
  });

  it("returns empty array for malformed JSON", () => {
    expect(parseCategoriesJson("not json")).toEqual([]);
    expect(parseCategoriesJson("{")).toEqual([]);
  });

  it("filters non-integer entries (defensive against schema drift)", () => {
    expect(parseCategoriesJson('[1,"two",3,null,4.5,5]')).toEqual([1, 3, 5]);
  });

  it("returns empty array when JSON is not an array (object/string/number)", () => {
    expect(parseCategoriesJson('{"a":1}')).toEqual([]);
    expect(parseCategoriesJson('"hello"')).toEqual([]);
    expect(parseCategoriesJson("42")).toEqual([]);
  });
});
