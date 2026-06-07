// PR-P8 — Unit tests for outcome token sign/verify.
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import {
  signOutcomeToken,
  verifyOutcomeToken,
  buildOutcomeLink,
  isValidOutcome,
  OUTCOME_VALUES,
} from "./outcome-tokens";

// Tests run with the real ADMIN_KEY from env when present, otherwise we set
// a deterministic secret so the suite is reproducible locally.
const PRIOR_SECRET = process.env.PARTNER_OUTCOME_SECRET;
const PRIOR_ADMIN = process.env.ADMIN_KEY;

beforeAll(() => {
  process.env.PARTNER_OUTCOME_SECRET = "test-secret-do-not-use-in-prod-abc123";
});

afterAll(() => {
  if (PRIOR_SECRET === undefined) delete process.env.PARTNER_OUTCOME_SECRET;
  else process.env.PARTNER_OUTCOME_SECRET = PRIOR_SECRET;
  if (PRIOR_ADMIN === undefined) delete process.env.ADMIN_KEY;
  else process.env.ADMIN_KEY = PRIOR_ADMIN;
});

describe("signOutcomeToken / verifyOutcomeToken", () => {
  const now = 1_700_000_000_000;
  const baseArgs = { partnerId: 42, placementId: 7, jobId: 1234 };

  it("round-trips a freshly signed token", () => {
    const tok = signOutcomeToken(baseArgs, { now, nonce: "deadbeefdeadbeef" });
    const v = verifyOutcomeToken(tok, { now });
    expect(v.ok).toBe(true);
    if (!v.ok) return;
    expect(v.payload.partnerId).toBe(42);
    expect(v.payload.placementId).toBe(7);
    expect(v.payload.jobId).toBe(1234);
    expect(v.payload.nonce).toBe("deadbeefdeadbeef");
    expect(v.payload.expiresAtMs).toBe(now + 90 * 24 * 60 * 60 * 1000);
  });

  it("uses default TTL of 90 days", () => {
    const tok = signOutcomeToken(baseArgs, { now });
    const v = verifyOutcomeToken(tok, { now });
    expect(v.ok).toBe(true);
    if (!v.ok) return;
    expect(v.payload.expiresAtMs - now).toBe(90 * 24 * 60 * 60 * 1000);
  });

  it("honours a custom TTL", () => {
    const tok = signOutcomeToken({ ...baseArgs, ttlMs: 60_000 }, { now });
    const v = verifyOutcomeToken(tok, { now });
    expect(v.ok).toBe(true);
    if (!v.ok) return;
    expect(v.payload.expiresAtMs - now).toBe(60_000);
  });

  it("rejects an expired token", () => {
    const tok = signOutcomeToken({ ...baseArgs, ttlMs: 1000 }, { now });
    const v = verifyOutcomeToken(tok, { now: now + 2000 });
    expect(v.ok).toBe(false);
    if (v.ok) return;
    expect(v.reason).toBe("expired");
  });

  it("rejects a tampered payload", () => {
    const tok = signOutcomeToken(baseArgs, { now });
    // Flip a character in the payload portion
    const dot = tok.indexOf(".");
    const payload = tok.slice(0, dot);
    const sig = tok.slice(dot + 1);
    // Change one char in payload (still valid base64url)
    const tampered =
      payload.slice(0, 5) + (payload[5] === "A" ? "B" : "A") + payload.slice(6) + "." + sig;
    const v = verifyOutcomeToken(tampered, { now });
    expect(v.ok).toBe(false);
    if (v.ok) return;
    expect(v.reason).toBe("bad_signature");
  });

  it("rejects a tampered signature", () => {
    const tok = signOutcomeToken(baseArgs, { now });
    const dot = tok.indexOf(".");
    const tampered =
      tok.slice(0, dot + 1) + (tok[dot + 1] === "A" ? "B" : "A") + tok.slice(dot + 2);
    const v = verifyOutcomeToken(tampered, { now });
    expect(v.ok).toBe(false);
    if (v.ok) return;
    expect(v.reason).toBe("bad_signature");
  });

  it("rejects a malformed (no dot) token", () => {
    const v = verifyOutcomeToken("garbage-no-dot-here", { now });
    expect(v.ok).toBe(false);
    if (v.ok) return;
    expect(v.reason).toBe("malformed");
  });

  it("rejects an empty token", () => {
    const v = verifyOutcomeToken("", { now });
    expect(v.ok).toBe(false);
    if (v.ok) return;
    expect(v.reason).toBe("malformed");
  });

  it("rejects a token with empty payload or sig", () => {
    expect(verifyOutcomeToken(".sig", { now }).ok).toBe(false);
    expect(verifyOutcomeToken("payload.", { now }).ok).toBe(false);
  });

  it("rejects a token signed with a different secret", () => {
    const tok = signOutcomeToken(baseArgs, { now });
    const prev = process.env.PARTNER_OUTCOME_SECRET;
    process.env.PARTNER_OUTCOME_SECRET = "different-secret-xyz";
    try {
      const v = verifyOutcomeToken(tok, { now });
      expect(v.ok).toBe(false);
      if (v.ok) return;
      expect(v.reason).toBe("bad_signature");
    } finally {
      process.env.PARTNER_OUTCOME_SECRET = prev;
    }
  });

  it("produces distinct tokens for distinct nonces", () => {
    const a = signOutcomeToken(baseArgs, { now, nonce: "aaaaaaaaaaaaaaaa" });
    const b = signOutcomeToken(baseArgs, { now, nonce: "bbbbbbbbbbbbbbbb" });
    expect(a).not.toBe(b);
  });

  it("randomly-generated nonces differ across calls", () => {
    const a = signOutcomeToken(baseArgs);
    const b = signOutcomeToken(baseArgs);
    expect(a).not.toBe(b);
  });

  it("falls back to ADMIN_KEY when PARTNER_OUTCOME_SECRET is unset", () => {
    const prior = process.env.PARTNER_OUTCOME_SECRET;
    delete process.env.PARTNER_OUTCOME_SECRET;
    process.env.ADMIN_KEY = "fallback-admin-key";
    try {
      const tok = signOutcomeToken(baseArgs, { now });
      const v = verifyOutcomeToken(tok, { now });
      expect(v.ok).toBe(true);
    } finally {
      process.env.PARTNER_OUTCOME_SECRET = prior;
    }
  });
});

describe("buildOutcomeLink", () => {
  it("builds a full URL with outcome query param", () => {
    const url = buildOutcomeLink("abc.def", "won", "https://example.com");
    expect(url).toBe("https://example.com/p/o/abc.def?outcome=won");
  });

  it("respects each outcome value", () => {
    for (const outcome of OUTCOME_VALUES) {
      const url = buildOutcomeLink("tok", outcome, "https://example.com");
      expect(url).toContain(`outcome=${outcome}`);
    }
  });

  it("uses APP_BASE_URL env var when no baseUrl is given", () => {
    const prior = process.env.APP_BASE_URL;
    process.env.APP_BASE_URL = "https://custom.example";
    try {
      const url = buildOutcomeLink("tok", "won");
      expect(url).toBe("https://custom.example/p/o/tok?outcome=won");
    } finally {
      if (prior === undefined) delete process.env.APP_BASE_URL;
      else process.env.APP_BASE_URL = prior;
    }
  });
});

describe("isValidOutcome", () => {
  it("accepts won, lost, quoted", () => {
    expect(isValidOutcome("won")).toBe(true);
    expect(isValidOutcome("lost")).toBe(true);
    expect(isValidOutcome("quoted")).toBe(true);
  });

  it("rejects everything else", () => {
    expect(isValidOutcome("")).toBe(false);
    expect(isValidOutcome("WON")).toBe(false);
    expect(isValidOutcome("foo")).toBe(false);
    expect(isValidOutcome(undefined)).toBe(false);
  });
});
