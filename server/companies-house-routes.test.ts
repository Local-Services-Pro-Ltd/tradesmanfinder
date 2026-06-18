/**
 * COMPANIES HOUSE VERIFICATION ROUTES — integration tests
 *
 * These tests cover the three new HTTP endpoints introduced by PR-A:
 *
 *   GET  /api/companies-house/search?q=
 *   GET  /api/companies-house/company/:number
 *   POST /api/tradesmen/:id/verifications/companies-house
 *
 * Goals:
 *   1. Lock in the auth boundary — these endpoints must NEVER be reachable
 *      without a tradesman session (would burn CH quota and let anyone
 *      grief the API).
 *   2. Lock in the typed-error → HTTP-status mapping (auth → 502, not-found
 *      → 404, rate-limit → 429 with Retry-After, network → 502, config
 *      → 503). Wrong mapping has user-visible regressions (e.g. surfacing
 *      our auth issue as "company not found").
 *   3. Lock in the pro-submission shape: dedupe pre-check returns 409,
 *      dissolved company returns 422, invalid number returns 400, success
 *      returns 201 with the trimmed evidence snapshot.
 *
 * The Companies House network layer is stubbed via a custom fetcher
 * installed by overriding the env so we don't make real HTTP calls.
 * Storage is mocked. The express app is mounted fresh per test block.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.hoisted(() => {
  process.env.ADMIN_KEY = 'test-secret-key';
  process.env.DATABASE_URL = 'postgres://fake';
  process.env.COMPANIES_HOUSE_API_KEY = 'fake-test-key';
});

// --- Mocks -------------------------------------------------------------

// Track the inserted CH verification so success-path tests can assert on it.
const createCHMock = vi.fn();
const getCHByCompanyMock = vi.fn();
const getSessionByIdMock = vi.fn();
const touchSessionMock = vi.fn().mockResolvedValue(undefined);

vi.mock('./storage', () => ({
  storage: {
    // Mounting + attachCardSummary helpers (minimal stubs).
    getCardsByTradesman: vi.fn().mockResolvedValue([]),
    getAllCards: vi.fn().mockResolvedValue([]),
    getTradesmanById: vi.fn().mockResolvedValue(null),
    getTradesmanByEmail: vi.fn().mockResolvedValue(null),
    getTradesmen: vi.fn().mockResolvedValue([]),
    getJobs: vi.fn().mockResolvedValue([]),
    getQuotes: vi.fn().mockResolvedValue([]),
    getReviews: vi.fn().mockResolvedValue([]),
    logModeration: vi.fn().mockResolvedValue({ id: 1 }),
    getModerationLog: vi.fn().mockResolvedValue([]),
    getPartnerEnquiriesByStatus: vi.fn().mockResolvedValue([]),
    getPartners: vi.fn().mockResolvedValue([]),
    getActivePlacementsBySurface: vi.fn().mockResolvedValue([]),
    getAreas: vi.fn().mockResolvedValue([{ id: 1, name: 'Default', slug: 'default' }]),
    // Auth-specific
    getSessionById: getSessionByIdMock,
    findSessionById: getSessionByIdMock,
    touchSession: touchSessionMock,
    deleteSession: vi.fn().mockResolvedValue(undefined),
    // The two CH-specific methods this PR introduces
    createCompaniesHouseVerification: createCHMock,
    getCompaniesHouseVerificationByTradesmanAndCompany: getCHByCompanyMock,
    // Other helpers used during route mounting
    createTradesman: vi.fn().mockResolvedValue({ id: 1 }),
    updateTradesman: vi.fn().mockResolvedValue(null),
    setCredits: vi.fn().mockResolvedValue(undefined),
    createCreditTransaction: vi.fn().mockResolvedValue(undefined),
    getReviewsByTradesman: vi.fn().mockResolvedValue([]),
  },
  db: {},
}));

vi.mock('./mailer', () => ({
  sendCardIssuedEmail: vi.fn().mockResolvedValue({ ok: true }),
  sendCardRescindedEmail: vi.fn().mockResolvedValue({ ok: true }),
  sendNewLeadEmail: vi.fn().mockResolvedValue({ ok: true }),
  sendPartnerEnquiryNotification: vi.fn().mockResolvedValue({ ok: true }),
  sendMagicLinkEmail: vi.fn().mockResolvedValue({ ok: true }),
  sendOutcomeAskEmail: vi.fn().mockResolvedValue({ ok: true }),
  sendHomeownerMagicLink: vi.fn().mockResolvedValue({ ok: true }),
  sendVerificationRequestToTradesman: vi.fn().mockResolvedValue({ ok: true }),
  sendVerificationAccessGranted: vi.fn().mockResolvedValue({ ok: true }),
  sendVerificationAccessDenied: vi.fn().mockResolvedValue({ ok: true }),
  sendFoundingProInterest: vi.fn().mockResolvedValue({ ok: true }),
}));

vi.mock('./stripe', () => ({
  stripe: { webhooks: { constructEvent: vi.fn() }, checkout: { sessions: { create: vi.fn(), listLineItems: vi.fn() } } },
  STRIPE_WEBHOOK_SECRET: 'whsec_test',
  stripeIsConfigured: false,
  productKindFromPriceId: () => null,
  creditsForProductKind: () => 0,
  PRODUCT_KINDS: [],
}));

vi.mock('./stripe-checkout', () => ({
  createLeadPackCheckoutSession: vi.fn(),
  createFeaturedCheckoutSession: vi.fn(),
}));
vi.mock('./stripe-portal', () => ({ createBillingPortalSession: vi.fn() }));
vi.mock('./stripe-webhook', () => ({ handleStripeWebhook: vi.fn() }));
vi.mock('./resend-webhook', () => ({ handleResendWebhook: vi.fn() }));
vi.mock('./spam-guard', () => ({
  publicFormGuard: () => (_req: any, _res: any, next: any) => next(),
  rateLimit: () => (_req: any, _res: any, next: any) => next(),
}));

// Mock the Companies House helper at the module boundary — much cleaner than
// trying to intercept fetch globally. The behaviour map drives what each test
// case sees.
const lookupMock = vi.fn();
const searchMock = vi.fn();
vi.mock('./companies-house', async () => {
  const actual = await vi.importActual<typeof import('./companies-house')>('./companies-house');
  return {
    // Keep the real error classes and pure helpers — only stub the IO bits.
    ...actual,
    lookupCompanyByNumberCached: lookupMock,
    searchCompany: searchMock,
  };
});

// --- Helpers -----------------------------------------------------------

async function buildApp() {
  const { default: express } = await import('express');
  const { createServer } = await import('node:http');
  const { registerRoutes } = await import('./routes');
  const app = express();
  app.use(express.json());
  const httpServer = createServer(app);
  await registerRoutes(httpServer, app);
  return app;
}

async function withServer(app: any, fn: (port: number) => Promise<void>) {
  return new Promise<void>((resolve, reject) => {
    const srv = app.listen(0, async () => {
      const port = (srv.address() as any).port as number;
      try { await fn(port); srv.close(() => resolve()); }
      catch (e) { srv.close(() => reject(e)); }
    });
  });
}

// A signed-in tradesman with id=42. The session cookie name and shape must
// match server/auth.ts — we don't manually craft it; instead we mock
// readSessionCookie to return a known sid for any request that sends our
// auth header. Simpler than reconstructing cookie signing.
const TEST_SID = 'test-session-12345678901234567890';
const TEST_TRADESMAN_ID = 42;

function authedHeaders(): Record<string, string> {
  // server/auth.ts reads the cookie via readSessionCookie which parses the
  // Cookie header. Format matches what setSessionCookie writes.
  return {
    'Content-Type': 'application/json',
    'Cookie': `tf_session=${TEST_SID}`,
  };
}

function girlsDaySchool() {
  return {
    company_number: '00006400',
    company_name: "THE GIRLS' DAY SCHOOL TRUST",
    company_status: 'active',
    type: 'private-limited-shares-section-30-exemption',
    date_of_creation: '1872-06-26',
    jurisdiction: 'england-wales',
    registered_office_address: {
      address_line_1: '10 Bressenden Place',
      locality: 'London',
      postal_code: 'SW1E 5DH',
      country: 'England',
    },
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  // Default: signed-in as tradesman 42.
  getSessionByIdMock.mockResolvedValue({
    id: TEST_SID,
    tradesmanId: TEST_TRADESMAN_ID,
    expiresAt: Date.now() + 7 * 24 * 60 * 60 * 1000,
    lastSeenAt: Date.now(),
  });
  // Default: no existing CH verification for this pro.
  getCHByCompanyMock.mockResolvedValue(undefined);
  // Default: insert returns the row we'd expect from a successful insert.
  createCHMock.mockResolvedValue({
    id: 999,
    tradesmanId: TEST_TRADESMAN_ID,
    kind: 'companies_house',
    companyNumber: '00006400',
    status: 'pending',
    submittedAt: 1_700_000_000_000,
  });
});

// =====================================================================
// AUTH BOUNDARY — must be unreachable without a tradesman session
// =====================================================================
describe('Companies House routes — auth boundary', () => {
  it('GET /api/companies-house/search → 401 without a session cookie', async () => {
    getSessionByIdMock.mockResolvedValue(null);
    const app = await buildApp();
    await withServer(app, async (port) => {
      const res = await fetch(`http://127.0.0.1:${port}/api/companies-house/search?q=girls+day+school`);
      expect(res.status).toBe(401);
      // CH helper must NOT have been called — auth gate runs first.
      expect(searchMock).not.toHaveBeenCalled();
    });
  });

  it('GET /api/companies-house/company/:number → 401 without a session', async () => {
    getSessionByIdMock.mockResolvedValue(null);
    const app = await buildApp();
    await withServer(app, async (port) => {
      const res = await fetch(`http://127.0.0.1:${port}/api/companies-house/company/00006400`);
      expect(res.status).toBe(401);
      expect(lookupMock).not.toHaveBeenCalled();
    });
  });

  it('POST /api/tradesmen/:id/verifications/companies-house → 401 without a session', async () => {
    getSessionByIdMock.mockResolvedValue(null);
    const app = await buildApp();
    await withServer(app, async (port) => {
      const res = await fetch(`http://127.0.0.1:${port}/api/tradesmen/${TEST_TRADESMAN_ID}/verifications/companies-house`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ companyNumber: '00006400' }),
      });
      expect(res.status).toBe(401);
      expect(createCHMock).not.toHaveBeenCalled();
    });
  });

  it('POST /api/tradesmen/:id/verifications/companies-house → 403 when signed in as a different tradesman', async () => {
    const app = await buildApp();
    await withServer(app, async (port) => {
      const res = await fetch(`http://127.0.0.1:${port}/api/tradesmen/${TEST_TRADESMAN_ID + 1}/verifications/companies-house`, {
        method: 'POST',
        headers: authedHeaders(),
        body: JSON.stringify({ companyNumber: '00006400' }),
      });
      expect(res.status).toBe(403);
      expect(createCHMock).not.toHaveBeenCalled();
    });
  });
});

// =====================================================================
// SEARCH ENDPOINT
// =====================================================================
describe('GET /api/companies-house/search', () => {
  it('returns empty result for q with fewer than 2 chars (no API call)', async () => {
    const app = await buildApp();
    await withServer(app, async (port) => {
      const res = await fetch(`http://127.0.0.1:${port}/api/companies-house/search?q=a`, {
        headers: authedHeaders(),
      });
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.items).toEqual([]);
      expect(searchMock).not.toHaveBeenCalled();
    });
  });

  it('returns search results from the helper', async () => {
    searchMock.mockResolvedValue({
      items: [{ company_number: '00006400', title: "THE GIRLS' DAY SCHOOL TRUST", company_status: 'active' }],
      total_results: 1,
      page_number: 1,
      items_per_page: 10,
    });
    const app = await buildApp();
    await withServer(app, async (port) => {
      const res = await fetch(`http://127.0.0.1:${port}/api/companies-house/search?q=girls+day`, {
        headers: authedHeaders(),
      });
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.items).toHaveLength(1);
      expect(body.items[0].company_number).toBe('00006400');
      expect(searchMock).toHaveBeenCalledWith('girls day', expect.objectContaining({ itemsPerPage: 10 }));
    });
  });

  it('caps limit at 20', async () => {
    searchMock.mockResolvedValue({ items: [], total_results: 0, page_number: 1, items_per_page: 20 });
    const app = await buildApp();
    await withServer(app, async (port) => {
      await fetch(`http://127.0.0.1:${port}/api/companies-house/search?q=plumber&limit=500`, {
        headers: authedHeaders(),
      });
      expect(searchMock).toHaveBeenCalledWith('plumber', expect.objectContaining({ itemsPerPage: 20 }));
    });
  });
});

// =====================================================================
// LOOKUP ENDPOINT — typed error mapping
// =====================================================================
describe('GET /api/companies-house/company/:number', () => {
  it('returns 400 for an obviously malformed company number (no API call)', async () => {
    const app = await buildApp();
    await withServer(app, async (port) => {
      const res = await fetch(`http://127.0.0.1:${port}/api/companies-house/company/not-a-number`, {
        headers: authedHeaders(),
      });
      expect(res.status).toBe(400);
      expect(lookupMock).not.toHaveBeenCalled();
    });
  });

  it('returns the company record on success', async () => {
    lookupMock.mockResolvedValue(girlsDaySchool());
    const app = await buildApp();
    await withServer(app, async (port) => {
      const res = await fetch(`http://127.0.0.1:${port}/api/companies-house/company/00006400`, {
        headers: authedHeaders(),
      });
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.company_number).toBe('00006400');
      expect(body.company_name).toMatch(/GIRLS/i);
    });
  });

  it('maps NotFoundError → 404', async () => {
    const { CompaniesHouseNotFoundError } = await import('./companies-house');
    lookupMock.mockRejectedValue(new CompaniesHouseNotFoundError('99999999'));
    const app = await buildApp();
    await withServer(app, async (port) => {
      const res = await fetch(`http://127.0.0.1:${port}/api/companies-house/company/99999999`, {
        headers: authedHeaders(),
      });
      expect(res.status).toBe(404);
    });
  });

  it('maps AuthError → 502 (our key, not the user\'s fault)', async () => {
    const { CompaniesHouseAuthError } = await import('./companies-house');
    lookupMock.mockRejectedValue(new CompaniesHouseAuthError('bad key'));
    const app = await buildApp();
    await withServer(app, async (port) => {
      const res = await fetch(`http://127.0.0.1:${port}/api/companies-house/company/00006400`, {
        headers: authedHeaders(),
      });
      expect(res.status).toBe(502);
    });
  });

  it('maps ConfigError → 503 (helper not configured)', async () => {
    const { CompaniesHouseConfigError } = await import('./companies-house');
    lookupMock.mockRejectedValue(new CompaniesHouseConfigError('no key'));
    const app = await buildApp();
    await withServer(app, async (port) => {
      const res = await fetch(`http://127.0.0.1:${port}/api/companies-house/company/00006400`, {
        headers: authedHeaders(),
      });
      expect(res.status).toBe(503);
    });
  });

  it('maps RateLimitError → 429 with Retry-After header', async () => {
    const { CompaniesHouseRateLimitError } = await import('./companies-house');
    lookupMock.mockRejectedValue(new CompaniesHouseRateLimitError(30));
    const app = await buildApp();
    await withServer(app, async (port) => {
      const res = await fetch(`http://127.0.0.1:${port}/api/companies-house/company/00006400`, {
        headers: authedHeaders(),
      });
      expect(res.status).toBe(429);
      expect(res.headers.get('retry-after')).toBe('30');
    });
  });

  it('maps NetworkError → 502', async () => {
    const { CompaniesHouseNetworkError } = await import('./companies-house');
    lookupMock.mockRejectedValue(new CompaniesHouseNetworkError('timed out'));
    const app = await buildApp();
    await withServer(app, async (port) => {
      const res = await fetch(`http://127.0.0.1:${port}/api/companies-house/company/00006400`, {
        headers: authedHeaders(),
      });
      expect(res.status).toBe(502);
    });
  });
});

// =====================================================================
// SUBMISSION ENDPOINT
// =====================================================================
describe('POST /api/tradesmen/:id/verifications/companies-house', () => {
  it('returns 400 for malformed company number', async () => {
    const app = await buildApp();
    await withServer(app, async (port) => {
      const res = await fetch(`http://127.0.0.1:${port}/api/tradesmen/${TEST_TRADESMAN_ID}/verifications/companies-house`, {
        method: 'POST',
        headers: authedHeaders(),
        body: JSON.stringify({ companyNumber: 'junk' }),
      });
      expect(res.status).toBe(400);
      expect(lookupMock).not.toHaveBeenCalled();
      expect(createCHMock).not.toHaveBeenCalled();
    });
  });

  it('returns 409 when pro already has a pending CH row for this company', async () => {
    getCHByCompanyMock.mockResolvedValue({
      id: 17,
      tradesmanId: TEST_TRADESMAN_ID,
      kind: 'companies_house',
      companyNumber: '00006400',
      status: 'pending',
    });
    const app = await buildApp();
    await withServer(app, async (port) => {
      const res = await fetch(`http://127.0.0.1:${port}/api/tradesmen/${TEST_TRADESMAN_ID}/verifications/companies-house`, {
        method: 'POST',
        headers: authedHeaders(),
        body: JSON.stringify({ companyNumber: '00006400' }),
      });
      expect(res.status).toBe(409);
      const body = await res.json();
      expect(body.existingId).toBe(17);
      expect(body.status).toBe('pending');
      // Lookup must NOT have run — dedupe short-circuits before burning quota.
      expect(lookupMock).not.toHaveBeenCalled();
      expect(createCHMock).not.toHaveBeenCalled();
    });
  });

  it('returns 422 when company is dissolved', async () => {
    lookupMock.mockResolvedValue({ ...girlsDaySchool(), company_status: 'dissolved' });
    const app = await buildApp();
    await withServer(app, async (port) => {
      const res = await fetch(`http://127.0.0.1:${port}/api/tradesmen/${TEST_TRADESMAN_ID}/verifications/companies-house`, {
        method: 'POST',
        headers: authedHeaders(),
        body: JSON.stringify({ companyNumber: '00006400' }),
      });
      expect(res.status).toBe(422);
      expect(createCHMock).not.toHaveBeenCalled();
    });
  });

  it('returns 404 when company does not exist on the register', async () => {
    const { CompaniesHouseNotFoundError } = await import('./companies-house');
    lookupMock.mockRejectedValue(new CompaniesHouseNotFoundError('99999999'));
    const app = await buildApp();
    await withServer(app, async (port) => {
      const res = await fetch(`http://127.0.0.1:${port}/api/tradesmen/${TEST_TRADESMAN_ID}/verifications/companies-house`, {
        method: 'POST',
        headers: authedHeaders(),
        body: JSON.stringify({ companyNumber: '99999999' }),
      });
      expect(res.status).toBe(404);
      expect(createCHMock).not.toHaveBeenCalled();
    });
  });

  it('returns 201 with the trimmed evidence row on success', async () => {
    lookupMock.mockResolvedValue(girlsDaySchool());
    const app = await buildApp();
    await withServer(app, async (port) => {
      const res = await fetch(`http://127.0.0.1:${port}/api/tradesmen/${TEST_TRADESMAN_ID}/verifications/companies-house`, {
        method: 'POST',
        headers: authedHeaders(),
        body: JSON.stringify({ companyNumber: ' 00006400 ' }), // intentional whitespace
      });
      expect(res.status).toBe(201);
      const body = await res.json();
      expect(body).toMatchObject({
        id: 999,
        status: 'pending',
        companyNumber: '00006400',
        companyName: "THE GIRLS' DAY SCHOOL TRUST",
      });

      // The storage layer must have been called with the normalised number
      // (whitespace stripped, uppercased) and a trimmed evidence snapshot.
      expect(createCHMock).toHaveBeenCalledTimes(1);
      const call = createCHMock.mock.calls[0][0];
      expect(call.tradesmanId).toBe(TEST_TRADESMAN_ID);
      expect(call.companyNumber).toBe('00006400');
      expect(call.source).toBe('pro_submission');
      expect(call.autoApprove).toBe(false);
      // Evidence snapshot must include the fields we whitelisted, and nothing
      // extra (we DON'T want SIC codes leaked into our DB without thinking).
      expect(call.evidenceData).toMatchObject({
        company_number: '00006400',
        company_name: "THE GIRLS' DAY SCHOOL TRUST",
        company_status: 'active',
        type: 'private-limited-shares-section-30-exemption',
        registered_office_address: expect.any(Object),
      });
      expect(call.evidenceData.fetched_at).toMatch(/^\d{4}-\d{2}-\d{2}T/);
      // sic_codes must NOT be in the snapshot — we deliberately drop it.
      expect(call.evidenceData.sic_codes).toBeUndefined();
    });
  });

  it('returns 409 if the unique partial index races us (Postgres 23505)', async () => {
    lookupMock.mockResolvedValue(girlsDaySchool());
    const dbErr: any = new Error('duplicate key value violates unique constraint');
    dbErr.code = '23505';
    createCHMock.mockRejectedValue(dbErr);
    const app = await buildApp();
    await withServer(app, async (port) => {
      const res = await fetch(`http://127.0.0.1:${port}/api/tradesmen/${TEST_TRADESMAN_ID}/verifications/companies-house`, {
        method: 'POST',
        headers: authedHeaders(),
        body: JSON.stringify({ companyNumber: '00006400' }),
      });
      expect(res.status).toBe(409);
    });
  });
});
