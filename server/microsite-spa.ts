/**
 * SPA HTML serving with mini-site SEO injection.
 *
 * The main app's `serveStatic` does `express.static(distPath)` and a
 * catch-all `res.sendFile(.../index.html)`. For mini-site hosts we need to
 * read that same `index.html`, inject host-specific SEO into the <head>,
 * and send the result. We register this BEFORE `serveStatic` so it gets
 * first crack at any HTML request on a mini-site host. Static assets
 * (.js/.css/images) pass through to express.static unchanged.
 *
 * Cache strategy: the index.html bytes are read once on first request and
 * cached in memory. The injected SEO payload is recomputed per request
 * because it depends on the live DB row for the area/category — those
 * change infrequently but we don't want stale tradesman names baked in
 * if an admin renames an area.
 */

import fs from 'node:fs';
import path from 'node:path';
import type { Express, Request, Response, NextFunction } from 'express';
import { storage } from './storage';
import { buildMicrositeSeo, injectMicrositeSeo } from './microsite-seo';
import { BUNDLED_INDEX_HTML } from './generated/index-html';

let cachedIndexHtml: string | null = null;
let cachedIndexPath: string | null = null;

/**
 * Resolve the index.html string to inject into.
 *
 * Mirrors the resolution strategy in server/main-host-spa.ts:
 * prefer the build-time bundled HTML (the only thing that works in
 * the Vercel serverless function, where dist/public is not shipped
 * with the function bundle); fall back to filesystem reads for local
 * dev and standalone Node deployments.
 *
 * Until script/build.ts inlines the real HTML, BUNDLED_INDEX_HTML is
 * the committed placeholder — we detect that case via a size +
 * asset-marker heuristic and prefer a filesystem read so dev still
 * serves the real client bundle.
 */
function looksLikeRealBuild(html: string): boolean {
  return html.length >= 512 && /\/assets\/index-/.test(html);
}

function loadIndexHtml(): string | null {
  if (cachedIndexHtml) return cachedIndexHtml;

  if (BUNDLED_INDEX_HTML && looksLikeRealBuild(BUNDLED_INDEX_HTML)) {
    cachedIndexHtml = BUNDLED_INDEX_HTML;
    cachedIndexPath = '<bundled>';
    return cachedIndexHtml;
  }

  const candidates = [
    path.resolve(__dirname, 'public', 'index.html'),
    path.resolve(process.cwd(), 'dist', 'public', 'index.html'),
  ];
  for (const p of candidates) {
    if (fs.existsSync(p)) {
      cachedIndexHtml = fs.readFileSync(p, 'utf8');
      cachedIndexPath = p;
      return cachedIndexHtml;
    }
  }

  cachedIndexHtml = BUNDLED_INDEX_HTML;
  cachedIndexPath = '<placeholder>';
  return cachedIndexHtml;
}

/** For tests: reset the index.html cache so a fresh file is read next call. */
export function _resetIndexHtmlCache(): void {
  cachedIndexHtml = null;
  cachedIndexPath = null;
}

function isHtmlRequest(req: Request): boolean {
  // Treat any non-API, non-asset, non-sitemap/robots request as a candidate
  // for HTML. Express.static will still take precedence for real files; we
  // only intercept when the response would otherwise fall through to the
  // catch-all index.html.
  if (req.path.startsWith('/api')) return false;
  if (req.path.startsWith('/sitemap')) return false;
  if (req.path.startsWith('/robots')) return false;
  if (req.path.startsWith('/checkout/return')) return false;
  if (req.path.startsWith('/p/')) return false; // partner click/outcome routes
  // Heuristic: any path with an extension is an asset, skip it.
  if (/\.[a-z0-9]+$/i.test(req.path)) return false;
  return true;
}

/**
 * Register the mini-site SPA handler. Mount AFTER `micrositeMiddleware`
 * (so req.microsite is populated) and BEFORE `serveStatic` (so we get
 * first dibs on HTML requests). Only active for mini-site hosts; main
 * site requests fall through unchanged.
 */
export function registerMicrositeSpa(app: Express): void {
  app.get('/{*path}', async (req: Request, res: Response, next: NextFunction) => {
    const ms = req.microsite;
    if (!ms) return next();
    if (ms.kind === 'redirect') return next(); // middleware should have handled
    if (!isHtmlRequest(req)) return next();

    const html = loadIndexHtml();
    if (!html) return next(); // dev mode / missing build → let Vite serve it

    // Resolve area + category from the registry. We tolerate missing rows
    // (the DB may not yet have a slug; the SEO falls back to generic copy).
    let area: { name: string; region: string } | null = null;
    let category: { name: string } | null = null;
    try {
      if (ms.area) {
        const a = await storage.getAreaBySlug(ms.area);
        if (a) area = { name: a.name, region: a.region };
      }
      if (ms.trade) {
        const c = await storage.getCategoryBySlug(ms.trade);
        if (c) category = { name: c.name };
      }
    } catch (e) {
      // SEO is best-effort: a DB hiccup should still serve the page.
      console.warn('[microsite-spa] taxonomy lookup failed:', e);
    }

    const proto = (req.headers['x-forwarded-proto'] as string) || req.protocol || 'https';
    const origin = `${proto}://${req.hostname}`;
    const seo = buildMicrositeSeo({ microsite: ms, area, category, origin });
    const injected = injectMicrositeSeo(html, ms, seo);
    res.type('text/html').send(injected);
  });
}
