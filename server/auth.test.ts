// Unit tests for the auth helpers (PR-A1b).
//
// Scope is deliberately tight: the pure crypto + validation helpers + the
// session-expiry check. The Express middleware (requireAuth, requireSelf)
// exercises real storage and is covered by integration tests at PR-A1c.

import { describe, it, expect } from "vitest";
import {
  generateToken,
  hashToken,
  tokensEqual,
  generateSessionId,
  normaliseEmail,
  isValidEmail,
  sessionIsExpired,
  readSessionCookie,
  SESSION_COOKIE,
  MAGIC_LINK_TTL_MS,
  SESSION_TTL_MS,
} from "./auth";
import type { Request } from "express";

describe("auth — token generation", () => {
  it("generateToken returns 64 hex chars (32 bytes)", () => {
    const t = generateToken();
    expect(t).toMatch(/^[0-9a-f]{64}$/);
  });

  it("two tokens are unique", () => {
    const a = generateToken();
    const b = generateToken();
    expect(a).not.toEqual(b);
  });

  it("generateSessionId returns 64 hex chars", () => {
    expect(generateSessionId()).toMatch(/^[0-9a-f]{64}$/);
  });

  it("hashToken is deterministic and sha256-shaped", () => {
    const t = "0".repeat(64);
    const h1 = hashToken(t);
    const h2 = hashToken(t);
    expect(h1).toEqual(h2);
    expect(h1).toMatch(/^[0-9a-f]{64}$/);
  });

  it("hashToken differs for different inputs", () => {
    expect(hashToken("a")).not.toEqual(hashToken("b"));
  });
});

describe("auth — tokensEqual (constant-time compare)", () => {
  it("equal hex strings compare true", () => {
    const t = generateToken();
    expect(tokensEqual(t, t)).toBe(true);
  });
  it("different hex strings compare false", () => {
    expect(tokensEqual(generateToken(), generateToken())).toBe(false);
  });
  it("different lengths compare false (and don't throw)", () => {
    expect(tokensEqual("ab", "abcd")).toBe(false);
  });
  it("invalid hex doesn't throw", () => {
    // Node's Buffer.from(_, 'hex') silently drops non-hex chars, so two equal
    // non-hex strings collapse to identical empty buffers and compare equal.
    // The point of this test is that we don't crash on garbage input.
    expect(() => tokensEqual("zz", "zz")).not.toThrow();
    expect(() => tokensEqual("!!", "@@")).not.toThrow();
  });
});

describe("auth — normaliseEmail / isValidEmail", () => {
  it("normalises case + trims whitespace", () => {
    expect(normaliseEmail("  Foo@Bar.COM ")).toEqual("foo@bar.com");
  });

  it("accepts plausible emails", () => {
    expect(isValidEmail("foo@bar.com")).toBe(true);
    expect(isValidEmail("a.b+tag@sub.example.co.uk")).toBe(true);
  });

  it("rejects malformed emails", () => {
    expect(isValidEmail("no-at-sign")).toBe(false);
    expect(isValidEmail("two@@bar.com")).toBe(false);
    expect(isValidEmail("a@b")).toBe(false);                 // no dot in domain
    expect(isValidEmail("spaces in@bar.com")).toBe(false);
    expect(isValidEmail("")).toBe(false);
  });

  it("rejects emails over 254 chars", () => {
    const local = "a".repeat(250);
    expect(isValidEmail(`${local}@b.co`)).toBe(false);
  });
});

describe("auth — sessionIsExpired", () => {
  it("returns false when expiresAt is in the future", () => {
    expect(sessionIsExpired({ expiresAt: Date.now() + 10_000 })).toBe(false);
  });
  it("returns true when expiresAt is in the past", () => {
    expect(sessionIsExpired({ expiresAt: Date.now() - 10_000 })).toBe(true);
  });
  it("returns true when expiresAt equals now (boundary)", () => {
    const now = 1_700_000_000_000;
    expect(sessionIsExpired({ expiresAt: now }, now)).toBe(true);
  });
});

describe("auth — readSessionCookie", () => {
  function reqWithCookie(header: string | undefined): Request {
    return { headers: header === undefined ? {} : { cookie: header } } as unknown as Request;
  }

  it("returns null when no cookie header", () => {
    expect(readSessionCookie(reqWithCookie(undefined))).toBeNull();
  });

  it("returns null when cookie header has no tf_session", () => {
    expect(readSessionCookie(reqWithCookie("other=1; foo=bar"))).toBeNull();
  });

  it("returns the value when the session cookie is present", () => {
    const sid = generateSessionId();
    expect(readSessionCookie(reqWithCookie(`${SESSION_COOKIE}=${sid}`))).toEqual(sid);
  });

  it("handles cookies with surrounding semicolons + spaces", () => {
    const sid = generateSessionId();
    expect(readSessionCookie(reqWithCookie(`other=1; ${SESSION_COOKIE}=${sid}; another=2`))).toEqual(sid);
  });

  it("decodes URL-encoded values", () => {
    const raw = "abc%2Bdef";
    expect(readSessionCookie(reqWithCookie(`${SESSION_COOKIE}=${raw}`))).toEqual("abc+def");
  });
});

describe("auth — TTL constants are sane", () => {
  it("magic-link TTL is 15 minutes", () => {
    expect(MAGIC_LINK_TTL_MS).toEqual(15 * 60 * 1000);
  });
  it("session TTL is 30 days", () => {
    expect(SESSION_TTL_MS).toEqual(30 * 24 * 60 * 60 * 1000);
  });
});
