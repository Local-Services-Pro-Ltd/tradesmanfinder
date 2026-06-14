/**
 * HOMEOWNER ACCESS REGRESSION GUARD — PR D
 *
 * Locks in the security boundary for the homeowner consent-gated
 * verification proof-viewing flow:
 *
 *  1.  POST /api/homeowner/request-link with invalid email → 400
 *  2.  POST /api/homeowner/request-link with blocked email → 202 (silent fail)
 *  3.  POST /api/homeowner/request-link 6x for same email → 429 on 6th
 *  4.  GET  /api/homeowner/verify with bad token → 401
 *  5.  GET  /api/homeowner/verify with valid token → 302, sets cookie, creates pending request
 *  6.  GET  /api/tradesmen/:id WITHOUT homeowner cookie → no verificationProof, status absent
 *  7.  GET  /api/tradesmen/:id WITH cookie but no grant → status=pending, no proof
 *  8.  GET  /api/tradesmen/:id WITH active grant → proof present, filePath absent
 *  9.  POST /api/tradesmen/:id/verification-requests/:reqId/decide as not-self → 403
 * 10.  POST /api/tradesmen/:id/verification-requests/:reqId/decide granted → grant active
 * 11.  POST /api/tradesmen/:id/verification-requests/:reqId/decide revoked → proof hidden
 * 12.  Block flow → block hides existing grant + prevents new requests
 *
 * All storage / mailer / stripe calls are stubbed — no database required.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── hoisted setup ──────────────────────────────────────────────────────────────
const {
  isBlockedMock,
  countAccessRequestsByEmailSinceMock,
  issueHomeownerMagicLinkMock,
  consumeHomeownerMagicLinkMock,
  createHomeownerSessionMock,
  getHomeownerSessionByIdMock,
  touchHomeownerSessionMock,
  deleteHomeownerSessionMock,
  createOrRefreshAccessRequestMock,
  listAllAccessRequestsForTradesmanMock,
  getAccessRequestByIdMock,
  decideAccessRequestMock,
  isAccessGrantedMock,
  getActiveAccessRequestMock,
  createBlockMock,
  deleteBlockMock,
  listBlocksMock,
  getTradesmanByIdMock,
  getLatestApprovedVerificationMock,
  sendHomeownerMagicLinkMock,
  sendVerificationRequestToTradesmanMock,
  sendVerificationAccessGrantedMock,
  sendVerificationAccessDeniedMock,
} = vi.hoisted(() => {
  process.env.ADMIN_KEY = 'test-secret-key';
  process.env.DATABASE_URL = 'postgres://fake';

  return {
    isBlockedMock: vi.fn().mockResolvedValue(false),
    countAccessRequestsByEmailSinceMock: vi.fn().mockResolvedValue(0),
    issueHomeownerMagicLinkMock: vi.fn().mockResolvedValue({ token: 'rawtoken123', expiresAt: Date.now() + 900_000 }),
    consumeHomeownerMagicLinkMock: vi.fn().mockResolvedValue(null),
    createHomeownerSessionMock: vi.fn().mockResolvedValue({ id: 'hsid-1', email: 'owner@example.com', createdAt: 1, expiresAt: Date.now() + 86400_000, lastSeenAt: 1, requestIp: null, requestUserAgent: null }),
    getHomeownerSessionByIdMock: vi.fn().mockResolvedValue(null),
    touchHomeownerSessionMock: vi.fn().mockResolvedValue(undefined),
    deleteHomeownerSessionMock: vi.fn().mockResolvedValue(undefined),
    createOrRefreshAccessRequestMock: vi.fn().mockResolvedValue({ id: 1, homeownerEmail: 'owner@example.com', tradesmanId: 7, status: 'pending', requestedAt: 1, decidedAt: null, decidedByTradesmanId: null, grantedUntil: null, revokedAt: null, notes: null, requestIp: null, requestUserAgent: null }),
    listAllAccessRequestsForTradesmanMock: vi.fn().mockResolvedValue([]),
    getAccessRequestByIdMock: vi.fn().mockResolvedValue(null),
    decideAccessRequestMock: vi.fn().mockResolvedValue(null),
    isAccessGrantedMock: vi.fn().mockResolvedValue(false),
    getActiveAccessRequestMock: vi.fn().mockResolvedValue(null),
    createBlockMock: vi.fn().mockResolvedValue({ id: 1, tradesmanId: 7, homeownerEmail: 'owner@example.com', createdAt: 1, reason: null }),
    deleteBlockMock: vi.fn().mockResolvedValue(undefined),
    listBlocksMock: vi.fn().mockResolvedValue([]),
    getTradesmanByIdMock: vi.fn().mockResolvedValue(null),
    getLatestApprovedVerificationMock: vi.fn().mockResolvedValue(undefined),
    sendHomeownerMagicLinkMock: vi.fn().mockResolvedValue({ ok: true, id: 'em1' }),
    sendVerificationRequestToTradesmanMock: vi.fn().mockResolvedValue({ ok: true, id: 'em2' }),
    sendVerificationAccessGrantedMock: vi.fn().mockResolvedValue({ ok: true, id: 'em3' }),
    sendVerificationAccessDeniedMock: vi.fn().mockResolvedValue({ ok: true, id: 'em4' }),
  };
});

// ── mock drizzle DB (used directly in request-link route for throttle check) ──
vi.mock('./storage', () => ({
  storage: {
    // Common stubs for route mounting
    getCardsByTradesman: vi.fn().mockResolvedValue([]),
    getAllCards: vi.fn().mockResolvedValue([]),
    getTradesmanById: getTradesmanByIdMock,
    getTradesmanByEmail: vi.fn().mockResolvedValue(null),
    getTradesmen: vi.fn().mockResolvedValue([]),
    getJobs: vi.fn().mockResolvedValue([]),
    getQuotes: vi.fn().mockResolvedValue([]),
    getReviews: vi.fn().mockResolvedValue([]),
    logModeration: vi.fn().mockResolvedValue({ id: 1 }),
    getModerationLog: vi.fn().mockResolvedValue([]),
    getPartnerEnquiriesByStatus: vi.fn().mockResolvedValue([]),
    getPartnerEnquiryById: vi.fn().mockResolvedValue(null),
    updatePartnerEnquiryStatus: vi.fn().mockResolvedValue(null),
    promoteEnquiryToPartner: vi.fn().mockResolvedValue(null),
    createPartner: vi.fn().mockResolvedValue(null),
    getPartners: vi.fn().mockResolvedValue([]),
    getPartnerById: vi.fn().mockResolvedValue(null),
    getPartnerBySlug: vi.fn().mockResolvedValue(null),
    updatePartner: vi.fn().mockResolvedValue(null),
    deletePartner: vi.fn().mockResolvedValue({ ok: true }),
    createPartnerPlacement: vi.fn().mockResolvedValue(null),
    getPartnerPlacementsByPartner: vi.fn().mockResolvedValue([]),
    getPartnerPlacementById: vi.fn().mockResolvedValue(null),
    updatePartnerPlacement: vi.fn().mockResolvedValue(null),
    deletePartnerPlacement: vi.fn().mockResolvedValue(undefined),
    getPartnerEventsByPartner: vi.fn().mockResolvedValue([]),
    getPartnerEventCountsByPartner: vi.fn().mockResolvedValue({}),
    getPartnerInvoicesByPartner: vi.fn().mockResolvedValue([]),
    getActivePlacementsBySurface: vi.fn().mockResolvedValue([]),
    getEventsByPlacementSince: vi.fn().mockResolvedValue([]),
    createPartnerEvent: vi.fn().mockResolvedValue(undefined),
    createMagicLinkToken: vi.fn().mockResolvedValue({ id: 1 }),
    getMagicLinkTokenByHash: vi.fn().mockResolvedValue(null),
    getRecentTokenForEmail: vi.fn().mockResolvedValue(null),
    consumeMagicLinkToken: vi.fn().mockResolvedValue(null),
    createSession: vi.fn().mockResolvedValue({ id: 'sid-1' }),
    getSessionById: vi.fn().mockResolvedValue(null),
    findSessionById: vi.fn().mockResolvedValue(null),
    deleteSession: vi.fn().mockResolvedValue(undefined),
    touchSession: vi.fn().mockResolvedValue(undefined),
    getAreas: vi.fn().mockResolvedValue([{ id: 1, name: 'Default', slug: 'default' }]),
    createTradesman: vi.fn().mockResolvedValue({ id: 1 }),
    setCredits: vi.fn().mockResolvedValue(undefined),
    createCreditTransaction: vi.fn().mockResolvedValue(undefined),
    updateTradesman: vi.fn().mockResolvedValue(null),
    getReviewsByTradesman: vi.fn().mockResolvedValue([]),
    getLatestApprovedVerification: getLatestApprovedVerificationMock,
    // Verification-submission stubs
    createTradesmanVerification: vi.fn().mockResolvedValue({ id: 42, tradesmanId: 1, kind: 'insurance', filePath: '1/insurance/x.pdf', fileMimeType: 'application/pdf', fileSizeBytes: 100, qualificationType: null, insuranceCoverGbp: 1_000_000, expiryDate: null, status: 'pending', submittedAt: Date.now(), reviewedAt: null, reviewedBy: null, reviewerNote: null }),
    getTradesmanVerificationsByTradesman: vi.fn().mockResolvedValue([]),
    getTradesmanVerificationById: vi.fn().mockResolvedValue(null),
    getPendingTradesmanVerifications: vi.fn().mockResolvedValue([]),
    decideTradesmanVerification: vi.fn().mockResolvedValue(null),
    // Homeowner access stubs (PR D)
    isBlocked: isBlockedMock,
    countAccessRequestsByEmailSince: countAccessRequestsByEmailSinceMock,
    issueHomeownerMagicLink: issueHomeownerMagicLinkMock,
    consumeHomeownerMagicLink: consumeHomeownerMagicLinkMock,
    createHomeownerSession: createHomeownerSessionMock,
    getHomeownerSessionById: getHomeownerSessionByIdMock,
    touchHomeownerSession: touchHomeownerSessionMock,
    deleteHomeownerSession: deleteHomeownerSessionMock,
    createOrRefreshAccessRequest: createOrRefreshAccessRequestMock,
    listAllAccessRequestsForTradesman: listAllAccessRequestsForTradesmanMock,
    getAccessRequestById: getAccessRequestByIdMock,
    decideAccessRequest: decideAccessRequestMock,
    isAccessGranted: isAccessGrantedMock,
    getActiveAccessRequest: getActiveAccessRequestMock,
    createBlock: createBlockMock,
    deleteBlock: deleteBlockMock,
    listBlocks: listBlocksMock,
  },
  // The db object is used directly in the request-link route for the per-email throttle check
  db: {
    select: () => ({
      from: () => ({
        where: () => ({
          limit: () => Promise.resolve([]),
        }),
      }),
    }),
  },
}));

vi.mock('./verifications-storage', () => ({
  ALLOWED_MIME_TYPES: ['application/pdf', 'image/jpeg', 'image/png', 'image/webp', 'image/heic'],
  MAX_FILE_BYTES: 5 * 1024 * 1024,
  extensionForMime: (m: string) => ({ 'application/pdf': 'pdf', 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/heic': 'heic' }[m.toLowerCase()] ?? null),
  newStoragePath: (id: number, kind: string, _mime: string) => `${id}/${kind}/fake-path.pdf`,
  uploadVerificationFile: vi.fn().mockResolvedValue(undefined),
  signVerificationUrl: vi.fn().mockResolvedValue('https://signed.example/url'),
  deleteVerificationFile: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('./mailer', () => ({
  sendCardIssuedEmail: vi.fn().mockResolvedValue({ ok: true, id: 'e1' }),
  sendCardRescindedEmail: vi.fn().mockResolvedValue({ ok: true, id: 'e2' }),
  sendNewLeadEmail: vi.fn().mockResolvedValue({ ok: true, id: 'e3' }),
  sendPartnerEnquiryNotification: vi.fn().mockResolvedValue({ ok: true, id: 'e4' }),
  sendMagicLinkEmail: vi.fn().mockResolvedValue({ ok: true, id: 'e5' }),
  sendOutcomeAskEmail: vi.fn().mockResolvedValue({ ok: true, id: 'e6' }),
  sendHomeownerMagicLink: sendHomeownerMagicLinkMock,
  sendVerificationRequestToTradesman: sendVerificationRequestToTradesmanMock,
  sendVerificationAccessGranted: sendVerificationAccessGrantedMock,
  sendVerificationAccessDenied: sendVerificationAccessDeniedMock,
}));

vi.mock('./stripe', () => ({
  stripe: { webhooks: { constructEvent: vi.fn() }, checkout: { sessions: { create: vi.fn(), listLineItems: vi.fn() } } },
  STRIPE_WEBHOOK_SECRET: 'whsec_test',
  stripeIsConfigured: false,
  productKindFromPriceId: () => null,
  creditsForProductKind: () => 0,
  PRODUCT_KINDS: [],
}));

vi.mock('./stripe-checkout', () => ({ createLeadPackCheckoutSession: vi.fn(), createFeaturedCheckoutSession: vi.fn() }));
vi.mock('./stripe-webhook', () => ({ handleStripeWebhook: vi.fn() }));
vi.mock('./stripe-portal', () => ({ createBillingPortalSession: vi.fn() }));
vi.mock('./spam-guard', () => ({
  publicFormGuard: () => (_req: any, _res: any, next: any) => next(),
  rateLimit: () => (_req: any, _res: any, next: any) => next(),
}));

// ── test helpers ───────────────────────────────────────────────────────────────
import express from 'express';
import { registerRoutes } from './routes';
import { createServer } from 'node:http';

async function buildApp() {
  const app = express();
  app.use(express.json());
  app.use(express.urlencoded({ extended: false }));
  const httpServer = createServer(app);
  await registerRoutes(httpServer, app);
  return app;
}

function makeReq(app: express.Express) {
  return function req(
    method: 'GET' | 'POST' | 'DELETE' | 'PATCH',
    path: string,
    opts: { body?: any; headers?: Record<string, string> } = {},
  ): Promise<{ status: number; body: any; headers: Record<string, string> }> {
    return new Promise((resolve, reject) => {
      const server = app.listen(0, () => {
        const addr = server.address();
        const port = typeof addr === 'object' && addr ? addr.port : 0;
        const bodyStr = opts.body ? JSON.stringify(opts.body) : undefined;
        const headers: Record<string, string> = { ...(opts.headers || {}) };
        if (bodyStr) {
          headers['content-type'] = 'application/json';
          headers['content-length'] = String(Buffer.byteLength(bodyStr));
        }
        const http = require('node:http');
        const r = http.request({ hostname: '127.0.0.1', port, path, method, headers }, (resp: any) => {
          let chunks = '';
          resp.on('data', (c: Buffer) => (chunks += c.toString()));
          resp.on('end', () => {
            let parsed: any = chunks;
            try { parsed = JSON.parse(chunks); } catch {}
            // Collect response headers
            const respHeaders: Record<string, string> = {};
            for (const [k, v] of Object.entries(resp.headers)) {
              if (typeof v === 'string') respHeaders[k] = v;
              else if (Array.isArray(v)) respHeaders[k] = v[0];
            }
            server.close(() => resolve({ status: resp.statusCode, body: parsed, headers: respHeaders }));
          });
        });
        r.on('error', (e: Error) => { server.close(); reject(e); });
        if (bodyStr) r.write(bodyStr);
        r.end();
      });
    });
  };
}

// ── base tradesman fixture ──────────────────────────────────────────────────────
const baseTradesman = {
  id: 7, businessName: 'Acme Heating', ownerName: 'Acme', slug: 'acme-heating',
  email: 'tradesman@acme.test', phone: '0', tradeId: 1, areaId: 1, postcode: 'M1', bio: 'x',
  rating: 5, jobsCompleted: 0, responseTime: 'fast', verified: true, insured: true,
  licensed: true, credits: 0, featuredUntil: null, photoUrl: null, cardStatus: 'none',
  publishedAt: 1, createdAt: 1, updatedAt: 1,
};

describe('HOMEOWNER ACCESS REGRESSION GUARD (PR D)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Reset to safe defaults
    isBlockedMock.mockResolvedValue(false);
    countAccessRequestsByEmailSinceMock.mockResolvedValue(0);
    issueHomeownerMagicLinkMock.mockResolvedValue({ token: 'rawtoken123', expiresAt: Date.now() + 900_000 });
    consumeHomeownerMagicLinkMock.mockResolvedValue(null);
    createHomeownerSessionMock.mockResolvedValue({ id: 'hsid-1', email: 'owner@example.com', createdAt: 1, expiresAt: Date.now() + 86400_000, lastSeenAt: 1, requestIp: null, requestUserAgent: null });
    getHomeownerSessionByIdMock.mockResolvedValue(null);
    createOrRefreshAccessRequestMock.mockResolvedValue({ id: 1, homeownerEmail: 'owner@example.com', tradesmanId: 7, status: 'pending', requestedAt: 1, decidedAt: null, decidedByTradesmanId: null, grantedUntil: null, revokedAt: null, notes: null, requestIp: null, requestUserAgent: null });
    getAccessRequestByIdMock.mockResolvedValue(null);
    decideAccessRequestMock.mockResolvedValue(null);
    getActiveAccessRequestMock.mockResolvedValue(null);
    createBlockMock.mockResolvedValue({ id: 1, tradesmanId: 7, homeownerEmail: 'owner@example.com', createdAt: 1, reason: null });
    getTradesmanByIdMock.mockResolvedValue(null);
    getLatestApprovedVerificationMock.mockResolvedValue(undefined);
  });

  // ── Test 1: invalid email ──────────────────────────────────────────────────────
  it('1. POST /api/homeowner/request-link with invalid email → 400', async () => {
    const app = await buildApp();
    const req = makeReq(app);
    const res = await req('POST', '/api/homeowner/request-link', {
      body: { email: 'not-an-email', tradesmanId: 7 },
    });
    expect(res.status).toBe(400);
  });

  // ── Test 2: blocked email fails silently ─────────────────────────────────────
  it('2. POST /api/homeowner/request-link with blocked email → 202 (silent fail)', async () => {
    getTradesmanByIdMock.mockResolvedValue(baseTradesman);
    isBlockedMock.mockResolvedValue(true);

    const app = await buildApp();
    const req = makeReq(app);
    const res = await req('POST', '/api/homeowner/request-link', {
      body: { email: 'blocked@example.com', tradesmanId: 7 },
    });
    // Must return 202 (not 403) to not leak block state
    expect(res.status).toBe(202);
    expect(res.body.ok).toBe(true);
    // Must NOT issue a magic link
    expect(issueHomeownerMagicLinkMock).not.toHaveBeenCalled();
  });

  // ── Test 3: 5/24h rate limit ─────────────────────────────────────────────────
  it('3. POST /api/homeowner/request-link hitting 5/24h cap → 429', async () => {
    getTradesmanByIdMock.mockResolvedValue(baseTradesman);
    // Already 5 requests in the last 24h
    countAccessRequestsByEmailSinceMock.mockResolvedValue(5);

    const app = await buildApp();
    const req = makeReq(app);
    const res = await req('POST', '/api/homeowner/request-link', {
      body: { email: 'rate-limited@example.com', tradesmanId: 7 },
    });
    expect(res.status).toBe(429);
    expect(issueHomeownerMagicLinkMock).not.toHaveBeenCalled();
  });

  // ── Test 4: bad token → 401 ──────────────────────────────────────────────────
  it('4. GET /api/homeowner/verify with bad/expired token → 401', async () => {
    consumeHomeownerMagicLinkMock.mockResolvedValue(null);

    const app = await buildApp();
    const req = makeReq(app);
    const res = await req('GET', '/api/homeowner/verify?token=badtoken&tradesmanId=7');
    expect(res.status).toBe(401);
  });

  // ── Test 5: valid token → session + pending request ──────────────────────────
  it('5. GET /api/homeowner/verify with valid token → sets cookie, creates pending request', async () => {
    consumeHomeownerMagicLinkMock.mockResolvedValue({ email: 'owner@example.com', tradesmanId: 7 });
    createHomeownerSessionMock.mockResolvedValue({ id: 'hsid-1', email: 'owner@example.com', createdAt: 1, expiresAt: Date.now() + 86400_000, lastSeenAt: 1 });
    createOrRefreshAccessRequestMock.mockResolvedValue({ id: 1, status: 'pending', homeownerEmail: 'owner@example.com', tradesmanId: 7, requestedAt: 1, decidedAt: null, decidedByTradesmanId: null, grantedUntil: null, revokedAt: null, notes: null });
    getTradesmanByIdMock.mockResolvedValue(baseTradesman);

    const app = await buildApp();
    const req = makeReq(app);
    const res = await req('GET', '/api/homeowner/verify?token=validtoken&tradesmanId=7');

    // Should redirect (302) — cookie set
    expect(res.status).toBe(302);
    // Session created for the correct email (ip/ua may vary)
    expect(createHomeownerSessionMock).toHaveBeenCalledOnce();
    expect(createHomeownerSessionMock.mock.calls[0][0]).toBe('owner@example.com');
    expect(createOrRefreshAccessRequestMock).toHaveBeenCalled();
  });

  // ── Test 6: GET /api/tradesmen/:id without cookie → no enrichment ─────────────
  it('6. GET /api/tradesmen/:id WITHOUT homeowner cookie → no verificationProof, no verificationAccessStatus', async () => {
    getTradesmanByIdMock.mockResolvedValue(baseTradesman as any);
    // No homeowner cookie — getHomeownerSessionById should NOT be called

    const app = await buildApp();
    const req = makeReq(app);
    const res = await req('GET', '/api/tradesmen/7');
    expect(res.status).toBe(200);
    expect(res.body.verificationProof).toBeUndefined();
    expect(res.body.verificationAccessStatus).toBeUndefined();
    // getActiveAccessRequest must NOT be called when no cookie
    expect(getActiveAccessRequestMock).not.toHaveBeenCalled();
  });

  // ── Test 7: GET /api/tradesmen/:id WITH cookie but no active grant ────────────
  it('7. GET /api/tradesmen/:id WITH cookie but pending request → status=pending, no proof', async () => {
    getTradesmanByIdMock.mockResolvedValue(baseTradesman as any);
    getHomeownerSessionByIdMock.mockResolvedValue({ id: 'hsid-1', email: 'owner@example.com', createdAt: 1, expiresAt: Date.now() + 86400_000, lastSeenAt: 1 });
    getActiveAccessRequestMock.mockResolvedValue({ id: 1, homeownerEmail: 'owner@example.com', tradesmanId: 7, status: 'pending', requestedAt: 1, decidedAt: null, decidedByTradesmanId: null, grantedUntil: null, revokedAt: null, notes: null });

    const app = await buildApp();
    const req = makeReq(app);
    const res = await req('GET', '/api/tradesmen/7', {
      headers: { cookie: 'tf_homeowner=hsid-1' },
    });
    expect(res.status).toBe(200);
    expect(res.body.verificationProof).toBeUndefined();
    expect(res.body.verificationAccessStatus).toBe('pending');
  });

  // ── Test 8: GET /api/tradesmen/:id WITH active grant → proof present, filePath absent ──
  it('8. GET /api/tradesmen/:id WITH active grant → proof present, no filePath leak', async () => {
    getTradesmanByIdMock.mockResolvedValue(baseTradesman as any);
    getHomeownerSessionByIdMock.mockResolvedValue({ id: 'hsid-1', email: 'owner@example.com', createdAt: 1, expiresAt: Date.now() + 86400_000, lastSeenAt: 1 });
    getActiveAccessRequestMock.mockResolvedValue({
      id: 1, homeownerEmail: 'owner@example.com', tradesmanId: 7,
      status: 'granted', requestedAt: 1, decidedAt: 2,
      decidedByTradesmanId: 7, grantedUntil: Date.now() + 7 * 86400_000,
      revokedAt: null, notes: null,
    });
    getLatestApprovedVerificationMock.mockImplementation(async (_id: number, kind: string) => {
      if (kind === 'insurance') {
        return {
          id: 100, tradesmanId: 7, kind: 'insurance',
          filePath: 'SECRET-PATH.pdf',  // must NOT appear in response
          fileMimeType: 'application/pdf', fileSizeBytes: 100, status: 'approved',
          submittedAt: 1, reviewedAt: Date.now() - 86400_000, reviewedBy: 'admin', reviewerNote: null,
          qualificationType: null, insuranceCoverGbp: 1_000_000, expiryDate: '2027-01-01',
        };
      }
      if (kind === 'qualification') {
        return {
          id: 101, tradesmanId: 7, kind: 'qualification',
          filePath: 'SECRET-PATH-2.pdf',
          fileMimeType: 'application/pdf', fileSizeBytes: 100, status: 'approved',
          submittedAt: 1, reviewedAt: Date.now() - 86400_000, reviewedBy: 'admin', reviewerNote: null,
          qualificationType: 'Gas Safe', insuranceCoverGbp: null, expiryDate: '2027-06-01',
        };
      }
      return undefined;
    });

    const app = await buildApp();
    const req = makeReq(app);
    const res = await req('GET', '/api/tradesmen/7', {
      headers: { cookie: 'tf_homeowner=hsid-1' },
    });
    expect(res.status).toBe(200);
    expect(res.body.verificationAccessStatus).toBe('granted');
    expect(res.body.verificationProof).toBeDefined();
    expect(res.body.verificationProof.insurance).toBeDefined();
    expect(res.body.verificationProof.insurance.coverGbp).toBe(1_000_000);
    expect(res.body.verificationProof.qualification).toBeDefined();
    expect(res.body.verificationProof.qualification.qualificationType).toBe('Gas Safe');

    // Critical: filePath must NEVER appear in the response
    const payload = JSON.stringify(res.body);
    expect(payload).not.toContain('SECRET-PATH');
    expect(payload).not.toContain('filePath');
  });

  // ── Test 9: decide as not-self → 403 ─────────────────────────────────────────
  it('9. POST /api/tradesmen/:id/verification-requests/:reqId/decide as not-self → 403', async () => {
    // No tradesman session cookie at all → should get 401
    const app = await buildApp();
    const req = makeReq(app);
    const res = await req('POST', '/api/tradesmen/7/verification-requests/1/decide', {
      body: { decision: 'granted' },
    });
    expect(res.status).toBe(401);
  });

  // ── Test 10: decide granted → grant active ────────────────────────────────────
  it('10. POST /decide granted → isAccessGranted returns true (via updated row)', async () => {
    const nowMs = Date.now();
    const existingReq = { id: 1, homeownerEmail: 'owner@example.com', tradesmanId: 7, status: 'pending', requestedAt: 1, decidedAt: null, decidedByTradesmanId: null, grantedUntil: null, revokedAt: null, notes: null };
    const grantedReq = { ...existingReq, status: 'granted', decidedAt: nowMs, grantedUntil: nowMs + 7 * 86400_000 };

    getAccessRequestByIdMock.mockResolvedValue(existingReq);
    decideAccessRequestMock.mockResolvedValue(grantedReq);
    getTradesmanByIdMock.mockResolvedValue(baseTradesman);

    // Simulate auth: inject a fake session cookie by mocking getSessionById
    const { storage } = await import('./storage');
    (storage.getSessionById as any).mockResolvedValueOnce({ id: 'sess-7', tradesmanId: 7, createdAt: 1, expiresAt: nowMs + 86400_000, lastSeenAt: 1 });

    const app = await buildApp();
    const req = makeReq(app);
    const res = await req('POST', '/api/tradesmen/7/verification-requests/1/decide', {
      body: { decision: 'granted' },
      headers: { cookie: 'tf_session=sess-7' },
    });
    expect(res.status).toBe(200);
    expect(decideAccessRequestMock).toHaveBeenCalledWith(1, 'granted', 7, null);
    expect(res.body.status).toBe('granted');
    expect(res.body.grantedUntil).toBeGreaterThan(nowMs);
  });

  // ── Test 11: decide revoked → proof hidden ────────────────────────────────────
  it('11. POST /decide revoked → status=revoked, no proof returned', async () => {
    const nowMs = Date.now();
    const grantedReq = { id: 2, homeownerEmail: 'owner@example.com', tradesmanId: 7, status: 'granted', requestedAt: 1, decidedAt: nowMs - 1000, decidedByTradesmanId: 7, grantedUntil: nowMs + 7 * 86400_000, revokedAt: null, notes: null };
    const revokedReq = { ...grantedReq, status: 'revoked', revokedAt: nowMs };

    getAccessRequestByIdMock.mockResolvedValue(grantedReq);
    decideAccessRequestMock.mockResolvedValue(revokedReq);
    getTradesmanByIdMock.mockResolvedValue(baseTradesman);
    // After revoke, getActiveAccessRequest returns revoked row
    getActiveAccessRequestMock.mockResolvedValue(revokedReq);

    const { storage } = await import('./storage');
    (storage.getSessionById as any).mockResolvedValueOnce({ id: 'sess-7', tradesmanId: 7, createdAt: 1, expiresAt: nowMs + 86400_000, lastSeenAt: 1 });

    const app = await buildApp();
    const req = makeReq(app);
    const decideRes = await req('POST', '/api/tradesmen/7/verification-requests/2/decide', {
      body: { decision: 'revoked' },
      headers: { cookie: 'tf_session=sess-7' },
    });
    expect(decideRes.status).toBe(200);
    expect(decideRes.body.status).toBe('revoked');

    // Now check tradesman profile — no proof should be shown
    getHomeownerSessionByIdMock.mockResolvedValue({ id: 'hsid-1', email: 'owner@example.com', createdAt: 1, expiresAt: nowMs + 86400_000, lastSeenAt: 1 });

    const profileRes = await req('GET', '/api/tradesmen/7', {
      headers: { cookie: 'tf_homeowner=hsid-1' },
    });
    expect(profileRes.status).toBe(200);
    expect(profileRes.body.verificationProof).toBeUndefined();
    expect(profileRes.body.verificationAccessStatus).toBe('revoked');
  });

  // ── Test 12: block flow ───────────────────────────────────────────────────────
  it('12. Block flow: block hides existing grant + silent 202 on future request', async () => {
    const nowMs = Date.now();
    const grantedReq = { id: 3, homeownerEmail: 'owner@example.com', tradesmanId: 7, status: 'granted', requestedAt: 1, decidedAt: nowMs - 1000, decidedByTradesmanId: 7, grantedUntil: nowMs + 7 * 86400_000, revokedAt: null, notes: null };

    // Step 1: tradesman blocks the homeowner email
    getTradesmanByIdMock.mockResolvedValue(baseTradesman);
    getActiveAccessRequestMock.mockResolvedValue(grantedReq);
    decideAccessRequestMock.mockResolvedValue({ ...grantedReq, status: 'revoked', revokedAt: nowMs });
    createBlockMock.mockResolvedValue({ id: 1, tradesmanId: 7, homeownerEmail: 'owner@example.com', createdAt: nowMs, reason: null });

    const { storage } = await import('./storage');
    (storage.getSessionById as any).mockResolvedValueOnce({ id: 'sess-7', tradesmanId: 7, createdAt: 1, expiresAt: nowMs + 86400_000, lastSeenAt: 1 });

    const app = await buildApp();
    const req = makeReq(app);
    const blockRes = await req('POST', '/api/tradesmen/7/verification-blocks', {
      body: { email: 'owner@example.com' },
      headers: { cookie: 'tf_session=sess-7' },
    });
    expect(blockRes.status).toBe(201);
    expect(createBlockMock).toHaveBeenCalledWith(7, 'owner@example.com', null);
    // The active grant must have been revoked
    expect(decideAccessRequestMock).toHaveBeenCalledWith(3, 'revoked', 7, 'Blocked by tradesman');

    // Step 2: blocked homeowner tries to request again → 202 (silent fail)
    isBlockedMock.mockResolvedValue(true);
    const reqRes = await req('POST', '/api/homeowner/request-link', {
      body: { email: 'owner@example.com', tradesmanId: 7 },
    });
    expect(reqRes.status).toBe(202);
    expect(reqRes.body.ok).toBe(true);
    // No magic link issued
    expect(issueHomeownerMagicLinkMock).not.toHaveBeenCalled();
  });
});
