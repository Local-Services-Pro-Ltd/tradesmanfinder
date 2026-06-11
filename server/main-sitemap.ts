/**
 * Main-host (tradesmanfinder.com) sitemap.xml + robots.txt.
 *
 * Distinct from server/microsite-routes.ts, which owns per-host sitemaps
 * for the mini-site domains. This module ONLY responds when the request
 * is on the main host (req.microsite is null/undefined). Mini-site hosts
 * keep their existing single-URL sitemap.
 *
 * Design decisions:
 *
 *  1. The route manifest from PR-#19-A drives the URL list.
 *     We import buildSeoRouteManifest() and feed it live DB rows
 *     (areas + categories + tradesman supply counts). Same scoring as
 *     the renderer, so every URL in the sitemap is one Google will
 *     also see in the templated cross-links (PR-#19-E).
 *
 *  2. In-memory cache with TTL (default 1h).
 *     Building the manifest costs a handful of millis but the DB hits
 *     dominate. Googlebot crawls /sitemap.xml repeatedly during
 *     re-indexing; we don't want each hit triggering 3 SELECTs.
 *     Cache key is just the host (one entry per origin).
 *
 *  3. Static URLs first, hyperlocal routes after.
 *     The crawler reads top-down. Homepage, /categories, /area/*,
 *     /category/* (single-axis) get higher priority because they're
 *     evergreen. Hyperlocal landing pages follow with priority scaled
 *     by tier (dense > sparse > empty).
 *
 *  4. We DO list empty-tier routes in the sitemap.
 *     PR-#19-A scoring keeps them (they convert with supply-side CTAs).
 *     Letting Google discover them is safe because PR-#19-D will add
 *     noindex on truly empty pages later if impressions are bad.
 *
 *  5. robots.txt is deliberately permissive.
 *     Allow: /, Disallow: /api/, /admin/, /dashboard/, /checkout/.
 *     Sitemap pointer at the bottom.
 */

import type { Express, Request, Response, NextFunction } from "express";
import { storage } from "./storage";
import {
  buildSeoRouteManifest,
  supplyKey,
  parseCategoriesJson,
  type SupplyCounts,
} from "../shared/seo-routes";

/** TTL for the in-memory sitemap cache (1h). */
const CACHE_TTL_MS = 60 * 60 * 1000;

/** Max hyperlocal routes to include. Matches PR-#19's 400-route target. */
const MAX_HYPERLOCAL_ROUTES = 400;

type CacheEntry = { xml: string; expiresAt: number };
const sitemapCache = new Map<string, CacheEntry>();

/** Test hook — clears the cache so a fresh build runs on next request. */
export function _resetMainSitemapCache(): void {
  sitemapCache.clear();
}

function originOf(req: Request): string {
  const proto = (req.headers["x-forwarded-proto"] as string) || req.protocol || "https";
  return `${proto}://${req.hostname}`;
}

/** Escape characters that are illegal inside a <loc> element. */
function escapeXml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

/** Static, evergreen URLs on the main host. Ordered by importance. */
const STATIC_URLS: ReadonlyArray<{ path: string; priority: string; changefreq: string }> = [
  { path: "/",              priority: "1.0", changefreq: "daily" },
  { path: "/categories",    priority: "0.8", changefreq: "weekly" },
  { path: "/post-a-job",    priority: "0.8", changefreq: "weekly" },
  { path: "/for-tradesmen", priority: "0.7", changefreq: "weekly" },
  { path: "/about",         priority: "0.4", changefreq: "monthly" },
  { path: "/contact",       priority: "0.4", changefreq: "monthly" },
  { path: "/faq",           priority: "0.4", changefreq: "monthly" },
  { path: "/terms",         priority: "0.2", changefreq: "yearly" },
  { path: "/privacy",       priority: "0.2", changefreq: "yearly" },
];

/** Priority for a hyperlocal route, derived from its tier. */
function priorityForTier(tier: "dense" | "sparse" | "empty"): string {
  if (tier === "dense") return "0.7";
  if (tier === "sparse") return "0.5";
  return "0.3";
}

/**
 * Build the full sitemap XML. Hits the DB and computes the manifest.
 * Exposed for testing; callers should normally go through the cached
 * Express handler below.
 */
export async function buildMainSitemap(origin: string): Promise<string> {
  const [areas, categories, tradesmen] = await Promise.all([
    storage.getAreas(),
    storage.getCategories(),
    storage.getTradesmen(),
  ]);

  // Build SupplyCounts: count tradesmen per (categoryId, areaId) pair.
  const supply: Record<string, number> = {};
  for (const t of tradesmen) {
    if (t.areaId == null) continue;
    const catIds = parseCategoriesJson(t.categories);
    for (const cid of catIds) {
      const key = supplyKey(cid, t.areaId);
      supply[key] = (supply[key] ?? 0) + 1;
    }
  }

  const routes = buildSeoRouteManifest(
    areas as ReadonlyArray<{ id: number; slug: string; name: string; region: string }>,
    categories as ReadonlyArray<{ id: number; slug: string; name: string }>,
    supply as SupplyCounts,
    { limit: MAX_HYPERLOCAL_ROUTES },
  );

  // Single-axis category and area pages — these already render via the
  // existing /category/:slug and /area/:slug routes and are independent
  // of the hyperlocal manifest.
  const categoryUrls = categories.map((c) => ({
    path: `/category/${c.slug}`,
    priority: "0.6",
    changefreq: "weekly",
  }));
  const areaUrls = areas.map((a) => ({
    path: `/area/${a.slug}`,
    priority: "0.6",
    changefreq: "weekly",
  }));

  const allEntries: Array<{ path: string; priority: string; changefreq: string }> = [
    ...STATIC_URLS,
    ...categoryUrls,
    ...areaUrls,
    ...routes.map((r) => ({
      path: r.path,
      priority: priorityForTier(r.tier),
      changefreq: "weekly" as const,
    })),
  ];

  const lines = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
  ];
  for (const entry of allEntries) {
    lines.push("  <url>");
    lines.push(`    <loc>${escapeXml(origin + entry.path)}</loc>`);
    lines.push(`    <changefreq>${entry.changefreq}</changefreq>`);
    lines.push(`    <priority>${entry.priority}</priority>`);
    lines.push("  </url>");
  }
  lines.push("</urlset>");
  return lines.join("\n");
}

/** robots.txt body. Permissive crawl, block private surfaces. */
export function buildMainRobots(origin: string): string {
  return [
    "User-agent: *",
    "Allow: /",
    "Disallow: /api/",
    "Disallow: /admin/",
    "Disallow: /dashboard",
    "Disallow: /checkout/",
    "Disallow: /sign-in",
    "",
    `Sitemap: ${origin}/sitemap.xml`,
    "",
  ].join("\n");
}

/**
 * Register the main-host sitemap.xml + robots.txt handlers.
 *
 * Mount BEFORE registerMicrositeRoutes so the main-host check runs
 * first. For mini-site hosts we call next() and the mini-site handlers
 * take over.
 */
export function registerMainSiteRoutes(app: Express): void {
  app.get("/robots.txt", (req: Request, res: Response, next: NextFunction) => {
    if (req.microsite) return next(); // mini-site host — defer
    res.type("text/plain").send(buildMainRobots(originOf(req)));
  });

  app.get("/sitemap.xml", async (req: Request, res: Response, next: NextFunction) => {
    if (req.microsite) return next(); // mini-site host — defer

    const origin = originOf(req);
    const cached = sitemapCache.get(origin);
    const now = Date.now();
    if (cached && cached.expiresAt > now) {
      res.type("application/xml").send(cached.xml);
      return;
    }

    try {
      const xml = await buildMainSitemap(origin);
      sitemapCache.set(origin, { xml, expiresAt: now + CACHE_TTL_MS });
      res.type("application/xml").send(xml);
    } catch (err) {
      console.error("[main-sitemap] build failed:", err);
      // Serve a minimal valid sitemap so Googlebot doesn't see a 500
      // and downgrade the host. Better to advertise just the homepage
      // than to fail entirely.
      const fallback = [
        '<?xml version="1.0" encoding="UTF-8"?>',
        '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
        "  <url>",
        `    <loc>${escapeXml(origin + "/")}</loc>`,
        "    <changefreq>daily</changefreq>",
        "    <priority>1.0</priority>",
        "  </url>",
        "</urlset>",
      ].join("\n");
      res.type("application/xml").send(fallback);
    }
  });
}
