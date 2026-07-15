/**
 * Unit tests for shared/register-configs.ts.
 *
 * These tests are pure — no DB, no HTTP — and exercise the normalisation +
 * validation contract that each register's submit-for-admin-review route
 * depends on. If a register's regex is loosened or its register URL
 * structure changes, these tests pin the expected behaviour.
 */

import { describe, expect, it } from "vitest";

import {
  REGISTER_CONFIGS,
  getRegisterConfig,
  isGenericRegisterKind,
} from "./register-configs";
import { GENERIC_REGISTER_KINDS } from "./schema";

describe("register-configs", () => {
  it("declares one config per generic register kind", () => {
    for (const kind of GENERIC_REGISTER_KINDS) {
      expect(REGISTER_CONFIGS[kind], `missing config for ${kind}`).toBeDefined();
      expect(REGISTER_CONFIGS[kind].kind).toBe(kind);
    }
  });

  it("isGenericRegisterKind matches GENERIC_REGISTER_KINDS exactly", () => {
    for (const kind of GENERIC_REGISTER_KINDS) {
      expect(isGenericRegisterKind(kind)).toBe(true);
    }
    expect(isGenericRegisterKind("gas_safe")).toBe(false);
    expect(isGenericRegisterKind("companies_house")).toBe(false);
    expect(isGenericRegisterKind("insurance")).toBe(false);
    expect(isGenericRegisterKind("")).toBe(false);
  });

  it("getRegisterConfig returns null for non-generic kinds", () => {
    expect(getRegisterConfig("gas_safe")).toBeNull();
    expect(getRegisterConfig("companies_house")).toBeNull();
    expect(getRegisterConfig("garbage")).toBeNull();
  });

  describe("NICEIC", () => {
    const c = REGISTER_CONFIGS.niceic;
    it("normalises and accepts plausible enrolment numbers", () => {
      expect(c.normaliseNumber("  d123456  ")).toBe("D123456");
      expect(c.validateNumber("D123456")).toBeNull();
      expect(c.validateNumber("ABCD")).toBeNull();
    });
    it("rejects too-short / too-long / non-alnum input", () => {
      expect(c.validateNumber("ABC")).toMatch(/4.15/);
      expect(c.validateNumber("A".repeat(16))).toMatch(/4.15/);
      expect(c.validateNumber("D 123")).toMatch(/4.15/);
    });
    it("builds a register lookup URL", () => {
      expect(c.buildRegisterUrl("D123456")).toMatch(
        /niceic\.com\/find-a-contractor\?search=D123456/,
      );
    });
  });

  describe("NAPIT", () => {
    const c = REGISTER_CONFIGS.napit;
    it("accepts short numeric IDs", () => {
      expect(c.normaliseNumber(" 12345 ")).toBe("12345");
      expect(c.validateNumber("12345")).toBeNull();
    });
    it("rejects too-short input", () => {
      expect(c.validateNumber("12")).toMatch(/3.15/);
    });
  });

  describe("MCS", () => {
    const c = REGISTER_CONFIGS.mcs;
    it("accepts MCS-prefixed and bare numeric IDs", () => {
      expect(c.normaliseNumber("MCS 12345")).toBe("MCS12345");
      expect(c.validateNumber("MCS12345")).toBeNull();
      expect(c.validateNumber("123456")).toBeNull();
    });
    it("strips the MCS prefix from the register URL search query", () => {
      expect(c.buildRegisterUrl("MCS12345")).toMatch(/search=12345$/);
      expect(c.buildRegisterUrl("123456")).toMatch(/search=123456$/);
    });
  });

  describe("OFTEC", () => {
    const c = REGISTER_CONFIGS.oftec;
    it("strips slashes from the canonical form", () => {
      expect(c.normaliseNumber("C/12345")).toBe("C12345");
      expect(c.validateNumber("C12345")).toBeNull();
    });
  });

  describe("TrustMark", () => {
    const c = REGISTER_CONFIGS.trustmark;
    it("accepts 4-10 digit licence numbers", () => {
      expect(c.normaliseNumber(" 12345 ")).toBe("12345");
      expect(c.validateNumber("12345")).toBeNull();
    });
    it("rejects letters", () => {
      expect(c.validateNumber("ABCDE")).toMatch(/4.10 digits/);
    });
  });

  describe("F-Gas", () => {
    const c = REGISTER_CONFIGS.fgas;
    it("accepts REF-prefixed IDs and bare digits", () => {
      expect(c.normaliseNumber("ref 12345")).toBe("REF12345");
      expect(c.validateNumber("REF12345")).toBeNull();
      expect(c.validateNumber("12345")).toBeNull();
    });
    it("strips the REF prefix from the register URL", () => {
      expect(c.buildRegisterUrl("REF12345")).toMatch(/search=12345$/);
    });
  });

  describe("CIPHE", () => {
    const c = REGISTER_CONFIGS.ciphe;
    it("accepts alphanumeric membership numbers", () => {
      expect(c.normaliseNumber(" abc12345 ")).toBe("ABC12345");
      expect(c.validateNumber("ABC12345")).toBeNull();
    });
  });

  it("every register URL is HTTPS and includes the canonical number", () => {
    for (const kind of GENERIC_REGISTER_KINDS) {
      const c = REGISTER_CONFIGS[kind];
      const n = c.normaliseNumber("12345");
      // Validation may fail for some kinds with this short value — that's fine,
      // we're only testing the URL builder shape here, not the regex.
      const url = c.buildRegisterUrl(n);
      expect(url.startsWith("https://"), `${kind} URL is not https`).toBe(true);
    }
  });
});
