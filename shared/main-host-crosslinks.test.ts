import { describe, expect, it } from "vitest";
import {
  buildCrosslinks,
  pickNearbyAreas,
  pickRelatedCategories,
  type CrosslinkArea,
  type CrosslinkCategory,
} from "./main-host-crosslinks";

// Realistic UK lat/lng so distance ordering matches geographic intuition.
const AREAS: CrosslinkArea[] = [
  { id: 1, slug: "london", name: "London", region: "Greater London", latitude: 51.5074, longitude: -0.1278 },
  { id: 2, slug: "manchester", name: "Manchester", region: "Greater Manchester", latitude: 53.4808, longitude: -2.2426 },
  { id: 3, slug: "liverpool", name: "Liverpool", region: "Merseyside", latitude: 53.4084, longitude: -2.9916 },
  { id: 4, slug: "leeds", name: "Leeds", region: "West Yorkshire", latitude: 53.8008, longitude: -1.5491 },
  { id: 5, slug: "birmingham", name: "Birmingham", region: "West Midlands", latitude: 52.4862, longitude: -1.8904 },
  { id: 6, slug: "bristol", name: "Bristol", region: "South West", latitude: 51.4545, longitude: -2.5879 },
  { id: 7, slug: "newcastle-upon-tyne", name: "Newcastle upon Tyne", region: "Tyne and Wear", latitude: 54.9783, longitude: -1.6178 },
  { id: 8, slug: "edinburgh", name: "Edinburgh", region: "Scotland", latitude: 55.9533, longitude: -3.1883 },
];

const CATS: CrosslinkCategory[] = [
  { id: 1, slug: "plumber", name: "Plumber", parentId: null },
  { id: 2, slug: "electrician", name: "Electrician", parentId: null },
  { id: 3, slug: "builder", name: "Builder", parentId: null },
  { id: 4, slug: "roofer", name: "Roofer", parentId: null },
  { id: 5, slug: "emergency-plumber", name: "Emergency Plumber", parentId: 1 },
  { id: 6, slug: "boiler-engineer", name: "Boiler Engineer", parentId: 1 },
  { id: 7, slug: "domestic-electrician", name: "Domestic Electrician", parentId: 2 },
];

describe("pickNearbyAreas", () => {
  it("excludes the input area itself", () => {
    const manchester = AREAS.find((a) => a.slug === "manchester")!;
    const result = pickNearbyAreas(manchester, AREAS, 10);
    expect(result.find((a) => a.id === manchester.id)).toBeUndefined();
  });

  it("orders areas by ascending Haversine distance", () => {
    const manchester = AREAS.find((a) => a.slug === "manchester")!;
    const result = pickNearbyAreas(manchester, AREAS, 3);
    // Liverpool and Leeds are clearly nearest to Manchester.
    expect(result[0].slug).toBe("liverpool");
    expect(result[1].slug).toBe("leeds");
  });

  it("returns at most `limit` items", () => {
    const london = AREAS.find((a) => a.slug === "london")!;
    expect(pickNearbyAreas(london, AREAS, 3)).toHaveLength(3);
    expect(pickNearbyAreas(london, AREAS, 100)).toHaveLength(AREAS.length - 1);
  });

  it("returns [] when limit is 0 or negative", () => {
    const london = AREAS.find((a) => a.slug === "london")!;
    expect(pickNearbyAreas(london, AREAS, 0)).toEqual([]);
    expect(pickNearbyAreas(london, AREAS, -1)).toEqual([]);
  });

  it("returns [] when the only area present is the input", () => {
    const solo = AREAS[0];
    expect(pickNearbyAreas(solo, [solo], 5)).toEqual([]);
  });

  it("returns [] when the input area has missing/NaN coordinates (fail closed)", () => {
    // Simulates the regression we shipped: a caller dropped lat/lng
    // from the narrowed area type, every distance was NaN, and the
    // sort silently kept insertion order — producing 170-mile-away
    // 'nearby' cities.
    const badArea = {
      id: 999,
      slug: "bad",
      name: "Bad",
      region: "r",
      latitude: NaN,
      longitude: NaN,
    } as CrosslinkArea;
    expect(pickNearbyAreas(badArea, AREAS, 5)).toEqual([]);
  });

  it("skips candidate areas with missing coordinates", () => {
    const manchester = AREAS.find((a) => a.slug === "manchester")!;
    const bad = {
      id: 100,
      slug: "bad",
      name: "Bad",
      region: "r",
      latitude: undefined as unknown as number,
      longitude: undefined as unknown as number,
    } as CrosslinkArea;
    const result = pickNearbyAreas(manchester, [...AREAS, bad], 10);
    expect(result.find((a) => a.id === 100)).toBeUndefined();
  });

  it("breaks ties on id ascending (deterministic)", () => {
    const a: CrosslinkArea = { id: 1, slug: "a", name: "A", region: "r", latitude: 0, longitude: 0 };
    const b: CrosslinkArea = { id: 2, slug: "b", name: "B", region: "r", latitude: 1, longitude: 1 };
    const c: CrosslinkArea = { id: 3, slug: "c", name: "C", region: "r", latitude: 1, longitude: 1 }; // same coords as b
    const result = pickNearbyAreas(a, [a, b, c], 5);
    expect(result.map((x) => x.id)).toEqual([2, 3]);
  });
});

describe("pickRelatedCategories", () => {
  it("excludes the input category", () => {
    const plumber = CATS.find((c) => c.slug === "plumber")!;
    const result = pickRelatedCategories(plumber, CATS, 10);
    expect(result.find((c) => c.id === plumber.id)).toBeUndefined();
  });

  it("prefers siblings (same parentId)", () => {
    const emergencyPlumber = CATS.find((c) => c.slug === "emergency-plumber")!;
    const result = pickRelatedCategories(emergencyPlumber, CATS, 5);
    // parentId=1 siblings: boiler-engineer (id 6). Then backfill from rest.
    expect(result[0].slug).toBe("boiler-engineer");
  });

  it("for top-level category, treats other top-level categories as siblings", () => {
    const plumber = CATS.find((c) => c.slug === "plumber")!;
    const result = pickRelatedCategories(plumber, CATS, 3);
    // top-level: electrician (2), builder (3), roofer (4) — by id ascending.
    expect(result.map((c) => c.slug)).toEqual(["electrician", "builder", "roofer"]);
  });

  it("backfills from non-siblings when siblings < limit", () => {
    const emergencyPlumber = CATS.find((c) => c.slug === "emergency-plumber")!;
    const result = pickRelatedCategories(emergencyPlumber, CATS, 5);
    // sibling: boiler-engineer. Then by id: plumber(1), electrician(2), builder(3), roofer(4).
    // The input itself is excluded, so we expect: boiler-engineer, plumber, electrician, builder, roofer.
    expect(result.map((c) => c.slug)).toEqual([
      "boiler-engineer",
      "plumber",
      "electrician",
      "builder",
      "roofer",
    ]);
  });

  it("returns [] when limit is 0", () => {
    const plumber = CATS.find((c) => c.slug === "plumber")!;
    expect(pickRelatedCategories(plumber, CATS, 0)).toEqual([]);
  });

  it("returns [] when the only category present is the input", () => {
    const solo = CATS[0];
    expect(pickRelatedCategories(solo, [solo], 5)).toEqual([]);
  });
});

describe("buildCrosslinks", () => {
  it("produces canonical /{cat}-in-{area} hrefs for nearby cities", () => {
    const plumber = CATS[0];
    const manchester = AREAS.find((a) => a.slug === "manchester")!;
    const { nearbyCities } = buildCrosslinks({
      category: plumber,
      area: manchester,
      allCategories: CATS,
      allAreas: AREAS,
      limit: 2,
    });
    expect(nearbyCities[0].href).toMatch(/^\/plumber-in-[a-z-]+$/);
    expect(nearbyCities[0].label).toMatch(/^Plumbers in /);
    expect(nearbyCities[0].href).toBe(`/plumber-in-${nearbyCities[0].slug}`);
  });

  it("produces canonical /{cat}-in-{area} hrefs for related trades", () => {
    const plumber = CATS[0];
    const manchester = AREAS.find((a) => a.slug === "manchester")!;
    const { relatedTrades } = buildCrosslinks({
      category: plumber,
      area: manchester,
      allCategories: CATS,
      allAreas: AREAS,
      limit: 2,
    });
    expect(relatedTrades[0].href).toMatch(/^\/[a-z-]+-in-manchester$/);
    expect(relatedTrades[0].label).toMatch(/ in Manchester$/);
    expect(relatedTrades[0].href).toBe(`/${relatedTrades[0].slug}-in-manchester`);
  });

  it("never includes the current (cat, area) pair in either cluster", () => {
    const plumber = CATS[0];
    const manchester = AREAS.find((a) => a.slug === "manchester")!;
    const { nearbyCities, relatedTrades } = buildCrosslinks({
      category: plumber,
      area: manchester,
      allCategories: CATS,
      allAreas: AREAS,
    });
    expect(nearbyCities.find((c) => c.href === "/plumber-in-manchester")).toBeUndefined();
    expect(relatedTrades.find((t) => t.href === "/plumber-in-manchester")).toBeUndefined();
  });

  it("defaults to 6-item limit per cluster", () => {
    const plumber = CATS[0];
    const london = AREAS[0];
    const result = buildCrosslinks({
      category: plumber,
      area: london,
      allCategories: CATS,
      allAreas: AREAS,
    });
    expect(result.nearbyCities.length).toBeLessThanOrEqual(6);
    expect(result.relatedTrades.length).toBeLessThanOrEqual(6);
    // With 8 areas total and 7 cats total, both clusters should fill to 6.
    expect(result.nearbyCities).toHaveLength(6);
    expect(result.relatedTrades).toHaveLength(6);
  });

  it("respects an explicit smaller limit", () => {
    const plumber = CATS[0];
    const london = AREAS[0];
    const result = buildCrosslinks({
      category: plumber,
      area: london,
      allCategories: CATS,
      allAreas: AREAS,
      limit: 2,
    });
    expect(result.nearbyCities).toHaveLength(2);
    expect(result.relatedTrades).toHaveLength(2);
  });

  it("survives degenerate inputs (only the current entities)", () => {
    const result = buildCrosslinks({
      category: CATS[0],
      area: AREAS[0],
      allCategories: [CATS[0]],
      allAreas: [AREAS[0]],
    });
    expect(result.nearbyCities).toEqual([]);
    expect(result.relatedTrades).toEqual([]);
  });
});
