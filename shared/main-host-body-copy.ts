/**
 * Unique body-copy generator for main-host SEO landing pages (PR-#19-H).
 *
 * Each `/{trade}-in-{area}` landing page needs 80–150 words of unique,
 * meaningful body text. Without it the pages risk being classified as
 * "doorway pages" by Google — a soft penalty that can deindex the whole
 * 400-page set. The visible body before this PR was ~343 chars made up
 * entirely of cross-link anchors, well below the threshold.
 *
 * Design constraints (kept the same shape as the rest of PR-#19):
 *
 *  1. Pure function, no DB / network. Builds in <0.1ms per page so the
 *     server-render path stays cheap and deterministic builds stay
 *     reproducible.
 *  2. Deterministic — same inputs produce the same output every time.
 *     Sitemap stability matters; Google penalises churn.
 *  3. Genuinely unique per `(trade, area)` combo. We don't just swap
 *     two nouns and call it a day. Variation comes from FOUR axes,
 *     combined: trade-specific job dictionary, region phrasing, supply
 *     tier, and a stable hash-driven template variant. With 20 trades
 *     × 20+ areas × 3 supply tiers × 3 opener variants × 3 closer
 *     variants the visible permutations exceed 30,000 — more than
 *     enough to look natural to a crawler doing similarity comparison.
 *  4. Word count target 90–140 (inside the 80–150 brief), validated by
 *     test.
 *
 * Why not LLM-generated copy: build-time LLM calls add a deploy-time
 * external dependency, are not reproducible, and produce drift across
 * deploys that Google interprets as instability. Templated copy is
 * boring but ships.
 */

/** Minimum word count we emit. Tests assert >= MIN_WORDS for every combo. */
export const MIN_WORDS = 80;
/** Soft ceiling. Tests assert <= MAX_WORDS for every combo. */
export const MAX_WORDS = 150;

export interface BodyCopyInput {
  category: { slug: string; name: string };
  area: { slug: string; name: string; region: string };
  /** Number of tradesmen serving this combo. 0 → "empty" tier copy. */
  supplyCount: number;
}

export interface BodyCopyPayload {
  /** Paragraphs in order — typically 2 or 3. Render each in its own <p>. */
  paragraphs: string[];
  /** Word count across all paragraphs (for telemetry / tests). */
  wordCount: number;
}

/**
 * Stable, deterministic 32-bit FNV-1a hash. Used to pick template
 * variants — same input always picks the same variant, but small
 * input changes (e.g. trade slug differing by one char) produce wildly
 * different outputs, so neighbouring routes get different variants.
 */
function fnv1a(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = (h + ((h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24))) >>> 0;
  }
  return h >>> 0;
}

/**
 * Trade-specific phrase pack. The key is the category SLUG (matches
 * the seo-routes manifest). For unknown trades we fall back to a
 * generic phrase pack so the function never throws — useful future-
 * proofing if we add new categories before updating this file.
 *
 * Each pack has:
 *   - jobs:   3–5 typical job phrases (lowercase, comma-joinable)
 *   - verb:   first-line action verb (e.g. "fitting", "installing")
 *   - noun:   plural noun for the practitioner ("plumbers", "joiners")
 *   - need:   short customer-need phrase ("a burst pipe", "a leaking roof")
 */
interface TradePhrases {
  jobs: string[];
  verb: string;
  noun: string;
  need: string;
}

const TRADE_PHRASES: Record<string, TradePhrases> = {
  plumber: {
    jobs: [
      "boiler installations",
      "leak repairs",
      "bathroom refits",
      "radiator fittings",
      "blocked-drain clearance",
    ],
    verb: "fitting",
    noun: "plumbers",
    need: "a burst pipe or a failing boiler",
  },
  electrician: {
    jobs: [
      "fuse-box upgrades",
      "EICR certifications",
      "EV charger installs",
      "rewiring projects",
      "smart-lighting installs",
    ],
    verb: "wiring",
    noun: "electricians",
    need: "a tripping consumer unit or a dead socket ring",
  },
  builder: {
    jobs: [
      "single-storey extensions",
      "loft conversions",
      "kitchen knock-throughs",
      "garage conversions",
      "structural alterations",
    ],
    verb: "building",
    noun: "builders",
    need: "an extension or full structural project",
  },
  carpenter: {
    jobs: [
      "fitted-wardrobe installs",
      "staircase repairs",
      "bespoke shelving",
      "door hanging",
      "skirting and architrave work",
    ],
    verb: "fitting",
    noun: "carpenters and joiners",
    need: "bespoke joinery or fitted furniture",
  },
  roofer: {
    jobs: [
      "tile replacements",
      "flat-roof refurbishments",
      "gutter repairs",
      "lead flashing work",
      "chimney repointing",
    ],
    verb: "repairing",
    noun: "roofers",
    need: "a leaking roof or storm damage",
  },
  bricklayer: {
    jobs: [
      "garden walls",
      "extension brickwork",
      "chimney rebuilds",
      "block-and-beam foundations",
      "repointing work",
    ],
    verb: "laying",
    noun: "bricklayers",
    need: "new brickwork or wall repairs",
  },
  plasterer: {
    jobs: [
      "skim-coat finishes",
      "rendering",
      "wet-plaster ceilings",
      "damp-proof plastering",
      "stud-wall plastering",
    ],
    verb: "plastering",
    noun: "plasterers",
    need: "fresh skim, render, or damp repairs",
  },
  tiler: {
    jobs: [
      "bathroom tiling",
      "kitchen splashbacks",
      "wet-room tanking",
      "porcelain floor tiling",
      "mosaic detailing",
    ],
    verb: "tiling",
    noun: "tilers",
    need: "kitchen or bathroom tiling",
  },
  "painter-decorator": {
    jobs: [
      "full-house redecorations",
      "exterior masonry painting",
      "wallpaper hanging",
      "spray-painted kitchens",
      "feature-wall finishes",
    ],
    verb: "decorating",
    noun: "painters and decorators",
    need: "a redecoration or exterior refresh",
  },
  glazier: {
    jobs: [
      "double-glazing repairs",
      "emergency board-ups",
      "sealed-unit replacements",
      "shopfront glass",
      "balustrade installations",
    ],
    verb: "glazing",
    noun: "glaziers",
    need: "a broken pane or misted unit",
  },
  "heating-engineer": {
    jobs: [
      "Gas Safe boiler swaps",
      "annual servicing",
      "system power-flushes",
      "radiator upgrades",
      "Nest and Hive controls",
    ],
    verb: "servicing",
    noun: "Gas Safe heating engineers",
    need: "a cold boiler or no hot water",
  },
  locksmith: {
    jobs: [
      "emergency lockouts",
      "UPVC lock changes",
      "anti-snap cylinder upgrades",
      "safe-opening callouts",
      "key cutting",
    ],
    verb: "fitting",
    noun: "locksmiths",
    need: "a lockout or a broken lock",
  },
  handyman: {
    jobs: [
      "flat-pack assembly",
      "TV wall-mounting",
      "shelf installs",
      "small repair jobs",
      "fence-panel replacements",
    ],
    verb: "fixing",
    noun: "handymen",
    need: "the smaller jobs other trades won't quote on",
  },
  cleaner: {
    jobs: [
      "end-of-tenancy cleans",
      "deep cleans",
      "carpet shampooing",
      "after-builders cleans",
      "regular domestic visits",
    ],
    verb: "cleaning",
    noun: "professional cleaners",
    need: "a deep clean or regular housekeeping",
  },
  "damp-specialist": {
    jobs: [
      "rising-damp surveys",
      "tanking systems",
      "condensation diagnosis",
      "timber treatments",
      "PCA-accredited damp-proof courses",
    ],
    verb: "diagnosing",
    noun: "damp and timber specialists",
    need: "rising damp, condensation, or timber rot",
  },
  "driveway-paving": {
    jobs: [
      "resin-bound drives",
      "block-paved drives",
      "tarmac resurfacing",
      "patio installations",
      "edging and drainage",
    ],
    verb: "laying",
    noun: "driveway and paving contractors",
    need: "a new drive, patio, or resurface",
  },
  "flooring-specialist": {
    jobs: [
      "engineered wood floors",
      "LVT installs",
      "carpet fitting",
      "screeding and levelling",
      "underfloor-heating-ready prep",
    ],
    verb: "fitting",
    noun: "flooring specialists",
    need: "new floors throughout the house",
  },
  "gardener-landscaper": {
    jobs: [
      "lawn turfing",
      "fencing and decking",
      "garden clearances",
      "soft-landscaping designs",
      "hedge cutting",
    ],
    verb: "landscaping",
    noun: "gardeners and landscapers",
    need: "a tidy-up or full garden redesign",
  },
  "pest-control": {
    jobs: [
      "rat and mouse treatments",
      "wasp-nest removal",
      "BPCA-certified bird-proofing",
      "bedbug treatments",
      "ant infestations",
    ],
    verb: "treating",
    noun: "pest controllers",
    need: "an infestation or one-off treatment",
  },
  removals: {
    jobs: [
      "full house moves",
      "single-item deliveries",
      "packing services",
      "office relocations",
      "BAR-accredited long-distance moves",
    ],
    verb: "moving",
    noun: "removals companies",
    need: "a house move or large delivery",
  },
};

const FALLBACK_TRADE: TradePhrases = {
  jobs: [
    "domestic projects",
    "commercial work",
    "emergency callouts",
    "scheduled installations",
    "maintenance visits",
  ],
  verb: "carrying out",
  noun: "tradespeople",
  need: "a job that needs doing properly",
};

function tradeFor(slug: string): TradePhrases {
  return TRADE_PHRASES[slug] ?? FALLBACK_TRADE;
}

/**
 * Region phrasing. Region values in the DB are mixed-case full names
 * ("England", "Scotland", "Wales", "Northern Ireland"); we lowercase
 * before the lookup so casing drift never causes a silent fallback.
 */
const REGION_PHRASES: Record<string, { area: string; coverage: string }> = {
  england: {
    area: "England",
    coverage: "across England",
  },
  scotland: {
    area: "Scotland",
    coverage: "across Scotland",
  },
  wales: {
    area: "Wales",
    coverage: "across Wales",
  },
  "northern ireland": {
    area: "Northern Ireland",
    coverage: "across Northern Ireland",
  },
};

const FALLBACK_REGION = { area: "the UK", coverage: "across the UK" };

function regionFor(region: string): { area: string; coverage: string } {
  return REGION_PHRASES[region.toLowerCase()] ?? FALLBACK_REGION;
}

/**
 * Pick N items from a list, starting at a hash-derived offset, with
 * wrap-around. Used so neighbouring routes get a different subset of
 * the trade's job phrases.
 */
function pickRotated<T>(items: readonly T[], offset: number, n: number): T[] {
  if (items.length === 0) return [];
  const k = Math.min(n, items.length);
  const start = offset % items.length;
  const out: T[] = [];
  for (let i = 0; i < k; i++) out.push(items[(start + i) % items.length]);
  return out;
}

/** Human-readable Oxford-style comma join: ["a","b","c"] → "a, b, and c". */
function joinPhrases(parts: string[]): string {
  if (parts.length === 0) return "";
  if (parts.length === 1) return parts[0];
  if (parts.length === 2) return `${parts[0]} and ${parts[1]}`;
  return `${parts.slice(0, -1).join(", ")}, and ${parts[parts.length - 1]}`;
}

/**
 * The three opener templates. Hash picks one. Each weaves in the trade,
 * area, region, and a rotated job-phrases subset.
 */
function openerVariants(
  trade: TradePhrases,
  area: { name: string },
  region: { area: string },
  jobsPhrase: string,
): string[] {
  return [
    `Looking for a trusted ${trade.noun.replace(/s$/, "").replace(/ companies$/, " company")} in ${area.name}? TradesmanFinder connects homeowners ${region.area === "the UK" ? "across the UK" : `in ${region.area}`} with vetted local tradespeople for ${jobsPhrase}.`,
    `${area.name} homeowners use TradesmanFinder to find vetted ${trade.noun} for ${jobsPhrase}. Every professional listed has been identity-checked, with verified reviews from real customers in ${region.area}.`,
    `Whether you need ${trade.need}, the ${trade.noun} listed for ${area.name} on TradesmanFinder cover ${jobsPhrase} ${region.coverage} — all backed by transparent quotes and homeowner-reviewed ratings.`,
  ];
}

/**
 * Middle paragraph branches on supply tier. Dense pages get a
 * comparison-shop angle; sparse pages get a "limited but quality"
 * angle; empty pages get a recruit-the-supplier + look-nearby angle
 * (matches the on-page CTA from PR-#19-B).
 */
function middleVariants(
  trade: TradePhrases,
  area: { name: string },
  region: { area: string; coverage: string },
  supplyCount: number,
): string[] {
  if (supplyCount >= 3) {
    return [
      `We currently list ${supplyCount} ${trade.noun} serving ${area.name} and the surrounding postcodes. Compare profiles side-by-side, read homeowner reviews, see typical day rates, and request up to three free quotes in under sixty seconds — no phone calls, no pressure, no upfront fees.`,
      `With ${supplyCount} active ${trade.noun} covering ${area.name}, you can shortlist on price, availability, and review score before you ever pick up the phone. Each profile shows recent jobs, response time, and the trades the business is qualified for ${region.coverage}.`,
      `${supplyCount} local ${trade.noun} are available for jobs in ${area.name} right now. Post the details of your job once and receive tailored quotes from professionals who already work in your postcode — most homeowners hear back within a few hours.`,
    ];
  }
  if (supplyCount >= 1) {
    return [
      `We're building the network of ${trade.noun} covering ${area.name} carefully — only ${supplyCount === 1 ? "one verified professional is" : `${supplyCount} verified professionals are`} listed for this area today. Each has been identity-checked and reviewed by real homeowners, so quality stays high while we scale supply ${region.coverage}.`,
      `Currently ${supplyCount === 1 ? "one" : supplyCount} vetted ${trade.noun.replace(/s$/, "")}${supplyCount === 1 ? "" : "s"} serve ${area.name} through TradesmanFinder. If your timing is flexible, you can also pull quotes from nearby towns listed at the bottom of this page — coverage is typically a 10–15 mile radius for ${trade.verb} work.`,
      `Listings for ${trade.noun} in ${area.name} are still limited (${supplyCount === 1 ? "one verified pro" : `${supplyCount} verified pros`} so far), but each professional has been background-checked and reviewed. For more options, browse the nearby cities linked below or post your job and let local pros come to you.`,
    ];
  }
  // empty tier
  return [
    `No ${trade.noun} are currently listed for ${area.name} on TradesmanFinder — but you can still post your job free of charge and we'll route it to vetted professionals in nearby towns. Coverage usually extends 10–15 miles, so neighbouring cities (linked at the bottom of this page) will normally bid for ${area.name} jobs.`,
    `We're actively recruiting ${trade.noun} to cover ${area.name}. In the meantime, posting your job here puts it in front of nearby vetted professionals ${region.coverage} who already work this postcode area, and you can browse the related trades and adjacent towns linked below.`,
    `${area.name} doesn't yet have dedicated ${trade.noun} listed, so we route ${area.name} jobs to vetted professionals working in the surrounding postcodes. Use the nearby-cities and related-trades links lower down the page, or post your job and we'll match you with available pros.`,
  ];
}

/** Closing line — short reassurance + soft CTA. Three variants. */
function closerVariants(area: { name: string }): string[] {
  return [
    `Posting a job is free for homeowners, takes under a minute, and there's no obligation to hire. Find the right professional for your next project in ${area.name} today.`,
    `Free to post, free to compare, and you only proceed when you're happy with the quote. TradesmanFinder makes hiring trusted trades in ${area.name} straightforward.`,
    `No signup fees, no commission on quotes, and no shared contact details until you choose a tradesperson. Get started with your ${area.name} job in under sixty seconds.`,
  ];
}

/** Count words by splitting on whitespace runs. Robust to punctuation. */
export function wordCount(s: string): number {
  const trimmed = s.trim();
  if (!trimmed) return 0;
  return trimmed.split(/\s+/).length;
}

/**
 * Build the body-copy payload for a `(trade, area)` pair.
 *
 * Pure function. Same input → same output. Never throws — unknown
 * trade slugs fall back to a generic phrase pack so the page always
 * renders.
 */
export function buildBodyCopy(input: BodyCopyInput): BodyCopyPayload {
  const trade = tradeFor(input.category.slug);
  const region = regionFor(input.area.region);
  const seed = `${input.category.slug}|${input.area.slug}`;
  const h = fnv1a(seed);

  // Distribute bits of the hash across the variation axes. Using
  // different bit-shifts means changing trade slug perturbs all three
  // picks, not just one — keeps neighbouring routes meaningfully
  // different even on a single-character change.
  const openerIdx = h % 3;
  const middleIdx = (h >>> 8) % 3;
  const closerIdx = (h >>> 16) % 3;
  const jobsOffset = (h >>> 4) % trade.jobs.length;
  const jobsTake = 3 + ((h >>> 12) % 2); // 3 or 4 jobs phrased

  const jobsPhrase = joinPhrases(pickRotated(trade.jobs, jobsOffset, jobsTake));

  const opener = openerVariants(trade, input.area, region, jobsPhrase)[openerIdx];
  const middle = middleVariants(
    trade,
    input.area,
    region,
    input.supplyCount,
  )[middleIdx];
  const closer = closerVariants(input.area)[closerIdx];

  const paragraphs = [opener, middle, closer];
  const total = paragraphs.reduce((n, p) => n + wordCount(p), 0);

  return { paragraphs, wordCount: total };
}
