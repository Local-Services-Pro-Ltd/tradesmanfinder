/**
 * Tests for the unique body-copy generator (PR-#19-H).
 *
 * Covers:
 *   - deterministic output (same input → same output)
 *   - word count inside [MIN_WORDS, MAX_WORDS] for every (trade, area)
 *     combo we ship in production
 *   - genuine uniqueness across the full 400-route surface — no two
 *     pages produce identical concatenated copy (catches accidental
 *     template collisions)
 *   - supply-tier branching (dense / sparse / empty produce different
 *     middle paragraphs)
 *   - graceful fallback for unknown trade or region values
 *   - paragraph splitting + word counter
 */

import { describe, it, expect } from "vitest";
import {
  buildBodyCopy,
  wordCount,
  MIN_WORDS,
  MAX_WORDS,
} from "./main-host-body-copy";

const PLUMBER = { slug: "plumber", name: "Plumber" };
const ELECTRICIAN = { slug: "electrician", name: "Electrician" };
const MANCHESTER = {
  slug: "manchester",
  name: "Manchester",
  region: "England",
};
const LEEDS = { slug: "leeds", name: "Leeds", region: "England" };
const GLASGOW = { slug: "glasgow", name: "Glasgow", region: "Scotland" };

describe("buildBodyCopy — determinism", () => {
  it("returns the same paragraphs for identical input", () => {
    const a = buildBodyCopy({ category: PLUMBER, area: MANCHESTER, supplyCount: 5 });
    const b = buildBodyCopy({ category: PLUMBER, area: MANCHESTER, supplyCount: 5 });
    expect(a).toEqual(b);
  });

  it("changes output when trade differs", () => {
    const a = buildBodyCopy({ category: PLUMBER, area: MANCHESTER, supplyCount: 5 });
    const b = buildBodyCopy({ category: ELECTRICIAN, area: MANCHESTER, supplyCount: 5 });
    expect(a.paragraphs.join(" ")).not.toEqual(b.paragraphs.join(" "));
  });

  it("changes output when area differs", () => {
    const a = buildBodyCopy({ category: PLUMBER, area: MANCHESTER, supplyCount: 5 });
    const b = buildBodyCopy({ category: PLUMBER, area: LEEDS, supplyCount: 5 });
    expect(a.paragraphs.join(" ")).not.toEqual(b.paragraphs.join(" "));
  });
});

describe("buildBodyCopy — word count", () => {
  it("hits the 80–150 word brief for a dense page", () => {
    const out = buildBodyCopy({ category: PLUMBER, area: MANCHESTER, supplyCount: 7 });
    expect(out.wordCount).toBeGreaterThanOrEqual(MIN_WORDS);
    expect(out.wordCount).toBeLessThanOrEqual(MAX_WORDS);
  });

  it("hits the 80–150 word brief for a sparse page (supply=1)", () => {
    const out = buildBodyCopy({ category: PLUMBER, area: MANCHESTER, supplyCount: 1 });
    expect(out.wordCount).toBeGreaterThanOrEqual(MIN_WORDS);
    expect(out.wordCount).toBeLessThanOrEqual(MAX_WORDS);
  });

  it("hits the 80–150 word brief for an empty page (supply=0)", () => {
    const out = buildBodyCopy({ category: PLUMBER, area: MANCHESTER, supplyCount: 0 });
    expect(out.wordCount).toBeGreaterThanOrEqual(MIN_WORDS);
    expect(out.wordCount).toBeLessThanOrEqual(MAX_WORDS);
  });

  it("wordCount() handles edges", () => {
    expect(wordCount("")).toBe(0);
    expect(wordCount("   ")).toBe(0);
    expect(wordCount("one")).toBe(1);
    expect(wordCount("  two  words ")).toBe(2);
  });
});

describe("buildBodyCopy — supply-tier branching", () => {
  it("dense and empty tiers produce different middle paragraphs", () => {
    const dense = buildBodyCopy({ category: PLUMBER, area: MANCHESTER, supplyCount: 10 });
    const empty = buildBodyCopy({ category: PLUMBER, area: MANCHESTER, supplyCount: 0 });
    expect(dense.paragraphs[1]).not.toEqual(empty.paragraphs[1]);
  });

  it("sparse and dense tiers produce different middle paragraphs", () => {
    const sparse = buildBodyCopy({ category: PLUMBER, area: MANCHESTER, supplyCount: 1 });
    const dense = buildBodyCopy({ category: PLUMBER, area: MANCHESTER, supplyCount: 10 });
    expect(sparse.paragraphs[1]).not.toEqual(dense.paragraphs[1]);
  });

  it("dense middle mentions the actual supply count", () => {
    const out = buildBodyCopy({ category: PLUMBER, area: MANCHESTER, supplyCount: 7 });
    expect(out.paragraphs[1]).toMatch(/\b7\b/);
  });
});

describe("buildBodyCopy — region phrasing", () => {
  it("England city includes 'England' or 'across England'", () => {
    // The hash picks one of several templates; either region phrasing is acceptable
    // as long as 'England' appears at least once.
    const out = buildBodyCopy({ category: PLUMBER, area: MANCHESTER, supplyCount: 5 });
    expect(out.paragraphs.join(" ")).toMatch(/England/);
  });

  it("Scotland city includes 'Scotland'", () => {
    const out = buildBodyCopy({ category: PLUMBER, area: GLASGOW, supplyCount: 5 });
    expect(out.paragraphs.join(" ")).toMatch(/Scotland/);
  });

  it("falls back gracefully for unknown region", () => {
    const out = buildBodyCopy({
      category: PLUMBER,
      area: { slug: "atlantis", name: "Atlantis", region: "Unknown Region" },
      supplyCount: 5,
    });
    expect(out.paragraphs.join(" ")).toMatch(/UK/);
    expect(out.wordCount).toBeGreaterThanOrEqual(MIN_WORDS);
  });

  it("falls back gracefully for unknown trade slug", () => {
    const out = buildBodyCopy({
      category: { slug: "time-traveller", name: "Time Traveller" },
      area: MANCHESTER,
      supplyCount: 5,
    });
    expect(out.paragraphs.join(" ")).toMatch(/tradespeople/);
    expect(out.wordCount).toBeGreaterThanOrEqual(MIN_WORDS);
  });
});

describe("buildBodyCopy — area name in copy", () => {
  it("mentions the area name in at least two paragraphs", () => {
    const out = buildBodyCopy({ category: PLUMBER, area: MANCHESTER, supplyCount: 5 });
    const mentions = out.paragraphs.filter((p) => p.includes("Manchester")).length;
    expect(mentions).toBeGreaterThanOrEqual(2);
  });

  it("never leaves a template placeholder un-substituted", () => {
    const out = buildBodyCopy({ category: PLUMBER, area: MANCHESTER, supplyCount: 0 });
    const joined = out.paragraphs.join(" ");
    expect(joined).not.toMatch(/\$\{/);
    expect(joined).not.toMatch(/\{\{/);
    expect(joined).not.toMatch(/undefined/);
  });
});

describe("buildBodyCopy — uniqueness across full route surface", () => {
  /**
   * Sweep every (trade × area) combo we ship in prod. Validates two
   * critical SEO properties:
   *   1. Every page hits the 80–150 word brief (doorway-page defence)
   *   2. No two pages produce identical concatenated copy (Google's
   *      similarity threshold for "scaled content abuse")
   *
   * We don't need DB data here — the function is pure on (slug,
   * name, region) tuples. We hand-roll a representative sample of
   * ~20 trades × ~20 areas to match the production manifest scale.
   */
  const TRADES = [
    "plumber",
    "electrician",
    "builder",
    "carpenter",
    "roofer",
    "bricklayer",
    "plasterer",
    "tiler",
    "painter-decorator",
    "glazier",
    "heating-engineer",
    "locksmith",
    "handyman",
    "cleaner",
    "damp-specialist",
    "driveway-paving",
    "flooring-specialist",
    "gardener-landscaper",
    "pest-control",
    "removals",
  ];

  const AREAS: { slug: string; name: string; region: string }[] = [
    { slug: "london", name: "London", region: "England" },
    { slug: "manchester", name: "Manchester", region: "England" },
    { slug: "birmingham", name: "Birmingham", region: "England" },
    { slug: "leeds", name: "Leeds", region: "England" },
    { slug: "liverpool", name: "Liverpool", region: "England" },
    { slug: "sheffield", name: "Sheffield", region: "England" },
    { slug: "bristol", name: "Bristol", region: "England" },
    { slug: "newcastle-upon-tyne", name: "Newcastle upon Tyne", region: "England" },
    { slug: "nottingham", name: "Nottingham", region: "England" },
    { slug: "leicester", name: "Leicester", region: "England" },
    { slug: "coventry", name: "Coventry", region: "England" },
    { slug: "brighton", name: "Brighton", region: "England" },
    { slug: "plymouth", name: "Plymouth", region: "England" },
    { slug: "reading", name: "Reading", region: "England" },
    { slug: "southampton", name: "Southampton", region: "England" },
    { slug: "glasgow", name: "Glasgow", region: "Scotland" },
    { slug: "edinburgh", name: "Edinburgh", region: "Scotland" },
    { slug: "cardiff", name: "Cardiff", region: "Wales" },
    { slug: "belfast", name: "Belfast", region: "Northern Ireland" },
    { slug: "plumstead", name: "Plumstead", region: "England" },
  ];

  it("every (trade × area) combo lands in the 80–150 word brief", () => {
    const violations: string[] = [];
    for (const tradeSlug of TRADES) {
      for (const area of AREAS) {
        const out = buildBodyCopy({
          category: { slug: tradeSlug, name: tradeSlug },
          area,
          // Mix supply counts so we exercise all three tiers across the sweep.
          supplyCount: (tradeSlug.length + area.slug.length) % 7,
        });
        if (out.wordCount < MIN_WORDS || out.wordCount > MAX_WORDS) {
          violations.push(
            `${tradeSlug}-in-${area.slug}: ${out.wordCount} words`,
          );
        }
      }
    }
    expect(violations).toEqual([]);
  });

  it("no two combos produce identical copy", () => {
    const seen = new Map<string, string>(); // copy → "trade-in-area"
    const collisions: string[] = [];
    for (const tradeSlug of TRADES) {
      for (const area of AREAS) {
        const out = buildBodyCopy({
          category: { slug: tradeSlug, name: tradeSlug },
          area,
          supplyCount: 5, // fixed supply isolates pure (trade × area) variation
        });
        const key = out.paragraphs.join("\n");
        const existing = seen.get(key);
        if (existing) {
          collisions.push(`${tradeSlug}-in-${area.slug} === ${existing}`);
        } else {
          seen.set(key, `${tradeSlug}-in-${area.slug}`);
        }
      }
    }
    expect(collisions).toEqual([]);
  });

  it("never includes 'NaN' or 'undefined' in any combo", () => {
    const bad: string[] = [];
    for (const tradeSlug of TRADES) {
      for (const area of AREAS) {
        const out = buildBodyCopy({
          category: { slug: tradeSlug, name: tradeSlug },
          area,
          supplyCount: 3,
        });
        const joined = out.paragraphs.join(" ");
        if (/\bNaN\b|\bundefined\b|\bnull\b/.test(joined)) {
          bad.push(`${tradeSlug}-in-${area.slug}`);
        }
      }
    }
    expect(bad).toEqual([]);
  });
});

describe("buildBodyCopy — paragraph shape", () => {
  it("emits exactly 3 paragraphs", () => {
    const out = buildBodyCopy({ category: PLUMBER, area: MANCHESTER, supplyCount: 5 });
    expect(out.paragraphs).toHaveLength(3);
  });

  it("every paragraph is non-empty", () => {
    const out = buildBodyCopy({ category: PLUMBER, area: MANCHESTER, supplyCount: 0 });
    for (const p of out.paragraphs) {
      expect(p.trim().length).toBeGreaterThan(0);
    }
  });
});
