/**
 * Pure helpers for the `/api/og` dynamic OpenGraph image endpoint.
 *
 * Why a shared module:
 *   - `shared/main-host-seo.ts` builds the URL that points at /api/og
 *     (used by Googlebot / Twitterbot / Slack / LinkedIn when crawling
 *     the meta tags on /{cat}-in-{area}).
 *   - `api/og.tsx` parses that same URL on render.
 *   - Tests want to round-trip the two without spinning up a server.
 *
 * Keeping the format in one file means the SEO builder and the
 * renderer can't drift apart and ship a broken card.
 *
 * Design notes (chosen, not obvious):
 *   1. Trade name, area name and supply count travel as plain query
 *      params (already URL-encoded, no Base64) so the URL stays
 *      human-debuggable in DevTools and in Search Console.
 *   2. We DELIBERATELY do NOT look up the DB inside /api/og. The
 *      injected meta tag carries everything the renderer needs.
 *      Net effect: every OG render is O(1), no DB roundtrip per
 *      crawl, and the image is fully cacheable behind Vercel's CDN.
 *   3. Length caps are defensive — a hostile URL with a 10KB area
 *      name should be rejected, not rendered. The OG image is
 *      1200×630; anything longer than the caps would overflow the
 *      layout anyway.
 *   4. supplyCount is clamped to [0, 9999]. 0 means "no count
 *      badge"; numbers above ~four digits don't fit the chip.
 */

/** Maximum input lengths — anything longer is clamped or rejected. */
export const OG_MAX_TRADE_LEN = 40;
export const OG_MAX_AREA_LEN = 40;
export const OG_MIN_SUPPLY = 0;
export const OG_MAX_SUPPLY = 9999;

/** Parsed, validated params ready for the renderer. */
export type OgImageParams = {
  /** Trade name (e.g. "Plumber"). Already trimmed and length-checked. */
  trade: string;
  /** Area name (e.g. "Manchester"). Already trimmed and length-checked. */
  area: string;
  /** Supply count. 0 means "do not show the count chip". */
  supply: number;
};

/**
 * Build the `/api/og?...` query string from a (trade, area, supply) triple.
 *
 * Returns only the search string (e.g. `?trade=Plumber&area=Manchester&n=3`)
 * because the caller knows the origin and may want to absolutify or not.
 * `n` is a deliberate alias for supply — shorter, fewer bytes in the
 * outgoing HTML for every hyperlocal page.
 */
export function buildOgImageQuery(input: {
  trade: string;
  area: string;
  supply: number;
}): string {
  const trade = clampLen(input.trade, OG_MAX_TRADE_LEN);
  const area = clampLen(input.area, OG_MAX_AREA_LEN);
  const supply = clampSupply(input.supply);

  const params = new URLSearchParams({ trade, area });
  if (supply > 0) {
    // Only emit `n` when there's an actual count — saves a few bytes
    // per page and keeps the URL clean for the no-supply case.
    params.set("n", String(supply));
  }
  return `?${params.toString()}`;
}

/**
 * Parse a `?trade=…&area=…&n=…` query into validated render params.
 *
 * Returns `null` when the inputs are missing or invalid — the
 * renderer falls back to the static `/og-default.png` in that case.
 *
 * We accept `URLSearchParams` (preferred) or a plain record so this
 * works in both Express (req.query is a parsed object) and Edge
 * runtimes (URL.searchParams).
 */
export function parseOgImageQuery(
  input: URLSearchParams | Record<string, string | string[] | undefined>,
): OgImageParams | null {
  const get = (key: string): string | undefined => {
    if (input instanceof URLSearchParams) {
      return input.get(key) ?? undefined;
    }
    const v = input[key];
    if (Array.isArray(v)) return v[0];
    return v;
  };

  const trade = (get("trade") ?? "").trim();
  const area = (get("area") ?? "").trim();
  const nRaw = (get("n") ?? "0").trim();

  if (!trade || !area) return null;
  if (trade.length > OG_MAX_TRADE_LEN) return null;
  if (area.length > OG_MAX_AREA_LEN) return null;

  // supply is optional. Bad input (NaN, negative, huge) clamps to a
  // safe value rather than rejecting — we'd rather render an image
  // with no count than 5xx a Slack/Twitter crawler.
  const parsedN = Number.parseInt(nRaw, 10);
  const supply = Number.isFinite(parsedN) ? clampSupply(parsedN) : 0;

  return { trade, area, supply };
}

function clampLen(s: string, max: number): string {
  const trimmed = (s ?? "").trim();
  return trimmed.length > max ? trimmed.slice(0, max) : trimmed;
}

function clampSupply(n: number): number {
  if (!Number.isFinite(n)) return 0;
  const rounded = Math.floor(n);
  if (rounded < OG_MIN_SUPPLY) return OG_MIN_SUPPLY;
  if (rounded > OG_MAX_SUPPLY) return OG_MAX_SUPPLY;
  return rounded;
}
