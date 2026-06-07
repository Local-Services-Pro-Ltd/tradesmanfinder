/**
 * Geo helpers — currently just the haversine great-circle distance used by
 * the mini-site renderer when an in-area tradesman count is 0.
 *
 * Why haversine: the UK areas table stores plain lat/long (no PostGIS), and
 * spinning up an extension purely for mini-site fallback is overkill. The
 * earth-as-sphere approximation has ≤0.5% error which is well inside the
 * tolerance for "is this tradesman within 8 miles of the area centroid".
 */

export const EARTH_RADIUS_MILES = 3958.8;

/** Haversine great-circle distance between two lat/long points, in miles. */
export function haversineMiles(
  aLat: number,
  aLng: number,
  bLat: number,
  bLng: number,
): number {
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = toRad(bLat - aLat);
  const dLng = toRad(bLng - aLng);
  const lat1 = toRad(aLat);
  const lat2 = toRad(bLat);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.sin(dLng / 2) ** 2 * Math.cos(lat1) * Math.cos(lat2);
  return 2 * EARTH_RADIUS_MILES * Math.asin(Math.min(1, Math.sqrt(h)));
}

/**
 * Default radius (miles) used by the mini-site renderer when no tradesmen
 * match the exact area slug. Tuned for UK density — anything wider risks
 * showing tradesmen that homeowners will reject as "too far".
 */
export const MICROSITE_FALLBACK_RADIUS_MILES = 8;
