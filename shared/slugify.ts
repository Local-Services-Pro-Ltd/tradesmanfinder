/**
 * URL-safe slug generator.
 *
 * Mirrors the invariant enforced by the Postgres CHECK constraint
 * `tradesmen_slug_url_safe_check` (see migrations/manual/2026-08-05-slug-audit-repair.sql):
 *
 *     slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$' AND length(slug) BETWEEN 3 AND 80
 *
 * Rules:
 *   * Lowercase everything (Companies House returns "SC704009" — we downcase).
 *   * "&" becomes "and" (SEO-friendly; matches historical behaviour).
 *   * Any run of non [a-z0-9] characters collapses to a single "-".
 *   * Leading/trailing "-" are stripped.
 *
 * NOTE: This function does NOT enforce the 3..80 length bound because
 * callers often append disambiguators (e.g. a Companies House number)
 * before persisting. Length is enforced by the DB CHECK at insert time.
 *
 * If the input cleans to an empty string, we return "" and let the caller
 * decide whether to use a fallback (e.g. "tradesman-" + Date.now()).
 */
export function slugify(input: string): string {
  return input
    .toLowerCase()
    .replace(/&/g, "and")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
}

/**
 * Predicate matching the DB-side CHECK constraint exactly.
 * Use for pre-insert validation in application code.
 */
export function isUrlSafeSlug(slug: string): boolean {
  return /^[a-z0-9]+(-[a-z0-9]+)*$/.test(slug) && slug.length >= 3 && slug.length <= 80;
}
