/**
 * FOUNDING PRO INTEREST FORM — Quick fix regression guard.
 *
 * Locks in behaviour of POST /api/founding-pro/interest:
 *
 *  1. Valid submission → 201, mailer called once with the right fields.
 *  2. Invalid email → 400 with validation errors.
 *  3. Missing required field → 400.
 *  4. ref param is plumbed through to the mailer (or null when absent).
 *  5. Mailer failure does NOT 500 the user — we 201 and log internally.
 *
 * No DB / Stripe stubs needed: the route does no storage writes and the
 * test stubs every other module the routes file imports from.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { sendFoundingProInterestMock } = vi.hoisted(() => {
  process.env.ADMIN_KEY = 'test-secret-key';
  process.env.DATABASE_URL = 'postgres://fake';
  return { sendFoundingProInterestMock: vi.fn() };
});

// ── module stubs ────────────────────────────────────────────────────────────────
vi.mock('./mailer', () => ({
  sendCardIssuedEmail: vi.fn().mockResolvedValue({ ok: true, id: 'e1' }),
  sendCardRescindedEmail: vi.fn().mockResolvedValue({ ok: true, id: 'e2' }),
  sendNewLeadEmail: vi.fn().mockResolvedValue({ ok: true, id: 'e3' }),
  sendPartnerEnquiryNotification: vi.fn().mockResolvedValue({ ok: true, id: 'e4' }),
  sendMagicLinkEmail: vi.fn().mockResolvedValue({ ok: true, id: 'e5' }),
  sendOutcomeAskEmail: vi.fn().mockResolvedValue({ ok: true, id: 'e6' }),
  sendHomeownerMagicLink: vi.fn().mockResolvedValue({ ok: true, id: 'e7' }),
  sendVerificationRequestToTradesman: vi.fn().mockResolvedValue({ ok: true, id: 'e8' }),
  sendVerificationAccessGranted: vi.fn().mockResolvedValue({ ok: true, id: 'e9' }),
  sendVerificationAccessDenied: vi.fn().mockResolvedValue({ ok: true, id: 'e10' }),
  sendFoundingProInterest: sendFoundingProInterestMock,
}));

vi.mock('./storage', () => ({
  db: {},
  storage: {},
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

const VALID_BODY = {
  companyName: 'Keystone Plumbing Ltd',
  contactName: 'Samira Mothi',
  email: 'hello@keystone.london',
  phone: '020 3369 9999',
  trades: 'plumbing, heating, gas',
  postcodes: 'SW3, SW7, SW10, W8',
  bio: 'Gas Safe registered plumbers covering Kensington & Chelsea since 2014.',
  ref: 'kc-plumber-2',
};

describe('FOUNDING PRO INTEREST — POST /api/founding-pro/interest', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    sendFoundingProInterestMock.mockResolvedValue({ ok: true, id: 'resend-1' });
  });

  it('accepts a valid submission, returns 201, calls mailer with all fields including ref', async () => {
    const app = await buildApp();
    const req = makeReq(app);
    const r = await req('POST', '/api/founding-pro/interest', { body: VALID_BODY });
    expect(r.status).toBe(201);
    expect(r.body).toEqual({ ok: true });
    expect(sendFoundingProInterestMock).toHaveBeenCalledTimes(1);
    expect(sendFoundingProInterestMock).toHaveBeenCalledWith({
      companyName: 'Keystone Plumbing Ltd',
      contactName: 'Samira Mothi',
      email: 'hello@keystone.london',
      phone: '020 3369 9999',
      trades: 'plumbing, heating, gas',
      postcodes: 'SW3, SW7, SW10, W8',
      bio: 'Gas Safe registered plumbers covering Kensington & Chelsea since 2014.',
      ref: 'kc-plumber-2',
    });
  });

  it('passes ref=null when query string ref is absent', async () => {
    const app = await buildApp();
    const req = makeReq(app);
    const body = { ...VALID_BODY };
    delete (body as any).ref;
    const r = await req('POST', '/api/founding-pro/interest', { body });
    expect(r.status).toBe(201);
    expect(sendFoundingProInterestMock).toHaveBeenCalledWith(
      expect.objectContaining({ ref: null }),
    );
  });

  it('rejects invalid email with 400', async () => {
    const app = await buildApp();
    const req = makeReq(app);
    const r = await req('POST', '/api/founding-pro/interest', {
      body: { ...VALID_BODY, email: 'not-an-email' },
    });
    expect(r.status).toBe(400);
    expect(r.body.message).toBe('Validation failed');
    expect(sendFoundingProInterestMock).not.toHaveBeenCalled();
  });

  it('rejects missing required field with 400', async () => {
    const app = await buildApp();
    const req = makeReq(app);
    const body = { ...VALID_BODY };
    delete (body as any).bio;
    const r = await req('POST', '/api/founding-pro/interest', { body });
    expect(r.status).toBe(400);
    expect(sendFoundingProInterestMock).not.toHaveBeenCalled();
  });

  it('still returns 201 when mailer fails — submission is logged server-side, user is not blocked', async () => {
    sendFoundingProInterestMock.mockResolvedValueOnce({ ok: false, error: 'resend_timeout' });
    const app = await buildApp();
    const req = makeReq(app);
    const r = await req('POST', '/api/founding-pro/interest', { body: VALID_BODY });
    expect(r.status).toBe(201);
    expect(r.body).toEqual({ ok: true });
    expect(sendFoundingProInterestMock).toHaveBeenCalledTimes(1);
  });
});
