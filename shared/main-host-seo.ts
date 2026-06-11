/**
 * Pure SEO payload builder for main-host `/{cat}-in-{area}` landing pages.
 *
 * Sibling to `server/microsite-seo.ts` but for the MAIN host
 * (tradesmanfinder.com). Server-rendered <head> means Googlebot,
 * Bing and every smaller crawler see the right title/description/
 * canonical/JSON-LD without waiting for client JS — important
 * because the SPA is hash-routed (`/path` is rewritten to `/#/path`
 * by a client bouncer), so the un-injected index.html has only
 * generic homepage tags.
 *
 * This file is intentionally pure: no DB, no Express, no DOM. The
 * caller resolves the DB rows and passes them in. Tests can cover
 * the entire surface without a database fixture.
 *
 * Lives in `shared/` so the manifest generator (PR-#19-A), the
 * sitemap (PR-#19-C) and any future client component can reuse
 * the title/description/canonical formatters without dragging in
 * the Express dependency tree.
 */

/** Inputs needed to build the payload. */
export type MainHostSeoInput = {
  /** Resolved DB row for the category — must include id, slug, name. */
  category: { id: number; slug: string; name: string };
  /** Resolved DB row for the area — must include id, slug, name, region. */
  area: { id: number; slug: string; name: string; region: string };
  /** Public origin for the request (e.g. https://tradesmanfinder.com). */
  origin: string;
  /**
   * Count of tradesmen serving this (category, area) pair. Drives the
   * count badge in the title and the LocalBusiness.aggregateRating
   * placeholder. Pass 0 for empty cells — the payload still renders.
   */
  supplyCount: number;
};

/** Result of building the payload. */
export type MainHostSeoPayload = {
  title: string;
  description: string;
  /** Canonical URL — always the flat `/{cat}-in-{area}` form on the main host. */
  canonical: string;
  /** OpenGraph + Twitter card values. */
  ogTitle: string;
  ogDescription: string;
  ogType: "website";
  /**
   * Array of JSON-LD payloads. We emit multiple separate <script> blocks
   * (one per @type) rather than a single @graph because Google's
   * Rich Results validator handles separate blocks more reliably and
   * the docs explicitly recommend it.
   */
  jsonLd: ReadonlyArray<Record<string, unknown>>;
};

/**
 * Build the SEO payload for a hyperlocal landing page.
 *
 * The title is intentionally branded ("| TradesmanFinder") because
 * Google's SERP often appends the site name anyway; explicit branding
 * means we control the truncation point.
 */
export function buildMainHostSeo(input: MainHostSeoInput): MainHostSeoPayload {
  const { category, area, origin, supplyCount } = input;
  const tradeName = category.name;
  const tradeLower = tradeName.toLowerCase();
  const areaName = area.name;
  const region = area.region;

  // Title formula tuned for ~60 char SERP truncation. The count is a
  // signal to homeowners that there *are* tradesmen available; for empty
  // cells we drop it rather than printing "0".
  const title =
    supplyCount > 0
      ? `${tradeName}s in ${areaName} — ${supplyCount} Verified Local Pros | TradesmanFinder`
      : `${tradeName}s in ${areaName} — Reviews & Free Quotes | TradesmanFinder`;

  // Description aims for ~155 chars and weaves in the region for
  // geographic disambiguation (e.g. multiple "Newcastle"s).
  const description =
    supplyCount > 0
      ? `Find ${supplyCount} verified ${tradeLower}s in ${areaName} (${region}). Compare reviews, see prices and get up to 3 free quotes — usually within hours. Post a job free.`
      : `Looking for a trusted ${tradeLower} in ${areaName} (${region})? Post a job free on TradesmanFinder and get quotes from verified local ${tradeLower}s — no signup needed.`;

  const canonical = `${origin}/${category.slug}-in-${area.slug}`;

  // LocalBusiness: the headline schema for local-intent queries.
  // We use the directory-page form (one schema for the whole page),
  // not per-tradesman, because the page IS the directory. Per-tradesman
  // schemas live on the individual tradesman profile pages.
  const localBusiness: Record<string, unknown> = {
    "@context": "https://schema.org",
    "@type": "LocalBusiness",
    name: `${tradeName}s in ${areaName}`,
    description,
    url: canonical,
    areaServed: {
      "@type": "Place",
      name: areaName,
      ...(region ? { containedInPlace: region } : {}),
    },
    knowsAbout: tradeName,
    // Aggregator-of-services: we run the directory, the individual
    // pros do the work. This stops Google flagging us as the provider.
    "@id": `${canonical}#directory`,
  };

  // Service: tells Google what the page is *about* in addition to who
  // serves it. Pairs naturally with LocalBusiness.
  const service: Record<string, unknown> = {
    "@context": "https://schema.org",
    "@type": "Service",
    serviceType: tradeName,
    provider: { "@type": "Organization", name: "TradesmanFinder" },
    areaServed: {
      "@type": "Place",
      name: areaName,
      ...(region ? { containedInPlace: region } : {}),
    },
    url: canonical,
  };

  // BreadcrumbList: mirrors the on-page breadcrumb (Home → Category → Area).
  // Position numbering is 1-indexed per schema.org spec.
  const breadcrumb: Record<string, unknown> = {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: [
      {
        "@type": "ListItem",
        position: 1,
        name: "Home",
        item: `${origin}/`,
      },
      {
        "@type": "ListItem",
        position: 2,
        name: `${tradeName}s`,
        item: `${origin}/category/${category.slug}`,
      },
      {
        "@type": "ListItem",
        position: 3,
        name: areaName,
        item: `${origin}/area/${area.slug}`,
      },
      {
        "@type": "ListItem",
        position: 4,
        name: `${tradeName}s in ${areaName}`,
        item: canonical,
      },
    ],
  };

  return {
    title,
    description,
    canonical,
    ogTitle: title,
    ogDescription: description,
    ogType: "website",
    jsonLd: [localBusiness, service, breadcrumb],
  };
}
