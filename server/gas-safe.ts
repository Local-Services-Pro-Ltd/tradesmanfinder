/**
 * Gas Safe Register helper.
 *
 * Unlike Companies House, the Gas Safe Register has no public API. The
 * official public search at https://www.gassaferegister.co.uk/find-an-engineer-or-check-the-register/
 * is gated by Imperva WAF (blocks all datacenter IPs at the network edge),
 * uses encrypted single-use `cp` tokens, and ASP.NET CSRF/ViewState — i.e.
 * not automatable from a Vercel function with a plain HTTPS request.
 *
 * Consequence: we cannot programmatically verify that a registration
 * number is live. PR-E therefore implements a submit-for-admin-review
 * flow — the pro enters their number + business name + postcode, we
 * normalise, validate format, save a pending row with a deep-link to
 * the public register, and an admin manually verifies before approving.
 *
 * This mirrors how Keystone was backfilled and how the Companies House
 * flow stayed pending until admin sign-off — except CH has the luxury
 * of an automatic record snapshot, and Gas Safe doesn't.
 *
 * If we ever ship a residential-proxy + headless-browser worker, the
 * automated lookup hook would replace this module without disturbing the
 * pro-side submission contract above it. Until then, this helper is
 * deliberately static — no HTTP calls, no caching, no failure modes.
 *
 * Investigation report: workspace/gas_safe_register_api_investigation.md
 */

/**
 * Format check only. Gas Safe registration numbers are issued as a 6-digit
 * (sometimes 5- or 7-digit) numeric ID. We accept 4–8 digits to be lenient
 * with historic numbers; the registry itself is the source of truth.
 *
 * We don't accept letters — engineer licence numbers (which DO contain
 * letters) are tracked separately by Gas Safe but are out of scope for the
 * business-level "verified business" badge that PR-E delivers.
 */
const GAS_SAFE_NUMBER_RE = /^\d{4,8}$/;

export function normaliseGasSafeNumber(raw: string): string {
  return raw.trim().replace(/\s+/g, "").replace(/^0+(?=\d)/, "");
}

export function isPlausibleGasSafeNumber(raw: string): boolean {
  return GAS_SAFE_NUMBER_RE.test(normaliseGasSafeNumber(raw));
}

/**
 * Canonical deep-link to the public Gas Safe Register results page for a
 * given registration number. The admin opens this link to manually verify
 * the submission before approving. We don't depend on its query-string
 * structure being stable for application logic — it's purely a convenience
 * URL for the admin reviewer; if Gas Safe changes the URL, the worst case
 * is the admin pastes the number into the search box themselves.
 */
export function buildGasSafeRegisterUrl(gasSafeNumber: string): string {
  const n = normaliseGasSafeNumber(gasSafeNumber);
  return `https://www.gassaferegister.co.uk/find-an-engineer-or-check-the-register/?registrationNumber=${encodeURIComponent(n)}`;
}

/**
 * Trim user-entered postcode to a single normalised form (uppercased,
 * single space before the inward code). We don't validate against the
 * UK postcode regex here — the admin step catches that. Cheap defense
 * against trivial typos like double spaces.
 */
export function normalisePostcode(raw: string): string {
  const compact = raw.trim().toUpperCase().replace(/\s+/g, "");
  if (compact.length < 5 || compact.length > 8) return compact;
  // Inward code is always 3 chars: digit + 2 letters.
  return `${compact.slice(0, -3)} ${compact.slice(-3)}`;
}
