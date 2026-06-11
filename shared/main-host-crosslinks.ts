/**
 * Pure builder for the internal cross-link blocks rendered on the
 * canonical SEO landing page `/{cat}-in-{area}` (PR-#19-E).
 *
 * Two link clusters:
 *   1. Nearby cities — same trade in the N closest areas by Haversine
 *      distance, excluding the current area. Drives crawl depth across
 *      the area dimension and gives users a quick "what about the next
 *      town over?" jump.
 *   2. Related trades — sibling categories (same parentId) in the same
 *      area, excluding the current trade. When the current category is
 *      itself top-level with no siblings, falls back to other top-level
 *      categories (sorted by id for determinism) so the block is never
 *      empty for a real (category, area) pair.
 *
 * Determinism: all ordering is deterministic given the same inputs so
 * the SSR HTML matches the client render and Googlebot sees stable URLs
 * across crawls. Distance ties (rare with 6-decimal lat/lng) break by
 * area id ascending.
 *
 * Why this lives in `shared/`:
 *  - The React page component renders these as visible <a> blocks.
 *  - The server-side SPA injector (server/main-host-spa.ts) emits the
 *    same anchor list into the SSR HTML inside a marker-bracketed
 *    <nav data-crosslinks> block, so crawlers see the links even
 *    without executing JS.
 *  - Both call sites must agree on selection logic; one source of truth.
 *
 * No React, no DOM imports — keeps the test suite pure.
 */

import { haversineMiles } from "./geo";
import { buildFlatHyperlocalPath } from "./hyperlocal-slug";

export interface CrosslinkArea {
  id: number;
  slug: string;
  name: string;
  region: string;
  latitude: number;
  longitude: number;
}

export interface CrosslinkCategory {
  id: number;
  slug: string;
  name: string;
  parentId?: number | null;
}

export interface CrosslinkItem {
  /** Anchor text — what the user sees and what Google reads. */
  label: string;
  /** Canonical href — always `/{cat}-in-{area}`. */
  href: string;
  /** Slug of the *other* dimension (area for nearby, category for related). */
  slug: string;
}

export interface MainHostCrosslinks {
  nearbyCities: CrosslinkItem[];
  relatedTrades: CrosslinkItem[];
}

export interface BuildCrosslinksInput {
  category: CrosslinkCategory;
  area: CrosslinkArea;
  allCategories: ReadonlyArray<CrosslinkCategory>;
  allAreas: ReadonlyArray<CrosslinkArea>;
  /** Max items per cluster. Default 6 — enough for 2x3 grid, not so many
   *  that crawlers see the page as a link farm. */
  limit?: number;
}

const DEFAULT_LIMIT = 6;

/**
 * Pick the N geographically-closest areas to the given area, excluding
 * the area itself. Stable: ties on distance break by area.id ascending.
 *
 * Exported for direct unit testing — `buildCrosslinks` wraps it.
 */
export function pickNearbyAreas(
  area: CrosslinkArea,
  allAreas: ReadonlyArray<CrosslinkArea>,
  limit: number = DEFAULT_LIMIT,
): CrosslinkArea[] {
  if (limit <= 0) return [];

  // Defensive: if the input area or any candidate is missing finite
  // lat/lng, fail closed rather than silently sort by insertion order.
  // We learned this the hard way — a caller dropped lat/lng from the
  // narrowed `area` type and we shipped "nearby cities" that were
  // 170mi away.
  const validCoord = (n: number | null | undefined): n is number =>
    typeof n === "number" && Number.isFinite(n);
  if (!validCoord(area.latitude) || !validCoord(area.longitude)) return [];

  const scored = allAreas
    .filter((a) => a.id !== area.id)
    .filter((a) => validCoord(a.latitude) && validCoord(a.longitude))
    .map((a) => ({
      area: a,
      dist: haversineMiles(area.latitude, area.longitude, a.latitude, a.longitude),
    }));
  scored.sort((x, y) => {
    if (x.dist !== y.dist) return x.dist - y.dist;
    return x.area.id - y.area.id;
  });
  return scored.slice(0, limit).map((s) => s.area);
}

/**
 * Pick up to N related categories — siblings (same parentId) first, then
 * other top-level categories as a backfill. Excludes the input category.
 * Order is deterministic by category.id ascending within each tier.
 *
 * Exported for direct unit testing.
 */
export function pickRelatedCategories(
  category: CrosslinkCategory,
  allCategories: ReadonlyArray<CrosslinkCategory>,
  limit: number = DEFAULT_LIMIT,
): CrosslinkCategory[] {
  if (limit <= 0) return [];

  const others = allCategories.filter((c) => c.id !== category.id);

  // Tier 1: siblings — same parentId (including both being null/undefined,
  // which means "both top-level"). When the current category is top-level,
  // every other top-level category qualifies as a "sibling".
  const parentKey = (c: CrosslinkCategory) =>
    c.parentId == null ? "__root__" : String(c.parentId);
  const myKey = parentKey(category);
  const siblings = others
    .filter((c) => parentKey(c) === myKey)
    .sort((a, b) => a.id - b.id);

  if (siblings.length >= limit) return siblings.slice(0, limit);

  // Tier 2: backfill from remaining categories, again by id ascending.
  const siblingIds = new Set(siblings.map((c) => c.id));
  const backfill = others
    .filter((c) => !siblingIds.has(c.id))
    .sort((a, b) => a.id - b.id);

  return [...siblings, ...backfill].slice(0, limit);
}

/**
 * Build both cross-link clusters for a `/{cat}-in-{area}` page. Returns
 * empty arrays (never throws) when the inputs are degenerate (e.g. the
 * category list contains only the current category).
 */
export function buildCrosslinks(input: BuildCrosslinksInput): MainHostCrosslinks {
  const { category, area, allCategories, allAreas } = input;
  const limit = input.limit ?? DEFAULT_LIMIT;

  const nearby = pickNearbyAreas(area, allAreas, limit);
  const related = pickRelatedCategories(category, allCategories, limit);

  const nearbyCities: CrosslinkItem[] = nearby.map((a) => ({
    label: `${category.name}s in ${a.name}`,
    href: buildFlatHyperlocalPath(category.slug, a.slug),
    slug: a.slug,
  }));

  const relatedTrades: CrosslinkItem[] = related.map((c) => ({
    label: `${c.name}s in ${area.name}`,
    href: buildFlatHyperlocalPath(c.slug, area.slug),
    slug: c.slug,
  }));

  return { nearbyCities, relatedTrades };
}
