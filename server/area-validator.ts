/**
 * Geocode-based validator for free-text area input.
 *
 * The unmatched-area waitlist (PR #116) accepted any string that matched
 * /^[A-Za-z0-9 \-]+$/ — which lets users sign up for "Hogwarts", "Banana
 * Republic", "Disneyland" etc. That makes the public CTA ("We're not in
 * <X> yet — tap to get notified when we launch there") trivially trollable
 * and embarrasses the brand.
 *
 * This module gates `requestedArea` strings: only real-world places get
 * through. Validation is performed by OpenStreetMap Nominatim (free, no
 * API key, ToS-compliant for low volume with a proper User-Agent and a
 * <= 1 req/sec budget).
 *
 * Decision rules (in order):
 *   1. UK postcode shape ("SE13", "WC1H", "SE13 6AA") → accept by shape.
 *      Nominatim's name field for postcode rows is unreliable, so we
 *      trust the regex instead of a round-trip.
 *   2. Nominatim returns a result with category in {place, boundary}
 *      AND type in our place-type allowlist AND name normalises to the
 *      same string as the query → accept.
 *   3. Nominatim returns a result that passes (2) on cat/type but the
 *      name doesn't match (typo case, e.g. "Lewishm" → "Lewisham", or
 *      "NYC" → "New York") → reject WITH a suggestion the client can
 *      offer the user as a one-click replacement.
 *   4. Otherwise → reject with no suggestion.
 *
 * "Any country" by user decision — we explicitly do NOT restrict to GB.
 * If the user wants pros in Brooklyn or Paris, that's a valid demand
 * signal even if we're UK-only today.
 *
 * The Nominatim ToS requires:
 *   - A descriptive User-Agent (we set "TradesmanFinder/1.0 (areavalidator;
 *     contact@tradesmanfinder.com)").
 *   - <= 1 req/sec sustained. Our gate fires on form submit and on a
 *     debounced client pre-check, so traffic is well within budget.
 *   - Caching when possible — we keep a 24h in-memory LRU below.
 */

const NOMINATIM_URL = "https://nominatim.openstreetmap.org/search";
const USER_AGENT =
  "TradesmanFinder/1.0 (areavalidator; contact@tradesmanfinder.com)";

const VALID_CATEGORIES = new Set(["place", "boundary"]);
const VALID_TYPES = new Set([
  "suburb",
  "town",
  "city",
  "village",
  "hamlet",
  "neighbourhood",
  "quarter",
  "borough",
  "region",
  "state",
  "county",
  "district",
  "locality",
  "island",
  "country",
  "administrative",
  "municipality",
  "postcode",
]);

// UK outward postcode shape (e.g. "SE13", "EC1A", "M1"). The optional
// inward part (1 digit + 2 letters) is also accepted. We allow this shape
// without a Nominatim round-trip — postcode-typed results from Nominatim
// have unreliable `name` fields and we'd otherwise reject valid postcodes.
const UK_POSTCODE_RE = /^[A-Z]{1,2}\d[A-Z\d]?(\s*\d[A-Z]{2})?$/i;

export type ValidationResult =
  | { kind: "accept"; canonicalName: string; displayName: string | null }
  | {
      kind: "reject";
      reason: "not_a_place" | "looks_like_typo";
      suggestion?: { name: string; displayName: string };
    };

export interface NominatimHit {
  name?: string;
  display_name?: string;
  category?: string;
  type?: string;
  lat?: string;
  lon?: string;
}

export type NominatimFetcher = (q: string) => Promise<NominatimHit[]>;

function isUkPostcode(q: string): boolean {
  return UK_POSTCODE_RE.test(q.trim());
}

function normaliseName(s: string): string {
  return (s || "").toLowerCase().replace(/[^a-z0-9]/g, "");
}

/**
 * Default fetcher. Hits Nominatim with a polite User-Agent and a short
 * timeout. Throws on network/HTTP errors so the caller can decide whether
 * to fail open or closed. (We currently fail closed — see callers.)
 */
export const defaultNominatimFetcher: NominatimFetcher = async (q) => {
  const url = `${NOMINATIM_URL}?${new URLSearchParams({
    q,
    format: "jsonv2",
    limit: "5",
    addressdetails: "0",
  }).toString()}`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 4000);
  try {
    const res = await fetch(url, {
      headers: { "User-Agent": USER_AGENT, Accept: "application/json" },
      signal: controller.signal,
    });
    if (!res.ok) throw new Error(`nominatim ${res.status}`);
    const data = (await res.json()) as NominatimHit[];
    return Array.isArray(data) ? data : [];
  } finally {
    clearTimeout(timer);
  }
};

/**
 * Validate a free-text area string. Pure function except for the
 * injected fetcher — easy to unit-test with a stubbed fetcher.
 */
export async function validateAreaString(
  raw: string,
  fetcher: NominatimFetcher = defaultNominatimFetcher,
): Promise<ValidationResult> {
  const q = raw.trim();
  if (q.length < 2) {
    return { kind: "reject", reason: "not_a_place" };
  }

  // Fast path: UK outward / full postcode shape.
  if (isUkPostcode(q)) {
    return { kind: "accept", canonicalName: q.toUpperCase(), displayName: null };
  }

  let hits: NominatimHit[];
  try {
    hits = await fetcher(q);
  } catch {
    // Fail closed on network/HTTP errors — better to occasionally reject
    // a real place during a Nominatim outage than to let trolls through.
    // The caller may re-attempt; we don't mask the failure as a success.
    return { kind: "reject", reason: "not_a_place" };
  }

  const nq = normaliseName(q);

  // Pass 1: exact normalised name match on a place-typed result.
  for (const h of hits) {
    if (!VALID_CATEGORIES.has(h.category || "")) continue;
    if (!VALID_TYPES.has(h.type || "")) continue;
    if (normaliseName(h.name || "") === nq) {
      return {
        kind: "accept",
        canonicalName: h.name || q,
        displayName: h.display_name || null,
      };
    }
  }

  // Pass 2: any place-typed result, even if name doesn't match — surface
  // as a suggestion (typo case). e.g. "Lewishm" → suggest "Lewisham".
  for (const h of hits) {
    if (!VALID_CATEGORIES.has(h.category || "")) continue;
    if (!VALID_TYPES.has(h.type || "")) continue;
    if (h.name && h.display_name) {
      return {
        kind: "reject",
        reason: "looks_like_typo",
        suggestion: { name: h.name, displayName: h.display_name },
      };
    }
  }

  return { kind: "reject", reason: "not_a_place" };
}

/**
 * Tiny in-memory cache. The validator is called from at least two paths
 * (the client pre-check via GET /api/areas/validate AND the server-side
 * POST gate), and a single homeowner typing "Deptford" can easily fire
 * the same query twice within seconds. We cap at 5000 entries and 24h.
 *
 * In-memory is fine for our scale (single Vercel function instance most
 * of the time) and keeps us inside Nominatim's request budget. If we
 * scale horizontally we can move this to Supabase or KV — the cache is
 * stateless beyond its TTL so the migration is trivial.
 */
const CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const CACHE_MAX = 5000;
const cache = new Map<string, { value: ValidationResult; expiresAt: number }>();

function cacheKey(s: string): string {
  return s.trim().toLowerCase();
}

export function clearAreaValidationCache(): void {
  cache.clear();
}

export async function validateAreaStringCached(
  raw: string,
  fetcher: NominatimFetcher = defaultNominatimFetcher,
): Promise<ValidationResult> {
  const key = cacheKey(raw);
  const now = Date.now();
  const hit = cache.get(key);
  if (hit && hit.expiresAt > now) return hit.value;
  const result = await validateAreaString(raw, fetcher);
  // Only cache positive results and "looks_like_typo" — pure "not_a_place"
  // rejections are also cached so trolls hammering "asdfg" don't burn quota.
  if (cache.size >= CACHE_MAX) {
    // Drop the oldest entry by insertion order. Map preserves it.
    const firstKey = cache.keys().next().value;
    if (firstKey !== undefined) cache.delete(firstKey);
  }
  cache.set(key, { value: result, expiresAt: now + CACHE_TTL_MS });
  return result;
}
