/**
 * AUTH REGRESSION GUARD
 *
 * Defensive tests that lock in the security boundary established by PR #43
 * (closes #28 — P0 SECURITY: Tradesman auth has no password or email verification).
 *
 * These tests MUST fail loudly if any of the following ever silently regress:
 *
 *  1. The legacy "pseudo-login by email" endpoint must not exist.
 *     `GET /api/tradesmen/login/<email>` was the exploit: anyone who knew a
 *     tradesman's email (visible on their public profile page) could call it
 *     and receive a full tradesman session payload. It must return 404.
 *
 *  2. The four magic-link auth endpoints must remain mounted:
 *       POST /api/auth/request-link  → 200 (rate-limited; doesn't leak email existence)
 *       GET  /api/auth/verify        → never 404 (302 redirects on success or bad token)
 *       GET  /api/auth/me            → 401 when no session cookie
 *       POST /api/auth/logout        → 200
 *
 *  3. The most exposed tradesman mutation, `PATCH /api/tradesmen/:id`, must
 *     return 401 when no session cookie is present (was the exploit's primary
 *     blast radius — letting an attacker edit any tradesman's profile).
 *
 * If you intentionally remove or rename any of these endpoints, update this
 * file in the SAME commit and explain why in the PR description.
 *
 * All storage / mailer / stripe calls are stubbed — no database required.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.hoisted(() => {
  process.env.ADMIN_KEY = 'test-secret-key';
  process.env.DATABASE_URL = 'postgres://fake';
});

vi.mock('./storage', () => ({
  storage: {
    // Minimal stubs needed for registerRoutes to mount cleanly
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
    // Auth-specific stubs (names must match storage.ts exactly)
    createMagicLinkToken: vi.fn().mockResolvedValue({ id: 1 }),
    getMagicLinkTokenByHash: vi.fn().mockResolvedValue(null),
    getRecentTokenForEmail: vi.fn().mockResolvedValue(null),
    consumeMagicLinkToken: vi.fn().mockResolvedValue(null),
    createSession: vi.fn().mockResolvedValue({ id: 'sid-1' }),
    getSessionById: vi.fn().mockResolvedValue(null),
    findSessionById: vi.fn().mockResolvedValue(null),
    deleteSession: vi.fn().mockResolvedValue(undefined),
    touchSession: vi.fn().mockResolvedValue(undefined),
    // Other helpers used during route mounting / attachCardSummary
    getAreas: vi.fn().mockResolvedValue([{ id: 1, name: 'Default', slug: 'default' }]),
    createTradesman: vi.fn().mockResolvedValue({ id: 1 }),
    setCredits: vi.fn().mockResolvedValue(undefined),
    createCreditTransaction: vi.fn().mockResolvedValue(undefined),
    updateTradesman: vi.fn().mockResolvedValue(null),
    getReviewsByTradesman: vi.fn().mockResolvedValue([]),
  },
  db: {},
}));

vi.mock('./mailer', () => ({
  sendCardIssuedEmail: vi.fn().mockResolvedValue({ ok: true, id: 'e1' }),
  sendCardRescindedEmail: vi.fn().mockResolvedValue({ ok: true, id: 'e2' }),
  sendNewLeadEmail: vi.fn().mockResolvedValue({ ok: true, id: 'e3' }),
  sendPartnerEnquiryNotification: vi.fn().mockResolvedValue({ ok: true, id: 'e4' }),
  sendMagicLinkEmail: vi.fn().mockResolvedValue({ ok: true, id: 'e5' }),
}));

vi.mock('./stripe', () => ({
  stripe: { webhooks: { constructEvent: vi.fn() }, checkout: { sessions: { create: vi.fn(), listLineItems: vi.fn() } } },
  STRIPE_WEBHOOK_SECRET: 'whsec_test',
  stripeIsConfigured: false,
  productKindFromPriceId: () => null,
  creditsForProductKind: () => 0,
  PRODUCT_KINDS: [],
}));

vi.mock('./stripe-checkout', () => ({ createLeadPackCheckoutSession: vi.fn() }));
vi.mock('./stripe-webhook', () => ({ handleStripeWebhook: vi.fn() }));
vi.mock('./spam-guard', () => ({
  publicFormGuard: () => (_req: any, _res: any, next: any) => next(),
  rateLimit: () => (_req: any, _res: any, next: any) => next(),
}));

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
      try { await fn(port); srv.close(resolve); }
      catch (e) { srv.close(() => reject(e)); }
    });
  });
}

describe('AUTH REGRESSION GUARD (locks in PR #43 / issue #28 fix)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('🚨 Legacy exploit endpoints — must NOT exist', () => {
    it('GET /api/tradesmen/login/<email> returns 404 (no pseudo-login by email)', async () => {
      const app = await buildApp();
      await withServer(app, async (port) => {
        // Try multiple email shapes to ensure no variant of the endpoint exists
        const emails = [
          'anyone@example.com',
          'tradesman+test@example.co.uk',
          'a@b.c',
        ];
        for (const email of emails) {
          const res = await fetch(`http://127.0.0.1:${port}/api/tradesmen/login/${encodeURIComponent(email)}`);
          expect(res.status, `legacy login endpoint must be removed (tried ${email})`).toBe(404);
        }
      });
    });

    it('GET /api/tradesmen/login (no email) does NOT return a session (no pseudo-login)', async () => {
      const app = await buildApp();
      await withServer(app, async (port) => {
        const res = await fetch(`http://127.0.0.1:${port}/api/tradesmen/login`);
        // Whether this resolves as 400 (route /:id parses 'login' as id) or 404
        // (no match) is fine — the only thing that must NEVER happen is a 200
        // with a session payload. Lock in: status >= 400 AND no session/auth body.
        expect(res.status).toBeGreaterThanOrEqual(400);
        expect(res.status).toBeLessThan(500);
        const text = await res.text();
        // Body must not contain anything resembling a session/auth grant.
        expect(text.toLowerCase()).not.toMatch(/sessionid|tradesmanid.*token|"token"\s*:/);
      });
    });
  });

  describe('🔐 Magic-link auth endpoints — must remain mounted', () => {
    it('POST /api/auth/request-link returns 200 (rate-limited, does not leak email existence)', async () => {
      const app = await buildApp();
      await withServer(app, async (port) => {
        const res = await fetch(`http://127.0.0.1:${port}/api/auth/request-link`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email: 'nobody-here@example.com' }),
        });
        expect(res.status).toBe(200);
        const body = await res.json();
        expect(body).toMatchObject({ ok: true });
      });
    });

    it('GET /api/auth/verify with bad token does NOT 404 (endpoint mounted)', async () => {
      const app = await buildApp();
      await withServer(app, async (port) => {
        // Try a malformed token (caught by regex → 302 redirect) and a well-formed-but-unknown
        // token (caught by storage lookup → 302 redirect). Either way, mustn't be 404.
        const badRaw = await fetch(`http://127.0.0.1:${port}/api/auth/verify?token=BADTOKEN`, { redirect: 'manual' });
        expect(badRaw.status, 'bad-format token must not 404 the endpoint').not.toBe(404);

        const wellFormed = 'a'.repeat(64); // 64 hex chars, will pass regex, fail DB lookup
        const badHex = await fetch(`http://127.0.0.1:${port}/api/auth/verify?token=${wellFormed}`, { redirect: 'manual' });
        expect(badHex.status, 'unknown-token must redirect, not 404').toBe(302);
      });
    });

    it('GET /api/auth/me with no session cookie returns 401 (not 404)', async () => {
      const app = await buildApp();
      await withServer(app, async (port) => {
        const res = await fetch(`http://127.0.0.1:${port}/api/auth/me`);
        expect(res.status).toBe(401);
      });
    });

    it('POST /api/auth/logout returns 200 even with no session', async () => {
      const app = await buildApp();
      await withServer(app, async (port) => {
        const res = await fetch(`http://127.0.0.1:${port}/api/auth/logout`, { method: 'POST' });
        expect(res.status).toBe(200);
        const body = await res.json();
        expect(body).toMatchObject({ ok: true });
      });
    });
  });

  describe('🛡️ Exposed mutation endpoints — must require auth', () => {
    it('PATCH /api/tradesmen/:id with no session cookie returns 401 (was the exploit primary blast radius)', async () => {
      const app = await buildApp();
      await withServer(app, async (port) => {
        const res = await fetch(`http://127.0.0.1:${port}/api/tradesmen/1`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ businessName: 'hacked' }),
        });
        expect(res.status).toBe(401);
      });
    });
  });
});
