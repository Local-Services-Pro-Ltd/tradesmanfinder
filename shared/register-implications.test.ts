/**
 * Tests for the REGISTER_IMPLICATIONS lookup table.
 *
 * These tests guard the trust model. If someone changes which badges a
 * register implies, they have to update both the entry AND the
 * corresponding test \u2014 the table is the single source of truth and
 * the badge meanings matter for customer trust.
 */
import { describe, it, expect } from "vitest";
import { REGISTER_IMPLICATIONS, getRegisterImplication } from "./register-implications";

describe("REGISTER_IMPLICATIONS", () => {
  it("companies_house implies only verified", () => {
    const impl = getRegisterImplication("companies_house");
    expect(impl).not.toBeNull();
    expect(impl!.impliesBadges).toEqual(["verified"]);
    expect(impl!.scopeBadge).toBeNull();
  });

  it("gas_safe implies verified + insured + licensed and scope Gas Work", () => {
    const impl = getRegisterImplication("gas_safe");
    expect(impl).not.toBeNull();
    expect(impl!.impliesBadges).toEqual(["verified", "insured", "licensed"]);
    expect(impl!.scopeBadge).toBe("Gas Work");
  });

  it("F-Gas does NOT imply insured (REFCOM doesn't verify PLI)", () => {
    const impl = getRegisterImplication("fgas");
    expect(impl).not.toBeNull();
    expect(impl!.impliesBadges).toContain("licensed");
    expect(impl!.impliesBadges).not.toContain("insured");
    expect(impl!.scopeBadge).toBe("F-Gas Certified");
  });

  it("CIPHE does NOT imply insured or licensed (membership body, not a register)", () => {
    const impl = getRegisterImplication("ciphe");
    expect(impl).not.toBeNull();
    expect(impl!.impliesBadges).toEqual(["verified"]);
    expect(impl!.impliesBadges).not.toContain("insured");
    expect(impl!.impliesBadges).not.toContain("licensed");
    expect(impl!.scopeBadge).toBe("CIPHE Member");
  });

  it("TrustMark implies insured but NOT licensed (quals come from scheme provider)", () => {
    const impl = getRegisterImplication("trustmark");
    expect(impl).not.toBeNull();
    expect(impl!.impliesBadges).toContain("insured");
    expect(impl!.impliesBadges).not.toContain("licensed");
  });

  it("NICEIC + NAPIT + MCS + OFTEC all imply verified+insured+licensed", () => {
    for (const key of ["niceic", "napit", "mcs", "oftec"]) {
      const impl = getRegisterImplication(key);
      expect(impl, `${key} missing`).not.toBeNull();
      expect(impl!.impliesBadges).toEqual(["verified", "insured", "licensed"]);
      expect(impl!.scopeBadge, `${key} missing scope badge`).not.toBeNull();
    }
  });

  it("unknown kinds return null", () => {
    expect(getRegisterImplication("insurance")).toBeNull();
    expect(getRegisterImplication("qualification")).toBeNull();
    expect(getRegisterImplication("bribery")).toBeNull();
  });

  it("every entry has a rationale (drives customer tooltips)", () => {
    for (const [key, impl] of Object.entries(REGISTER_IMPLICATIONS)) {
      expect(impl.rationale.length, `${key} rationale missing`).toBeGreaterThan(20);
    }
  });
});
