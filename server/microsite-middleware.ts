/**
 * Mini-site middleware — runs first for every incoming request.
 *
 * Responsibilities:
 *   1. Resolve the request hostname against the microsite registry.
 *   2. 301-redirect brand-piggyback domains (kind === 'redirect') to their
 *      canonical destination — we never serve content on those hosts.
 *   3. 301-redirect duplicate-canonical hosts (e.g. blackheathbuilder.co.uk →
 *      blackheathbuilders.co.uk) to the canonical pair so we don't split
 *      link equity between two near-identical domains.
 *   4. Attach the resolved entry to `res.locals.microsite` and to a typed
 *      `req.microsite` so downstream handlers, SEO injection, and the
 *      sitemap/robots routes can branch off it.
 *
 * Why a separate module: the resolver runs O(1) (Map lookup) and is
 * critical-path on every request, so keeping it small and dependency-free
 * makes it easy to unit-test and reason about.
 */

import type { Request, Response, NextFunction } from 'express';
import { resolveMicrositeByHost, type Microsite } from '../shared/microsites';

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      /** Resolved microsite entry for this request, or null for the main site. */
      microsite?: Microsite | null;
    }
    interface Locals {
      microsite?: Microsite | null;
    }
  }
}

/** Fields exposed on res.locals.microsite (used by SEO injection + tests). */
export type RequestMicrosite = Microsite | null;

/**
 * Pull the request hostname, preferring `req.hostname` (express-normalised)
 * and falling back to the raw `Host` header. We export this so tests can
 * verify the host-resolution logic without spinning up express.
 */
export function readRequestHost(req: Pick<Request, 'hostname' | 'headers'>): string | undefined {
  if (req.hostname) return req.hostname;
  const raw = req.headers?.host;
  return typeof raw === 'string' ? raw : undefined;
}

/**
 * Express middleware. Mount BEFORE `registerRoutes` so /api/* handlers can
 * read `req.microsite` for source attribution.
 *
 * Skips API routes for the redirect branch — we only 301 page navigations,
 * not the JSON API. That keeps the API surface uniform across hosts and
 * makes lead capture from a redirect domain still possible if we ever
 * change the policy.
 */
export function micrositeMiddleware(
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  const host = readRequestHost(req);
  const microsite = resolveMicrositeByHost(host);
  req.microsite = microsite;
  res.locals.microsite = microsite;

  if (!microsite) return next();

  // Brand-piggyback domains: hard 301 to the canonical site. We never serve
  // content on these hosts to keep trademark exposure minimal — they exist
  // only to capture type-in traffic and forward it.
  if (microsite.kind === 'redirect' && microsite.redirectTo) {
    // Preserve the original path so deep-linked redirect URLs still land
    // on a usable page on the canonical site.
    const target = microsite.redirectTo.replace(/\/+$/, '') + req.originalUrl;
    res.redirect(301, target);
    return;
  }

  // Duplicate-canonical 301 (e.g. blackheathbuilder.co.uk → blackheathbuilders.co.uk).
  // Only applies to non-API page requests; API stays host-stable.
  if (microsite.canonical && !req.path.startsWith('/api') && !req.path.startsWith('/sitemap') && !req.path.startsWith('/robots')) {
    const proto = (req.headers['x-forwarded-proto'] as string) || req.protocol || 'https';
    const target = `${proto}://${microsite.canonical}${req.originalUrl}`;
    res.redirect(301, target);
    return;
  }

  next();
}
