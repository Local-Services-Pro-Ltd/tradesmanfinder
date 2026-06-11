/**
 * SEO landing-page route manifest generator (PR-#19-A).
 *
 * Produces a deduplicated, scored list of `/{category-slug}-in-{area-slug}`
 * routes used by:
 *  - The sitemap generator (PR-#19-C)
 *  - The landing-page template (PR-#19-B)
 *  - Internal cross-links (PR-#19-E)
 *
 * Pure functions, no DB access. Callers pass arrays of areas + categories +
 * supply counts (typically loaded from the DB once at request/build time)
 * and receive a sorted manifest.
 *
 * Design decisions:
 *
 *  1. Demand-anchored, not supply-anchored.
 *     We keep routes for (cat × area) pairs with ZERO supply because thin
 *     content can be solved with a "be the first" supply-side CTA + nearby
 *     alternatives. Pruning empty routes would shrink the page surface
 *     prematurely. Tier ('dense' | 'sparse' | 'empty') drives the template
 *     branch in PR-#19-B.
 *
 *  2. Supply tier > population for ranking.
 *     A route with 3 plumbers in a small town outranks a route with 0
 *     plumbers in a big city because the small-town page converts and the
 *     big-city page doesn't. Population is a tie-breaker, not a primary
 *     signal.
 *
 *  3. Route limit is configurable but defaults to 400.
 *     Matches the original PR-#19 target. Callers can request more for the
 *     sitemap and fewer for the prerender batch.
 *
 *  4. Deterministic ordering.
 *     Same inputs → same output, every time. No Date.now() or Math.random()
 *     in the scorer. Important for sitemap stability (Google penalises
 *     churn in sitemap.xml).
 */

import { SEO_CITY_POPULATION, DEFAULT_LONDON_AREA_POPULATION } from "./seo-cities";
import { buildFlatHyperlocalPath } from "./hyperlocal-slug";

/** Minimal area shape the scorer needs. Compatible with `areas` table. */
export interface SeoArea {
  slug: string;
  name: string;
  region: string;
}

/** Minimal category shape the scorer needs. Compatible with `categories` table. */
export interface SeoCategory {
  id: number;
  slug: string;
  name: string;
}

/**
 * (Category × Area) → integer count. Caller computes this by parsing the
 * `tradesmen.categories` JSON arrays and grouping by area_id. Empty pairs
 * are simply absent (the manifest treats absence as 0).
 */
export type SupplyCounts = Readonly<Record<string, number>>;

export type RouteTier = "dense" | "sparse" | "empty";

export interface SeoRoute {
  /** URL path: `/{category.slug}-in-{area.slug}`. Always lowercase, hyphen-joined. */
  path: string;
  categorySlug: string;
  categoryName: string;
  areaSlug: string;
  areaName: string;
  areaRegion: string;
  /** Number of tradespeople in this category serving this area. */
  supplyCount: number;
  /**
   * 'dense'   → 3+ tradespeople. Standard listing page.
   * 'sparse'  → 1-2 tradespeople. Listing page + "see nearby" inline CTA.
   * 'empty'   → 0. Supply-side recruit CTA + nearby alternatives.
   */
  tier: RouteTier;
  /** Population of the area (for tie-breaks and copy hints). */
  population: number;
  /** Computed sort score. Higher = better. Exposed for debugging. */
  score: number;
}

/** Build the canonical supply-counts key. Exported so callers stay consistent. */
export function supplyKey(categoryId: number, areaId: number): string {
  return `${categoryId}:${areaId}`;
}

/**
 * Compute a deterministic score for a (cat × area) route.
 *
 * Tier weights are intentionally far apart so a single tradesperson in the
 * area is worth more than any population difference. Within a tier, log
 * population narrows the gap between megacities and towns (a city with 10x
 * the population of another only gets ~2.3x the population bonus, which
 * mirrors how organic CTR scales).
 *
 * Exposed for unit tests and debugging.
 */
export function scoreRoute(supplyCount: number, population: number): number {
  const tierWeight =
    supplyCount >= 3 ? 1_000_000 : supplyCount >= 1 ? 100_000 : 0;
  const supplyBonus = supplyCount * 10_000;
  // log1p so population=0 doesn't crash and small towns aren't crushed.
  const populationBonus = Math.log1p(Math.max(0, population)) * 100;
  return tierWeight + supplyBonus + populationBonus;
}

/**
 * Look up population for an area. SEO cities have explicit values;
 * London neighborhoods (everything else in the table) get a neutral
 * default so they don't dominate or get punished.
 */
export function populationForArea(areaSlug: string): number {
  return SEO_CITY_POPULATION[areaSlug] ?? DEFAULT_LONDON_AREA_POPULATION;
}

function tierFor(supplyCount: number): RouteTier {
  if (supplyCount >= 3) return "dense";
  if (supplyCount >= 1) return "sparse";
  return "empty";
}

export interface BuildManifestOptions {
  /** Max routes to return. Default 400 (matches PR-#19 target). */
  limit?: number;
  /**
   * If true, omit empty-supply routes entirely. Useful for the sitemap
   * draft when you want to launch with zero thin-content risk and add
   * empty pages later. Default false — we keep them and template-branch.
   */
  excludeEmpty?: boolean;
}

/**
 * Build the route manifest from raw inputs. Caller supplies areas,
 * categories, and supply counts; we do the cross-product, score, sort,
 * and cap.
 *
 * Output is sorted by score DESC, with deterministic tie-breaking on
 * (categorySlug, areaSlug) so the same inputs always produce the same
 * order — critical for sitemap stability.
 */
export function buildSeoRouteManifest(
  areas: ReadonlyArray<SeoArea & { id: number }>,
  categories: ReadonlyArray<SeoCategory>,
  supplyCounts: SupplyCounts,
  options: BuildManifestOptions = {},
): SeoRoute[] {
  const { limit = 400, excludeEmpty = false } = options;
  const routes: SeoRoute[] = [];

  for (const category of categories) {
    for (const area of areas) {
      const supplyCount = supplyCounts[supplyKey(category.id, area.id)] ?? 0;
      if (excludeEmpty && supplyCount === 0) continue;

      const population = populationForArea(area.slug);
      routes.push({
        path: buildFlatHyperlocalPath(category.slug, area.slug),
        categorySlug: category.slug,
        categoryName: category.name,
        areaSlug: area.slug,
        areaName: area.name,
        areaRegion: area.region,
        supplyCount,
        tier: tierFor(supplyCount),
        population,
        score: scoreRoute(supplyCount, population),
      });
    }
  }

  // Sort by score DESC; deterministic tie-break by (categorySlug, areaSlug).
  routes.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    if (a.categorySlug !== b.categorySlug) {
      return a.categorySlug < b.categorySlug ? -1 : 1;
    }
    return a.areaSlug < b.areaSlug ? -1 : 1;
  });

  return routes.slice(0, limit);
}

/**
 * Group routes by tier — useful for the build script's summary log and for
 * monitoring (e.g. "alert if dense_route_ratio drops below 30%").
 */
export function tierStats(routes: ReadonlyArray<SeoRoute>): Record<RouteTier, number> {
  const stats: Record<RouteTier, number> = { dense: 0, sparse: 0, empty: 0 };
  for (const r of routes) stats[r.tier] += 1;
  return stats;
}

/**
 * Parse the `tradesmen.categories` text column (JSON array of integer IDs)
 * into a clean number[]. Tolerates malformed/null rows by returning [].
 * Centralised here so the DB query layer doesn't reimplement it per call site.
 */
export function parseCategoriesJson(raw: string | null | undefined): number[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((x): x is number => typeof x === "number" && Number.isInteger(x));
  } catch {
    return [];
  }
}
