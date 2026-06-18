/**
 * Companies House (UK) API helper.
 *
 * We use this to verify a tradesman's claimed company by looking up its
 * registration number against the official register. This is the evidence
 * that backs the "Verified" badge — addresses the prior issue where 35
 * pros were marked `verified=true` with no row in `tradesman_verifications`
 * (the badge was a lie).
 *
 * Auth: Companies House uses HTTP Basic with the API key as the username
 * and an empty password — i.e. `Authorization: Basic base64(KEY:)`. The
 * trailing colon is critical and is the part that the agent-proxy's
 * BasicCred encoder gets wrong. We construct the header ourselves from
 * the raw key stored in `process.env.COMPANIES_HOUSE_API_KEY` and never
 * route through the proxy.
 *
 * Rate limits: 600 req / 5min per key. We add a small in-memory LRU
 * (24h, 1000 entries) keyed on the normalised input so a Vercel function
 * cold-start doesn't burn quota on repeat lookups during a verification
 * back-and-forth.
 *
 * Failure mode: this helper throws typed errors. Callers in routes
 * should translate to HTTP status codes — 401/403 from CH => 502 to
 * client (our key is misconfigured, not the user's fault), 404 stays
 * 404, 429 surfaces as 429, network errors as 502.
 *
 * Docs: https://developer-specs.company-information.service.gov.uk/
 */

const CH_BASE = "https://api.company-information.service.gov.uk";

const USER_AGENT =
  "TradesmanFinder/1.0 (verifications; contact@tradesmanfinder.com)";

export class CompaniesHouseConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CompaniesHouseConfigError";
  }
}

export class CompaniesHouseAuthError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CompaniesHouseAuthError";
  }
}

export class CompaniesHouseNotFoundError extends Error {
  constructor(public companyNumber: string) {
    super(`Company ${companyNumber} not found`);
    this.name = "CompaniesHouseNotFoundError";
  }
}

export class CompaniesHouseRateLimitError extends Error {
  constructor(public retryAfterSeconds: number | null) {
    super("Companies House rate limit hit");
    this.name = "CompaniesHouseRateLimitError";
  }
}

export class CompaniesHouseNetworkError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CompaniesHouseNetworkError";
  }
}

/**
 * Subset of the `/company/{number}` response we actually use.
 * The real payload is much larger but we deliberately narrow to the
 * fields that drive the verification UI — anything we don't surface
 * is a privacy/compliance liability we don't want to be storing.
 */
export interface CompanyRecord {
  company_number: string;
  company_name: string;
  company_status: string;
  type: string;
  date_of_creation?: string | null;
  date_of_cessation?: string | null;
  jurisdiction?: string;
  registered_office_address?: {
    address_line_1?: string;
    address_line_2?: string;
    locality?: string;
    region?: string;
    postal_code?: string;
    country?: string;
  };
  sic_codes?: string[];
}

export interface SearchResultItem {
  company_number: string;
  title: string;
  company_status: string;
  company_type?: string;
  address_snippet?: string;
  date_of_creation?: string;
}

export interface SearchResult {
  items: SearchResultItem[];
  total_results: number;
  page_number: number;
  items_per_page: number;
}

/**
 * Format check only — Companies House numbers are 8 chars: either
 *   - 8 digits (e.g. "00006400"), OR
 *   - 2 letters + 6 digits (e.g. "SC123456" Scottish, "NI123456" NI,
 *     "OC123456" LLP, "FC123456" overseas).
 * This is a pre-flight filter — we still hit the API for the real check.
 */
const COMPANY_NUMBER_RE = /^[A-Z0-9]{2}\d{6}$|^\d{8}$/i;

export function normaliseCompanyNumber(raw: string): string {
  return raw.trim().toUpperCase().replace(/\s+/g, "");
}

export function isPlausibleCompanyNumber(raw: string): boolean {
  return COMPANY_NUMBER_RE.test(normaliseCompanyNumber(raw));
}

/**
 * Build the Authorization header ourselves. We base64-encode `KEY:` with
 * the trailing colon (empty password) — this is the part that the
 * platform's BasicCred injection gets wrong, hence why we don't use it.
 */
function authHeader(apiKey: string): string {
  // Buffer is the canonical Node implementation; works in Vercel runtime.
  const encoded = Buffer.from(`${apiKey}:`, "utf8").toString("base64");
  return `Basic ${encoded}`;
}

export type CompaniesHouseFetcher = (
  path: string,
  apiKey: string,
) => Promise<{ status: number; json: unknown; retryAfter: string | null }>;

export const defaultFetcher: CompaniesHouseFetcher = async (path, apiKey) => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 6000);
  try {
    const res = await fetch(`${CH_BASE}${path}`, {
      headers: {
        Authorization: authHeader(apiKey),
        "User-Agent": USER_AGENT,
        Accept: "application/json",
      },
      signal: controller.signal,
    });
    // 204 / non-JSON edge cases: be defensive.
    let json: unknown = null;
    const text = await res.text();
    if (text) {
      try {
        json = JSON.parse(text);
      } catch {
        json = { _raw: text };
      }
    }
    return {
      status: res.status,
      json,
      retryAfter: res.headers.get("retry-after"),
    };
  } catch (e) {
    if ((e as { name?: string }).name === "AbortError") {
      throw new CompaniesHouseNetworkError("Companies House request timed out");
    }
    throw new CompaniesHouseNetworkError(
      `Companies House fetch failed: ${(e as Error).message}`,
    );
  } finally {
    clearTimeout(timer);
  }
};

export interface CompaniesHouseClientOptions {
  apiKey?: string;
  fetcher?: CompaniesHouseFetcher;
}

function resolveApiKey(opts?: CompaniesHouseClientOptions): string {
  const k = opts?.apiKey ?? process.env.COMPANIES_HOUSE_API_KEY;
  if (!k || k.trim() === "") {
    throw new CompaniesHouseConfigError(
      "COMPANIES_HOUSE_API_KEY is not set — verification lookups are disabled.",
    );
  }
  return k.trim();
}

function handleErrorStatus(
  status: number,
  json: unknown,
  retryAfter: string | null,
  companyNumber?: string,
): never {
  if (status === 401 || status === 400) {
    // 400 with ch-authentication-error means our auth header is malformed —
    // operationally the same as 401 for the caller.
    throw new CompaniesHouseAuthError(
      `Companies House rejected our credentials (status ${status})`,
    );
  }
  if (status === 403) {
    throw new CompaniesHouseAuthError(
      "Companies House returned 403 — API key may be revoked or rate-tier exceeded",
    );
  }
  if (status === 404 && companyNumber) {
    throw new CompaniesHouseNotFoundError(companyNumber);
  }
  if (status === 429) {
    const secs = retryAfter ? Number.parseInt(retryAfter, 10) : null;
    throw new CompaniesHouseRateLimitError(Number.isFinite(secs) ? secs : null);
  }
  throw new CompaniesHouseNetworkError(
    `Companies House returned unexpected status ${status}: ${JSON.stringify(json).slice(0, 200)}`,
  );
}

/**
 * Look up a single company by its registration number.
 * Throws CompaniesHouseNotFoundError if no such company exists.
 */
export async function lookupCompanyByNumber(
  rawNumber: string,
  opts?: CompaniesHouseClientOptions,
): Promise<CompanyRecord> {
  const number = normaliseCompanyNumber(rawNumber);
  if (!isPlausibleCompanyNumber(number)) {
    // Don't burn API quota on obvious junk. Treat as not-found.
    throw new CompaniesHouseNotFoundError(number);
  }
  const apiKey = resolveApiKey(opts);
  const fetcher = opts?.fetcher ?? defaultFetcher;
  const { status, json, retryAfter } = await fetcher(
    `/company/${encodeURIComponent(number)}`,
    apiKey,
  );
  if (status >= 200 && status < 300) {
    return json as CompanyRecord;
  }
  handleErrorStatus(status, json, retryAfter, number);
}

/**
 * Free-text company search. Returns at most `itemsPerPage` results (capped
 * at 20 by Companies House) starting from `startIndex` (0-based).
 *
 * We use this in the verification UI to help a pro find their own company
 * when they don't remember the exact number — e.g. "AJ Smith Plumbing
 * Manchester" returns a short list they can pick from.
 */
export async function searchCompany(
  query: string,
  opts?: CompaniesHouseClientOptions & {
    itemsPerPage?: number;
    startIndex?: number;
  },
): Promise<SearchResult> {
  const q = query.trim();
  if (q.length < 2) {
    return { items: [], total_results: 0, page_number: 1, items_per_page: 0 };
  }
  const apiKey = resolveApiKey(opts);
  const fetcher = opts?.fetcher ?? defaultFetcher;
  const params = new URLSearchParams({ q });
  if (opts?.itemsPerPage) {
    params.set("items_per_page", String(Math.min(opts.itemsPerPage, 20)));
  }
  if (opts?.startIndex) {
    params.set("start_index", String(opts.startIndex));
  }
  const { status, json, retryAfter } = await fetcher(
    `/search/companies?${params.toString()}`,
    apiKey,
  );
  if (status >= 200 && status < 300) {
    const j = (json as Partial<SearchResult>) ?? {};
    return {
      items: Array.isArray(j.items) ? j.items : [],
      total_results: j.total_results ?? 0,
      page_number: j.page_number ?? 1,
      items_per_page: j.items_per_page ?? 0,
    };
  }
  handleErrorStatus(status, json, retryAfter);
}

/**
 * In-memory LRU cache for company-number lookups. We only cache positive
 * hits and 404s — every other error is a transient condition and should
 * be retried. Cache for 24h since company records change rarely (status
 * changes are the main concern but pro verification doesn't need same-day
 * freshness; we re-verify on a schedule separately).
 */
const CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const CACHE_MAX = 1000;

type CacheEntry =
  | { kind: "hit"; value: CompanyRecord; expiresAt: number }
  | { kind: "miss"; expiresAt: number };

const cache = new Map<string, CacheEntry>();

export function clearCompaniesHouseCache(): void {
  cache.clear();
}

export async function lookupCompanyByNumberCached(
  rawNumber: string,
  opts?: CompaniesHouseClientOptions,
): Promise<CompanyRecord> {
  const key = normaliseCompanyNumber(rawNumber);
  const now = Date.now();
  const hit = cache.get(key);
  if (hit && hit.expiresAt > now) {
    if (hit.kind === "hit") return hit.value;
    throw new CompaniesHouseNotFoundError(key);
  }
  try {
    const value = await lookupCompanyByNumber(key, opts);
    if (cache.size >= CACHE_MAX) {
      const firstKey = cache.keys().next().value;
      if (firstKey !== undefined) cache.delete(firstKey);
    }
    cache.set(key, { kind: "hit", value, expiresAt: now + CACHE_TTL_MS });
    return value;
  } catch (e) {
    if (e instanceof CompaniesHouseNotFoundError) {
      if (cache.size >= CACHE_MAX) {
        const firstKey = cache.keys().next().value;
        if (firstKey !== undefined) cache.delete(firstKey);
      }
      cache.set(key, { kind: "miss", expiresAt: now + CACHE_TTL_MS });
    }
    throw e;
  }
}
