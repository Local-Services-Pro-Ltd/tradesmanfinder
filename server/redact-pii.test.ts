import { describe, expect, it } from "vitest";
import { redactPII, redactPIIText } from "./redact-pii";

describe("redactPII", () => {
  it("returns empty input unchanged", () => {
    expect(redactPII("").text).toBe("");
    expect(redactPII("").redactions).toBe(0);
  });

  it("redacts UK mobile numbers (0 prefix, with spaces)", () => {
    const r = redactPII("Call me on 07911 123 456 about the boiler");
    expect(r.text).not.toMatch(/07911/);
    expect(r.text).toContain("[redacted phone]");
    expect(r.redactions).toBe(1);
  });

  it("redacts UK mobile numbers in +44 form", () => {
    const r = redactPII("Reach me at +44 7911 123456");
    expect(r.text).not.toMatch(/7911 123456/);
    expect(r.text).toContain("[redacted phone]");
  });

  it("redacts UK landline numbers", () => {
    const r = redactPII("Office is 01472 123 456");
    expect(r.text).toContain("[redacted phone]");
  });

  it("redacts email addresses", () => {
    const r = redactPII("Drop me a line at jane.smith@example.co.uk");
    expect(r.text).not.toMatch(/jane\.smith/);
    expect(r.text).toContain("[redacted email]");
  });

  it("reduces full UK postcodes to outward code only", () => {
    const r = redactPII("Address is 14 The Avenue, DN31 3LL");
    expect(r.text).toContain("DN31");
    expect(r.text).not.toMatch(/3LL/);
    // postcode trimming is NOT counted as a redaction (we keep area context)
    expect(r.redactions).toBe(0);
  });

  it("normalises lowercase postcodes to uppercase outward code", () => {
    const r = redactPII("near dn31 3ll please");
    expect(r.text).toContain("DN31");
    expect(r.text).not.toMatch(/3ll|3LL/);
  });

  it("redacts long bare digit runs (7+ digits)", () => {
    const r = redactPII("Reference 12345678 for the order");
    expect(r.text).toContain("[redacted number]");
    expect(r.text).not.toMatch(/12345678/);
  });

  it("leaves short numbers alone (house numbers, prices)", () => {
    const r = redactPII("Budget around 250, house number 14");
    expect(r.text).toContain("250");
    expect(r.text).toContain("14");
    expect(r.redactions).toBe(0);
  });

  it("handles multiple PII items in a single string", () => {
    const r = redactPII(
      "Hi I'm Jane on 07911 123 456 at jane@x.com, postcode DN31 3LL. Job ref 99887766.",
    );
    expect(r.text).toContain("[redacted phone]");
    expect(r.text).toContain("[redacted email]");
    expect(r.text).toContain("DN31");
    expect(r.text).not.toMatch(/3LL/);
    expect(r.text).toContain("[redacted number]");
    expect(r.redactions).toBe(3); // phone + email + ref number; postcode doesn't count
  });

  it("does not double-redact (digit runs inside an already-replaced phone)", () => {
    const r = redactPII("07911 123456");
    expect(r.text).toBe("[redacted phone]");
    expect(r.redactions).toBe(1);
  });

  it("redactPIIText returns only the string", () => {
    expect(redactPIIText("call 07911 123 456")).toContain("[redacted phone]");
    expect(typeof redactPIIText("hello")).toBe("string");
  });

  it("preserves benign text unchanged", () => {
    const benign = "Need a new boiler installed in the kitchen, weekend ideally.";
    expect(redactPIIText(benign)).toBe(benign);
  });
});
