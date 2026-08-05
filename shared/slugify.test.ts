import { describe, expect, it } from "vitest";
import { slugify, isUrlSafeSlug } from "./slugify";

describe("slugify", () => {
  it("downcases everything", () => {
    expect(slugify("ATLAS Services Ltd")).toBe("atlas-services-ltd");
  });

  it("downcases Companies House SC-prefixed numbers (regression #138)", () => {
    // The 4 rows in prod (id 100-103) all had this exact bug.
    expect(slugify("Atlas Services Solutions (Scotland) Ltd SC704009"))
      .toBe("atlas-services-solutions-scotland-ltd-sc704009");
  });

  it("replaces & with 'and'", () => {
    expect(slugify("Smith & Sons")).toBe("smith-and-sons");
  });

  it("collapses runs of non-alphanumerics to a single hyphen", () => {
    expect(slugify("A  --  B")).toBe("a-b");
    expect(slugify("A/B\\C")).toBe("a-b-c");
  });

  it("strips leading and trailing hyphens", () => {
    expect(slugify("---hello---")).toBe("hello");
  });

  it("handles accented characters by collapsing them", () => {
    // "é" is not in [a-z0-9] so it becomes a hyphen. This is the historical
    // behaviour; if we later want to transliterate, that's a separate change.
    expect(slugify("Café Nero")).toBe("caf-nero");
  });

  it("returns empty string for pure non-alphanumeric input", () => {
    expect(slugify("!!!")).toBe("");
    expect(slugify("   ")).toBe("");
  });
});

describe("isUrlSafeSlug", () => {
  it("accepts a canonical slug", () => {
    expect(isUrlSafeSlug("atlas-services-ltd-sc704009")).toBe(true);
  });

  it("rejects uppercase (the #138 bug)", () => {
    expect(isUrlSafeSlug("atlas-services-solutions-scotland-ltd-SC704009")).toBe(false);
  });

  it("rejects leading/trailing hyphens", () => {
    expect(isUrlSafeSlug("-hello")).toBe(false);
    expect(isUrlSafeSlug("hello-")).toBe(false);
  });

  it("rejects consecutive hyphens", () => {
    expect(isUrlSafeSlug("hello--world")).toBe(false);
  });

  it("rejects too short and too long", () => {
    expect(isUrlSafeSlug("ab")).toBe(false);
    expect(isUrlSafeSlug("a".repeat(81))).toBe(false);
  });

  it("accepts minimum and maximum boundary lengths", () => {
    expect(isUrlSafeSlug("abc")).toBe(true);
    expect(isUrlSafeSlug("a".repeat(80))).toBe(true);
  });

  it("rejects non-ascii characters", () => {
    expect(isUrlSafeSlug("café")).toBe(false);
  });
});
