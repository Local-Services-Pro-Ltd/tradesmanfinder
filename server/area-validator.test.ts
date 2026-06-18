import { describe, it, expect, beforeEach } from "vitest";
import {
  validateAreaString,
  validateAreaStringCached,
  clearAreaValidationCache,
  type NominatimFetcher,
  type NominatimHit,
} from "./area-validator";

// Reusable fetcher factory. We mirror Nominatim's response shape so tests
// document what the upstream actually returns.
function fakeFetcher(byQuery: Record<string, NominatimHit[]>): NominatimFetcher {
  return async (q: string) => byQuery[q] ?? byQuery[q.toLowerCase()] ?? [];
}

describe("validateAreaString", () => {
  it("rejects empty / too-short input without calling the fetcher", async () => {
    let calls = 0;
    const fetcher: NominatimFetcher = async () => {
      calls += 1;
      return [];
    };
    const r = await validateAreaString("a", fetcher);
    expect(r.kind).toBe("reject");
    expect(calls).toBe(0);
  });

  it("accepts UK outward postcodes by shape (no fetcher call)", async () => {
    let calls = 0;
    const fetcher: NominatimFetcher = async () => {
      calls += 1;
      return [];
    };
    for (const pc of ["SE13", "WC1H", "M1", "EC1A", "se13", " se13 "]) {
      const r = await validateAreaString(pc, fetcher);
      expect(r.kind).toBe("accept");
      if (r.kind === "accept") expect(r.canonicalName).toBe(pc.trim().toUpperCase());
    }
    expect(calls).toBe(0);
  });

  it("accepts full UK postcodes by shape", async () => {
    const r = await validateAreaString("SE13 6AA", async () => []);
    expect(r.kind).toBe("accept");
  });

  it("accepts a real locality with an exact name match", async () => {
    const fetcher = fakeFetcher({
      Deptford: [
        {
          name: "Deptford",
          display_name: "Deptford, London Borough of Lewisham, England, UK",
          category: "place",
          type: "suburb",
        },
      ],
    });
    const r = await validateAreaString("Deptford", fetcher);
    expect(r.kind).toBe("accept");
    if (r.kind === "accept") expect(r.canonicalName).toBe("Deptford");
  });

  it("accepts case- and punctuation-insensitive name matches", async () => {
    const fetcher = fakeFetcher({
      "notting hill": [
        {
          name: "Notting Hill",
          display_name: "Notting Hill, London, UK",
          category: "place",
          type: "suburb",
        },
      ],
    });
    const r = await validateAreaString("notting hill", fetcher);
    expect(r.kind).toBe("accept");
  });

  it("rejects non-places ('Hogwarts' as a school, 'Disneyland' as a theme park)", async () => {
    const fetcher = fakeFetcher({
      Hogwarts: [
        { name: "HOGWARTS", display_name: "...", category: "amenity", type: "prep_school" },
      ],
      Disneyland: [
        { name: "Disneyland", display_name: "...", category: "tourism", type: "theme_park" },
      ],
    });
    for (const q of ["Hogwarts", "Disneyland"]) {
      const r = await validateAreaString(q, fetcher);
      expect(r.kind).toBe("reject");
      if (r.kind === "reject") expect(r.reason).toBe("not_a_place");
    }
  });

  it("rejects strings Nominatim has zero results for", async () => {
    const fetcher = fakeFetcher({});
    const r = await validateAreaString("asdfg", fetcher);
    expect(r.kind).toBe("reject");
  });

  it("suggests a near-match when query name doesn't exactly match", async () => {
    // "Lewishm" — typo of "Lewisham". Nominatim returns Lewisham anyway
    // because of its fuzzy matching. We should surface the suggestion.
    const fetcher = fakeFetcher({
      Lewishm: [
        {
          name: "Lewisham",
          display_name: "Lewisham, Greater London, England, UK",
          category: "place",
          type: "town",
        },
      ],
    });
    const r = await validateAreaString("Lewishm", fetcher);
    expect(r.kind).toBe("reject");
    if (r.kind === "reject") {
      expect(r.reason).toBe("looks_like_typo");
      expect(r.suggestion?.name).toBe("Lewisham");
    }
  });

  it("does NOT silently rewrite to a suggestion (caller must decide)", async () => {
    // Guard rail — we explicitly DO NOT auto-accept the suggestion server-side.
    // The user needs to consent (one-click confirm) before the row is stored.
    const fetcher = fakeFetcher({
      NYC: [
        {
          name: "New York",
          display_name: "New York, USA",
          category: "boundary",
          type: "administrative",
        },
      ],
    });
    const r = await validateAreaString("NYC", fetcher);
    expect(r.kind).toBe("reject");
  });

  it("rejects results outside the place-type allowlist even if name matches", async () => {
    // Defense in depth: even if some weird OSM entry is named "Deptford"
    // but tagged as a bus stop, we must not accept it.
    const fetcher = fakeFetcher({
      Deptford: [
        {
          name: "Deptford",
          display_name: "Deptford bus stop",
          category: "highway",
          type: "bus_stop",
        },
      ],
    });
    const r = await validateAreaString("Deptford", fetcher);
    expect(r.kind).toBe("reject");
  });

  it("fails closed on fetcher errors (does not let strings through during outage)", async () => {
    const fetcher: NominatimFetcher = async () => {
      throw new Error("nominatim 503");
    };
    const r = await validateAreaString("Deptford", fetcher);
    expect(r.kind).toBe("reject");
    if (r.kind === "reject") expect(r.reason).toBe("not_a_place");
  });

  it("accepts global localities (Paris, Brooklyn, Tokyo) — 'Any country' policy", async () => {
    const fetcher = fakeFetcher({
      Paris: [
        {
          name: "Paris",
          display_name: "Paris, France",
          category: "boundary",
          type: "administrative",
        },
      ],
      Brooklyn: [
        {
          name: "Brooklyn",
          display_name: "Brooklyn, NYC",
          category: "boundary",
          type: "administrative",
        },
      ],
    });
    for (const q of ["Paris", "Brooklyn"]) {
      const r = await validateAreaString(q, fetcher);
      expect(r.kind).toBe("accept");
    }
  });
});

describe("validateAreaStringCached", () => {
  beforeEach(() => clearAreaValidationCache());

  it("caches a positive result across calls (single fetcher invocation)", async () => {
    let calls = 0;
    const fetcher: NominatimFetcher = async () => {
      calls += 1;
      return [
        {
          name: "Deptford",
          display_name: "Deptford, UK",
          category: "place",
          type: "suburb",
        },
      ];
    };
    await validateAreaStringCached("Deptford", fetcher);
    await validateAreaStringCached("Deptford", fetcher);
    await validateAreaStringCached("DEPTFORD", fetcher); // case-insensitive
    expect(calls).toBe(1);
  });

  it("caches a negative result so 'asdfg' spam doesn't burn quota", async () => {
    let calls = 0;
    const fetcher: NominatimFetcher = async () => {
      calls += 1;
      return [];
    };
    for (let i = 0; i < 5; i++) {
      await validateAreaStringCached("asdfg", fetcher);
    }
    expect(calls).toBe(1);
  });
});
