/**
 * Server-side SEO injection for mini-site SPA responses.
 *
 * The TradesmanFinder client is a hash-routed SPA: the server serves the
 * same index.html for every page path, and the client reads
 * `location.hash` to decide what to render. That makes the SPA fine for
 * users but invisible to Googlebot when the URL differs by hostname only.
 *
 * This module rewrites the SPA's <head> before sending so each mini-site
 * host advertises its own <title>, meta description, canonical, and
 * JSON-LD LocalBusiness payload. We also embed `window.__MICROSITE__` so
 * the client renderer can branch on the resolved entry without re-doing
 * the host lookup in the browser.
 *
 * Why server-side: Googlebot does render JS, but server-injected tags
 * remove the rendering risk and dominate Bing / smaller crawlers. The
 * payload is tiny (a few hundred bytes) and adds no runtime cost.
 */

import type { Microsite } from '../shared/microsites';

/** Inputs needed to build the SEO payload — kept narrow so tests stay simple. */
export type MicrositeSeoInput = {
  microsite: Microsite;
  /** DB area row (we look up region + display name from it). Optional for non-geo sites. */
  area?: { name: string; region: string } | null;
  /** DB category row, used for the trade display name. Optional for generic-directory sites. */
  category?: { name: string } | null;
  /** Public origin for the current host (e.g. https://blackheathbuilders.co.uk). */
  origin: string;
};

/** Result of building the SEO payload. */
export type MicrositeSeoPayload = {
  title: string;
  description: string;
  canonical: string;
  jsonLd: Record<string, unknown>;
};

/**
 * Build the title/description/canonical/JSON-LD for a given microsite +
 * resolved DB rows. Pure function — no I/O — so it's trivially testable
 * and safe to call on every render.
 */
export function buildMicrositeSeo(input: MicrositeSeoInput): MicrositeSeoPayload {
  const { microsite, area, category, origin } = input;
  const tradeName = category?.name ?? 'Tradesmen';
  const tradeLower = tradeName.toLowerCase();
  const areaName = area?.name;
  const region = area?.region;

  let title: string;
  let description: string;

  switch (microsite.kind) {
    case 'geo-trade':
      title = areaName
        ? `${tradeName}s in ${areaName} — Reviews & Free Quotes`
        : `${tradeName}s — Local UK directory`;
      description = areaName
        ? `Find trusted ${tradeLower}s in ${areaName}${region ? ` (${region})` : ''}. Compare verified local tradesmen, read genuine reviews and get free quotes — usually within hours.`
        : `Find trusted ${tradeLower}s near you. Compare verified UK tradesmen, read reviews and post a job for free.`;
      break;
    case 'generic-directory':
      title = microsite.trade
        ? `Find a local ${tradeLower} — UK directory of verified ${tradeLower}s`
        : 'Find a local tradesman — UK directory';
      description = microsite.trade
        ? `Search the UK's directory of verified ${tradeLower}s. Compare reviews, see prices, get free no-obligation quotes from trusted ${tradeLower}s in your area.`
        : `Search the UK's directory of verified local tradesmen. Compare reviews, see prices, get free no-obligation quotes for any home job.`;
      break;
    case 'vertical':
      title = microsite.title ?? 'Specialist UK tradesmen directory';
      description = microsite.title
        ? `${microsite.title}. Compare verified specialists, read reviews and get free quotes.`
        : 'Find vetted specialist tradesmen for niche home projects.';
      break;
    case 'redirect':
      // Redirect hosts never render — but we still produce a payload so
      // the function is total and tests don't have to special-case it.
      title = 'TradesmanFinder — find a trusted local tradesman';
      description = 'Find verified local tradesmen across the UK.';
      break;
  }

  const canonical = microsite.canonical
    ? `https://${microsite.canonical}/`
    : `${origin}/`;

  const jsonLd: Record<string, unknown> =
    microsite.kind === 'geo-trade' && areaName
      ? {
          '@context': 'https://schema.org',
          '@type': 'LocalBusiness',
          name: `${tradeName}s in ${areaName}`,
          description,
          url: canonical,
          areaServed: { '@type': 'Place', name: areaName, ...(region ? { containedInPlace: region } : {}) },
          knowsAbout: tradeName,
        }
      : {
          '@context': 'https://schema.org',
          '@type': 'WebSite',
          name: title,
          url: canonical,
          description,
        };

  return { title, description, canonical, jsonLd };
}

/** Escape a string for safe use as HTML text or attribute. Minimal — we only emit our own controlled strings. */
function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] as string),
  );
}

/**
 * Inject the SEO payload into a raw index.html string.
 * Rewrites <title>, adds <meta name="description">, <link rel="canonical">,
 * a <script type="application/ld+json"> block, and a <script>
 * window.__MICROSITE__ = ... bootstrap so the client can render the right
 * mini-site copy without re-resolving the host.
 *
 * Idempotent: if the markers are already present (cache hit, double-render
 * during dev), the existing block is replaced rather than duplicated.
 */
export function injectMicrositeSeo(
  html: string,
  microsite: Microsite,
  seo: MicrositeSeoPayload,
): string {
  const marker = '<!-- microsite-seo:start -->';
  const endMarker = '<!-- microsite-seo:end -->';

  const block = [
    marker,
    `<title>${escapeHtml(seo.title)}</title>`,
    `<meta name="description" content="${escapeHtml(seo.description)}">`,
    `<link rel="canonical" href="${escapeHtml(seo.canonical)}">`,
    `<meta property="og:title" content="${escapeHtml(seo.title)}">`,
    `<meta property="og:description" content="${escapeHtml(seo.description)}">`,
    `<meta property="og:url" content="${escapeHtml(seo.canonical)}">`,
    `<meta property="og:type" content="website">`,
    `<script type="application/ld+json">${JSON.stringify(seo.jsonLd)}</script>`,
    `<script>window.__MICROSITE__=${JSON.stringify(microsite)};</script>`,
    endMarker,
  ].join('\n');

  // If we already injected (idempotency for hot-reload), replace the block.
  if (html.includes(marker) && html.includes(endMarker)) {
    return html.replace(
      new RegExp(`${marker}[\\s\\S]*?${endMarker}`),
      block,
    );
  }

  // Strip any pre-existing <title> so we don't end up with two.
  const stripped = html.replace(/<title>[\s\S]*?<\/title>/i, '');

  // Inject just before </head>.
  if (stripped.includes('</head>')) {
    return stripped.replace('</head>', `${block}\n</head>`);
  }

  // Fallback: prepend (shouldn't happen for a real Vite build, but safe).
  return `${block}\n${stripped}`;
}
