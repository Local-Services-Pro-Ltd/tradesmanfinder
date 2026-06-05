import type { Request, Response, NextFunction } from "express";

// Lightweight, dependency-free spam protection for public POST endpoints.
// 1) Honeypot: a hidden form field (default name "company_website") that real
//    users never fill in. If populated, the request is silently rejected.
// 2) Rate limit: in-memory sliding window keyed by client IP.

type Hit = { count: number; resetAt: number };
const buckets = new Map<string, Hit>();

function clientIp(req: Request): string {
const fwd = (req.headers["x-forwarded-for"] as string | undefined) || "";
return fwd.split(",")[0].trim() || req.socket.remoteAddress || "unknown";
}

export function honeypot(field = "company_website") {
return (req: Request, res: Response, next: NextFunction) => {
const body = req.body || {};
if (typeof body[field] === "string" && body[field].trim() !== "") {
return res.status(400).json({ message: "Validation failed" });
}
if (field in body) delete body[field];
next();
};
}

export function rateLimit(opts: { windowMs?: number; max?: number } = {}) {
const windowMs = opts.windowMs ?? 10 * 60 * 1000;
const max = opts.max ?? 5;
return (req: Request, res: Response, next: NextFunction) => {
const key = clientIp(req);
const now = Date.now();
const hit = buckets.get(key);
if (!hit || now > hit.resetAt) {
buckets.set(key, { count: 1, resetAt: now + windowMs });
return next();
}
if (hit.count >= max) {
const retry = Math.ceil((hit.resetAt - now) / 1000);
res.setHeader("Retry-After", String(retry));
return res.status(429).json({ message: "Too many requests. Please try again later." });
}
hit.count += 1;
next();
};
}

// Convenience: honeypot + rate limit applied together for public submissions.
export function publicFormGuard(opts?: { windowMs?: number; max?: number; field?: string }) {
const hp = honeypot(opts?.field);
const rl = rateLimit({ windowMs: opts?.windowMs, max: opts?.max });
return (req: Request, res: Response, next: NextFunction) => hp(req, res, (err?: unknown) => err ? next(err) : rl(req, res, next));
}
