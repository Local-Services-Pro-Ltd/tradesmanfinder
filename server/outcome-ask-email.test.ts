// PR-P9 — Unit tests for the outcome-ask email builder.
//
// We test the pure `buildOutcomeAskEmail` function only — the sender goes
// through `send()` which is the same plumbing every other mailer uses
// (already exercised in production). Testing the pure builder keeps these
// tests fast, deterministic, and free of env / DB / network dependencies.

import { describe, it, expect } from "vitest";
// Import directly from the pure module — importing from "./mailer" would
// transitively load "./storage" and fail at module load (DATABASE_URL).
// The builder is also re-exported from "./mailer" for production callers.
import { buildOutcomeAskEmail } from "./outcome-ask-email";

const baseLinks = {
  won: "https://example.com/p/o/tokenABC?outcome=won",
  lost: "https://example.com/p/o/tokenABC?outcome=lost",
  quoted: "https://example.com/p/o/tokenABC?outcome=quoted",
};

describe("buildOutcomeAskEmail", () => {
  it("produces the expected subject", () => {
    const out = buildOutcomeAskEmail({
      partnerName: "Acme EPC Ltd",
      jobId: 4321,
      links: baseLinks,
      expiresInDays: 90,
    });
    expect(out.subject).toBe("Did lead #4321 convert?");
  });

  it("includes all three outcome links in HTML and text", () => {
    const out = buildOutcomeAskEmail({
      partnerName: "Acme",
      jobId: 1,
      links: baseLinks,
      expiresInDays: 90,
    });
    for (const url of Object.values(baseLinks)) {
      expect(out.html).toContain(url);
      expect(out.text).toContain(url);
    }
  });

  it("uses the partner name in HTML and text", () => {
    const out = buildOutcomeAskEmail({
      partnerName: "Northern Energy Partners",
      jobId: 99,
      links: baseLinks,
      expiresInDays: 30,
    });
    expect(out.html).toContain("Hi Northern Energy Partners,");
    expect(out.text).toContain("Hi Northern Energy Partners,");
  });

  it("HTML-escapes the partner name to prevent injection", () => {
    const malicious = `Evil"<script>alert(1)</script>`;
    const out = buildOutcomeAskEmail({
      partnerName: malicious,
      jobId: 1,
      links: baseLinks,
      expiresInDays: 90,
    });
    expect(out.html).not.toContain("<script>");
    expect(out.html).toContain("&lt;script&gt;");
    expect(out.html).toContain("&quot;");
    // Plain-text version is intentionally NOT escaped — text/plain doesn't
    // execute markup. The raw string should appear there.
    expect(out.text).toContain(malicious);
  });

  it("includes the job title when provided", () => {
    const out = buildOutcomeAskEmail({
      partnerName: "Acme",
      jobId: 7,
      jobTitle: "Bathroom rewire",
      links: baseLinks,
      expiresInDays: 90,
    });
    expect(out.html).toContain("Bathroom rewire");
    expect(out.text).toContain("Bathroom rewire");
  });

  it("falls back to 'Job #N' when no job title given", () => {
    const out = buildOutcomeAskEmail({
      partnerName: "Acme",
      jobId: 7,
      links: baseLinks,
      expiresInDays: 90,
    });
    expect(out.html).toContain("Job #7");
    expect(out.text).toContain("Job #7");
  });

  it("HTML-escapes the job title", () => {
    const out = buildOutcomeAskEmail({
      partnerName: "Acme",
      jobId: 1,
      jobTitle: `<img src=x onerror=alert(1)>`,
      links: baseLinks,
      expiresInDays: 90,
    });
    expect(out.html).not.toContain("<img src=x");
    expect(out.html).toContain("&lt;img src=x");
  });

  it("includes the area when provided", () => {
    const out = buildOutcomeAskEmail({
      partnerName: "Acme",
      jobId: 1,
      area: "Manchester (M14)",
      links: baseLinks,
      expiresInDays: 90,
    });
    expect(out.html).toContain("Manchester (M14)");
    expect(out.text).toContain("Manchester (M14)");
  });

  it("omits area block entirely when not given", () => {
    const out = buildOutcomeAskEmail({
      partnerName: "Acme",
      jobId: 1,
      links: baseLinks,
      expiresInDays: 90,
    });
    expect(out.html).not.toContain("Area:");
    expect(out.text).not.toContain("Area:");
  });

  it("HTML-escapes the area", () => {
    const out = buildOutcomeAskEmail({
      partnerName: "Acme",
      jobId: 1,
      area: `<b>HACK</b>`,
      links: baseLinks,
      expiresInDays: 90,
    });
    expect(out.html).not.toContain("<b>HACK</b>");
    expect(out.html).toContain("&lt;b&gt;HACK&lt;/b&gt;");
  });

  it("uses singular 'day' for 1 day expiry", () => {
    const out = buildOutcomeAskEmail({
      partnerName: "Acme",
      jobId: 1,
      links: baseLinks,
      expiresInDays: 1,
    });
    expect(out.html).toContain("expire in 1 day");
    expect(out.html).not.toContain("expire in 1 days");
    expect(out.text).toContain("expire in 1 day");
  });

  it("uses plural 'days' for >1 day expiry", () => {
    const out = buildOutcomeAskEmail({
      partnerName: "Acme",
      jobId: 1,
      links: baseLinks,
      expiresInDays: 90,
    });
    expect(out.html).toContain("expire in 90 days");
    expect(out.text).toContain("expire in 90 days");
  });

  it("mentions the deal_value_pence hint in both HTML and text", () => {
    const out = buildOutcomeAskEmail({
      partnerName: "Acme",
      jobId: 1,
      links: baseLinks,
      expiresInDays: 90,
    });
    expect(out.html).toContain("deal_value_pence");
    expect(out.text).toContain("deal_value_pence");
  });

  it("text version contains all 3 labelled link lines", () => {
    const out = buildOutcomeAskEmail({
      partnerName: "Acme",
      jobId: 1,
      links: baseLinks,
      expiresInDays: 90,
    });
    expect(out.text).toMatch(/Won:\s+https:\/\/example\.com/);
    expect(out.text).toMatch(/Quoted:\s+https:\/\/example\.com/);
    expect(out.text).toMatch(/Lost:\s+https:\/\/example\.com/);
  });

  it("HTML body wrap is applied (contains accent header)", () => {
    const out = buildOutcomeAskEmail({
      partnerName: "Acme",
      jobId: 1,
      links: baseLinks,
      expiresInDays: 90,
    });
    // The shared wrap() function emits this exact header text.
    expect(out.html).toContain("TradesmanFinder");
    // Green accent (used here for outcome-ask)
    expect(out.html).toContain("#16a34a");
  });
});
