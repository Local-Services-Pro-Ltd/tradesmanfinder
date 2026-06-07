/**
 * PR-P5 — /api/placements shape contract tests
 *
 * These tests verify:
 *  1. The response shape matches what PartnerPlacement expects
 *  2. The endpoint correctly handles the feature flag
 *  3. The creative field structure (structured JSON vs. plain text)
 *  4. The event_id field is present (null or string)
 *  5. Multi-placement responses (limit param)
 *  6. Surface-specific routing (all 6 surfaces are valid)
 *
 * We use the same mock + HTTP server pattern established in
 * placement-engine.test.ts (express + node:http).
 *
 * Client-side RTL tests are skipped — vitest.config.ts uses environment:"node"
 * and excludes client/ — so server-side shape contracts are the pragmatic path.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.hoisted(() => {
  process.env.ADMIN_KEY = 'test-secret-key';
  process.env.DATABASE_URL = 'postgres://fake';
});

vi.mock('./storage', () => ({
  storage: {
    getCardsByTradesman: vi.fn().mockResolvedValue([]),
    getAllCards: vi.fn().mockResolvedValue([]),
    getTradesmanById: vi.fn().mockResolvedValue(null),
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
  },
  db: {},
}));

vi.mock('./mailer', () => ({
  sendCardIssuedEmail: vi.fn().mockResolvedValue({ ok: true, id: 'e1' }),
  sendCardRescindedEmail: vi.fn().mockResolvedValue({ ok: true, id: 'e2' }),
  sendNewLeadEmail: vi.fn().mockResolvedValue({ ok: true, id: 'e3' }),
  sendPartnerEnquiryNotification: vi.fn().mockResolvedValue({ ok: true, id: 'e4' }),
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
vi.mock('./spam-guard', () => ({ publicFormGuard: () => (_req: any, _res: any, next: any) => next(), rateLimit: () => (_req: any, _res: any, next: any) => next() }));

import { storage } from './storage';

type AnyFn = ReturnType<typeof vi.fn>;
const s = storage as Record<string, AnyFn>;

const NOW = 1_700_000_000_000;

/** Build a minimal PartnerPlacement row */
function makePlacement(overrides: Record<string, unknown> = {}) {
  return {
    id: 1,
    partnerId: 10,
    surface: 'category_footer',
    commercialModel: 'sponsored',
    ratePence: 10000,
    rateCapPence: null,
    categoryFilter: '[]',
    areaFilter: '[]',
    priority: 10,
    activeFrom: NOW - 1000,
    activeTo: null,
    creativeHtml: 'Test Headline',
    creativeUrl: 'https://partner.example.com',
    createdAt: NOW - 2000,
    ...overrides,
  };
}

/** Build a minimal Partner row */
function makePartner(overrides: Record<string, unknown> = {}) {
  return {
    id: 10,
    slug: 'test-partner',
    name: 'Test Partner',
    vertical: 'insurance',
    status: 'active',
    billingEmail: null,
    billingContact: null,
    stripeCustomerId: null,
    notes: null,
    createdAt: NOW - 10000,
    ...overrides,
  };
}

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

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('PR-P5 /api/placements shape contract', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    delete process.env.PARTNER_PLACEMENTS_ENABLED;
    s.getActivePlacementsBySurface?.mockResolvedValue([]);
    s.getPartnerById?.mockResolvedValue(null);
    s.createPartnerEvent?.mockResolvedValue(undefined);
    s.getEventsByPlacementSince?.mockResolvedValue([]);
    s.getTradesmen?.mockResolvedValue([]);
    s.getJobs?.mockResolvedValue([]);
    s.getQuotes?.mockResolvedValue([]);
    s.getReviews?.mockResolvedValue([]);
    s.getCardsByTradesman?.mockResolvedValue([]);
    s.getAllCards?.mockResolvedValue([]);
    s.logModeration?.mockResolvedValue({ id: 1 });
    s.getModerationLog?.mockResolvedValue([]);
    s.getPartnerEnquiriesByStatus?.mockResolvedValue([]);
    s.getPartners?.mockResolvedValue([]);
    s.getPartnerPlacementsByPartner?.mockResolvedValue([]);
    s.getPartnerEventsByPartner?.mockResolvedValue([]);
    s.getPartnerEventCountsByPartner?.mockResolvedValue({});
    s.getPartnerInvoicesByPartner?.mockResolvedValue([]);
  });

  // 1. Flag off → empty placements array (component renders null)
  it('returns {placements:[]} when PARTNER_PLACEMENTS_ENABLED is off', async () => {
    const app = await buildApp();
    await withServer(app, async (port) => {
      const r = await fetch(`http://localhost:${port}/api/placements?surface=category_footer`);
      expect(r.status).toBe(200);
      const body = await r.json();
      expect(body).toHaveProperty('placements');
      expect(Array.isArray(body.placements)).toBe(true);
      expect(body.placements).toHaveLength(0);
    });
  });

  // 2. Flag on, no placements → still empty array (not an error)
  it('returns empty array when flag is on but no placements exist for surface', async () => {
    process.env.PARTNER_PLACEMENTS_ENABLED = 'true';
    s.getActivePlacementsBySurface?.mockResolvedValue([]);
    const app = await buildApp();
    await withServer(app, async (port) => {
      const r = await fetch(`http://localhost:${port}/api/placements?surface=area_footer`);
      expect(r.status).toBe(200);
      const body = await r.json();
      expect(body.placements).toEqual([]);
    });
  });

  // 3. Shape: placement fields match what PartnerPlacement component expects
  it('returns placement with correct shape when flag on and placement exists', async () => {
    process.env.PARTNER_PLACEMENTS_ENABLED = 'true';
    s.getActivePlacementsBySurface?.mockResolvedValue([makePlacement()]);
    s.getPartnerById?.mockResolvedValue(makePartner());
    const app = await buildApp();
    await withServer(app, async (port) => {
      const r = await fetch(`http://localhost:${port}/api/placements?surface=category_footer`);
      expect(r.status).toBe(200);
      const body = await r.json();
      expect(body.placements).toHaveLength(1);
      const p = body.placements[0];
      // Required fields for the component
      expect(typeof p.id).toBe('number');
      expect(typeof p.partner_id).toBe('number');
      expect(typeof p.surface).toBe('string');
      expect(typeof p.target_url).toBe('string');
      expect(typeof p.weight).toBe('number');
      // event_id is null or string
      expect(p.event_id === null || typeof p.event_id === 'string').toBe(true);
    });
  });

  // 4. creative field — plain text becomes { headline }
  it('returns creative.headline from plain-text creativeHtml', async () => {
    process.env.PARTNER_PLACEMENTS_ENABLED = 'true';
    s.getActivePlacementsBySurface?.mockResolvedValue([
      makePlacement({ creativeHtml: 'Plain headline text' }),
    ]);
    s.getPartnerById?.mockResolvedValue(makePartner());
    const app = await buildApp();
    await withServer(app, async (port) => {
      const r = await fetch(`http://localhost:${port}/api/placements?surface=category_footer`);
      const body = await r.json();
      const creative = body.placements[0].creative;
      expect(creative.headline).toBe('Plain headline text');
    });
  });

  // 5. creative field — structured JSON is parsed correctly
  it('parses structured JSON creative with headline/body/cta/image_url', async () => {
    process.env.PARTNER_PLACEMENTS_ENABLED = 'true';
    const structured = JSON.stringify({
      headline: 'Get your EPC today',
      body: 'Fast, accredited, fixed price',
      cta: 'Book now',
      image_url: 'https://cdn.example.com/ad.png',
    });
    s.getActivePlacementsBySurface?.mockResolvedValue([
      makePlacement({ creativeHtml: structured }),
    ]);
    s.getPartnerById?.mockResolvedValue(makePartner());
    const app = await buildApp();
    await withServer(app, async (port) => {
      const r = await fetch(`http://localhost:${port}/api/placements?surface=category_footer`);
      const body = await r.json();
      const creative = body.placements[0].creative;
      expect(creative.headline).toBe('Get your EPC today');
      expect(creative.body).toBe('Fast, accredited, fixed price');
      expect(creative.cta).toBe('Book now');
      expect(creative.image_url).toBe('https://cdn.example.com/ad.png');
    });
  });

  // 6. limit param — up to 3 results returned
  it('respects limit=2 and returns at most 2 placements', async () => {
    process.env.PARTNER_PLACEMENTS_ENABLED = 'true';
    // Three placements from three different partners
    const placements = [1, 2, 3].map((id) =>
      makePlacement({ id, partnerId: id * 10, priority: 10 })
    );
    s.getActivePlacementsBySurface?.mockResolvedValue(placements);
    s.getPartnerById?.mockImplementation(async (id: number) =>
      makePartner({ id, status: 'active' })
    );
    const app = await buildApp();
    await withServer(app, async (port) => {
      const r = await fetch(`http://localhost:${port}/api/placements?surface=category_footer&limit=2`);
      const body = await r.json();
      expect(body.placements.length).toBeLessThanOrEqual(2);
    });
  });

  // 7. All 6 surfaces are accepted (400 only when surface is missing/unknown — not surface-specific)
  it('accepts all 6 PARTNER_SURFACES values without error', async () => {
    const surfaces = [
      'category_footer', 'area_footer', 'job_confirmation',
      'dashboard_sidebar', 'lead_email_footer', 'partners_page',
    ];
    const app = await buildApp();
    await withServer(app, async (port) => {
      for (const surface of surfaces) {
        const r = await fetch(`http://localhost:${port}/api/placements?surface=${surface}`);
        expect(r.status).toBe(200);
        const body = await r.json();
        expect(Array.isArray(body.placements)).toBe(true);
      }
    });
  });

  // 8. target_url is the placement's creativeUrl
  it('returns target_url matching the placement creativeUrl', async () => {
    process.env.PARTNER_PLACEMENTS_ENABLED = 'true';
    s.getActivePlacementsBySurface?.mockResolvedValue([
      makePlacement({ creativeUrl: 'https://mypartner.co.uk/landing' }),
    ]);
    s.getPartnerById?.mockResolvedValue(makePartner());
    const app = await buildApp();
    await withServer(app, async (port) => {
      const r = await fetch(`http://localhost:${port}/api/placements?surface=dashboard_sidebar`);
      const body = await r.json();
      expect(body.placements[0].target_url).toBe('https://mypartner.co.uk/landing');
    });
  });
});
