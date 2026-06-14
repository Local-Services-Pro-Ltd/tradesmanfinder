/**
 * VERIFICATIONS REGRESSION GUARD — PR A
 *
 * Locks in the security boundary for the tradesman verification routes:
 *
 *  1. POST   /api/tradesmen/:id/verifications        — auth required (401 w/o cookie)
 *  2. GET    /api/tradesmen/:id/verifications        — auth required (401 w/o cookie)
 *  3. GET    /api/admin/verifications/pending        — admin key required (401 w/o key)
 *  4. GET    /api/admin/verifications/:id/file-url   — admin key required (401 w/o key)
 *  5. POST   /api/admin/verifications/:id/decide     — admin key required (401 w/o key)
 *  6. Approving an "insurance" verification flips `tradesmen.insured=true`
 *     via storage.updateTradesman (PATCH /api/tradesmen/:id cannot do this —
 *     it strips `insured`/`licensed` from the body — so this is the only path).
 *
 * All storage / Supabase Storage calls are stubbed — no DB or network required.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { updateTradesmanMock, decideTradesmanVerificationMock, getTradesmanVerificationByIdMock, getTradesmanByIdMock, getLatestApprovedVerificationMock, sendVerificationApprovedMock, sendVerificationRejectedMock } = vi.hoisted(() => {
  process.env.ADMIN_KEY = 'test-secret-key';
  process.env.DATABASE_URL = 'postgres://fake';
  return {
    updateTradesmanMock: vi.fn().mockResolvedValue({ id: 1 }),
    decideTradesmanVerificationMock: vi.fn(),
    getTradesmanVerificationByIdMock: vi.fn(),
    getTradesmanByIdMock: vi.fn().mockResolvedValue(null),
    getLatestApprovedVerificationMock: vi.fn().mockResolvedValue(undefined),
    sendVerificationApprovedMock: vi.fn().mockResolvedValue({ ok: true }),
    sendVerificationRejectedMock: vi.fn().mockResolvedValue({ ok: true }),
  };
});

// Mock the mailer so decide-route email sends are observable and never hit the
// network. Only the transactional senders that routes.ts imports are stubbed.
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
  sendVerificationApproved: sendVerificationApprovedMock,
  sendVerificationRejected: sendVerificationRejectedMock,
}));

// Stub the Supabase Storage helpers so we don't need a real bucket or key.
vi.mock('./verifications-storage', () => ({
  ALLOWED_MIME_TYPES: ['application/pdf', 'image/jpeg', 'image/png', 'image/webp', 'image/heic'],
  MAX_FILE_BYTES: 5 * 1024 * 1024,
  extensionForMime: (m: string) => ({ 'application/pdf': 'pdf', 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/heic': 'heic' }[m.toLowerCase()] ?? null),
  newStoragePath: (id: number, kind: string, _mime: string) => `${id}/${kind}/fake-path.pdf`,
  uploadVerificationFile: vi.fn().mockResolvedValue(undefined),
  signVerificationUrl: vi.fn().mockResolvedValue('https://signed.example/url'),
  deleteVerificationFile: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('./storage', () => ({
  storage: {
    // Mounting stubs (copied from auth-regression.test.ts)
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
    updateTradesman: updateTradesmanMock,
    getReviewsByTradesman: vi.fn().mockResolvedValue([]),

    // Verification-specific stubs
    createTradesmanVerification: vi.fn().mockResolvedValue({
      id: 42, tradesmanId: 1, kind: 'insurance', filePath: '1/insurance/x.pdf',
      fileMimeType: 'application/pdf', fileSizeBytes: 100, qualificationType: null,
      insuranceCoverGbp: 1_000_000, expiryDate: null, status: 'pending',
      submittedAt: Date.now(), reviewedAt: null, reviewedBy: null, reviewerNote: null,
    }),
    getTradesmanVerificationsByTradesman: vi.fn().mockResolvedValue([]),
    getTradesmanVerificationById: getTradesmanVerificationByIdMock,
    getPendingTradesmanVerifications: vi.fn().mockResolvedValue([]),
    decideTradesmanVerification: decideTradesmanVerificationMock,
    getLatestApprovedVerification: getLatestApprovedVerificationMock,
  },
  db: {},
}));

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

async function req(
  app: express.Express,
  method: 'GET' | 'POST',
  path: string,
  opts: { body?: any; headers?: Record<string, string> } = {},
): Promise<{ status: number; body: any }> {
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
      // Use node's http client
      const http = require('node:http');
      const r = http.request({ hostname: '127.0.0.1', port, path, method, headers }, (resp: any) => {
        let chunks = '';
        resp.on('data', (c: Buffer) => (chunks += c.toString()));
        resp.on('end', () => {
          let parsed: any = chunks;
          try { parsed = JSON.parse(chunks); } catch {}
          server.close(() => resolve({ status: resp.statusCode, body: parsed }));
        });
      });
      r.on('error', (e: Error) => { server.close(); reject(e); });
      if (bodyStr) r.write(bodyStr);
      r.end();
    });
  });
}

describe('VERIFICATIONS REGRESSION GUARD (PR A)', () => {
  beforeEach(() => {
    updateTradesmanMock.mockClear();
    decideTradesmanVerificationMock.mockReset();
    getTradesmanVerificationByIdMock.mockReset();
    getTradesmanByIdMock.mockReset();
    getTradesmanByIdMock.mockResolvedValue(null);
    getLatestApprovedVerificationMock.mockReset();
    getLatestApprovedVerificationMock.mockResolvedValue(undefined);
    sendVerificationApprovedMock.mockReset();
    sendVerificationApprovedMock.mockResolvedValue({ ok: true });
    sendVerificationRejectedMock.mockReset();
    sendVerificationRejectedMock.mockResolvedValue({ ok: true });
  });

  describe('🔐 Tradesman-facing routes require auth', () => {
    it('POST /api/tradesmen/:id/verifications returns 401 with no session cookie', async () => {
      const app = await buildApp();
      const res = await req(app, 'POST', '/api/tradesmen/1/verifications', {
        body: { kind: 'insurance', fileBase64: 'YWJj', fileMimeType: 'application/pdf' },
      });
      expect(res.status).toBe(401);
    });

    it('GET /api/tradesmen/:id/verifications returns 401 with no session cookie', async () => {
      const app = await buildApp();
      const res = await req(app, 'GET', '/api/tradesmen/1/verifications');
      expect(res.status).toBe(401);
    });
  });

  describe('🔐 Admin routes require ADMIN_KEY', () => {
    it('GET /api/admin/verifications/pending returns 401 without admin key', async () => {
      const app = await buildApp();
      const res = await req(app, 'GET', '/api/admin/verifications/pending');
      expect(res.status).toBe(401);
    });

    it('GET /api/admin/verifications/pending returns 200 with correct admin key', async () => {
      const app = await buildApp();
      const res = await req(app, 'GET', '/api/admin/verifications/pending', {
        headers: { 'x-admin-key': 'test-secret-key' },
      });
      expect(res.status).toBe(200);
      expect(Array.isArray(res.body)).toBe(true);
    });

    it('GET /api/admin/verifications/:id/file-url returns 401 without admin key', async () => {
      const app = await buildApp();
      const res = await req(app, 'GET', '/api/admin/verifications/42/file-url');
      expect(res.status).toBe(401);
    });

    it('POST /api/admin/verifications/:id/decide returns 401 without admin key', async () => {
      const app = await buildApp();
      const res = await req(app, 'POST', '/api/admin/verifications/42/decide', {
        body: { status: 'approved' },
      });
      expect(res.status).toBe(401);
    });
  });

  describe('✅ Approval flips the tradesman boolean', () => {
    it('approving an insurance verification calls updateTradesman({insured:true})', async () => {
      getTradesmanVerificationByIdMock.mockResolvedValue({
        id: 42, tradesmanId: 7, kind: 'insurance', filePath: '7/insurance/x.pdf',
        fileMimeType: 'application/pdf', fileSizeBytes: 100, status: 'pending',
        submittedAt: 1, reviewedAt: null, reviewedBy: null, reviewerNote: null,
        qualificationType: null, insuranceCoverGbp: 1_000_000, expiryDate: null,
      });
      decideTradesmanVerificationMock.mockResolvedValue({
        id: 42, tradesmanId: 7, kind: 'insurance', filePath: '7/insurance/x.pdf',
        fileMimeType: 'application/pdf', fileSizeBytes: 100, status: 'approved',
        submittedAt: 1, reviewedAt: 2, reviewedBy: 'admin', reviewerNote: null,
        qualificationType: null, insuranceCoverGbp: 1_000_000, expiryDate: null,
      });
      const app = await buildApp();
      const res = await req(app, 'POST', '/api/admin/verifications/42/decide', {
        body: { status: 'approved' },
        headers: { 'x-admin-key': 'test-secret-key' },
      });
      expect(res.status).toBe(200);
      expect(updateTradesmanMock).toHaveBeenCalledWith(7, { insured: true });
    });

    it('approving a qualification verification calls updateTradesman({licensed:true})', async () => {
      getTradesmanVerificationByIdMock.mockResolvedValue({
        id: 43, tradesmanId: 8, kind: 'qualification', filePath: '8/qualification/x.pdf',
        fileMimeType: 'application/pdf', fileSizeBytes: 100, status: 'pending',
        submittedAt: 1, reviewedAt: null, reviewedBy: null, reviewerNote: null,
        qualificationType: 'Gas Safe', insuranceCoverGbp: null, expiryDate: null,
      });
      decideTradesmanVerificationMock.mockResolvedValue({
        id: 43, tradesmanId: 8, kind: 'qualification', filePath: '8/qualification/x.pdf',
        fileMimeType: 'application/pdf', fileSizeBytes: 100, status: 'approved',
        submittedAt: 1, reviewedAt: 2, reviewedBy: 'admin', reviewerNote: null,
        qualificationType: 'Gas Safe', insuranceCoverGbp: null, expiryDate: null,
      });
      const app = await buildApp();
      const res = await req(app, 'POST', '/api/admin/verifications/43/decide', {
        body: { status: 'approved' },
        headers: { 'x-admin-key': 'test-secret-key' },
      });
      expect(res.status).toBe(200);
      expect(updateTradesmanMock).toHaveBeenCalledWith(8, { licensed: true });
    });

    it('rejecting does NOT flip any boolean and requires reviewerNote', async () => {
      getTradesmanVerificationByIdMock.mockResolvedValue({
        id: 44, tradesmanId: 9, kind: 'insurance', filePath: '9/insurance/x.pdf',
        fileMimeType: 'application/pdf', fileSizeBytes: 100, status: 'pending',
        submittedAt: 1, reviewedAt: null, reviewedBy: null, reviewerNote: null,
        qualificationType: null, insuranceCoverGbp: 0, expiryDate: null,
      });
      const app = await buildApp();
      // Missing reviewerNote → 400
      const bad = await req(app, 'POST', '/api/admin/verifications/44/decide', {
        body: { status: 'rejected' },
        headers: { 'x-admin-key': 'test-secret-key' },
      });
      expect(bad.status).toBe(400);
      expect(updateTradesmanMock).not.toHaveBeenCalled();

      // With reviewerNote → 200; still no boolean flip
      decideTradesmanVerificationMock.mockResolvedValue({
        id: 44, tradesmanId: 9, kind: 'insurance', filePath: '9/insurance/x.pdf',
        fileMimeType: 'application/pdf', fileSizeBytes: 100, status: 'rejected',
        submittedAt: 1, reviewedAt: 2, reviewedBy: 'admin', reviewerNote: 'illegible',
        qualificationType: null, insuranceCoverGbp: 0, expiryDate: null,
      });
      const good = await req(app, 'POST', '/api/admin/verifications/44/decide', {
        body: { status: 'rejected', reviewerNote: 'illegible' },
        headers: { 'x-admin-key': 'test-secret-key' },
      });
      expect(good.status).toBe(200);
      expect(updateTradesmanMock).not.toHaveBeenCalled();
    });

    it('public profile NEVER exposes filePath; only coverGbp/expiryDate/qualificationType in verificationSummary', async () => {
      // A tradesman with both insurance & qualification approved.
      const baseTradesman = {
        id: 7, businessName: 'Acme Heating', ownerName: 'Acme', slug: 'acme-heating',
        email: 'a@b.test', phone: '0', tradeId: 1, areaId: 1, postcode: 'M1', bio: 'x',
        rating: 5, jobsCompleted: 0, responseTime: 'fast', verified: true, insured: true,
        licensed: true, credits: 0, featuredUntil: null, photoUrl: null, cardStatus: 'none',
        publishedAt: 1, createdAt: 1, updatedAt: 1,
      };
      getTradesmanByIdMock.mockResolvedValue(baseTradesman as any);
      getLatestApprovedVerificationMock.mockImplementation(async (_id: number, kind: string) => {
        if (kind === 'insurance') {
          return {
            id: 100, tradesmanId: 7, kind: 'insurance',
            // filePath MUST NOT appear in the API response — verify below.
            filePath: '7/insurance/SECRET-PATH.pdf',
            fileMimeType: 'application/pdf', fileSizeBytes: 100, status: 'approved',
            submittedAt: 1, reviewedAt: 2, reviewedBy: 'admin', reviewerNote: null,
            qualificationType: null, insuranceCoverGbp: 1_000_000, expiryDate: '2027-01-01',
          };
        }
        if (kind === 'qualification') {
          return {
            id: 101, tradesmanId: 7, kind: 'qualification',
            filePath: '7/qualification/SECRET-PATH.pdf',
            fileMimeType: 'application/pdf', fileSizeBytes: 100, status: 'approved',
            submittedAt: 1, reviewedAt: 2, reviewedBy: 'admin', reviewerNote: null,
            qualificationType: 'Gas Safe', insuranceCoverGbp: null, expiryDate: '2027-06-01',
          };
        }
        return undefined;
      });
      const app = await buildApp();
      const res = await req(app, 'GET', '/api/tradesmen/7');
      expect(res.status).toBe(200);
      expect(res.body.verificationSummary).toEqual({
        insurance: { coverGbp: 1_000_000, expiryDate: '2027-01-01' },
        qualification: { qualificationType: 'Gas Safe', expiryDate: '2027-06-01' },
      });
      // Critical: storage path must NOT leak anywhere in the response payload.
      expect(JSON.stringify(res.body)).not.toContain('SECRET-PATH');
      expect(JSON.stringify(res.body)).not.toContain('filePath');
    });

    it('verificationSummary stays null when tradesman.insured/licensed flags are false', async () => {
      // Even if storage somehow returned a doc, we never query it because
      // the boolean flag is the source of truth for whether to enrich.
      const baseTradesman = {
        id: 8, businessName: 'Beta Plumbers', ownerName: 'Beta', slug: 'beta-plumbers',
        email: 'b@b.test', phone: '0', tradeId: 1, areaId: 1, postcode: 'M2', bio: 'x',
        rating: 5, jobsCompleted: 0, responseTime: 'fast', verified: false, insured: false,
        licensed: false, credits: 0, featuredUntil: null, photoUrl: null, cardStatus: 'none',
        publishedAt: 1, createdAt: 1, updatedAt: 1,
      };
      getTradesmanByIdMock.mockResolvedValue(baseTradesman as any);
      const app = await buildApp();
      const res = await req(app, 'GET', '/api/tradesmen/8');
      expect(res.status).toBe(200);
      expect(res.body.verificationSummary).toEqual({ insurance: null, qualification: null });
      // Skipped the storage call entirely (flags were false).
      expect(getLatestApprovedVerificationMock).not.toHaveBeenCalled();
    });

    it('decide returns 409 when already decided (not pending)', async () => {
      getTradesmanVerificationByIdMock.mockResolvedValue({
        id: 45, tradesmanId: 10, kind: 'insurance', filePath: '10/insurance/x.pdf',
        fileMimeType: 'application/pdf', fileSizeBytes: 100, status: 'approved',
        submittedAt: 1, reviewedAt: 2, reviewedBy: 'admin', reviewerNote: null,
        qualificationType: null, insuranceCoverGbp: 0, expiryDate: null,
      });
      const app = await buildApp();
      const res = await req(app, 'POST', '/api/admin/verifications/45/decide', {
        body: { status: 'approved' },
        headers: { 'x-admin-key': 'test-secret-key' },
      });
      expect(res.status).toBe(409);
    });
  });

  describe('📧 Decision emails (PR H)', () => {
    it('approving sends the approval email to the tradesman with kind + profile URL', async () => {
      getTradesmanVerificationByIdMock.mockResolvedValue({
        id: 50, tradesmanId: 11, kind: 'insurance', filePath: '11/insurance/x.pdf',
        fileMimeType: 'application/pdf', fileSizeBytes: 100, status: 'pending',
        submittedAt: 1, reviewedAt: null, reviewedBy: null, reviewerNote: null,
        qualificationType: null, insuranceCoverGbp: 1_000_000, expiryDate: null,
      });
      decideTradesmanVerificationMock.mockResolvedValue({
        id: 50, tradesmanId: 11, kind: 'insurance', filePath: '11/insurance/x.pdf',
        fileMimeType: 'application/pdf', fileSizeBytes: 100, status: 'approved',
        submittedAt: 1, reviewedAt: 2, reviewedBy: 'admin', reviewerNote: null,
        qualificationType: null, insuranceCoverGbp: 1_000_000, expiryDate: null,
      });
      getTradesmanByIdMock.mockResolvedValue({
        id: 11, slug: 'acme-electrics', businessName: 'Acme Electrics',
        ownerName: 'Jane Acme', email: 'jane@acme.test',
      } as any);

      const app = await buildApp();
      const res = await req(app, 'POST', '/api/admin/verifications/50/decide', {
        body: { status: 'approved' },
        headers: { 'x-admin-key': 'test-secret-key' },
      });
      expect(res.status).toBe(200);
      expect(sendVerificationApprovedMock).toHaveBeenCalledTimes(1);
      expect(sendVerificationApprovedMock).toHaveBeenCalledWith(
        expect.objectContaining({
          to: 'jane@acme.test',
          kind: 'insurance',
          tradesmanName: 'Jane Acme',
          profileUrl: 'https://tradesmanfinder.com/tradesman/acme-electrics',
        }),
      );
      expect(sendVerificationRejectedMock).not.toHaveBeenCalled();
    });

    it('rejecting sends the rejection email with the reviewer note verbatim', async () => {
      const note = "blurry scan, can't read expiry";
      getTradesmanVerificationByIdMock.mockResolvedValue({
        id: 51, tradesmanId: 12, kind: 'qualification', filePath: '12/qualification/x.pdf',
        fileMimeType: 'application/pdf', fileSizeBytes: 100, status: 'pending',
        submittedAt: 1, reviewedAt: null, reviewedBy: null, reviewerNote: null,
        qualificationType: 'Gas Safe', insuranceCoverGbp: null, expiryDate: null,
      });
      decideTradesmanVerificationMock.mockResolvedValue({
        id: 51, tradesmanId: 12, kind: 'qualification', filePath: '12/qualification/x.pdf',
        fileMimeType: 'application/pdf', fileSizeBytes: 100, status: 'rejected',
        submittedAt: 1, reviewedAt: 2, reviewedBy: 'admin', reviewerNote: note,
        qualificationType: 'Gas Safe', insuranceCoverGbp: null, expiryDate: null,
      });
      getTradesmanByIdMock.mockResolvedValue({
        id: 12, slug: 'beta-gas', businessName: 'Beta Gas',
        ownerName: 'Bob Beta', email: 'bob@beta.test',
      } as any);

      const app = await buildApp();
      const res = await req(app, 'POST', '/api/admin/verifications/51/decide', {
        body: { status: 'rejected', reviewerNote: note },
        headers: { 'x-admin-key': 'test-secret-key' },
      });
      expect(res.status).toBe(200);
      expect(sendVerificationRejectedMock).toHaveBeenCalledTimes(1);
      expect(sendVerificationRejectedMock).toHaveBeenCalledWith(
        expect.objectContaining({
          to: 'bob@beta.test',
          kind: 'qualification',
          reviewerNote: note,
          dashboardUrl: 'https://tradesmanfinder.com/dashboard/verification',
        }),
      );
      expect(sendVerificationApprovedMock).not.toHaveBeenCalled();
    });

    it('a mailer failure does not fail the decide request (DB is source of truth)', async () => {
      getTradesmanVerificationByIdMock.mockResolvedValue({
        id: 52, tradesmanId: 13, kind: 'insurance', filePath: '13/insurance/x.pdf',
        fileMimeType: 'application/pdf', fileSizeBytes: 100, status: 'pending',
        submittedAt: 1, reviewedAt: null, reviewedBy: null, reviewerNote: null,
        qualificationType: null, insuranceCoverGbp: 1_000_000, expiryDate: null,
      });
      decideTradesmanVerificationMock.mockResolvedValue({
        id: 52, tradesmanId: 13, kind: 'insurance', filePath: '13/insurance/x.pdf',
        fileMimeType: 'application/pdf', fileSizeBytes: 100, status: 'approved',
        submittedAt: 1, reviewedAt: 2, reviewedBy: 'admin', reviewerNote: null,
        qualificationType: null, insuranceCoverGbp: 1_000_000, expiryDate: null,
      });
      getTradesmanByIdMock.mockResolvedValue({
        id: 13, slug: 'gamma-co', businessName: 'Gamma Co',
        ownerName: 'Gail Gamma', email: 'gail@gamma.test',
      } as any);
      sendVerificationApprovedMock.mockRejectedValue(new Error('resend down'));

      const app = await buildApp();
      const res = await req(app, 'POST', '/api/admin/verifications/52/decide', {
        body: { status: 'approved' },
        headers: { 'x-admin-key': 'test-secret-key' },
      });
      // Request still succeeds and the boolean flip (DB write) still happened.
      expect(res.status).toBe(200);
      expect(updateTradesmanMock).toHaveBeenCalledWith(13, { insured: true });
    });
  });
});
