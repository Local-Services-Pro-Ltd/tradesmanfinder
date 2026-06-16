/**
 * FOUNDING PRO CLAIM FLOW — route regression guard.
 *
 * Locks in behaviour of the canonical claim flow (supersedes the interest
 * form from PR #106):
 *
 *  GET /api/founding-pro/invite/:ref
 *   1. unknown ref → 404
 *   2. known ref → 200 with pre-fill payload, marks viewed on first open,
 *      never leaks recipient_email / companies_house_number
 *
 *  POST /api/founding-pro/claim/:ref
 *   3. happy path → creates tradesman (founding_pro=true), links invite,
 *      sends both emails (awaited), returns { tradesmanId, dashboardUrl }
 *   4. unknown ref → 404
 *   5. honeypot (website_url) filled → 400, no tradesman created
 *   6. Zod validation error (bio too short) → 400
 *   7. missing marketing_consent → 400
 *   8. idempotent re-claim → same tradesmanId, no second createTradesman
 *
 *  GET /api/founding-pro/invites (admin)
 *   9. without admin key → 401
 *  10. with admin key → 200 list
 *
 * All storage / mailer / stripe calls are stubbed — no database required,
 * mirroring server/founding-pro-interest.test.ts and the homeowner regression.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const {
  getFoundingProInviteByRefMock,
  markFoundingProInviteViewedMock,
  claimFoundingProInviteMock,
  listFoundingProInvitesMock,
  getAreasMock,
  getTradesmanBySlugMock,
  createTradesmanMock,
  setCreditsMock,
  sendFoundingProClaimedMock,
  sendFoundingProInternalNotificationMock,
} = vi.hoisted(() => {
  process.env.ADMIN_KEY = 'test-secret-key';
  process.env.DATABASE_URL = 'postgres://fake';
  return {
    getFoundingProInviteByRefMock: vi.fn(),
    markFoundingProInviteViewedMock: vi.fn().mockResolvedValue(undefined),
    claimFoundingProInviteMock: vi.fn(),
    listFoundingProInvitesMock: vi.fn().mockResolvedValue([]),
    getAreasMock: vi.fn().mockResolvedValue([{ id: 3, name: 'Wandsworth' }, { id: 9, name: 'Dulwich' }]),
    getTradesmanBySlugMock: vi.fn().mockResolvedValue(undefined),
    createTradesmanMock: vi.fn(),
    setCreditsMock: vi.fn().mockResolvedValue(undefined),
    sendFoundingProClaimedMock: vi.fn().mockResolvedValue({ ok: true, id: 'e-pro' }),
    sendFoundingProInternalNotificationMock: vi.fn().mockResolvedValue({ ok: true, id: 'e-int' }),
  };
});

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
  sendFoundingProClaimed: sendFoundingProClaimedMock,
  sendFoundingProInternalNotification: sendFoundingProInternalNotificationMock,
}));

vi.mock('./storage', () => ({
  db: {},
  storage: {
    getFoundingProInviteByRef: getFoundingProInviteByRefMock,
    markFoundingProInviteViewed: markFoundingProInviteViewedMock,
    claimFoundingProInvite: claimFoundingProInviteMock,
    listFoundingProInvites: listFoundingProInvitesMock,
    getAreas: getAreasMock,
    getTradesmanBySlug: getTradesmanBySlugMock,
    createTradesman: createTradesmanMock,
    setCredits: setCreditsMock,
  },
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
  };
}

const INVITE = {
  id: 1,
  ref: 'wandsworth-plumber-1',
  recipientEmail: 'Info@instagasworks.com',
  recipientName: 'Chris',
  companyName: 'Instagasworks Plumbing And Heating',
  companiesHouseNumber: null,
  trade: 'plumber',
  area: 'Wandsworth',
  postcodes: ['SW8', 'SW11', 'SW12'],
  campaign: 'founding-pro-pilot-01',
  status: 'invited',
  claimedTradesmanId: null,
  viewedAt: null,
  claimedAt: null,
  createdAt: 1,
};

const VALID_CLAIM = {
  phone: '020 1234 5678',
  bio: 'Gas Safe registered plumbers covering Wandsworth since 2014 — boilers, leaks, bathrooms.',
  trades: ['plumber', 'heating'],
  postcodes: ['SW8', 'SW11'],
  website: 'https://instagasworks.com',
  marketing_consent: true,
};

describe('FOUNDING PRO CLAIM — GET /api/founding-pro/invite/:ref', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getAreasMock.mockResolvedValue([{ id: 3, name: 'Wandsworth' }, { id: 9, name: 'Dulwich' }]);
  });

  it('returns 404 for an unknown ref', async () => {
    getFoundingProInviteByRefMock.mockResolvedValue(null);
    const req = makeReq(await buildApp());
    const r = await req('GET', '/api/founding-pro/invite/nope-1');
    expect(r.status).toBe(404);
  });

  it('returns the pre-fill payload, marks viewed, and never leaks sensitive fields', async () => {
    getFoundingProInviteByRefMock.mockResolvedValue({ ...INVITE });
    const req = makeReq(await buildApp());
    const r = await req('GET', '/api/founding-pro/invite/wandsworth-plumber-1');
    expect(r.status).toBe(200);
    expect(r.body.companyName).toBe('Instagasworks Plumbing And Heating');
    expect(r.body.trade).toBe('plumber');
    expect(r.body.area).toBe('Wandsworth');
    expect(r.body.postcodes).toEqual(['SW8', 'SW11', 'SW12']);
    expect(r.body.status).toBe('viewed');
    // Sensitive fields must not be returned to the browser.
    expect(r.body.recipientEmail).toBeUndefined();
    expect(r.body.companiesHouseNumber).toBeUndefined();
    expect(markFoundingProInviteViewedMock).toHaveBeenCalledWith('wandsworth-plumber-1');
  });

  it('does not re-mark viewed when status is already past invited', async () => {
    getFoundingProInviteByRefMock.mockResolvedValue({ ...INVITE, status: 'viewed' });
    const req = makeReq(await buildApp());
    const r = await req('GET', '/api/founding-pro/invite/wandsworth-plumber-1');
    expect(r.status).toBe(200);
    expect(markFoundingProInviteViewedMock).not.toHaveBeenCalled();
  });
});

describe('FOUNDING PRO CLAIM — POST /api/founding-pro/claim/:ref', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getAreasMock.mockResolvedValue([{ id: 3, name: 'Wandsworth' }, { id: 9, name: 'Dulwich' }]);
    getTradesmanBySlugMock.mockResolvedValue(undefined);
    createTradesmanMock.mockResolvedValue({ id: 42 });
    sendFoundingProClaimedMock.mockResolvedValue({ ok: true, id: 'e-pro' });
    sendFoundingProInternalNotificationMock.mockResolvedValue({ ok: true, id: 'e-int' });
  });

  it('happy path: creates a founding-pro tradesman, links the invite, sends both emails', async () => {
    getFoundingProInviteByRefMock.mockResolvedValue({ ...INVITE });
    claimFoundingProInviteMock.mockResolvedValue({ ...INVITE, status: 'claimed', claimedTradesmanId: 42 });
    const req = makeReq(await buildApp());
    const r = await req('POST', '/api/founding-pro/claim/wandsworth-plumber-1', { body: VALID_CLAIM });
    expect(r.status).toBe(200);
    expect(r.body.tradesmanId).toBe(42);
    expect(typeof r.body.dashboardUrl).toBe('string');

    expect(createTradesmanMock).toHaveBeenCalledTimes(1);
    const createdArg = createTradesmanMock.mock.calls[0][0];
    expect(createdArg.foundingPro).toBe(true);
    expect(createdArg.email).toBe('Info@instagasworks.com');
    expect(createdArg.areaId).toBe(3); // resolved from area name 'Wandsworth'
    expect(JSON.parse(createdArg.categories)).toEqual(['plumber', 'heating']);

    expect(claimFoundingProInviteMock).toHaveBeenCalledWith('wandsworth-plumber-1', 42);
    expect(sendFoundingProClaimedMock).toHaveBeenCalledTimes(1);
    expect(sendFoundingProInternalNotificationMock).toHaveBeenCalledTimes(1);
  });

  it('returns 404 for an unknown ref and never creates a tradesman', async () => {
    getFoundingProInviteByRefMock.mockResolvedValue(null);
    const req = makeReq(await buildApp());
    const r = await req('POST', '/api/founding-pro/claim/nope-1', { body: VALID_CLAIM });
    expect(r.status).toBe(404);
    expect(createTradesmanMock).not.toHaveBeenCalled();
  });

  it('rejects a tripped honeypot with 400 and creates nothing', async () => {
    getFoundingProInviteByRefMock.mockResolvedValue({ ...INVITE });
    const req = makeReq(await buildApp());
    const r = await req('POST', '/api/founding-pro/claim/wandsworth-plumber-1', {
      body: { ...VALID_CLAIM, website_url: 'http://spam.example' },
    });
    expect(r.status).toBe(400);
    expect(createTradesmanMock).not.toHaveBeenCalled();
  });

  it('rejects a Zod validation error (bio too short) with 400', async () => {
    getFoundingProInviteByRefMock.mockResolvedValue({ ...INVITE });
    const req = makeReq(await buildApp());
    const r = await req('POST', '/api/founding-pro/claim/wandsworth-plumber-1', {
      body: { ...VALID_CLAIM, bio: 'too short' },
    });
    expect(r.status).toBe(400);
    expect(r.body.message).toBe('Validation failed');
    expect(createTradesmanMock).not.toHaveBeenCalled();
  });

  it('rejects a missing marketing_consent with 400', async () => {
    getFoundingProInviteByRefMock.mockResolvedValue({ ...INVITE });
    const req = makeReq(await buildApp());
    const r = await req('POST', '/api/founding-pro/claim/wandsworth-plumber-1', {
      body: { ...VALID_CLAIM, marketing_consent: false },
    });
    expect(r.status).toBe(400);
    expect(createTradesmanMock).not.toHaveBeenCalled();
  });

  it('idempotent re-claim returns the same tradesmanId without creating a second record', async () => {
    getFoundingProInviteByRefMock.mockResolvedValue({
      ...INVITE,
      status: 'claimed',
      claimedTradesmanId: 42,
    });
    const req = makeReq(await buildApp());
    const r = await req('POST', '/api/founding-pro/claim/wandsworth-plumber-1', { body: VALID_CLAIM });
    expect(r.status).toBe(200);
    expect(r.body.tradesmanId).toBe(42);
    expect(createTradesmanMock).not.toHaveBeenCalled();
    expect(sendFoundingProClaimedMock).not.toHaveBeenCalled();
  });
});

describe('FOUNDING PRO CLAIM — GET /api/founding-pro/invites (admin)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    listFoundingProInvitesMock.mockResolvedValue([{ ...INVITE }]);
  });

  it('rejects without the admin key', async () => {
    const req = makeReq(await buildApp());
    const r = await req('GET', '/api/founding-pro/invites');
    expect(r.status).toBe(401);
  });

  it('returns the invite list with the admin key', async () => {
    const req = makeReq(await buildApp());
    const r = await req('GET', '/api/founding-pro/invites?key=test-secret-key');
    expect(r.status).toBe(200);
    expect(Array.isArray(r.body.invites)).toBe(true);
    expect(r.body.invites).toHaveLength(1);
  });
});
