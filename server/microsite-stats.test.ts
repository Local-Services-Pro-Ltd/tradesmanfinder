// PR-M4 — tests for GET /api/admin/microsites/stats
//
// We exercise the HTTP surface end-to-end (express + node:http listener) with
// the storage layer stubbed via vi.mock. That gives us coverage of:
//  - admin auth guard (401 without x-admin-key)
//  - days query parsing (default 30, days=0 → sinceMs=0, invalid → 400, cap at 3650)
//  - registry enrichment (registered host gets kind/trade/area; unknown host
//    flagged registered:false; bare `web` row left un-enriched)
//  - summary totals (sum of microsite vs web counts, active host count)
//
// We also include a lightweight assertion that the storage method is invoked
// with the correct sinceMs threshold so we know the route → storage contract
// is intact even though the storage impl itself is mocked.
import { describe, it, expect, vi, beforeEach } from 'vitest';

// Set required env BEFORE routes.ts is loaded — it throws on missing ADMIN_KEY.
const { adminKey } = vi.hoisted(() => {
  process.env.ADMIN_KEY = 'test-secret-key';
  process.env.DATABASE_URL = 'postgres://fake';
  return { adminKey: 'test-secret-key' };
});

vi.mock('./mailer', () => ({
  sendCardIssuedEmail: vi.fn().mockResolvedValue({ ok: true }),
  sendCardRescindedEmail: vi.fn().mockResolvedValue({ ok: true }),
  sendNewLeadEmail: vi.fn().mockResolvedValue({ ok: true }),
  sendPartnerEnquiryNotification: vi.fn().mockResolvedValue({ ok: true }),
  sendMagicLinkEmail: vi.fn().mockResolvedValue({ ok: true }),
  sendOutcomeAskEmail: vi.fn().mockResolvedValue({ ok: true }),
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

vi.mock('./storage', () => ({
  storage: {
    // unused by these tests but required so registerRoutes doesn't blow up
    getCardsByTradesman: vi.fn().mockResolvedValue([]),
    getAllCards: vi.fn().mockResolvedValue([]),
    getTradesmanById: vi.fn().mockResolvedValue(null),
    getTradesmen: vi.fn().mockResolvedValue([]),
    getJobs: vi.fn().mockResolvedValue([]),
    getQuotes: vi.fn().mockResolvedValue([]),
    getReviews: vi.fn().mockResolvedValue([]),
    logModeration: vi.fn().mockResolvedValue({ id: 1 }),
    getModerationLog: vi.fn().mockResolvedValue([]),
    // the focus of this suite
    getMicrositeLeadStats: vi.fn().mockResolvedValue([]),
  },
  db: {},
}));

import { MICROSITE_COUNT } from '@shared/microsites';
import express from 'express';
import { createServer } from 'node:http';
import { registerRoutes } from './routes';
import { storage } from './storage';

type AnyFn = ReturnType<typeof vi.fn>;
const s = storage as unknown as Record<string, AnyFn>;

async function buildApp() {
  const app = express();
  app.use(express.json());
  const httpServer = createServer(app);
  await registerRoutes(httpServer, app);
  return app;
}

async function withServer(
  app: express.Express,
  testFn: (port: number) => Promise<void>,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const server = app.listen(0, async () => {
      const port = (server.address() as any).port as number;
      try {
        await testFn(port);
        server.close(() => resolve());
      } catch (e) {
        server.close(() => reject(e));
      }
    });
  });
}

const STATS_PATH = '/api/admin/microsites/stats';

describe('GET /api/admin/microsites/stats', () => {
  let app: express.Express;

  beforeEach(async () => {
    vi.clearAllMocks();
    s.getMicrositeLeadStats.mockResolvedValue([]);
    app = await buildApp();
  });

  // ── 1. Admin guard ──────────────────────────────────────────────────
  it('returns 401 when x-admin-key header is missing', async () => {
    await withServer(app, async (port) => {
      const r = await fetch(`http://localhost:${port}${STATS_PATH}`);
      expect(r.status).toBe(401);
      expect(s.getMicrositeLeadStats).not.toHaveBeenCalled();
    });
  });

  it('returns 401 when x-admin-key is wrong', async () => {
    await withServer(app, async (port) => {
      const r = await fetch(`http://localhost:${port}${STATS_PATH}`, {
        headers: { 'x-admin-key': 'not-the-key' },
      });
      expect(r.status).toBe(401);
    });
  });

  // ── 2. Default window is 30 days ────────────────────────────────────
  it('defaults to a 30-day window when ?days is omitted', async () => {
    const before = Date.now();
    await withServer(app, async (port) => {
      const r = await fetch(`http://localhost:${port}${STATS_PATH}`, {
        headers: { 'x-admin-key': adminKey },
      });
      expect(r.status).toBe(200);
      const body = await r.json();
      expect(body.windowDays).toBe(30);
      // sinceMs should be ~30 days behind generatedAt; allow generous slack
      // for test runner latency.
      const thirtyDaysMs = 30 * 24 * 60 * 60 * 1000;
      expect(body.sinceMs).toBeGreaterThanOrEqual(before - thirtyDaysMs - 1000);
      expect(body.sinceMs).toBeLessThanOrEqual(Date.now() - thirtyDaysMs + 1000);
      expect(s.getMicrositeLeadStats).toHaveBeenCalledWith(body.sinceMs);
    });
  });

  // ── 3. days=0 is all-time (sinceMs = 0) ─────────────────────────────
  it('treats ?days=0 as all-time with sinceMs=0', async () => {
    await withServer(app, async (port) => {
      const r = await fetch(`http://localhost:${port}${STATS_PATH}?days=0`, {
        headers: { 'x-admin-key': adminKey },
      });
      expect(r.status).toBe(200);
      const body = await r.json();
      expect(body.windowDays).toBe(0);
      expect(body.sinceMs).toBe(0);
      expect(s.getMicrositeLeadStats).toHaveBeenCalledWith(0);
    });
  });

  // ── 4. Invalid days param returns 400 ───────────────────────────────
  it('returns 400 for non-numeric days', async () => {
    await withServer(app, async (port) => {
      const r = await fetch(`http://localhost:${port}${STATS_PATH}?days=foo`, {
        headers: { 'x-admin-key': adminKey },
      });
      expect(r.status).toBe(400);
    });
  });

  it('returns 400 for negative days', async () => {
    await withServer(app, async (port) => {
      const r = await fetch(`http://localhost:${port}${STATS_PATH}?days=-5`, {
        headers: { 'x-admin-key': adminKey },
      });
      expect(r.status).toBe(400);
    });
  });

  // ── 5. Registry enrichment ──────────────────────────────────────────
  // - microsite:blackheathbuilders.co.uk → known geo-trade entry
  // - microsite:notreal.example.com      → unknown host, registered=false
  // - web                                → no host, no enrichment
  it('enriches microsite rows with registry data', async () => {
    s.getMicrositeLeadStats.mockResolvedValue([
      { source: 'microsite:blackheathbuilders.co.uk', count: 12, lastLeadAt: 1_700_000_000_000 },
      { source: 'microsite:notreal.example.com', count: 3, lastLeadAt: 1_700_000_000_000 },
      { source: 'web', count: 50, lastLeadAt: 1_700_000_500_000 },
    ]);

    await withServer(app, async (port) => {
      const r = await fetch(`http://localhost:${port}${STATS_PATH}`, {
        headers: { 'x-admin-key': adminKey },
      });
      expect(r.status).toBe(200);
      const body = await r.json();

      expect(body.rows).toHaveLength(3);

      const blackheath = body.rows.find((row: any) => row.host === 'blackheathbuilders.co.uk');
      expect(blackheath).toBeTruthy();
      expect(blackheath.registered).toBe(true);
      expect(blackheath.kind).toBe('geo-trade');
      expect(blackheath.trade).toBe('builder');
      // area slug for Blackheath is whatever the registry says — assert it's set.
      expect(typeof blackheath.area).toBe('string');
      expect(blackheath.area).toBeTruthy();
      expect(blackheath.count).toBe(12);

      const unknown = body.rows.find((row: any) => row.host === 'notreal.example.com');
      expect(unknown).toBeTruthy();
      expect(unknown.registered).toBe(false);
      expect(unknown.kind).toBeNull();
      expect(unknown.trade).toBeNull();

      const web = body.rows.find((row: any) => row.source === 'web');
      expect(web).toBeTruthy();
      expect(web.host).toBeNull();
      // For bare `web` rows we explicitly emit registered:null to distinguish
      // them from "unknown microsite host" rows (registered:false).
      expect(web.registered).toBeNull();
      expect(web.kind).toBeNull();
    });
  });

  // ── 6. Summary totals ───────────────────────────────────────────────
  it('computes summary totals correctly', async () => {
    s.getMicrositeLeadStats.mockResolvedValue([
      { source: 'microsite:blackheathbuilders.co.uk', count: 10, lastLeadAt: 1 },
      { source: 'microsite:blackheathplumber.co.uk', count: 5, lastLeadAt: 2 },
      { source: 'web', count: 100, lastLeadAt: 3 },
    ]);

    await withServer(app, async (port) => {
      const r = await fetch(`http://localhost:${port}${STATS_PATH}?days=0`, {
        headers: { 'x-admin-key': adminKey },
      });
      const body = await r.json();
      expect(body.summary.totalMicrositeLeads).toBe(15);
      expect(body.summary.totalWebLeads).toBe(100);
      expect(body.summary.activeMicrositeHosts).toBe(2);
      // Source of truth for portfolio size is the registry itself —
      // importing MICROSITE_COUNT avoids the need to bump a literal here
      // every time a new mini-site is registered (PR-M6 added two).
      expect(body.summary.registeredMicrositeCount).toBe(MICROSITE_COUNT);
    });
  });

  // ── 7. Empty result ─────────────────────────────────────────────────
  it('returns empty rows + zero totals when no leads exist', async () => {
    s.getMicrositeLeadStats.mockResolvedValue([]);
    await withServer(app, async (port) => {
      const r = await fetch(`http://localhost:${port}${STATS_PATH}`, {
        headers: { 'x-admin-key': adminKey },
      });
      const body = await r.json();
      expect(body.rows).toEqual([]);
      expect(body.summary.totalMicrositeLeads).toBe(0);
      expect(body.summary.totalWebLeads).toBe(0);
      expect(body.summary.activeMicrositeHosts).toBe(0);
    });
  });

  // ── 8. days capped at 3650 ──────────────────────────────────────────
  it('caps days at 3650 to keep the SQL window sane', async () => {
    await withServer(app, async (port) => {
      const r = await fetch(`http://localhost:${port}${STATS_PATH}?days=99999`, {
        headers: { 'x-admin-key': adminKey },
      });
      expect(r.status).toBe(200);
      const body = await r.json();
      expect(body.windowDays).toBe(3650);
    });
  });
});
