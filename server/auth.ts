// Magic-link authentication for the tradesman dashboard.
//
// Replaces the insecure GET /api/tradesmen/login/:email endpoint, which let
// anyone sign in as any tradesperson with just their email address. That was a
// P0 gap once Stripe payments went live (a logged-in tradesperson can spend
// credits / open Checkout).
//
// Flow:
//   POST /api/auth/request-link { email }
//     → always 200 with a generic message (no account enumeration).
//     → if a tradesperson exists, generate a 32-byte random token, store ONLY
//       its sha256 hash (15-min TTL, single-use), email the plaintext link.
//   GET /api/auth/verify?token=...
//     → hash, look up unconsumed/unexpired row, mark consumed, set a signed
//       JWT session cookie (30-day rolling), redirect to the dashboard.
//   POST /api/auth/logout → clear the cookie, 204.
//   GET  /api/auth/me     → current tradesman (requireAuth), for bootstrap.
//
// JWT and cookies are hand-rolled with the Node crypto module to keep the
// serverless bundle lean and avoid pulling in a JWT dependency (none is
// currently in the tree).

import crypto from "node:crypto";
import type { Request, Response, NextFunction } from "express";
import { z } from "zod";
import { storage } from "./storage";
import { sendSignInLinkEmail } from "./mailer";
import { summarizeCards } from "@shared/cards";
import type { Tradesman } from "@shared/schema";

// ── Constants ──
export const SESSION_COOKIE = "tf_session";
export const TOKEN_TTL_MS = 15 * 60 * 1000; // 15 minutes
export const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days
export const PER_EMAIL_LIMIT = 3; // per 15 min
export const PER_EMAIL_WINDOW_MS = 15 * 60 * 1000;
export const PER_IP_LIMIT = 10; // per hour
export const PER_IP_WINDOW_MS = 60 * 60 * 1000;

const PUBLIC_URL = process.env.PUBLIC_URL || "https://tradesmanfinder.com";

// Augment Express's Request so route handlers can read req.tradesman.
declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      tradesman?: Tradesman;
    }
  }
}

// ── Token helpers ──

// 32 random bytes, base64url-encoded. This is the plaintext that goes in the
// email link and is never persisted.
export function generateToken(): string {
  return crypto.randomBytes(32).toString("base64url");
}

// sha256 hex of a token. Deterministic — used both when storing and when
// looking up on verify.
export function hashToken(token: string): string {
  return crypto.createHash("sha256").update(token).digest("hex");
}

// ── Email normalisation ──
export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

// ── JWT (HS256) helpers ──

function base64url(input: Buffer | string): string {
  return Buffer.from(input).toString("base64url");
}

function getSessionSecret(): string {
  const secret = process.env.SESSION_SECRET;
  if (!secret) {
    throw new Error("SESSION_SECRET environment variable is required for auth");
  }
  return secret;
}

export interface SessionClaims {
  sub: number; // tradesman id
  iat: number; // issued-at (seconds)
  exp: number; // expiry (seconds)
}

// Sign a session JWT. `secret` is injectable for tests; defaults to env.
export function signSession(
  tradesmanId: number,
  opts?: { now?: number; ttlMs?: number; secret?: string },
): string {
  const secret = opts?.secret ?? getSessionSecret();
  const now = opts?.now ?? Date.now();
  const ttlMs = opts?.ttlMs ?? SESSION_TTL_MS;
  const header = { alg: "HS256", typ: "JWT" };
  const payload: SessionClaims = {
    sub: tradesmanId,
    iat: Math.floor(now / 1000),
    exp: Math.floor((now + ttlMs) / 1000),
  };
  const encHeader = base64url(JSON.stringify(header));
  const encPayload = base64url(JSON.stringify(payload));
  const signingInput = `${encHeader}.${encPayload}`;
  const sig = crypto.createHmac("sha256", secret).update(signingInput).digest("base64url");
  return `${signingInput}.${sig}`;
}

// Verify a session JWT. Returns the claims if the signature is valid and the
// token is unexpired, otherwise null. Constant-time signature comparison.
export function verifySession(
  token: string,
  opts?: { now?: number; secret?: string },
): SessionClaims | null {
  const secret = opts?.secret ?? getSessionSecret();
  const now = opts?.now ?? Date.now();
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  const [encHeader, encPayload, sig] = parts;
  const signingInput = `${encHeader}.${encPayload}`;
  const expected = crypto.createHmac("sha256", secret).update(signingInput).digest("base64url");
  // timingSafeEqual throws on length mismatch — guard first.
  const sigBuf = Buffer.from(sig);
  const expBuf = Buffer.from(expected);
  if (sigBuf.length !== expBuf.length || !crypto.timingSafeEqual(sigBuf, expBuf)) {
    return null;
  }
  let claims: SessionClaims;
  try {
    claims = JSON.parse(Buffer.from(encPayload, "base64url").toString("utf8"));
  } catch {
    return null;
  }
  if (typeof claims.sub !== "number" || typeof claims.exp !== "number") return null;
  if (claims.exp * 1000 <= now) return null; // expired
  return claims;
}

// ── Cookie helpers ──

// Serialize the Set-Cookie value for the session cookie.
// HttpOnly + Secure + SameSite=Lax + Path=/ + Max-Age.
export function serializeSessionCookie(value: string, maxAgeMs: number): string {
  const maxAgeSec = Math.floor(maxAgeMs / 1000);
  const attrs = [
    `${SESSION_COOKIE}=${value}`,
    "HttpOnly",
    "Secure",
    "SameSite=Lax",
    "Path=/",
    `Max-Age=${maxAgeSec}`,
  ];
  return attrs.join("; ");
}

export function clearSessionCookieHeader(): string {
  return serializeSessionCookie("", 0);
}

// Parse a Cookie request header into a name→value map.
export function parseCookies(header: string | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  if (!header) return out;
  for (const part of header.split(";")) {
    const idx = part.indexOf("=");
    if (idx === -1) continue;
    const key = part.slice(0, idx).trim();
    const val = part.slice(idx + 1).trim();
    if (key) out[key] = decodeURIComponent(val);
  }
  return out;
}

// ── In-memory rate limiter ──
//
// Per-email and per-IP fixed-window counters. v1 limitation: state lives in
// the function instance's memory, so on Vercel (multiple short-lived serverless
// instances) the limit is per-instance, not global — an attacker hitting
// different instances could exceed it. The per-email limit is additionally
// backed by a DB count over auth_tokens (see requestLinkHandler) which is
// global and survives restarts; the in-memory limiter is the fast first line
// and also covers the per-IP dimension. A fully global per-IP limiter would
// need Redis/Upstash and is deferred.
type Bucket = { count: number; resetAt: number };
const emailBuckets = new Map<string, Bucket>();
const ipBuckets = new Map<string, Bucket>();

function hit(map: Map<string, Bucket>, key: string, limit: number, windowMs: number, now: number): boolean {
  const b = map.get(key);
  if (!b || b.resetAt <= now) {
    // Opportunistically evict expired buckets so the map can't grow unbounded
    // on a long-lived process (keys never re-hit would otherwise leak forever).
    map.forEach((v, k) => {
      if (v.resetAt <= now) map.delete(k);
    });
    map.set(key, { count: 1, resetAt: now + windowMs });
    return true; // allowed
  }
  if (b.count >= limit) return false; // blocked
  b.count += 1;
  return true;
}

// Exposed for tests so the limiter can be reset between cases.
export function _resetRateLimiters(): void {
  emailBuckets.clear();
  ipBuckets.clear();
}

export function checkEmailRateLimit(email: string, now = Date.now()): boolean {
  return hit(emailBuckets, email, PER_EMAIL_LIMIT, PER_EMAIL_WINDOW_MS, now);
}
export function checkIpRateLimit(ip: string, now = Date.now()): boolean {
  return hit(ipBuckets, ip, PER_IP_LIMIT, PER_IP_WINDOW_MS, now);
}

function clientIp(req: Request): string {
  const fwd = req.headers["x-forwarded-for"];
  if (typeof fwd === "string" && fwd.length > 0) return fwd.split(",")[0].trim();
  if (Array.isArray(fwd) && fwd.length > 0) return fwd[0];
  return req.ip || req.socket?.remoteAddress || "unknown";
}

const GENERIC_REQUEST_LINK_MESSAGE =
  "If an account exists for this email, a sign-in link has been sent.";

// ── Route handlers ──

const requestLinkSchema = z.object({ email: z.string().min(3).max(320) });

export async function requestLinkHandler(req: Request, res: Response): Promise<void> {
  const parsed = requestLinkSchema.safeParse(req.body);
  if (!parsed.success) {
    // Even on a malformed body, do not behave differently in a way that leaks
    // account existence. A 400 here only reflects a missing/invalid email
    // field, never whether an account exists.
    res.status(400).json({ message: "A valid email is required." });
    return;
  }
  const email = normalizeEmail(parsed.data.email);
  const ip = clientIp(req);

  // Per-IP rate limit (in-memory). Generic 429 so it cannot be used to probe
  // which emails exist.
  if (!checkIpRateLimit(ip)) {
    res.status(429).json({ message: "Too many requests. Please try again later." });
    return;
  }
  // Per-email rate limit (in-memory fast path).
  if (!checkEmailRateLimit(email)) {
    res.status(429).json({ message: "Too many requests. Please try again later." });
    return;
  }

  // Always return the same generic 200, regardless of whether an account
  // exists, is banned, or is over its quota (no enumeration leak).
  await maybeSendSignInLink(email, ip, req);
  res.status(200).json({ message: GENERIC_REQUEST_LINK_MESSAGE });
}

// Sends a sign-in link if and only if the email maps to a real, non-banned,
// under-quota account. Swallows the "should not send" cases via early returns
// so the caller can stay enumeration-safe.
async function maybeSendSignInLink(email: string, ip: string, req: Request): Promise<void> {
  const tradesman = await storage.getTradesmanByEmail(email);
  if (!tradesman) return;

  // Block sign-in for permanently banned (red-carded) accounts.
  const cards = await storage.getCardsByTradesman(tradesman.id);
  if (summarizeCards(cards).isLoginBlocked) return;

  // DB-backed per-email limit (global, survives restarts) — belt-and-braces
  // with the in-memory check in the caller.
  const since = new Date(Date.now() - PER_EMAIL_WINDOW_MS);
  const recent = await storage.countAuthTokensForTradesmanSince(tradesman.id, since);
  if (recent >= PER_EMAIL_LIMIT) return;

  const token = generateToken();
  const userAgent = typeof req.headers["user-agent"] === "string" ? req.headers["user-agent"] : null;
  await storage.createAuthToken({
    tradesmanId: tradesman.id,
    tokenHash: hashToken(token),
    expiresAt: new Date(Date.now() + TOKEN_TTL_MS),
    ip: ip === "unknown" ? null : ip,
    userAgent,
  });
  const verifyUrl = `${PUBLIC_URL}/api/auth/verify?token=${encodeURIComponent(token)}`;
  const result = await sendSignInLinkEmail({
    to: tradesman.email,
    ownerName: tradesman.ownerName || tradesman.businessName,
    businessName: tradesman.businessName,
    verifyUrl,
    tradesmanId: tradesman.id,
  });
  if (!result.ok) {
    console.error(`[auth] sign-in link send failed for tradesman ${tradesman.id}:`, result.error);
  }
}

// On any failure, redirect to the SPA login page with a generic error. The SPA
// uses hash routing, so the canonical login route is /#/login.
const LOGIN_ERROR_REDIRECT = "/#/login?error=invalid_or_expired";
const DASHBOARD_REDIRECT = "/#/dashboard";

export async function verifyHandler(req: Request, res: Response): Promise<void> {
  const token = typeof req.query.token === "string" ? req.query.token : "";
  if (!token) {
    res.redirect(302, LOGIN_ERROR_REDIRECT);
    return;
  }
  const tokenHash = hashToken(token);
  const row = await storage.getAuthTokenByHash(tokenHash);
  if (!row || row.consumedAt || row.expiresAt.getTime() <= Date.now()) {
    res.redirect(302, LOGIN_ERROR_REDIRECT);
    return;
  }
  // Atomically consume (guards against double-spend / replay).
  const consumed = await storage.consumeAuthToken(row.id, new Date());
  if (!consumed) {
    res.redirect(302, LOGIN_ERROR_REDIRECT);
    return;
  }
  const tradesman = await storage.getTradesmanById(row.tradesmanId);
  if (!tradesman) {
    res.redirect(302, LOGIN_ERROR_REDIRECT);
    return;
  }
  // First successful verification stamps email_verified_at.
  if (!tradesman.emailVerifiedAt) {
    await storage.updateTradesman(tradesman.id, { emailVerifiedAt: new Date() });
  }
  const jwt = signSession(tradesman.id);
  res.setHeader("Set-Cookie", serializeSessionCookie(jwt, SESSION_TTL_MS));
  res.redirect(302, DASHBOARD_REDIRECT);
}

export function logoutHandler(_req: Request, res: Response): void {
  res.setHeader("Set-Cookie", clearSessionCookieHeader());
  res.status(204).end();
}

// ── requireAuth middleware ──
//
// Verifies the session cookie JWT, loads the tradesman, attaches it to
// req.tradesman, and refreshes the cookie (sliding 30-day expiry). On any
// failure responds 401 { error: "unauthenticated" }.
export async function requireAuth(req: Request, res: Response, next: NextFunction): Promise<void> {
  const deny = () => { res.status(401).json({ error: "unauthenticated" }); };
  const raw = parseCookies(req.headers.cookie)[SESSION_COOKIE];
  if (!raw) return deny();
  const claims = verifySession(raw);
  if (!claims) return deny();
  const tradesman = await storage.getTradesmanById(claims.sub);
  if (!tradesman) return deny();
  req.tradesman = tradesman;
  // Sliding session: re-issue the cookie on each authenticated request.
  const fresh = signSession(tradesman.id);
  res.setHeader("Set-Cookie", serializeSessionCookie(fresh, SESSION_TTL_MS));
  next();
}

export async function meHandler(req: Request, res: Response): Promise<void> {
  res.json({ tradesman: req.tradesman });
}

// 410 Gone for the deprecated GET /api/tradesmen/login/:email endpoint.
export function deprecatedLoginHandler(_req: Request, res: Response): void {
  res.status(410).json({ error: "deprecated", message: "Use POST /api/auth/request-link" });
}
