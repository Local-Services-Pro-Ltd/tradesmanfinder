/**
 * Tests for PR-P6 — Click Tracking
 *
 * Tests the GET /p/c/:event_id?p=<placement_id> endpoint.
 * All storage calls are stubbed — no database required.
 *
 * Covers:
 *  1. Valid placement → 302 + click event logged
 *  2. Duplicate click → 302, no duplicate event (unique constraint)
 *  3. Placement not found → 404
 *  4. Placement has no creativeUrl → 404
 *  5. Partner is paused → 302, no event logged
 *  6. Feature flag off → 302, no event logged
 *  7. Invalid UUID → 302, no event logged
 *  8. Click event shape: event_type, idempotency_key, metadata
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
vi.mock('./spam-guard', () => ({ publicFormGuard: () => (_req: any, _res: any, next: any) => next() }));

import { storage } from './storage';

type AnyFn = ReturnType<typeof vi.fn>;
const s = storage as Record<string, AnyFn>;

const NOW = 1_700_000_000_000;
const VALID_EID = 'f47ac10b-58cc-4372-a567-0e02b2c3d479';
const PLACEMENT_ID = 42;
const PARTNER_ID = 7;
const TARGET_URL = 'https://partner.example.com/landing';

function makePlacement(overrides: Record<string, unknown> = {}) {
  return {
    id: PLACEMENT_ID,
    partnerId: PARTNER_ID,
    surface: 'category_footer',
    commercialModel: 'sponsored',
    ratePence: 10000,
    rateCapPence: null,
    categoryFilter: '[]',
    areaFilter: '[]',
    priority: 10,
    activeFrom: NOW - 1000,
    activeTo: null,
    creativeHtml: 'Test Ad',
    creativeUrl: TARGET_URL,
    createdAt: NOW - 2000,
    ...overrides,
  };
}

function makePartner(overrides: Record<string, unknown> = {}) {
  return {
    id: PARTNER_ID,
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

// Helper: fetch without following redirects
async function fetchNoFollow(url: string): Promise<Response> {
  return fetch(url, { redirect: 'manual' });
}

// ── Tests ─────────────────────────────────────────────────────────────────

describe('PR-P6 GET /p/c/:event_id click tracking', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    delete process.env.PARTNER_PLACEMENTS_ENABLED;
    // Default: feature flag ON for most tests
    process.env.PARTNER_PLACEMENTS_ENABLED = 'true';
    s.getPartnerPlacementById?.mockResolvedValue(makePlacement());
    s.getPartnerById?.mockResolvedValue(makePartner());
    s.createPartnerEvent?.mockResolvedValue(undefined);
    // Reset misc mocks
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
    s.getActivePlacementsBySurface?.mockResolvedValue([]);
  });

  // 1. Valid placement → 302 to creativeUrl + event row in DB
  it('redirects to creativeUrl and logs a click event for a valid request', async () => {
    const app = await buildApp();
    await withServer(app, async (port) => {
      const r = await fetchNoFollow(
        `http://localhost:${port}/p/c/${VALID_EID}?p=${PLACEMENT_ID}`
      );
      expect(r.status).toBe(302);
      expect(r.headers.get('location')).toBe(TARGET_URL);
      expect(s.createPartnerEvent).toHaveBeenCalledOnce();
      const call = s.createPartnerEvent.mock.calls[0][0];
      expect(call.event_type).toBe('click');
      expect(call.placement_id).toBe(PLACEMENT_ID);
      expect(call.partner_id).toBe(PARTNER_ID);
      expect(call.event_id).toBe(VALID_EID);
    });
  });

  // 2. Duplicate click → second returns 302 but doesn't create a duplicate event
  it('handles duplicate click gracefully (unique constraint violation)', async () => {
    const uniqueError = Object.assign(new Error('duplicate key value violates unique constraint'), {
      code: '23505',
    });
    // First call succeeds; second call throws unique violation
    s.createPartnerEvent
      ?.mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(uniqueError);

    const app = await buildApp();
    await withServer(app, async (port) => {
      const url = `http://localhost:${port}/p/c/${VALID_EID}?p=${PLACEMENT_ID}`;
      // First click
      const r1 = await fetchNoFollow(url);
      expect(r1.status).toBe(302);
      expect(r1.headers.get('location')).toBe(TARGET_URL);
      // Second click — createPartnerEvent throws but response is still 302
      const r2 = await fetchNoFollow(url);
      expect(r2.status).toBe(302);
      expect(r2.headers.get('location')).toBe(TARGET_URL);
      expect(s.createPartnerEvent).toHaveBeenCalledTimes(2);
    });
  });

  // 3. Placement not found → 404
  it('returns 404 when placement does not exist', async () => {
    s.getPartnerPlacementById?.mockResolvedValue(undefined);
    const app = await buildApp();
    await withServer(app, async (port) => {
      const r = await fetch(
        `http://localhost:${port}/p/c/${VALID_EID}?p=9999`
      );
      expect(r.status).toBe(404);
      expect(s.createPartnerEvent).not.toHaveBeenCalled();
    });
  });

  // 4. Placement has no creativeUrl → 404
  it('returns 404 when placement has no creativeUrl', async () => {
    s.getPartnerPlacementById?.mockResolvedValue(makePlacement({ creativeUrl: null }));
    const app = await buildApp();
    await withServer(app, async (port) => {
      const r = await fetch(
        `http://localhost:${port}/p/c/${VALID_EID}?p=${PLACEMENT_ID}`
      );
      expect(r.status).toBe(404);
      expect(s.createPartnerEvent).not.toHaveBeenCalled();
    });
  });

  // 5. Partner is paused → still 302 but no event logged
  it('redirects without logging when partner is paused', async () => {
    s.getPartnerById?.mockResolvedValue(makePartner({ status: 'paused' }));
    const app = await buildApp();
    await withServer(app, async (port) => {
      const r = await fetchNoFollow(
        `http://localhost:${port}/p/c/${VALID_EID}?p=${PLACEMENT_ID}`
      );
      expect(r.status).toBe(302);
      expect(r.headers.get('location')).toBe(TARGET_URL);
      expect(s.createPartnerEvent).not.toHaveBeenCalled();
    });
  });

  // 5b. Partner is terminated → still 302 but no event logged
  it('redirects without logging when partner is terminated', async () => {
    s.getPartnerById?.mockResolvedValue(makePartner({ status: 'terminated' }));
    const app = await buildApp();
    await withServer(app, async (port) => {
      const r = await fetchNoFollow(
        `http://localhost:${port}/p/c/${VALID_EID}?p=${PLACEMENT_ID}`
      );
      expect(r.status).toBe(302);
      expect(s.createPartnerEvent).not.toHaveBeenCalled();
    });
  });

  // 6. Feature flag off → 302 to creativeUrl but no event logged
  it('redirects without logging when PARTNER_PLACEMENTS_ENABLED is off', async () => {
    delete process.env.PARTNER_PLACEMENTS_ENABLED;
    const app = await buildApp();
    await withServer(app, async (port) => {
      const r = await fetchNoFollow(
        `http://localhost:${port}/p/c/${VALID_EID}?p=${PLACEMENT_ID}`
      );
      expect(r.status).toBe(302);
      expect(r.headers.get('location')).toBe(TARGET_URL);
      expect(s.createPartnerEvent).not.toHaveBeenCalled();
    });
  });

  // 7. Invalid UUID format → 302 to creativeUrl but no event logged
  it('redirects without logging when event_id is not a valid UUID', async () => {
    const app = await buildApp();
    await withServer(app, async (port) => {
      const r = await fetchNoFollow(
        `http://localhost:${port}/p/c/not-a-uuid?p=${PLACEMENT_ID}`
      );
      expect(r.status).toBe(302);
      expect(r.headers.get('location')).toBe(TARGET_URL);
      expect(s.createPartnerEvent).not.toHaveBeenCalled();
    });
  });

  // 8. Click event has correct shape
  it('creates event with correct event_type, idempotency key pattern, and metadata', async () => {
    const app = await buildApp();
    await withServer(app, async (port) => {
      await fetchNoFollow(
        `http://localhost:${port}/p/c/${VALID_EID}?p=${PLACEMENT_ID}`
      );
      const call = s.createPartnerEvent.mock.calls[0][0];
      expect(call.event_type).toBe('click');
      expect(call.placement_id).toBe(PLACEMENT_ID);
      expect(call.partner_id).toBe(PARTNER_ID);
      expect(call.event_id).toBe(VALID_EID);
      // idempotency_key is built inside storage.createPartnerEvent as
      // `click:<placement_id>:<event_id>` — verify the inputs are correct
      // so storage can build the right key.
      expect(call.placement_id).toBe(PLACEMENT_ID);
      expect(call.event_id).toBe(VALID_EID);
      // metadata should carry a referer field (null when no Referer header)
      expect(call.metadata).toHaveProperty('referer');
    });
  });
});
