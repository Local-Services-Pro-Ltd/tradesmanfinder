/**
 * Tests for the cross-field validation rules on insertTradesmanVerificationSchema.
 *
 * These rules implement the same shape constraints as the
 * `tv_evidence_shape` CHECK constraint in the database — we want bad
 * inserts to be caught client-side (clearer error messages) before they
 * hit the DB. The DB constraint is the last line of defence.
 */
import { describe, it, expect } from "vitest";
import { insertTradesmanVerificationSchema } from "./schema";

describe("insertTradesmanVerificationSchema — file-backed kinds", () => {
  const fileFields = {
    filePath: "verifications/42/insurance.pdf",
    fileMimeType: "application/pdf",
    fileSizeBytes: 12345,
  };

  it("accepts a valid insurance row", () => {
    const r = insertTradesmanVerificationSchema.safeParse({
      tradesmanId: 42,
      kind: "insurance",
      insuranceCoverGbp: 2_000_000,
      expiryDate: "2027-01-15",
      ...fileFields,
    });
    expect(r.success).toBe(true);
  });

  it("accepts a valid qualification row", () => {
    const r = insertTradesmanVerificationSchema.safeParse({
      tradesmanId: 42,
      kind: "qualification",
      qualificationType: "Gas Safe",
      ...fileFields,
    });
    expect(r.success).toBe(true);
  });

  it("rejects insurance row missing file fields", () => {
    const r = insertTradesmanVerificationSchema.safeParse({
      tradesmanId: 42,
      kind: "insurance",
    });
    expect(r.success).toBe(false);
    if (!r.success) {
      expect(r.error.issues.some((i) => i.path.includes("filePath"))).toBe(true);
    }
  });

  it("rejects qualification row that also carries a company number", () => {
    const r = insertTradesmanVerificationSchema.safeParse({
      tradesmanId: 42,
      kind: "qualification",
      qualificationType: "City & Guilds 2391",
      companyNumber: "12345678",
      ...fileFields,
    });
    expect(r.success).toBe(false);
    if (!r.success) {
      expect(r.error.issues.some((i) => i.path.includes("companyNumber"))).toBe(
        true,
      );
    }
  });
});

describe("insertTradesmanVerificationSchema — companies_house kind", () => {
  const ch = {
    tradesmanId: 42,
    kind: "companies_house" as const,
    companyNumber: "00006400",
    evidenceData: {
      company_number: "00006400",
      company_name: "THE GIRLS' DAY SCHOOL TRUST",
      company_status: "active",
    },
    source: "pro_submission" as const,
  };

  it("accepts a valid companies_house row", () => {
    const r = insertTradesmanVerificationSchema.safeParse(ch);
    expect(r.success).toBe(true);
  });

  it("rejects companies_house row missing company_number", () => {
    const r = insertTradesmanVerificationSchema.safeParse({
      ...ch,
      companyNumber: undefined,
    });
    expect(r.success).toBe(false);
    if (!r.success) {
      expect(r.error.issues.some((i) => i.path.includes("companyNumber"))).toBe(
        true,
      );
    }
  });

  it("rejects companies_house row that also carries file fields", () => {
    const r = insertTradesmanVerificationSchema.safeParse({
      ...ch,
      filePath: "verifications/42/extra.pdf",
      fileMimeType: "application/pdf",
      fileSizeBytes: 100,
    });
    expect(r.success).toBe(false);
    if (!r.success) {
      expect(r.error.issues.some((i) => i.path.includes("filePath"))).toBe(true);
    }
  });

  it("rejects unknown source values", () => {
    const r = insertTradesmanVerificationSchema.safeParse({
      ...ch,
      source: "external_audit" as unknown as "pro_submission",
    });
    expect(r.success).toBe(false);
  });

  it("rejects company_number that's too short", () => {
    const r = insertTradesmanVerificationSchema.safeParse({
      ...ch,
      companyNumber: "1",
    });
    expect(r.success).toBe(false);
  });
});

describe("insertTradesmanVerificationSchema — gas_safe kind", () => {
  const gs = {
    tradesmanId: 42,
    kind: "gas_safe" as const,
    gasSafeNumber: "123456",
    gasSafeRegisterUrl: "https://www.gassaferegister.co.uk/checkbusinessresults?cp=abc123",
    evidenceData: {
      business_name: "Keystone London Group Limited",
      registration_number: "123456",
      categories: ["Boilers", "Cookers", "Fires & Wall Heaters"],
    },
    source: "pro_submission" as const,
  };

  it("accepts a valid gas_safe row", () => {
    const r = insertTradesmanVerificationSchema.safeParse(gs);
    expect(r.success).toBe(true);
  });

  it("rejects gas_safe row missing gasSafeNumber", () => {
    const r = insertTradesmanVerificationSchema.safeParse({
      ...gs,
      gasSafeNumber: undefined,
    });
    expect(r.success).toBe(false);
    if (!r.success) {
      expect(r.error.issues.some((i) => i.path.includes("gasSafeNumber"))).toBe(true);
    }
  });

  it("rejects gas_safe row that also carries file fields", () => {
    const r = insertTradesmanVerificationSchema.safeParse({
      ...gs,
      filePath: "verifications/42/extra.pdf",
      fileMimeType: "application/pdf",
      fileSizeBytes: 100,
    });
    expect(r.success).toBe(false);
    if (!r.success) {
      expect(r.error.issues.some((i) => i.path.includes("filePath"))).toBe(true);
    }
  });

  it("rejects gas_safe row that also carries a company number", () => {
    const r = insertTradesmanVerificationSchema.safeParse({
      ...gs,
      companyNumber: "12345678",
    });
    expect(r.success).toBe(false);
    if (!r.success) {
      expect(r.error.issues.some((i) => i.path.includes("companyNumber"))).toBe(true);
    }
  });

  it("rejects insurance row that also carries a gas safe number", () => {
    const r = insertTradesmanVerificationSchema.safeParse({
      tradesmanId: 42,
      kind: "insurance",
      insuranceCoverGbp: 2_000_000,
      filePath: "verifications/42/insurance.pdf",
      fileMimeType: "application/pdf",
      fileSizeBytes: 12345,
      gasSafeNumber: "123456",
    });
    expect(r.success).toBe(false);
    if (!r.success) {
      expect(r.error.issues.some((i) => i.path.includes("gasSafeNumber"))).toBe(true);
    }
  });

  it("rejects an invalid gasSafeRegisterUrl", () => {
    const r = insertTradesmanVerificationSchema.safeParse({
      ...gs,
      gasSafeRegisterUrl: "not-a-url",
    });
    expect(r.success).toBe(false);
  });
});

describe("insertTradesmanVerificationSchema — kind enum", () => {
  it("rejects unknown kinds", () => {
    const r = insertTradesmanVerificationSchema.safeParse({
      tradesmanId: 42,
      kind: "bribe" as unknown as "insurance",
      filePath: "x",
      fileMimeType: "application/pdf",
      fileSizeBytes: 1,
    });
    expect(r.success).toBe(false);
  });
});
