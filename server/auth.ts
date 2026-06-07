// Magic-link authentication (PR-A1b).
//
// Design summary (chosen during PR-A1 kickoff):
//   * Magic-link only — no passwords, no OAuth. Token = 256-bit hex sent by
//     email; only its SHA-256 hash is stored.
//   * 15-min token TTL, one-time use (consumed_at gated).
//   * Sessions are opaque 256-bit hex cookies; sliding 30-day expiry — every
//     authenticated request bumps `expires_at` and `last_seen_at`.
//   * HttpOnly, Secure-in-prod, SameSite=Lax cookie. Lax (not Strict) so the
//     verify link clicked from an email client still attaches the cookie on
//     the redirect to /#/dashboard.
//   * No RLS — service-role DB connection. All gating happens here.
//
// This module is intentionally framework-light: it returns plain data and
// exposes a thin Express middleware. Heavy DB calls go through storage.ts.

import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import type { Request, Response, NextFunction } from "express";
// NB: `./storage` is imported lazily inside the middleware so the pure helpers
// in this file remain unit-testable without DATABASE_URL set.

export const SESSION_COOKIE = "tf_session";
export const MAGIC_LINK_TTL_MS = 15 * 60 * 1000;          // 15 minutes
export const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;   // 30 days (sliding)
// Per-email throttle on /request-link to stop someone hammering a target
// inbox. Independent of the IP-based publicFormGuard rate limit.
export const REQUEST_LINK_EMAIL_THROTTLE_MS = 60 * 1000;  // 1 minute

export type MagicLinkPurpose = "sign_in" | "sign_up";

/* ─────────────────────────────────────────────
   Token helpers — pure functions, easy to unit test.
   ───────────────────────────────────────────── */

// 256-bit (32-byte) random token, hex-encoded. Sent in the magic-link URL.
export function generateToken(): string {
  return randomBytes(32).toString("hex");
}

export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

// Constant-time compare for two hex strings of equal length. Defensive — the
// DB lookup is by hash equality, but if we ever switch to a list-and-compare
// flow this keeps us honest.
export function tokensEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  try {
    return timingSafeEqual(Buffer.from(a, "hex"), Buffer.from(b, "hex"));
  } catch {
    return false;
  }
}

// Session id: 256-bit hex. Identical entropy to the magic-link token; this is
// the cookie value the browser presents on every authenticated request.
export function generateSessionId(): string {
  return randomBytes(32).toString("hex");
}

/* ─────────────────────────────────────────────
   Email normalisation. We lowercase + trim once on every entry point
   so callers can never disagree with storage lookups.
   ───────────────────────────────────────────── */
export function normaliseEmail(raw: string): string {
  return raw.trim().toLowerCase();
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
export function isValidEmail(s: string): boolean {
  return EMAIL_RE.test(s) && s.length <= 254;
}

/* ─────────────────────────────────────────────
   Cookie helpers — Express 5 supports res.cookie() natively but we still
   parse the Cookie header ourselves to avoid pulling in cookie-parser.
   ───────────────────────────────────────────── */
export function readSessionCookie(req: Request): string | null {
  const raw = req.headers.cookie;
  if (!raw) return null;
  for (const part of raw.split(/;\s*/)) {
    const eq = part.indexOf("=");
    if (eq === -1) continue;
    if (part.slice(0, eq) === SESSION_COOKIE) {
      const v = part.slice(eq + 1);
      // Tolerate URL-encoded values just in case.
      try { return decodeURIComponent(v); } catch { return v; }
    }
  }
  return null;
}

export interface CookieOpts {
  /** Override secure flag for tests. Defaults to NODE_ENV === 'production'. */
  secure?: boolean;
}

export function setSessionCookie(res: Response, sessionId: string, opts: CookieOpts = {}) {
  const secure = opts.secure ?? process.env.NODE_ENV === "production";
  res.cookie(SESSION_COOKIE, sessionId, {
    httpOnly: true,
    secure,
    sameSite: "lax",  // 'lax' lets the email-link redirect carry the cookie
    path: "/",
    maxAge: SESSION_TTL_MS,
  });
}

export function clearSessionCookie(res: Response, opts: CookieOpts = {}) {
  const secure = opts.secure ?? process.env.NODE_ENV === "production";
  res.clearCookie(SESSION_COOKIE, {
    httpOnly: true,
    secure,
    sameSite: "lax",
    path: "/",
  });
}

/* ─────────────────────────────────────────────
   Request fingerprinting — captured on token issue + session create so we
   can investigate abuse later without needing PII.
   ───────────────────────────────────────────── */
export function requestFingerprint(req: Request): { ip: string | null; ua: string | null } {
  const fwd = (req.headers["x-forwarded-for"] as string | undefined) || "";
  const ip = fwd.split(",")[0].trim() || req.socket.remoteAddress || null;
  const ua = (req.headers["user-agent"] as string | undefined) || null;
  return { ip, ua };
}

/* ─────────────────────────────────────────────
   Session validation — pure data check, no DB calls. Exposed for tests.
   ───────────────────────────────────────────── */
export function sessionIsExpired(session: { expiresAt: number }, nowMs = Date.now()): boolean {
  return session.expiresAt <= nowMs;
}

/* ─────────────────────────────────────────────
   Express middleware — populates req.auth on success, 401 on failure.
   ───────────────────────────────────────────── */
declare module "express-serve-static-core" {
  interface Request {
    auth?: {
      sessionId: string;
      tradesmanId: number;
    };
  }
}

export async function requireAuth(req: Request, res: Response, next: NextFunction) {
  const sid = readSessionCookie(req);
  if (!sid) return res.status(401).json({ message: "Not signed in" });

  // Lazy-imported so the pure helpers above stay unit-testable without DB env.
  const { storage } = await import("./storage");
  const session = await storage.getSessionById(sid);
  if (!session) {
    // Cookie present but session gone — clear it so the client can show the
    // sign-in screen cleanly instead of looping on a stale cookie.
    clearSessionCookie(res);
    return res.status(401).json({ message: "Session expired" });
  }
  if (sessionIsExpired(session)) {
    await storage.deleteSession(sid).catch(() => undefined);
    clearSessionCookie(res);
    return res.status(401).json({ message: "Session expired" });
  }

  // Sliding expiration: bump expires_at + last_seen_at on every authenticated
  // request. Fire-and-forget so the rest of the handler isn't blocked on
  // a write that would only ever be best-effort anyway.
  const now = Date.now();
  storage.touchSession(sid, { lastSeenAt: now, expiresAt: now + SESSION_TTL_MS })
    .catch((err) => console.error(`[auth] touchSession failed for sid=${sid.slice(0, 8)}…:`, err?.message));

  req.auth = { sessionId: sid, tradesmanId: session.tradesmanId };
  next();
}

/* ─────────────────────────────────────────────
   Ownership guard — auth required AND the resource :id must belong to the
   signed-in tradesman. Used on `/api/tradesmen/:id/cards`, PATCH
   `/api/tradesmen/:id`, etc.
   ───────────────────────────────────────────── */
export function requireSelf(idParam: string = "id") {
  return async (req: Request, res: Response, next: NextFunction) => {
    if (!req.auth) return res.status(401).json({ message: "Not signed in" });
    const target = Number(req.params[idParam]);
    if (!Number.isFinite(target)) return res.status(400).json({ message: "Invalid id" });
    if (req.auth.tradesmanId !== target) {
      return res.status(403).json({ message: "Forbidden" });
    }
    next();
  };
}
