/**
 * Top 20 UK cities by Google search volume for tradesperson queries
 * ("plumber in <city>", "electrician in <city>", etc.).
 *
 * Sourced from Ahrefs UK keyword data, cross-checked against ONS mid-2024
 * population estimates. London is intentionally excluded — the existing
 * `areas` table already has ~30 London neighborhoods which beat the generic
 * "london" route on purchase intent. We seed the major regional cities
 * instead so PR-#19 can cover both halves of the demand curve.
 *
 * Lat/long are city-centre coordinates (postcode-level precision is not
 * needed for landing-page geo-context). Region matches the existing
 * `areas.region` convention: "<county/region> <outward postcode>".
 *
 * This file is the single source of truth for the seed script. Re-running
 * the seed is idempotent via slug uniqueness — the script upserts on slug.
 *
 * Why ship as a static .ts instead of seeding inline in a migration:
 *  - Reviewable diff (humans can sanity-check city list and coordinates)
 *  - Reusable from the manifest generator without a DB round-trip
 *  - Future expansions (Scottish/Welsh additions) just append rows here
 *
 * To add a city: append to SEO_CITIES, then run `npm run seed:seo-cities`.
 */

export interface SeoCity {
  /** URL-safe identifier; becomes `areas.slug` and the `:city` route param. */
  slug: string;
  /** Display name as it appears in titles and breadcrumbs. */
  name: string;
  /** "<county/region> <outward postcode>" — matches existing area convention. */
  region: string;
  /** City-centre latitude (WGS84). */
  latitude: number;
  /** City-centre longitude (WGS84). */
  longitude: number;
  /**
   * ONS mid-2024 population estimate (rounded to nearest thousand).
   * Used as a tie-breaker in the route scorer when supply is equal.
   * Not stored in the DB — kept here for the scorer only.
   */
  population: number;
}

export const SEO_CITIES: ReadonlyArray<SeoCity> = [
  // Existing slugs (already present in areas table) — reused intentionally
  // to avoid duplicate landing pages and SEO fragmentation. Listed here so
  // SEO_CITY_POPULATION can score them; the seed script skips them via
  // ON CONFLICT DO NOTHING.
  { slug: "manchester",        name: "Manchester",    region: "Greater Manchester M1",    latitude: 53.4808, longitude: -2.2426, population: 568_000 },
  { slug: "birmingham",        name: "Birmingham",    region: "West Midlands B1",         latitude: 52.4862, longitude: -1.8904, population: 1_157_000 },
  { slug: "leeds",             name: "Leeds",         region: "West Yorkshire LS1",       latitude: 53.8008, longitude: -1.5491, population: 826_000 },
  { slug: "bristol",           name: "Bristol",       region: "Bristol BS1",              latitude: 51.4545, longitude: -2.5879, population: 480_000 },
  { slug: "sheffield",         name: "Sheffield",     region: "South Yorkshire S1",       latitude: 53.3811, longitude: -1.4701, population: 584_000 },
  { slug: "liverpool",         name: "Liverpool",     region: "Merseyside L1",            latitude: 53.4084, longitude: -2.9916, population: 506_000 },
  { slug: "newcastle-upon-tyne", name: "Newcastle upon Tyne", region: "Tyne and Wear NE1", latitude: 54.9783, longitude: -1.6178, population: 307_000 },
  { slug: "edinburgh",         name: "Edinburgh",     region: "City of Edinburgh EH1",    latitude: 55.9533, longitude: -3.1883, population: 526_000 },
  { slug: "glasgow",           name: "Glasgow",       region: "Glasgow City G1",          latitude: 55.8642, longitude: -4.2518, population: 635_000 },
  { slug: "cardiff",           name: "Cardiff",       region: "Cardiff CF10",             latitude: 51.4816, longitude: -3.1791, population: 372_000 },
  { slug: "belfast",           name: "Belfast",       region: "Belfast BT1",              latitude: 54.5973, longitude: -5.9301, population: 348_000 },
  { slug: "nottingham",        name: "Nottingham",    region: "Nottinghamshire NG1",      latitude: 52.9548, longitude: -1.1581, population: 337_000 },
  { slug: "leicester",         name: "Leicester",     region: "Leicestershire LE1",       latitude: 52.6369, longitude: -1.1398, population: 372_000 },
  { slug: "coventry",          name: "Coventry",      region: "West Midlands CV1",        latitude: 52.4068, longitude: -1.5197, population: 345_000 },
  { slug: "southampton",       name: "Southampton",   region: "Hampshire SO14",           latitude: 50.9097, longitude: -1.4044, population: 254_000 },
  { slug: "brighton",          name: "Brighton",      region: "East Sussex BN1",          latitude: 50.8225, longitude: -0.1372, population: 277_000 },
  { slug: "plymouth",          name: "Plymouth",      region: "Devon PL1",                latitude: 50.3755, longitude: -4.1427, population: 264_000 },
  { slug: "reading",           name: "Reading",       region: "Berkshire RG1",            latitude: 51.4543, longitude: -0.9781, population: 175_000 },
  { slug: "oxford",            name: "Oxford",        region: "Oxfordshire OX1",          latitude: 51.7520, longitude: -1.2577, population: 162_000 },
  { slug: "cambridge",         name: "Cambridge",     region: "Cambridgeshire CB1",       latitude: 52.2053, longitude: 0.1218,  population: 145_000 },
];

/**
 * Population lookup for the route scorer. Keys are city slugs (matches
 * `areas.slug`). London neighborhoods are absent here intentionally —
 * the scorer falls back to a London-area default for missing slugs.
 */
export const SEO_CITY_POPULATION: Readonly<Record<string, number>> = Object.freeze(
  Object.fromEntries(SEO_CITIES.map((c) => [c.slug, c.population])),
);

/**
 * Default population for areas not in SEO_CITIES (mostly London
 * neighborhoods in the existing `areas` table). London ward populations
 * cluster around 20-30k; we pick 25k as a neutral midpoint so London
 * routes don't dominate by default but also aren't penalized.
 */
export const DEFAULT_LONDON_AREA_POPULATION = 25_000;
