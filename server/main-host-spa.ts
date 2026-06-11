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
import {
  buildCrosslinks,
  type MainHostCrosslinks,
} from "../shared/main-host-crosslinks";
import {
  buildBodyCopy,
  type BodyCopyPayload,
} from "../shared/main-host-body-copy";
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
    `<meta name="robots" content="${escapeHtml(seo.robots)}">`,
    `<link rel="canonical" href="${escapeHtml(seo.canonical)}">`,
    `<meta property="og:title" content="${escapeHtml(seo.ogTitle)}">`,
    `<meta property="og:description" content="${escapeHtml(seo.ogDescription)}">`,
    `<meta property="og:url" content="${escapeHtml(seo.canonical)}">`,
    `<meta property="og:type" content="${escapeHtml(seo.ogType)}">`,
    `<meta property="og:site_name" content="TradesmanFinder">`,
    `<meta property="og:locale" content="${escapeHtml(seo.ogLocale)}">`,
    `<meta property="og:image" content="${escapeHtml(seo.ogImage)}">`,
    `<meta property="og:image:width" content="${seo.ogImageWidth}">`,
    `<meta property="og:image:height" content="${seo.ogImageHeight}">`,
    `<meta property="og:image:alt" content="${escapeHtml(seo.ogImageAlt)}">`,
    // Static fallback OG image (PR-#19-G). Crawlers walk this if the
    // dynamic render at /api/og is unhealthy, so social cards never break.
    `<meta property="og:image" content="${escapeHtml(seo.ogImageFallback)}">`,
    `<meta name="twitter:card" content="summary_large_image">`,
    `<meta name="twitter:title" content="${escapeHtml(seo.ogTitle)}">`,
    `<meta name="twitter:description" content="${escapeHtml(seo.ogDescription)}">`,
    `<meta name="twitter:image" content="${escapeHtml(seo.ogImage)}">`,
    `<meta name="twitter:image:alt" content="${escapeHtml(seo.ogImageAlt)}">`,
  ];

  // Geo meta — only when the payload has them. Treated as defensive
  // (only emit non-empty tags) so other consumers of buildMainHostSeo
  // (e.g. tests with no coords) don't ship empty content="" tags.
  if (seo.geoPosition) {
    lines.push(
      `<meta name="geo.position" content="${escapeHtml(seo.geoPosition)}">`,
    );
    lines.push(`<meta name="ICBM" content="${escapeHtml(seo.geoPosition.replace(";", ", "))}">`);
  }
  if (seo.geoPlacename) {
    lines.push(
      `<meta name="geo.placename" content="${escapeHtml(seo.geoPlacename)}">`,
    );
  }
  if (seo.geoRegion) {
    lines.push(
      `<meta name="geo.region" content="${escapeHtml(seo.geoRegion)}">`,
    );
  }

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

  // Strip default <title> / description / og:* / twitter:* / robots so
  // ours doesn't double up. (Vite's default index.html doesn't currently
  // ship twitter/robots tags, but stripping defensively means if someone
  // adds them later they don't fight ours.)
  let stripped = html.replace(/<title>[\s\S]*?<\/title>/i, "");
  stripped = stripped.replace(
    /<meta\s+name=["']description["'][^>]*>\s*/gi,
    "",
  );
  stripped = stripped.replace(
    /<meta\s+name=["']robots["'][^>]*>\s*/gi,
    "",
  );
  stripped = stripped.replace(
    /<meta\s+property=["']og:[^"']+["'][^>]*>\s*/gi,
    "",
  );
  stripped = stripped.replace(
    /<meta\s+name=["']twitter:[^"']+["'][^>]*>\s*/gi,
    "",
  );

  // Replace the <html lang="…"> attribute so the document advertises
  // the right locale (en-GB) for our UK-only content. If <html> has
  // no lang attribute we add one; if it has one we overwrite it.
  stripped = stripped.replace(
    /<html\b([^>]*)>/i,
    (_match, attrs) => {
      const cleaned = attrs.replace(/\s+lang="[^"]*"/i, "");
      return `<html lang="${seo.htmlLang}"${cleaned}>`;
    },
  );

  if (stripped.includes("</head>")) {
    return stripped.replace("</head>", `${block}\n</head>`);
  }

  // Fallback for malformed HTML — should never happen with a real Vite build.
  return `${block}\n${stripped}`;
}

/**
 * Inject the internal cross-link clusters (PR-#19-E) into the HTML.
 *
 * Rendered as a real <nav> block — visible by default, server-rendered
 * so crawlers see the anchors without executing JS. The React component
 * also renders the same links on hydration; CSS class
 * `data-server-crosslinks` is a sentinel React reads to suppress its
 * duplicate render (see hyperlocal.tsx). We use marker comments for
 * idempotency in dev hot-reload, the same pattern as injectMainHostSeo.
 *
 * Why a separate function from injectMainHostSeo: crosslinks belong in
 * <body>, not <head>. Splitting also keeps each function's responsibility
 * narrow and its unit tests focused.
 *
 * Exposed for direct unit testing.
 */
export function injectMainHostCrosslinks(
  html: string,
  crosslinks: MainHostCrosslinks,
): string {
  const marker = "<!-- main-host-crosslinks:start -->";
  const endMarker = "<!-- main-host-crosslinks:end -->";

  if (
    crosslinks.nearbyCities.length === 0 &&
    crosslinks.relatedTrades.length === 0
  ) {
    // Nothing to inject. If a previous injection exists (dev hot-reload),
    // strip it so the page doesn't keep stale links.
    if (html.includes(marker) && html.includes(endMarker)) {
      return html.replace(
        new RegExp(`${marker}[\\s\\S]*?${endMarker}\\s*`),
        "",
      );
    }
    return html;
  }

  const renderList = (
    items: MainHostCrosslinks["nearbyCities"],
    heading: string,
    ariaLabel: string,
  ): string => {
    if (items.length === 0) return "";
    const lis = items
      .map(
        (i) =>
          `<li><a href="${escapeHtml(i.href)}">${escapeHtml(i.label)}</a></li>`,
      )
      .join("");
    return `<nav aria-label="${escapeHtml(ariaLabel)}"><h2>${escapeHtml(heading)}</h2><ul>${lis}</ul></nav>`;
  };

  const nearbyHeading =
    crosslinks.nearbyCities[0]?.label.split(" in ")[0] + " in nearby cities";
  const relatedHeading =
    "Related trades in " +
    (crosslinks.relatedTrades[0]?.label.split(" in ")[1] ?? "");

  const inner = [
    renderList(crosslinks.nearbyCities, nearbyHeading, "Nearby cities"),
    renderList(crosslinks.relatedTrades, relatedHeading, "Related trades"),
  ].join("");

  const block = `${marker}<div data-server-crosslinks="true" hidden>${inner}</div>${endMarker}`;

  // Idempotent re-injection.
  if (html.includes(marker) && html.includes(endMarker)) {
    return html.replace(
      new RegExp(`${marker}[\\s\\S]*?${endMarker}`),
      block,
    );
  }

  if (html.includes("</body>")) {
    return html.replace("</body>", `${block}\n</body>`);
  }
  // Fallback — append. The links still get crawled.
  return `${html}\n${block}`;
}

/**
 * Inject the unique 80–150 word body copy (PR-#19-H) into the HTML.
 *
 * Rendered as a real <section> with the same `hidden` server-render
 * pattern as cross-links: crawler-visible on first paint, then the
 * React app owns the user-visible rendering on hydration. Without this,
 * the page body before React mounts is ~343 chars of cross-link anchors
 * — below Google's content-depth threshold and a doorway-page risk
 * across the 400-route surface.
 *
 * Placement: inside <body>, just before </body>, same as cross-links.
 * Order between the two body injections doesn't matter for crawlers
 * (both end up in the DOM before </body>).
 *
 * Exposed for direct unit testing.
 */
export function injectMainHostBodyCopy(
  html: string,
  body: BodyCopyPayload,
): string {
  const marker = "<!-- main-host-body:start -->";
  const endMarker = "<!-- main-host-body:end -->";

  if (body.paragraphs.length === 0) {
    if (html.includes(marker) && html.includes(endMarker)) {
      return html.replace(
        new RegExp(`${marker}[\\s\\S]*?${endMarker}\\s*`),
        "",
      );
    }
    return html;
  }

  const paras = body.paragraphs
    .map((p) => `<p>${escapeHtml(p)}</p>`)
    .join("");
  const block = `${marker}<section data-server-body="true" hidden>${paras}</section>${endMarker}`;

  // Idempotent re-injection (dev hot-reload).
  if (html.includes(marker) && html.includes(endMarker)) {
    return html.replace(
      new RegExp(`${marker}[\\s\\S]*?${endMarker}`),
      block,
    );
  }

  if (html.includes("</body>")) {
    return html.replace("</body>", `${block}\n</body>`);
  }
  return `${html}\n${block}`;
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
    // Carry lat/lng on `area` so the cross-link builder below can compute
    // Haversine distance to other areas. Without these fields every
    // distance is NaN and `pickNearbyAreas` falls back to insertion
    // order — which silently produced the wrong 'nearby cities' before
    // this fix. Keep this in sync with shared/main-host-crosslinks.ts:CrosslinkArea.
    let area:
      | {
          id: number;
          slug: string;
          name: string;
          region: string;
          latitude: number;
          longitude: number;
        }
      | null = null;
    let supplyCount = 0;
    try {
      const [cat, ar] = await Promise.all([
        storage.getCategoryBySlug(parsed.catSlug),
        storage.getAreaBySlug(parsed.areaSlug),
      ]);
      if (!cat || !ar) return next();
      category = { id: cat.id, slug: cat.slug, name: cat.name };
      area = {
        id: ar.id,
        slug: ar.slug,
        name: ar.name,
        region: ar.region,
        latitude: ar.latitude,
        longitude: ar.longitude,
      };
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

    // Cross-link data — same builder the React page uses on hydration so
    // SSR HTML and client render produce the same anchors. Best-effort:
    // if the lookup fails we still ship the SEO-injected HTML.
    let crosslinks: MainHostCrosslinks = {
      nearbyCities: [],
      relatedTrades: [],
    };
    try {
      const [allCats, allAreas] = await Promise.all([
        storage.getCategories(),
        storage.getAreas(),
      ]);
      crosslinks = buildCrosslinks({
        category: { id: category.id, slug: category.slug, name: category.name, parentId: (allCats.find(c => c.id === category.id)?.parentId) ?? null },
        area,
        allCategories: allCats.map((c) => ({ id: c.id, slug: c.slug, name: c.name, parentId: c.parentId })),
        allAreas: allAreas.map((a) => ({
          id: a.id,
          slug: a.slug,
          name: a.name,
          region: a.region,
          latitude: a.latitude,
          longitude: a.longitude,
        })),
      });
    } catch (e) {
      console.warn("[main-host-spa] crosslinks lookup failed:", e);
    }

    const origin = originOf(req);
    const seo = buildMainHostSeo({ category, area, origin, supplyCount });
    const bodyCopy = buildBodyCopy({
      category: { slug: category.slug, name: category.name },
      area: { slug: area.slug, name: area.name, region: area.region },
      supplyCount,
    });
    let injected = injectMainHostSeo(html, seo);
    injected = injectMainHostCrosslinks(injected, crosslinks);
    injected = injectMainHostBodyCopy(injected, bodyCopy);
    res.type("text/html").send(injected);
  });
}
