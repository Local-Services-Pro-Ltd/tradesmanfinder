/**
 * Parser for the canonical SEO landing-page URL segment
 * `/{categorySlug}-in-{areaSlug}` (PR-#19-B).
 *
 * Why this lives in `shared/` and not in the page component:
 *  - The router gate, the page component, and the manifest generator
 *    all need to agree on what counts as a valid hyperlocal slug.
 *    Putting the parser here gives a single source of truth.
 *  - Tests stay pure: importing this file pulls in no React, no wouter,
 *    no DOM. The unit suite can run server-side.
 *  - PR-#19-C (sitemap) and PR-#19-E (internal links) will reuse the
 *    inverse operation (build path from slugs) without coupling to the
 *    React tree.
 *
 * Split policy: we split on the LAST `-in-` so multi-hyphen area slugs
 * like `newcastle-upon-tyne` survive. Compound category slugs that
 * themselves contain `-in-` would be misparsed — at the time of writing
 * none of the 20 categories does, and the parser asserts this invariant
 * via tests.
 */

export interface HyperlocalSlugParts {
  catSlug?: string;
  areaSlug?: string;
}

/**
 * Parse the path segment (without the leading `/`) into category + area
 * slugs. Returns `{}` when the segment does not match the canonical
 * shape — callers should treat that as a non-match and fall through to
 * other routes / 404.
 */
export function parseFlatHyperlocalSlug(
  segment: string | undefined,
): HyperlocalSlugParts {
  if (!segment) return {};
  const idx = segment.lastIndexOf("-in-");
  if (idx <= 0 || idx + 4 >= segment.length) return {};
  return {
    catSlug: segment.slice(0, idx),
    areaSlug: segment.slice(idx + 4),
  };
}

/**
 * Build the canonical path for a (category, area) slug pair.
 * Symmetric with `parseFlatHyperlocalSlug` — round-trip safe for any
 * slug pair the parser would accept.
 */
export function buildFlatHyperlocalPath(catSlug: string, areaSlug: string): string {
  return `/${catSlug}-in-${areaSlug}`;
}
