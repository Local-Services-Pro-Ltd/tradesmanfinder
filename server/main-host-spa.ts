/**
 * Server-side HTML rendering for main-host SEO landing pages (PR-#19-D).
 *
 * Catches GET requests on the main host that match the canonical
 * `/{cat}-in-{area}` shape, resolves the category + area + supply
 * count, and rewrites the <head> of `dist/public/index.html` with
 * landing-page-specific title, meta description, canonical link,
 * OpenGraph tags and JSON-LD (LocalBusiness + Service + BreadcrumbList)
 * before sending. Static assets and non-hyperlocal HTML requests fall
 * through to serveStatic unchanged.
 *
 * Why this layer is needed even though the client uses useEffect to
 * set <title> and <link rel="canonical">: the SPA is hash-routed —
 * `/plumber-in-manchester` is rewritten to `/#/plumber-in-manchester`
 * by a bouncer script in index.html before React mounts. Googlebot
 * and friends see the un-injected index.html *first*, with only the
 * generic homepage tags. By the time client JS runs, the bot has
 * usually moved on. Server injection closes that gap.
 *
 * Mount order requirements (see server/index.ts and server/vercel-entry.ts):
 *   1. micrositeMiddleware            (populates req.microsite)
 *   2. registerRoutes                  (everything under /api)
 *   3. registerMainSiteRoutes          (/sitemap.xml, /robots.txt)
 *   4. registerMicrositeRoutes         (per-host /sitemap.xml)
 *   5. registerMainHostSpa  ← THIS    (main-host /{cat}-in-{area} HTML)
 *   6. registerMicrositeSpa            (mini-site HTML)
 *   7. serveStatic                     (catch-all index.html)
 *
 * We come after the mini-site SPA registration in source order but
 * BOTH check req.microsite first, so order between (5) and (6) does
 * not affect behaviour. We do, however, need to come before
 * serveStatic.
 */

import fs from "node:fs";
import path from "node:path";
import type { Express, Request, Response, NextFunction } from "express";
import { storage } from "./storage";
import { parseFlatHyperlocalSlug } from "../shared/hyperlocal-slug";
import { parseCategoriesJson } from "../shared/seo-routes";
import {
  buildMainHostSeo,
  type MainHostSeoPayload,
} from "../shared/main-host-seo";
import { BUNDLED_INDEX_HTML } from "./generated/index-html";

let cachedIndexHtml: string | null = null;
let cachedIndexPath: string | null = null;

/**
 * Resolve the index.html string to inject into.
 *
 * Resolution order:
 *   1. BUNDLED_INDEX_HTML — baked in at build time from
 *      dist/public/index.html (see script/build.ts). This is the only
 *      thing that works in the Vercel serverless function, where the
 *      static dist/ tree is NOT shipped with the function bundle.
 *   2. Local filesystem (dist/public/index.html or sibling public/) —
 *      used by the dev Express server (server/index.ts) and by any
 *      standalone Node deployment where the build artefact is co-located
 *      with the bundle.
 *
 * We prefer the bundled string when it looks like a real build (a
 * file >=512 bytes containing the React Vite asset marker). The
 * checked-in placeholder is a few hundred bytes, so the heuristic
 * keeps tests honest — if the build step hasn't replaced the
 * placeholder, we fall through to a filesystem read.
 */
function looksLikeRealBuild(html: string): boolean {
  return html.length >= 512 && /\/assets\/index-/.test(html);
}

function loadIndexHtml(): string | null {
  if (cachedIndexHtml) return cachedIndexHtml;

  if (BUNDLED_INDEX_HTML && looksLikeRealBuild(BUNDLED_INDEX_HTML)) {
    cachedIndexHtml = BUNDLED_INDEX_HTML;
    cachedIndexPath = "<bundled>";
    return cachedIndexHtml;
  }

  // Filesystem fallback for local dev / standalone Node deployments.
  // Try the path layout used by the standalone server bundle first.
  const candidates = [
    path.resolve(__dirname, "public", "index.html"),
    path.resolve(process.cwd(), "dist", "public", "index.html"),
  ];
  for (const p of candidates) {
    if (fs.existsSync(p)) {
      cachedIndexHtml = fs.readFileSync(p, "utf8");
      cachedIndexPath = p;
      return cachedIndexHtml;
    }
  }

  // Last resort: the placeholder. Better to inject into a stub than
  // 404 the request — the client renderer will replace it anyway.
  cachedIndexHtml = BUNDLED_INDEX_HTML;
  cachedIndexPath = "<placeholder>";
  return cachedIndexHtml;
}

/** Test hook — clears the cached index.html bytes so a fresh read happens next. */
export function _resetMainHostIndexCache(): void {
  cachedIndexHtml = null;
  cachedIndexPath = null;
}

/** Escape a string for safe use as HTML text or attribute value. */
function escapeHtml(s: string): string {
  return s.replace(
    /[&<>"']/g,
    (c) =>
      ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#39;",
      })[c] as string,
  );
}

/**
 * Inject the SEO payload into the raw index.html string.
 *
 * Strips any pre-existing <title> / `<meta name="description">` /
 * `<meta property="og:*">` from the default HTML so we never end up
 * with duplicate tags (Google picks the first; we want ours to win).
 * Inserts a marker-bracketed block just before </head>; idempotent
 * across repeat injections via the markers.
 *
 * Exposed for direct unit testing — the Express handler calls it.
 */
export function injectMainHostSeo(
  html: string,
  seo: MainHostSeoPayload,
): string {
  const marker = "<!-- main-host-seo:start -->";
  const endMarker = "<!-- main-host-seo:end -->";

  const lines: string[] = [
    marker,
    `<title>${escapeHtml(seo.title)}</title>`,
    `<meta name="description" content="${escapeHtml(seo.description)}">`,
    `<link rel="canonical" href="${escapeHtml(seo.canonical)}">`,
    `<meta property="og:title" content="${escapeHtml(seo.ogTitle)}">`,
    `<meta property="og:description" content="${escapeHtml(seo.ogDescription)}">`,
    `<meta property="og:url" content="${escapeHtml(seo.canonical)}">`,
    `<meta property="og:type" content="${escapeHtml(seo.ogType)}">`,
    `<meta property="og:site_name" content="TradesmanFinder">`,
    `<meta name="twitter:card" content="summary_large_image">`,
    `<meta name="twitter:title" content="${escapeHtml(seo.ogTitle)}">`,
    `<meta name="twitter:description" content="${escapeHtml(seo.ogDescription)}">`,
  ];

  for (const block of seo.jsonLd) {
    // JSON.stringify is safe inside a <script type="application/ld+json">
    // body provided we never embed user-controlled strings raw. All inputs
    // here are DB rows we control, but defensively escape </script.
    const json = JSON.stringify(block).replace(/<\/script/gi, "<\\/script");
    lines.push(`<script type="application/ld+json">${json}</script>`);
  }

  lines.push(endMarker);
  const block = lines.join("\n");

  // Idempotent re-injection (covers dev hot-reload).
  if (html.includes(marker) && html.includes(endMarker)) {
    return html.replace(
      new RegExp(`${marker}[\\s\\S]*?${endMarker}`),
      block,
    );
  }

  // Strip default <title> / description / og:* so ours doesn't double up.
  let stripped = html.replace(/<title>[\s\S]*?<\/title>/i, "");
  stripped = stripped.replace(
    /<meta\s+name=["']description["'][^>]*>\s*/gi,
    "",
  );
  stripped = stripped.replace(
    /<meta\s+property=["']og:[^"']+["'][^>]*>\s*/gi,
    "",
  );

  if (stripped.includes("</head>")) {
    return stripped.replace("</head>", `${block}\n</head>`);
  }

  // Fallback for malformed HTML — should never happen with a real Vite build.
  return `${block}\n${stripped}`;
}

function originOf(req: Request): string {
  const proto =
    (req.headers["x-forwarded-proto"] as string) || req.protocol || "https";
  return `${proto}://${req.hostname}`;
}

/**
 * Decide whether this request is an HTML request that should hit the
 * SPA pipeline. Mirrors microsite-spa.ts:isHtmlRequest so the two
 * handlers agree on what counts as "HTML".
 */
function isHtmlRequest(req: Request): boolean {
  if (req.path.startsWith("/api")) return false;
  if (req.path.startsWith("/sitemap")) return false;
  if (req.path.startsWith("/robots")) return false;
  if (req.path.startsWith("/checkout/return")) return false;
  if (req.path.startsWith("/p/")) return false;
  if (/\.[a-z0-9]+$/i.test(req.path)) return false;
  return true;
}

/**
 * Compute the supply count for a (categoryId, areaId) pair from the
 * raw tradesmen rows. Safe against the same defensive cases as
 * server/main-sitemap.ts:buildMainSitemap — null areaId, malformed
 * categories JSON.
 */
function countSupply(
  tradesmen: ReadonlyArray<{
    areaId: number | null;
    categories: string | null;
  }>,
  categoryId: number,
  areaId: number,
): number {
  let n = 0;
  for (const t of tradesmen) {
    if (t.areaId !== areaId) continue;
    const cats = parseCategoriesJson(t.categories);
    if (cats.includes(categoryId)) n += 1;
  }
  return n;
}

/**
 * Register the main-host SPA handler. Mount AFTER micrositeMiddleware,
 * registerRoutes, registerMainSiteRoutes, and registerMicrositeRoutes,
 * and BEFORE serveStatic.
 *
 * For mini-site hosts we defer to registerMicrositeSpa via next() so
 * the mini-site SEO injection wins.
 */
export function registerMainHostSpa(app: Express): void {
  app.get("/{*path}", async (req: Request, res: Response, next: NextFunction) => {
    // Mini-site hosts use their own injector.
    if (req.microsite) return next();
    if (!isHtmlRequest(req)) return next();

    // Only HTML paths matching the canonical /{cat}-in-{area} shape
    // get SEO injection. Everything else (homepage, /categories,
    // /post-a-job, …) falls through to serveStatic untouched. Those
    // pages still have meaningful default tags in the un-injected
    // index.html; only the hyperlocal pages were missing tags.
    //
    // req.path here is `/plumber-in-manchester` (with leading slash);
    // parseFlatHyperlocalSlug takes the segment without the slash.
    const segment = req.path.replace(/^\/+/, "").replace(/\/+$/, "");
    if (!segment || segment.includes("/")) return next();
    const parsed = parseFlatHyperlocalSlug(segment);
    if (!parsed.catSlug || !parsed.areaSlug) return next();

    const html = loadIndexHtml();
    if (!html) return next(); // unexpected — no HTML to inject into

    // Resolve the DB rows. If either is missing the URL isn't a real
    // landing page, so we let it fall through to serveStatic — the
    // client renderer will show its own "no results" copy.
    let category: { id: number; slug: string; name: string } | null = null;
    let area:
      | { id: number; slug: string; name: string; region: string }
      | null = null;
    let supplyCount = 0;
    try {
      const [cat, ar] = await Promise.all([
        storage.getCategoryBySlug(parsed.catSlug),
        storage.getAreaBySlug(parsed.areaSlug),
      ]);
      if (!cat || !ar) return next();
      category = { id: cat.id, slug: cat.slug, name: cat.name };
      area = { id: ar.id, slug: ar.slug, name: ar.name, region: ar.region };
      // Count once at request time. We could cache, but the entire
      // landing-page HTML response is uncached and DB call cost is
      // dominated by network, not row scan. Revisit if /{cat}-in-{area}
      // traffic ever exceeds a few QPS.
      const tradesmen = await storage.getTradesmen();
      supplyCount = countSupply(tradesmen, category.id, area.id);
    } catch (e) {
      // SEO is best-effort: a DB hiccup must not 500 the page.
      // Fall through with the un-injected HTML; the client renderer
      // still sets <title> via useEffect once it mounts.
      console.warn("[main-host-spa] taxonomy lookup failed:", e);
      return next();
    }

    const origin = originOf(req);
    const seo = buildMainHostSeo({ category, area, origin, supplyCount });
    const injected = injectMainHostSeo(html, seo);
    res.type("text/html").send(injected);
  });
}
