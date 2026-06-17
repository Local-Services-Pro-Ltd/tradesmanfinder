/**
 * AREA RESOLVER — regression guard for the free-text area picker.
 *
 * Covers:
 *   - Exact slug / name match wins over substring / region
 *   - Outward postcode match: "SE13" → London SE13
 *   - Full postcode parsed to outward: "SE13 6AA" → SE13
 *   - Substring matches on name and region
 *   - Below-min-length queries return empty
 *   - Unknown query returns empty (caller routes to waitlist)
 *   - Ranking is deterministic when scores tie
 */
import { describe, it, expect } from "vitest";
import { resolveAreas, extractOutwardPostcode, type ResolvableArea } from "./area-resolver";

const AREAS: ResolvableArea[] = [
  { id: 7, slug: "lewisham", name: "Lewisham", region: "London SE13" },
  { id: 14, slug: "blackheath", name: "Blackheath", region: "London SE3" },
  { id: 84, slug: "camden", name: "Camden", region: "London NW1" },
  { id: 85, slug: "tower-hamlets", name: "Tower Hamlets", region: "London E1" },
  { id: 17, slug: "manchester", name: "Manchester", region: "Greater Manchester M1" },
  { id: 18, slug: "birmingham", name: "Birmingham", region: "West Midlands B1" },
];

describe("extractOutwardPostcode", () => {
  it("extracts a bare outward code", () => {
    expect(extractOutwardPostcode("SE13")).toBe("SE13");
    expect(extractOutwardPostcode("nw1")).toBe("NW1");
    expect(extractOutwardPostcode("E1")).toBe("E1");
    expect(extractOutwardPostcode("EC1A")).toBe("EC1A");
  });

  it("strips the inward half from a full postcode", () => {
    expect(extractOutwardPostcode("SE13 6AA")).toBe("SE13");
    expect(extractOutwardPostcode("nw1 4rp")).toBe("NW1");
  });

  it("extracts when embedded in a longer string", () => {
    expect(extractOutwardPostcode("near SE13 please")).toBe("SE13");
  });

  it("returns null for non-postcode input", () => {
    expect(extractOutwardPostcode("camden")).toBeNull();
    expect(extractOutwardPostcode("")).toBeNull();
    expect(extractOutwardPostcode("123")).toBeNull();
  });
});

describe("resolveAreas — exact matches", () => {
  it("exact slug beats substring of name", () => {
    const r = resolveAreas("camden", AREAS);
    expect(r[0].area.slug).toBe("camden");
    expect(r[0].rule).toBe("exact_slug");
  });

  it("exact name match works case-insensitively", () => {
    const r = resolveAreas("Lewisham", AREAS);
    expect(r[0].area.slug).toBe("lewisham");
  });
});

describe("resolveAreas — postcode matches", () => {
  it("outward postcode resolves to the right area", () => {
    const r = resolveAreas("SE13", AREAS);
    expect(r[0].area.slug).toBe("lewisham");
    expect(r[0].rule).toBe("outward_postcode");
  });

  it("full postcode parses to outward and matches", () => {
    const r = resolveAreas("SE13 6AA", AREAS);
    expect(r[0].area.slug).toBe("lewisham");
  });

  it("outward postcode for unseeded area returns no matches", () => {
    // SW2 = Brixton, not seeded
    const r = resolveAreas("SW2", AREAS);
    expect(r).toHaveLength(0);
  });

  it("Camden by outward NW1 resolves", () => {
    const r = resolveAreas("NW1", AREAS);
    expect(r[0].area.slug).toBe("camden");
  });
});

describe("resolveAreas — substring", () => {
  it("partial name match works", () => {
    const r = resolveAreas("lewis", AREAS);
    expect(r.map((m) => m.area.slug)).toContain("lewisham");
  });

  it("region substring works", () => {
    const r = resolveAreas("midlands", AREAS);
    expect(r[0].area.slug).toBe("birmingham");
  });
});

describe("resolveAreas — guardrails", () => {
  it("returns empty for queries shorter than 2 chars", () => {
    expect(resolveAreas("l", AREAS)).toHaveLength(0);
    expect(resolveAreas("", AREAS)).toHaveLength(0);
    expect(resolveAreas("  ", AREAS)).toHaveLength(0);
  });

  it("returns empty for unknown queries (caller routes to waitlist)", () => {
    expect(resolveAreas("streatham", AREAS)).toHaveLength(0);
    expect(resolveAreas("finsbury park", AREAS)).toHaveLength(0);
  });

  it("respects the limit", () => {
    // All six areas contain 'london' or 'manchester'/'midlands' — but only
    // those whose region contains the query substring will match. We use
    // 'lon' to match the four London ones, then limit to 2.
    const r = resolveAreas("lon", AREAS, 2);
    expect(r).toHaveLength(2);
  });
});

describe("resolveAreas — ranking", () => {
  it("ties break by alphabetical area name (deterministic ordering)", () => {
    // 'london' matches all four London regions with the same score 40.
    // Expect alphabetical: Blackheath, Camden, Lewisham, Tower Hamlets.
    const r = resolveAreas("london", AREAS);
    expect(r.map((m) => m.area.name)).toEqual([
      "Blackheath",
      "Camden",
      "Lewisham",
      "Tower Hamlets",
    ]);
  });

  it("postcode match (score 90) ranks ABOVE region-substring match", () => {
    // 'NW1' matches Camden via outward_postcode (90). Also 'nw1' as a substring
    // on the region 'London NW1' would score 40 — postcode rule must win.
    const r = resolveAreas("NW1", AREAS);
    expect(r[0].rule).toBe("outward_postcode");
  });
});
