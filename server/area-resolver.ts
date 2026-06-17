/**
 * Free-text area resolution for the searchable area picker.
 *
 * The classic dropdown is restrictive: a homeowner who types "Streatham"
 * or "SE13 6AA" gets nothing if those strings aren't in our seeded
 * `areas` table. This module accepts arbitrary input and either:
 *
 *   - returns a list of matching seeded areas, ranked by quality, OR
 *   - returns nothing, telling the caller "this is unmatched — route to
 *     the waitlist with `requestedArea` set to the original input".
 *
 * Matching rules, in order of precedence:
 *   1. Exact slug match    — `lewisham` → Lewisham
 *   2. Exact name match    — `Lewisham` → Lewisham
 *   3. Outward postcode in `region` — `SE13` matches "London SE13"
 *      (also `SE13 6AA` → outward `SE13` → "London SE13")
 *   4. Substring on name   — `lewis` → Lewisham
 *   5. Substring on region — `nw1` → "London NW1" → Camden
 *
 * Returns at most `limit` results. Empty array means "unmatched".
 *
 * Pure module — no DB access. Caller passes in the area list (typically
 * the same payload the dropdown receives), so we don't add a second query.
 */
export interface ResolvableArea {
  id: number;
  slug: string;
  name: string;
  region: string;
}

export interface ResolverMatch {
  area: ResolvableArea;
  /** Higher = better. Used for ranking ties (e.g. multiple substring hits). */
  score: number;
  /** Which rule fired — useful for debugging + the client surfacing "matched on postcode" hints. */
  rule:
    | "exact_slug"
    | "exact_name"
    | "outward_postcode"
    | "substring_name"
    | "substring_region";
}

/**
 * Extract a UK outward postcode from a free-text input. Returns null if
 * the input doesn't contain a postcode-shaped token.
 *
 * Outward = the first half of a postcode (e.g. SE13, NW1, E1, EC1A).
 * Accepts:
 *   - bare outward:  "SE13", "nw1", "e1"
 *   - full postcode: "SE13 6AA", "se136aa"
 *   - embedded in a longer string: "near SE13 please"
 */
export function extractOutwardPostcode(raw: string): string | null {
  const m = raw.toUpperCase().match(/\b([A-Z]{1,2}\d[A-Z\d]?)(?:\s*\d[A-Z]{2})?\b/);
  return m ? m[1] : null;
}

/**
 * Resolve a query string against a list of seeded areas.
 * `limit` defaults to 5 — more than that is information overload in a dropdown.
 */
export function resolveAreas(
  query: string,
  areas: ResolvableArea[],
  limit = 5,
): ResolverMatch[] {
  const q = query.trim().toLowerCase();
  if (q.length < 2) return [];

  const matches = new Map<number, ResolverMatch>();
  const consider = (area: ResolvableArea, score: number, rule: ResolverMatch["rule"]) => {
    const prev = matches.get(area.id);
    if (!prev || score > prev.score) {
      matches.set(area.id, { area, score, rule });
    }
  };

  for (const a of areas) {
    const slug = a.slug.toLowerCase();
    const name = a.name.toLowerCase();
    const region = a.region.toLowerCase();

    if (slug === q) consider(a, 100, "exact_slug");
    else if (name === q) consider(a, 95, "exact_name");
    else if (name.startsWith(q)) consider(a, 70, "substring_name");
    else if (name.includes(q)) consider(a, 60, "substring_name");
    else if (region.includes(q)) consider(a, 40, "substring_region");
  }

  // Postcode handling: pulled out separately because the postcode token
  // might be embedded in a longer free-text query.
  const outward = extractOutwardPostcode(query);
  if (outward) {
    const needle = outward.toLowerCase();
    for (const a of areas) {
      const region = a.region.toLowerCase();
      // Match as a whole word in the region string. We use a manual
      // token check rather than regex so we don't accidentally match
      // "se13" against a region containing "se130" (impossible in
      // practice, but the strict-equality check is cheap insurance).
      const tokens = region.split(/\s+/);
      if (tokens.includes(needle)) {
        consider(a, 90, "outward_postcode");
      }
    }
  }

  return Array.from(matches.values())
    .sort((a, b) => b.score - a.score || a.area.name.localeCompare(b.area.name))
    .slice(0, limit);
}
