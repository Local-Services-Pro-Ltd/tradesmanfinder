// Homeowner magic-link authentication (PR D).
//
// Mirrors server/auth.ts but for homeowner sessions:
//   * Cookie name: tf_homeowner (separate from tf_session)
//   * Session table: homeowner_sessions (no tradesman_id)
//   * Magic-link purpose: 'homeowner_verify_access'
//   * Same security model: 256-bit hex tokens, SHA-256 hash stored only,
//     one-time use, 15-min TTL, 30-day sliding session
//
// This module is intentionally framework-light: pure helpers + thin
// Express middleware. Heavy DB calls go through storage.ts.

import type { Request, Response, NextFunction } from "express";

export const HOMEOWNER_SESSION_COOKIE = "tf_homeowner";
export const HOMEOWNER_MAGIC_LINK_TTL_MS = 15 * 60 * 1000;       // 15 minutes
export const HOMEOWNER_SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days sliding
export const HOMEOWNER_GRANT_TTL_MS = 7 * 24 * 60 * 60 * 1000;   // 7 days access grant
export const HOMEOWNER_RATE_LIMIT_WINDOW_MS = 24 * 60 * 60 * 1000; // 24h window
export const HOMEOWNER_RATE_LIMIT_MAX = 5;                          // 5 requests/24h
export const HOMEOWNER_REQUEST_THROTTLE_MS = 60 * 1000;            // 1 min per-email

/* ─────────────────────────────────────────────
   Cookie helpers
   ───────────────────────────────────────────── */

export function readHomeownerSessionCookie(req: Request): string | null {
  const raw = req.headers.cookie;
  if (!raw) return null;
  for (const part of raw.split(/;\s*/)) {
    const eq = part.indexOf("=");
    if (eq === -1) continue;
    if (part.slice(0, eq) === HOMEOWNER_SESSION_COOKIE) {
      const v = part.slice(eq + 1);
      try { return decodeURIComponent(v); } catch { return v; }
    }
  }
  return null;
}

export interface CookieOpts {
  secure?: boolean;
}

export function setHomeownerSessionCookie(res: Response, sessionId: string, opts: CookieOpts = {}) {
  const secure = opts.secure ?? process.env.NODE_ENV === "production";
  res.cookie(HOMEOWNER_SESSION_COOKIE, sessionId, {
    httpOnly: true,
    secure,
    sameSite: "lax",
    path: "/",
    maxAge: HOMEOWNER_SESSION_TTL_MS,
  });
}

export function clearHomeownerSessionCookie(res: Response, opts: CookieOpts = {}) {
  const secure = opts.secure ?? process.env.NODE_ENV === "production";
  res.clearCookie(HOMEOWNER_SESSION_COOKIE, {
    httpOnly: true,
    secure,
    sameSite: "lax",
    path: "/",
  });
}

/* ─────────────────────────────────────────────
   Session validation
   ───────────────────────────────────────────── */

export function homeownerSessionIsExpired(session: { expiresAt: number }, nowMs = Date.now()): boolean {
  return session.expiresAt <= nowMs;
}

/* ─────────────────────────────────────────────
   Express middleware — populates req.homeowner on success, 401 on failure.
   ───────────────────────────────────────────── */

declare module "express-serve-static-core" {
  interface Request {
    homeowner?: {
      sessionId: string;
      email: string;
    };
  }
}

export async function requireHomeowner(req: Request, res: Response, next: NextFunction) {
  const sid = readHomeownerSessionCookie(req);
  if (!sid) return res.status(401).json({ message: "Not signed in as homeowner" });

  // Lazy-imported so the pure helpers above stay unit-testable without DB env.
  const { storage } = await import("./storage");
  const session = await storage.getHomeownerSessionById(sid);
  if (!session) {
    clearHomeownerSessionCookie(res);
    return res.status(401).json({ message: "Homeowner session expired" });
  }
  if (homeownerSessionIsExpired(session)) {
    await storage.deleteHomeownerSession(sid).catch(() => undefined);
    clearHomeownerSessionCookie(res);
    return res.status(401).json({ message: "Homeowner session expired" });
  }

  // Sliding expiration
  const now = Date.now();
  storage.touchHomeownerSession(sid, { lastSeenAt: now, expiresAt: now + HOMEOWNER_SESSION_TTL_MS })
    .catch((err: any) => console.error(`[homeowner-auth] touchHomeownerSession failed for sid=${sid.slice(0, 8)}…:`, err?.message));

  req.homeowner = { sessionId: sid, email: session.email };
  next();
}
