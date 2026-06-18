import { describe, it, expect, beforeEach } from "vitest";
import {
  lookupCompanyByNumber,
  lookupCompanyByNumberCached,
  searchCompany,
  clearCompaniesHouseCache,
  isPlausibleCompanyNumber,
  normaliseCompanyNumber,
  CompaniesHouseConfigError,
  CompaniesHouseAuthError,
  CompaniesHouseNotFoundError,
  CompaniesHouseRateLimitError,
  CompaniesHouseNetworkError,
  type CompaniesHouseFetcher,
  type CompanyRecord,
} from "./companies-house";

const apiKey = "fake-key-for-tests";

// Real CH response for /company/00006400 (THE GIRLS' DAY SCHOOL TRUST),
// trimmed to the fields our type narrows to.
const girlsDaySchool: CompanyRecord = {
  company_number: "00006400",
  company_name: "THE GIRLS' DAY SCHOOL TRUST",
  company_status: "active",
  type: "private-limited-shares-section-30-exemption",
  date_of_creation: "1872-06-26",
  jurisdiction: "england-wales",
  registered_office_address: {
    address_line_1: "10 Bressenden Place",
    locality: "London",
    postal_code: "SW1E 5DH",
    country: "England",
  },
  sic_codes: ["85100", "85200", "85310"],
};

function jsonFetcher(
  byPath: Record<string, { status: number; json: unknown; retryAfter?: string }>,
): CompaniesHouseFetcher {
  return async (path) => {
    const entry = byPath[path];
    if (!entry) {
      return { status: 404, json: { error: "not found" }, retryAfter: null };
    }
    return {
      status: entry.status,
      json: entry.json,
      retryAfter: entry.retryAfter ?? null,
    };
  };
}

describe("normaliseCompanyNumber", () => {
  it("upper-cases and strips whitespace", () => {
    expect(normaliseCompanyNumber("  sc123456 ")).toBe("SC123456");
    expect(normaliseCompanyNumber("00006400")).toBe("00006400");
  });
});

describe("isPlausibleCompanyNumber", () => {
  it("accepts 8-digit and 2-letter+6-digit forms", () => {
    expect(isPlausibleCompanyNumber("00006400")).toBe(true);
    expect(isPlausibleCompanyNumber("SC123456")).toBe(true);
    expect(isPlausibleCompanyNumber("NI123456")).toBe(true);
    expect(isPlausibleCompanyNumber("OC123456")).toBe(true);
    expect(isPlausibleCompanyNumber("sc123456")).toBe(true); // case-insensitive
    expect(isPlausibleCompanyNumber(" 00006400 ")).toBe(true); // tolerates whitespace
  });

  it("rejects obvious junk", () => {
    expect(isPlausibleCompanyNumber("")).toBe(false);
    expect(isPlausibleCompanyNumber("123")).toBe(false);
    expect(isPlausibleCompanyNumber("not-a-number")).toBe(false);
    expect(isPlausibleCompanyNumber("123456789")).toBe(false); // 9 digits
    expect(isPlausibleCompanyNumber("ABC12345")).toBe(false); // 3 letters
  });
});

describe("lookupCompanyByNumber", () => {
  it("throws CompaniesHouseConfigError when no API key configured", async () => {
    await expect(
      lookupCompanyByNumber("00006400", { fetcher: async () => ({ status: 200, json: {}, retryAfter: null }) }),
    ).rejects.toBeInstanceOf(CompaniesHouseConfigError);
  });

  it("returns the company record on 200", async () => {
    const fetcher = jsonFetcher({
      "/company/00006400": { status: 200, json: girlsDaySchool },
    });
    const r = await lookupCompanyByNumber("00006400", { apiKey, fetcher });
    expect(r.company_name).toBe("THE GIRLS' DAY SCHOOL TRUST");
    expect(r.company_status).toBe("active");
  });

  it("normalises the number before the API call", async () => {
    let capturedPath: string | null = null;
    const fetcher: CompaniesHouseFetcher = async (path) => {
      capturedPath = path;
      return { status: 200, json: girlsDaySchool, retryAfter: null };
    };
    await lookupCompanyByNumber("  sc123456 ", { apiKey, fetcher });
    expect(capturedPath).toBe("/company/SC123456");
  });

  it("throws CompaniesHouseNotFoundError on implausible numbers WITHOUT hitting the API", async () => {
    let called = 0;
    const fetcher: CompaniesHouseFetcher = async () => {
      called += 1;
      return { status: 200, json: {}, retryAfter: null };
    };
    await expect(
      lookupCompanyByNumber("not-a-number", { apiKey, fetcher }),
    ).rejects.toBeInstanceOf(CompaniesHouseNotFoundError);
    expect(called).toBe(0);
  });

  it("throws CompaniesHouseNotFoundError on 404", async () => {
    const fetcher = jsonFetcher({
      "/company/99999999": { status: 404, json: { error: "company-profile-not-found" } },
    });
    await expect(
      lookupCompanyByNumber("99999999", { apiKey, fetcher }),
    ).rejects.toBeInstanceOf(CompaniesHouseNotFoundError);
  });

  it("throws CompaniesHouseAuthError on 401", async () => {
    const fetcher = jsonFetcher({
      "/company/00006400": { status: 401, json: { error: "Invalid Authorization header" } },
    });
    await expect(
      lookupCompanyByNumber("00006400", { apiKey, fetcher }),
    ).rejects.toBeInstanceOf(CompaniesHouseAuthError);
  });

  it("throws CompaniesHouseAuthError on 400 with ch:service auth error", async () => {
    // 400 with this body is what the proxy returns today — same operational signal as 401.
    const fetcher = jsonFetcher({
      "/company/00006400": {
        status: 400,
        json: { error: "Invalid Authorization header", type: "ch:service" },
      },
    });
    await expect(
      lookupCompanyByNumber("00006400", { apiKey, fetcher }),
    ).rejects.toBeInstanceOf(CompaniesHouseAuthError);
  });

  it("throws CompaniesHouseAuthError on 403", async () => {
    const fetcher = jsonFetcher({
      "/company/00006400": { status: 403, json: { error: "forbidden" } },
    });
    await expect(
      lookupCompanyByNumber("00006400", { apiKey, fetcher }),
    ).rejects.toBeInstanceOf(CompaniesHouseAuthError);
  });

  it("throws CompaniesHouseRateLimitError on 429 and surfaces Retry-After", async () => {
    const fetcher = jsonFetcher({
      "/company/00006400": { status: 429, json: { error: "rate-limit" }, retryAfter: "42" },
    });
    try {
      await lookupCompanyByNumber("00006400", { apiKey, fetcher });
      throw new Error("expected throw");
    } catch (e) {
      expect(e).toBeInstanceOf(CompaniesHouseRateLimitError);
      expect((e as CompaniesHouseRateLimitError).retryAfterSeconds).toBe(42);
    }
  });

  it("throws CompaniesHouseNetworkError on unexpected status", async () => {
    const fetcher = jsonFetcher({
      "/company/00006400": { status: 502, json: { error: "bad gateway" } },
    });
    await expect(
      lookupCompanyByNumber("00006400", { apiKey, fetcher }),
    ).rejects.toBeInstanceOf(CompaniesHouseNetworkError);
  });
});

describe("searchCompany", () => {
  it("returns empty result for too-short query without hitting the API", async () => {
    let called = 0;
    const fetcher: CompaniesHouseFetcher = async () => {
      called += 1;
      return { status: 200, json: {}, retryAfter: null };
    };
    const r = await searchCompany("a", { apiKey, fetcher });
    expect(r.items).toEqual([]);
    expect(called).toBe(0);
  });

  it("returns search results on 200", async () => {
    const fetcher = jsonFetcher({
      "/search/companies?q=plumber": {
        status: 200,
        json: {
          items: [
            {
              company_number: "12345678",
              title: "PLUMBER LTD",
              company_status: "active",
            },
          ],
          total_results: 1,
          page_number: 1,
          items_per_page: 20,
        },
      },
    });
    const r = await searchCompany("plumber", { apiKey, fetcher });
    expect(r.items).toHaveLength(1);
    expect(r.items[0].title).toBe("PLUMBER LTD");
    expect(r.total_results).toBe(1);
  });

  it("caps items_per_page at 20", async () => {
    let capturedPath: string | null = null;
    const fetcher: CompaniesHouseFetcher = async (path) => {
      capturedPath = path;
      return {
        status: 200,
        json: { items: [], total_results: 0, page_number: 1, items_per_page: 20 },
        retryAfter: null,
      };
    };
    await searchCompany("plumber", { apiKey, fetcher, itemsPerPage: 100 });
    expect(capturedPath).toContain("items_per_page=20");
  });
});

describe("lookupCompanyByNumberCached", () => {
  beforeEach(() => {
    clearCompaniesHouseCache();
  });

  it("caches positive hits across calls", async () => {
    let calls = 0;
    const fetcher: CompaniesHouseFetcher = async () => {
      calls += 1;
      return { status: 200, json: girlsDaySchool, retryAfter: null };
    };
    await lookupCompanyByNumberCached("00006400", { apiKey, fetcher });
    await lookupCompanyByNumberCached("00006400", { apiKey, fetcher });
    await lookupCompanyByNumberCached("  00006400 ", { apiKey, fetcher });
    expect(calls).toBe(1);
  });

  it("caches 404s so trolls can't burn quota on bogus numbers", async () => {
    let calls = 0;
    const fetcher: CompaniesHouseFetcher = async () => {
      calls += 1;
      return { status: 404, json: { error: "not found" }, retryAfter: null };
    };
    await expect(
      lookupCompanyByNumberCached("99999999", { apiKey, fetcher }),
    ).rejects.toBeInstanceOf(CompaniesHouseNotFoundError);
    await expect(
      lookupCompanyByNumberCached("99999999", { apiKey, fetcher }),
    ).rejects.toBeInstanceOf(CompaniesHouseNotFoundError);
    expect(calls).toBe(1);
  });

  it("does NOT cache auth errors (transient — credential could be fixed)", async () => {
    let calls = 0;
    const fetcher: CompaniesHouseFetcher = async () => {
      calls += 1;
      return { status: 401, json: { error: "auth" }, retryAfter: null };
    };
    await expect(
      lookupCompanyByNumberCached("00006400", { apiKey, fetcher }),
    ).rejects.toBeInstanceOf(CompaniesHouseAuthError);
    await expect(
      lookupCompanyByNumberCached("00006400", { apiKey, fetcher }),
    ).rejects.toBeInstanceOf(CompaniesHouseAuthError);
    expect(calls).toBe(2);
  });

  it("does NOT cache rate-limit errors", async () => {
    let calls = 0;
    const fetcher: CompaniesHouseFetcher = async () => {
      calls += 1;
      return { status: 429, json: { error: "rate-limit" }, retryAfter: "5" };
    };
    await expect(
      lookupCompanyByNumberCached("00006400", { apiKey, fetcher }),
    ).rejects.toBeInstanceOf(CompaniesHouseRateLimitError);
    await expect(
      lookupCompanyByNumberCached("00006400", { apiKey, fetcher }),
    ).rejects.toBeInstanceOf(CompaniesHouseRateLimitError);
    expect(calls).toBe(2);
  });
});
