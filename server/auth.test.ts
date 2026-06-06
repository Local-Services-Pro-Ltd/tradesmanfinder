// Tests for magic-link authentication (PR-A1).
//
// We stub the storage layer (no DB) and the mailer (no network). Pure helpers
// (token gen/hash, JWT sign/verify, cookie serialize/parse, rate limiter) are
// tested directly.
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Request, Response } from "express";

vi.mock("./storage", () => ({
  storage: {
    getTradesmanByEmail: vi.fn(),
    getTradesmanById: vi.fn(),
    getCardsByTradesman: vi.fn().mockResolvedValue([]),
    createAuthToken: vi.fn(),
    getAuthTokenByHash: vi.fn(),
    consumeAuthToken: vi.fn(),
    countAuthTokensForTradesmanSince: vi.fn().mockResolvedValue(0),
    updateTradesman: vi.fn(),
  },
}));

vi.mock("./mailer", () => ({
  sendSignInLinkEmail: vi.fn().mockResolvedValue({ ok: true, id: "email_1" }),
}));

import {
  generateToken, hashToken, normalizeEmail,
  signSession, verifySession,
  serializeSessionCookie, clearSessionCookieHeader, parseCookies,
  checkEmailRateLimit, checkIpRateLimit, _resetRateLimiters,
  requestLinkHandler, verifyHandler, logoutHandler, requireAuth, meHandler,
  deprecatedLoginHandler, SESSION_COOKIE,
} from "./auth";
import { storage } from "./storage";
import { sendSignInLinkEmail } from "./mailer";

const storageMock = storage as unknown as Record<string, ReturnType<typeof vi.fn>>;
const mailerMock = sendSignInLinkEmail as unknown as ReturnType<typeof vi.fn>;

const TEST_SECRET = "test-session-secret-at-least-32-bytes-long-xxxx";

function mockRes() {
  const res: any = { _status: 200, _json: undefined, _headers: {} as Record<string, string>, _redirect: undefined, _ended: false };
  res.status = vi.fn((code: number) => { res._status = code; return res; });
  res.json = vi.fn((body: unknown) => { res._json = body; return res; });
  res.setHeader = vi.fn((k: string, v: string) => { res._headers[k] = v; return res; });
  res.redirect = vi.fn((code: number, url: string) => { res._status = code; res._redirect = url; return res; });
  res.end = vi.fn(() => { res._ended = true; return res; });
  return res as Response & { _status: number; _json: any; _headers: Record<string, string>; _redirect?: string; _ended: boolean };
}

function mockReq(opts: { body?: any; query?: any; headers?: Record<string, any> } = {}): Request {
  return {
    body: opts.body ?? {},
    query: opts.query ?? {},
    headers: opts.headers ?? {},
    socket: { remoteAddress: "10.0.0.1" },
    ip: "10.0.0.1",
  } as unknown as Request;
}

beforeEach(() => {
  Object.values(storageMock).forEach((fn) => fn.mockReset?.());
  storageMock.getCardsByTradesman.mockResolvedValue([]);
  storageMock.countAuthTokensForTradesmanSince.mockResolvedValue(0);
  mailerMock.mockReset();
  mailerMock.mockResolvedValue({ ok: true, id: "email_1" });
  _resetRateLimiters();
  process.env.SESSION_SECRET = TEST_SECRET;
});

// ── Token generation & hashing ──
describe("token helpers", () => {
  it("generateToken produces a base64url string with >= 32 bytes of entropy", () => {
    const t = generateToken();
    expect(t).toMatch(/^[A-Za-z0-9_-]+$/); // base64url alphabet, no padding
    // 32 bytes base64url → 43 chars
    expect(t.length).toBeGreaterThanOrEqual(43);
    const decoded = Buffer.from(t, "base64url");
    expect(decoded.length).toBe(32);
  });

  it("generateToken is non-deterministic", () => {
    expect(generateToken()).not.toBe(generateToken());
  });

  it("hashToken returns deterministic sha256 hex", () => {
    const t = "some-token";
    const h1 = hashToken(t);
    const h2 = hashToken(t);
    expect(h1).toBe(h2);
    expect(h1).toMatch(/^[0-9a-f]{64}$/);
    expect(hashToken("other")).not.toBe(h1);
  });

  it("normalizeEmail lowercases and trims", () => {
    expect(normalizeEmail("  Foo@Bar.COM ")).toBe("foo@bar.com");
  });
});

// ── JWT ──
describe("session JWT", () => {
  it("signs and verifies a valid session", () => {
    const jwt = signSession(42, { secret: TEST_SECRET });
    const claims = verifySession(jwt, { secret: TEST_SECRET });
    expect(claims?.sub).toBe(42);
  });

  it("rejects a tampered signature", () => {
    const jwt = signSession(42, { secret: TEST_SECRET });
    const tampered = jwt.slice(0, -2) + (jwt.endsWith("a") ? "bb" : "aa");
    expect(verifySession(tampered, { secret: TEST_SECRET })).toBeNull();
  });

  it("rejects a token signed with a different secret", () => {
    const jwt = signSession(42, { secret: "another-secret-value-of-sufficient-length!" });
    expect(verifySession(jwt, { secret: TEST_SECRET })).toBeNull();
  });

  it("rejects an expired token", () => {
    const past = Date.now() - 60 * 60 * 1000;
    const jwt = signSession(42, { secret: TEST_SECRET, now: past, ttlMs: 1000 });
    expect(verifySession(jwt, { secret: TEST_SECRET })).toBeNull();
  });

  it("rejects malformed input", () => {
    expect(verifySession("not.a.jwt", { secret: TEST_SECRET })).toBeNull();
    expect(verifySession("only-one-part", { secret: TEST_SECRET })).toBeNull();
  });
});

// ── Cookies ──
describe("cookie helpers", () => {
  it("serializes a hardened session cookie", () => {
    const c = serializeSessionCookie("abc", 30 * 24 * 60 * 60 * 1000);
    expect(c).toContain(`${SESSION_COOKIE}=abc`);
    expect(c).toContain("HttpOnly");
    expect(c).toContain("Secure");
    expect(c).toContain("SameSite=Lax");
    expect(c).toContain("Path=/");
    expect(c).toContain("Max-Age=2592000");
  });

  it("clear cookie sets Max-Age=0", () => {
    expect(clearSessionCookieHeader()).toContain("Max-Age=0");
  });

  it("parses a cookie header", () => {
    const parsed = parseCookies(`${SESSION_COOKIE}=xyz; other=1`);
    expect(parsed[SESSION_COOKIE]).toBe("xyz");
    expect(parsed.other).toBe("1");
    expect(parseCookies(undefined)).toEqual({});
  });
});

// ── Rate limiter ──
describe("rate limiter", () => {
  it("blocks the 4th email request inside the window", () => {
    expect(checkEmailRateLimit("a@b.com")).toBe(true);
    expect(checkEmailRateLimit("a@b.com")).toBe(true);
    expect(checkEmailRateLimit("a@b.com")).toBe(true);
    expect(checkEmailRateLimit("a@b.com")).toBe(false); // 4th
  });

  it("blocks the 11th IP request inside the window", () => {
    for (let i = 0; i < 10; i++) expect(checkIpRateLimit("1.2.3.4")).toBe(true);
    expect(checkIpRateLimit("1.2.3.4")).toBe(false); // 11th
  });
});

// ── POST /api/auth/request-link ──
describe("requestLinkHandler", () => {
  it("returns 200 generic message for an unknown email WITHOUT sending", async () => {
    storageMock.getTradesmanByEmail.mockResolvedValue(undefined);
    const res = mockRes();
    await requestLinkHandler(mockReq({ body: { email: "nobody@example.com" } }), res);
    expect(res._status).toBe(200);
    expect(res._json.message).toMatch(/if an account exists/i);
    expect(mailerMock).not.toHaveBeenCalled();
    expect(storageMock.createAuthToken).not.toHaveBeenCalled();
  });

  it("returns 200 and creates an auth_tokens row + sends email for a known email", async () => {
    storageMock.getTradesmanByEmail.mockResolvedValue({ id: 7, email: "trade@x.com", businessName: "Acme", ownerName: "Pat" });
    storageMock.createAuthToken.mockResolvedValue({ id: 1 });
    const res = mockRes();
    await requestLinkHandler(mockReq({ body: { email: "Trade@X.com" } }), res);
    expect(res._status).toBe(200);
    expect(storageMock.createAuthToken).toHaveBeenCalledTimes(1);
    const row = storageMock.createAuthToken.mock.calls[0][0];
    expect(row.tradesmanId).toBe(7);
    expect(row.tokenHash).toMatch(/^[0-9a-f]{64}$/);
    expect(row.expiresAt).toBeInstanceOf(Date);
    expect(mailerMock).toHaveBeenCalledTimes(1);
    const emailArgs = mailerMock.mock.calls[0][0];
    expect(emailArgs.verifyUrl).toContain("/api/auth/verify?token=");
  });

  it("does not send for a banned (red-carded) account but still returns generic 200", async () => {
    storageMock.getTradesmanByEmail.mockResolvedValue({ id: 9, email: "banned@x.com", businessName: "B", ownerName: "B" });
    storageMock.getCardsByTradesman.mockResolvedValue([
      { id: 1, tradesmanId: 9, cardType: "red", reason: "x", grossMisconduct: true, issuedAt: Date.now() - 1000, expiresAt: null, rescindedAt: null, rescindedBy: null, rescindedReason: null, issuedBy: "admin" },
    ]);
    const res = mockRes();
    await requestLinkHandler(mockReq({ body: { email: "banned@x.com" } }), res);
    expect(res._status).toBe(200);
    expect(mailerMock).not.toHaveBeenCalled();
    expect(storageMock.createAuthToken).not.toHaveBeenCalled();
  });

  it("blocks the 4th request from the same email with 429", async () => {
    storageMock.getTradesmanByEmail.mockResolvedValue(undefined);
    const body = { email: "rl@example.com" };
    for (let i = 0; i < 3; i++) {
      const r = mockRes();
      await requestLinkHandler(mockReq({ body }), r);
      expect(r._status).toBe(200);
    }
    const r4 = mockRes();
    await requestLinkHandler(mockReq({ body }), r4);
    expect(r4._status).toBe(429);
  });

  it("blocks the 11th request from the same IP with 429", async () => {
    storageMock.getTradesmanByEmail.mockResolvedValue(undefined);
    const headers = { "x-forwarded-for": "9.9.9.9" };
    // Use distinct emails so the per-email limit doesn't trip first.
    for (let i = 0; i < 10; i++) {
      const r = mockRes();
      await requestLinkHandler(mockReq({ body: { email: `u${i}@example.com` }, headers }), r);
      expect(r._status).toBe(200);
    }
    const r11 = mockRes();
    await requestLinkHandler(mockReq({ body: { email: "u10@example.com" }, headers }), r11);
    expect(r11._status).toBe(429);
  });
});

// ── GET /api/auth/verify ──
describe("verifyHandler", () => {
  it("redirects with error when token is missing", async () => {
    const res = mockRes();
    await verifyHandler(mockReq({ query: {} }), res);
    expect(res._status).toBe(302);
    expect(res._redirect).toContain("error=invalid_or_expired");
  });

  it("redirects with error for an invalid (unknown) token", async () => {
    storageMock.getAuthTokenByHash.mockResolvedValue(undefined);
    const res = mockRes();
    await verifyHandler(mockReq({ query: { token: "bogus" } }), res);
    expect(res._redirect).toContain("error=invalid_or_expired");
  });

  it("redirects with error for an expired token", async () => {
    storageMock.getAuthTokenByHash.mockResolvedValue({
      id: 1, tradesmanId: 7, tokenHash: hashToken("t"), expiresAt: new Date(Date.now() - 1000), consumedAt: null,
    });
    const res = mockRes();
    await verifyHandler(mockReq({ query: { token: "t" } }), res);
    expect(res._redirect).toContain("error=invalid_or_expired");
    expect(storageMock.consumeAuthToken).not.toHaveBeenCalled();
  });

  it("redirects with error for a consumed token", async () => {
    storageMock.getAuthTokenByHash.mockResolvedValue({
      id: 1, tradesmanId: 7, tokenHash: hashToken("t"), expiresAt: new Date(Date.now() + 60000), consumedAt: new Date(),
    });
    const res = mockRes();
    await verifyHandler(mockReq({ query: { token: "t" } }), res);
    expect(res._redirect).toContain("error=invalid_or_expired");
  });

  it("on valid token: consumes, stamps email_verified_at, sets cookie, redirects to dashboard", async () => {
    storageMock.getAuthTokenByHash.mockResolvedValue({
      id: 5, tradesmanId: 7, tokenHash: hashToken("good"), expiresAt: new Date(Date.now() + 60000), consumedAt: null,
    });
    storageMock.consumeAuthToken.mockResolvedValue({ id: 5, consumedAt: new Date() });
    storageMock.getTradesmanById.mockResolvedValue({ id: 7, emailVerifiedAt: null, businessName: "Acme" });
    storageMock.updateTradesman.mockResolvedValue({ id: 7 });
    const res = mockRes();
    await verifyHandler(mockReq({ query: { token: "good" } }), res);
    expect(storageMock.consumeAuthToken).toHaveBeenCalledWith(5, expect.any(Date));
    expect(storageMock.updateTradesman).toHaveBeenCalledWith(7, expect.objectContaining({ emailVerifiedAt: expect.any(Date) }));
    expect(res._headers["Set-Cookie"]).toContain(`${SESSION_COOKIE}=`);
    expect(res._headers["Set-Cookie"]).toContain("HttpOnly");
    expect(res._status).toBe(302);
    expect(res._redirect).toContain("/dashboard");
    // Verify the issued cookie is a valid session for id 7.
    const cookieVal = res._headers["Set-Cookie"].split(";")[0].split("=")[1];
    expect(verifySession(cookieVal, { secret: TEST_SECRET })?.sub).toBe(7);
  });

  it("does not re-stamp email_verified_at when already set", async () => {
    storageMock.getAuthTokenByHash.mockResolvedValue({
      id: 5, tradesmanId: 7, tokenHash: hashToken("good"), expiresAt: new Date(Date.now() + 60000), consumedAt: null,
    });
    storageMock.consumeAuthToken.mockResolvedValue({ id: 5 });
    storageMock.getTradesmanById.mockResolvedValue({ id: 7, emailVerifiedAt: new Date(), businessName: "Acme" });
    const res = mockRes();
    await verifyHandler(mockReq({ query: { token: "good" } }), res);
    expect(storageMock.updateTradesman).not.toHaveBeenCalled();
    expect(res._redirect).toContain("/dashboard");
  });
});

// ── POST /api/auth/logout ──
describe("logoutHandler", () => {
  it("clears the cookie and returns 204", () => {
    const res = mockRes();
    logoutHandler(mockReq(), res);
    expect(res._headers["Set-Cookie"]).toContain("Max-Age=0");
    expect(res._status).toBe(204);
    expect(res._ended).toBe(true);
  });
});

// ── requireAuth middleware ──
describe("requireAuth", () => {
  it("401 when no cookie", async () => {
    const res = mockRes();
    const next = vi.fn();
    await requireAuth(mockReq({ headers: {} }), res, next);
    expect(res._status).toBe(401);
    expect(res._json).toEqual({ error: "unauthenticated" });
    expect(next).not.toHaveBeenCalled();
  });

  it("401 on invalid signature", async () => {
    const res = mockRes();
    const next = vi.fn();
    await requireAuth(mockReq({ headers: { cookie: `${SESSION_COOKIE}=a.b.c` } }), res, next);
    expect(res._status).toBe(401);
    expect(next).not.toHaveBeenCalled();
  });

  it("401 on expired JWT", async () => {
    const expired = signSession(7, { secret: TEST_SECRET, now: Date.now() - 60 * 60 * 1000, ttlMs: 1000 });
    const res = mockRes();
    const next = vi.fn();
    await requireAuth(mockReq({ headers: { cookie: `${SESSION_COOKIE}=${expired}` } }), res, next);
    expect(res._status).toBe(401);
    expect(next).not.toHaveBeenCalled();
  });

  it("attaches req.tradesman and refreshes the cookie on a valid session", async () => {
    storageMock.getTradesmanById.mockResolvedValue({ id: 7, businessName: "Acme" });
    const jwt = signSession(7, { secret: TEST_SECRET });
    const req = mockReq({ headers: { cookie: `${SESSION_COOKIE}=${jwt}` } });
    const res = mockRes();
    const next = vi.fn();
    await requireAuth(req, res, next);
    expect(next).toHaveBeenCalledTimes(1);
    expect((req as any).tradesman).toEqual({ id: 7, businessName: "Acme" });
    expect(res._headers["Set-Cookie"]).toContain(`${SESSION_COOKIE}=`); // refreshed
  });

  it("401 when the JWT is valid but the tradesman no longer exists", async () => {
    storageMock.getTradesmanById.mockResolvedValue(undefined);
    const jwt = signSession(99, { secret: TEST_SECRET });
    const res = mockRes();
    const next = vi.fn();
    await requireAuth(mockReq({ headers: { cookie: `${SESSION_COOKIE}=${jwt}` } }), res, next);
    expect(res._status).toBe(401);
    expect(next).not.toHaveBeenCalled();
  });
});

// ── Deprecated endpoint ──
describe("deprecatedLoginHandler", () => {
  it("returns 410 Gone pointing to the new endpoint", () => {
    const res = mockRes();
    deprecatedLoginHandler(mockReq({ headers: {} }), res);
    expect(res._status).toBe(410);
    expect(res._json).toEqual({ error: "deprecated", message: "Use POST /api/auth/request-link" });
  });
});

// ── GET /api/auth/me ──
describe("meHandler", () => {
  it("returns the attached tradesman", async () => {
    const req = mockReq();
    (req as any).tradesman = { id: 7, businessName: "Acme" };
    const res = mockRes();
    await meHandler(req, res);
    expect(res._json).toEqual({ tradesman: { id: 7, businessName: "Acme" } });
  });
});
