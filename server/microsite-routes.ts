/**
 * Per-host /sitemap.xml and /robots.txt for each mini-site.
 *
 * Why per-host: each mini-site is its own domain in Google's eyes. Pointing
 * them all at tradesmanfinder.com's sitemap would dilute the per-host
 * crawl budget and confuse canonicals. Each mini-site advertises only the
 * URLs that live on its own host.
 *
 * The handlers read `req.microsite` (attached by `micrositeMiddleware`)
 * and emit a minimal but valid sitemap. For geo-trade and vertical sites
 * we emit the root page only — they are single-page renderings. For the
 * main site (no microsite), we delegate back to the existing main
 * sitemap (or 404 if not present); these handlers only own mini-site hosts.
 */

import type { Express, Request, Response } from 'express';
import { resolveMicrositeByHost } from '../shared/microsites';

function origin(req: Request): string {
  const proto = (req.headers['x-forwarded-proto'] as string) || req.protocol || 'https';
  return `${proto}://${req.hostname}`;
}

export function registerMicrositeRoutes(app: Express): void {
  // /robots.txt — allow everything on mini-sites and point at our sitemap.
  // For the main domain, we let the SPA static handler serve any existing
  // robots.txt (or 404). That keeps the main-site policy unchanged.
  app.get('/robots.txt', (req: Request, res: Response, next) => {
    const ms = req.microsite ?? resolveMicrositeByHost(req.hostname);
    if (!ms) return next(); // main site — let static handler take it

    res.type('text/plain').send(
      [
        'User-agent: *',
        'Allow: /',
        '',
        `Sitemap: ${origin(req)}/sitemap.xml`,
        '',
      ].join('\n'),
    );
  });

  // /sitemap.xml — one URL per host. Geo-trade + vertical + generic-directory
  // each render a single landing page at the root. We deliberately don't
  // cross-list URLs to other mini-sites here (each host owns only itself).
  app.get('/sitemap.xml', (req: Request, res: Response, next) => {
    const ms = req.microsite ?? resolveMicrositeByHost(req.hostname);
    if (!ms) return next();

    // Redirect hosts shouldn't reach here (middleware 301s first), but
    // belt-and-braces: don't advertise a sitemap for them.
    if (ms.kind === 'redirect') return res.status(404).end();

    const url = ms.canonical
      ? `https://${ms.canonical}/`
      : `${origin(req)}/`;

    const xml = [
      '<?xml version="1.0" encoding="UTF-8"?>',
      '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
      '  <url>',
      `    <loc>${url}</loc>`,
      `    <changefreq>weekly</changefreq>`,
      `    <priority>0.8</priority>`,
      '  </url>',
      '</urlset>',
    ].join('\n');

    res.type('application/xml').send(xml);
  });
}
