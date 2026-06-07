// Unit tests for PR-P3 Partner Programme admin routes.
//
// We stub the storage layer (no DB) and mailer (no network).
// Covers: enquiry-convert atomicity, slug conflicts, placement enum validation,
// deletePartner 409 guard, status enum check, and admin-key guard.
import { describe, it, expect, vi, beforeEach, beforeAll } from 'vitest';

// Use vi.hoisted to set env vars BEFORE any module-level code runs.
// routes.ts throws if ADMIN_KEY is not set at module-init time.
const { adminKey } = vi.hoisted(() => {
  process.env.ADMIN_KEY = 'test-secret-key';
  process.env.DATABASE_URL = 'postgres://fake';
  return { adminKey: 'test-secret-key' };
});

// vi.mock factories are hoisted — factory bodies must be self-contained.
vi.mock('./mailer', () => ({
  sendCardIssuedEmail: vi.fn().mockResolvedValue({ ok: true, id: 'email_1' }),
  sendCardRescindedEmail: vi.fn().mockResolvedValue({ ok: true, id: 'email_2' }),
  sendNewLeadEmail: vi.fn().mockResolvedValue({ ok: true, id: 'email_3' }),
  sendPartnerEnquiryNotification: vi.fn().mockResolvedValue({ ok: true, id: 'email_4' }),
}));

vi.mock('./stripe', () => ({
  stripe: {
    webhooks: { constructEvent: vi.fn() },
    checkout: { sessions: { create: vi.fn(), listLineItems: vi.fn() } },
  },
  STRIPE_WEBHOOK_SECRET: 'whsec_test',
  stripeIsConfigured: false,
  productKindFromPriceId: () => null,
  creditsForProductKind: () => 0,
  PRODUCT_KINDS: [],
}));

vi.mock('./stripe-checkout', () => ({ createLeadPackCheckoutSession: vi.fn() }));
vi.mock('./stripe-webhook', () => ({ handleStripeWebhook: vi.fn() }));
vi.mock('./spam-guard', () => ({ publicFormGuard: () => (_req: any, _res: any, next: any) => next() }));

vi.mock('./storage', () => ({
  storage: {
    // tradesman helpers (used by route setup)
    getCardsByTradesman: vi.fn().mockResolvedValue([]),
    getAllCards: vi.fn().mockResolvedValue([]),
    getTradesmanById: vi.fn().mockResolvedValue(null),
    getTradesmen: vi.fn().mockResolvedValue([]),
    getJobs: vi.fn().mockResolvedValue([]),
    getQuotes: vi.fn().mockResolvedValue([]),
    getReviews: vi.fn().mockResolvedValue([]),
    logModeration: vi.fn().mockResolvedValue({ id: 1 }),
    getModerationLog: vi.fn().mockResolvedValue([]),
    // partner enquiry admin
    getPartnerEnquiriesByStatus: vi.fn().mockResolvedValue([]),
    getPartnerEnquiryById: vi.fn().mockResolvedValue(null),
    updatePartnerEnquiryStatus: vi.fn().mockResolvedValue({ id: 1, status: 'contacted' }),
    promoteEnquiryToPartner: vi.fn().mockResolvedValue(null),
    // partners CRUD
    createPartner: vi.fn().mockResolvedValue(null),
    getPartners: vi.fn().mockResolvedValue([]),
    getPartnerById: vi.fn().mockResolvedValue(null),
    getPartnerBySlug: vi.fn().mockResolvedValue(null),
    updatePartner: vi.fn().mockResolvedValue(null),
    deletePartner: vi.fn().mockResolvedValue({ ok: true }),
    // placements
    createPartnerPlacement: vi.fn().mockResolvedValue(null),
    getPartnerPlacementsByPartner: vi.fn().mockResolvedValue([]),
    getPartnerPlacementById: vi.fn().mockResolvedValue(null),
    updatePartnerPlacement: vi.fn().mockResolvedValue(null),
    deletePartnerPlacement: vi.fn().mockResolvedValue(undefined),
    // events
    getPartnerEventsByPartner: vi.fn().mockResolvedValue([]),
    getPartnerEventCountsByPartner: vi.fn().mockResolvedValue({}),
    // invoices
    getPartnerInvoicesByPartner: vi.fn().mockResolvedValue([]),
  },
  db: {},
}));

import express from 'express';
import { createServer } from 'node:http';
import { registerRoutes } from './routes';
import { storage } from './storage';

// Typed alias so TS lets us call vi.fn methods on the stubs.
type AnyFn = ReturnType<typeof vi.fn>;
const s = storage as Record<string, AnyFn>;

async function buildApp() {
  const app = express();
  app.use(express.json());
  const httpServer = createServer(app);
  await registerRoutes(httpServer, app);
  return app;
}

async function withServer(app: express.Express, testFn: (port: number) => Promise<void>): Promise<void> {
  return new Promise((resolve, reject) => {
    const server = app.listen(0, async () => {
      const port = (server.address() as any).port as number;
      try {
        await testFn(port);
        server.close(resolve);
      } catch (e) {
        server.close(() => reject(e));
      }
    });
  });
}

const ADMIN_HDR: Record<string, string> = {
  'x-admin-key': adminKey,
  'Content-Type': 'application/json',
};

describe('partner admin routes', () => {
  let app: ReturnType<typeof express>;

  beforeEach(async () => {
    vi.clearAllMocks();
    // Re-set defaults that clearAllMocks wipes out
    s.getCardsByTradesman.mockResolvedValue([]);
    s.getAllCards.mockResolvedValue([]);
    s.getTradesmen.mockResolvedValue([]);
    s.getJobs.mockResolvedValue([]);
    s.getQuotes.mockResolvedValue([]);
    s.getReviews.mockResolvedValue([]);
    s.logModeration.mockResolvedValue({ id: 1 });
    s.getModerationLog.mockResolvedValue([]);
    s.getPartnerEnquiriesByStatus.mockResolvedValue([]);
    s.getPartnerEnquiryById.mockResolvedValue(null);
    s.updatePartnerEnquiryStatus.mockResolvedValue({ id: 1, status: 'contacted' });
    s.promoteEnquiryToPartner.mockResolvedValue(null);
    s.createPartner.mockResolvedValue(null);
    s.getPartners.mockResolvedValue([]);
    s.getPartnerById.mockResolvedValue(null);
    s.getPartnerBySlug.mockResolvedValue(null);
    s.updatePartner.mockResolvedValue(null);
    s.deletePartner.mockResolvedValue({ ok: true });
    s.createPartnerPlacement.mockResolvedValue(null);
    s.getPartnerPlacementsByPartner.mockResolvedValue([]);
    s.getPartnerPlacementById.mockResolvedValue(null);
    s.updatePartnerPlacement.mockResolvedValue(null);
    s.deletePartnerPlacement.mockResolvedValue(undefined);
    s.getPartnerEventsByPartner.mockResolvedValue([]);
    s.getPartnerEventCountsByPartner.mockResolvedValue({});
    s.getPartnerInvoicesByPartner.mockResolvedValue([]);

    app = await buildApp();
  });

  // ── 1. Admin guard: missing key returns 401 ──
  it('returns 401 when x-admin-key header is missing', async () => {
    await withServer(app, async (port) => {
      const r = await fetch(`http://localhost:${port}/api/admin/partner-enquiries`);
      expect(r.status).toBe(401);
    });
  });

  // ── 2. Admin guard: correct key allows access ──
  it('returns 200 with correct admin key', async () => {
    s.getPartnerEnquiriesByStatus.mockResolvedValue([{ id: 1 }]);
    await withServer(app, async (port) => {
      const r = await fetch(`http://localhost:${port}/api/admin/partner-enquiries`, {
        headers: { 'x-admin-key': adminKey },
      });
      expect(r.status).toBe(200);
    });
  });

  // ── 3. Status update validates against PARTNER_ENQUIRY_STATUSES enum ──
  it('POST /status returns 400 for invalid status value', async () => {
    s.getPartnerEnquiryById.mockResolvedValue({ id: 5, status: 'new' });
    await withServer(app, async (port) => {
      const r = await fetch(`http://localhost:${port}/api/admin/partner-enquiries/5/status`, {
        method: 'POST',
        headers: ADMIN_HDR,
        body: JSON.stringify({ status: 'invalid-status' }),
      });
      expect(r.status).toBe(400);
    });
  });

  // ── 4. Status update succeeds for valid status ──
  it('POST /status calls storage with valid status', async () => {
    const enquiry = { id: 5, status: 'new', companyName: 'Test Co' };
    s.getPartnerEnquiryById.mockResolvedValue(enquiry);
    s.updatePartnerEnquiryStatus.mockResolvedValue({ ...enquiry, status: 'contacted' });

    await withServer(app, async (port) => {
      const r = await fetch(`http://localhost:${port}/api/admin/partner-enquiries/5/status`, {
        method: 'POST',
        headers: ADMIN_HDR,
        body: JSON.stringify({ status: 'contacted' }),
      });
      expect(r.status).toBe(200);
      expect(s.updatePartnerEnquiryStatus).toHaveBeenCalledWith(5, 'contacted');
    });
  });

  // ── 5. promoteEnquiryToPartner: creates partner + updates enquiry ──
  it('POST /convert returns 201 with {partner, enquiry}', async () => {
    const enquiry = { id: 3, companyName: 'BuildRight', vertical: 'builders_merchant', status: 'new' };
    const newPartner = { id: 100, slug: 'buildright', name: 'BuildRight', vertical: 'builders_merchant', status: 'pilot', createdAt: Date.now() };
    const updatedEnquiry = { ...enquiry, status: 'won', promotedPartnerId: 100 };

    s.getPartnerEnquiryById.mockResolvedValue(enquiry);
    s.promoteEnquiryToPartner.mockResolvedValue({ partner: newPartner, enquiry: updatedEnquiry });

    await withServer(app, async (port) => {
      const r = await fetch(`http://localhost:${port}/api/admin/partner-enquiries/3/convert`, {
        method: 'POST',
        headers: ADMIN_HDR,
        body: JSON.stringify({ slug: 'buildright' }),
      });
      expect(r.status).toBe(201);
      const body = await r.json();
      expect(body.partner.slug).toBe('buildright');
      expect(body.enquiry.status).toBe('won');
      expect(s.promoteEnquiryToPartner).toHaveBeenCalledWith(3, expect.objectContaining({ slug: 'buildright' }));
    });
  });

  // ── 6. Duplicate slug returns 409 ──
  it('POST /convert returns 409 on SLUG_CONFLICT', async () => {
    s.getPartnerEnquiryById.mockResolvedValue({ id: 7, companyName: 'Dup Co', status: 'new' });
    const conflictErr = Object.assign(new Error('Slug already in use'), { code: 'SLUG_CONFLICT' });
    s.promoteEnquiryToPartner.mockRejectedValue(conflictErr);

    await withServer(app, async (port) => {
      const r = await fetch(`http://localhost:${port}/api/admin/partner-enquiries/7/convert`, {
        method: 'POST',
        headers: ADMIN_HDR,
        body: JSON.stringify({ slug: 'dup-co' }),
      });
      expect(r.status).toBe(409);
    });
  });

  // ── 7. Placement enum validation rejects bad surface ──
  it('POST /placements returns 400 for invalid surface', async () => {
    s.getPartnerById.mockResolvedValue({ id: 1, name: 'Test', slug: 'test', status: 'active' });

    await withServer(app, async (port) => {
      const r = await fetch(`http://localhost:${port}/api/admin/partners/1/placements`, {
        method: 'POST',
        headers: ADMIN_HDR,
        body: JSON.stringify({
          surface: 'not_a_real_surface',
          commercialModel: 'sponsored',
          ratePence: 10000,
          activeFrom: Date.now(),
        }),
      });
      expect(r.status).toBe(400);
      const body = await r.json();
      expect(body.message).toMatch(/surface/i);
    });
  });

  // ── 8. deletePartner returns 409 when storage says not deletable ──
  it('DELETE /partners/:id returns 409 when deletePartner returns ok:false', async () => {
    s.getPartnerById.mockResolvedValue({ id: 2, status: 'inactive' });
    s.deletePartner.mockResolvedValue({ ok: false, reason: 'Partner has placements -- remove them first' });

    await withServer(app, async (port) => {
      const r = await fetch(`http://localhost:${port}/api/admin/partners/2`, {
        method: 'DELETE',
        headers: { 'x-admin-key': adminKey },
      });
      expect(r.status).toBe(409);
      const body = await r.json();
      expect(body.message).toContain('placements');
    });
  });

  // ── 9. PATCH /partners/:id validates status enum ──
  it('PATCH /partners/:id returns 400 for invalid status', async () => {
    s.getPartnerById.mockResolvedValue({ id: 9, name: 'Widget Co', status: 'active' });

    await withServer(app, async (port) => {
      const r = await fetch(`http://localhost:${port}/api/admin/partners/9`, {
        method: 'PATCH',
        headers: ADMIN_HDR,
        body: JSON.stringify({ status: 'flying' }),
      });
      expect(r.status).toBe(400);
    });
  });

  // ── 10. POST /partners validates slug format ──
  it('POST /partners returns 400 for badly-formed slug', async () => {
    await withServer(app, async (port) => {
      const r = await fetch(`http://localhost:${port}/api/admin/partners`, {
        method: 'POST',
        headers: ADMIN_HDR,
        body: JSON.stringify({ slug: 'INVALID SLUG!!', name: 'Foo', vertical: 'insurance' }),
      });
      expect(r.status).toBe(400);
    });
  });

  // ── 11. GET /partners/:partnerId/events returns event array ──
  it('GET /partners/:partnerId/events returns events array', async () => {
    const fakeEvents = [{ id: 1, eventType: 'impression', occurredAt: Date.now() }];
    s.getPartnerEventsByPartner.mockResolvedValue(fakeEvents);

    await withServer(app, async (port) => {
      const r = await fetch(`http://localhost:${port}/api/admin/partners/1/events`, {
        headers: { 'x-admin-key': adminKey },
      });
      expect(r.status).toBe(200);
      const body = await r.json();
      expect(Array.isArray(body)).toBe(true);
      expect(body[0].eventType).toBe('impression');
    });
  });

  // ── 12. GET /partners/:partnerId/invoices — read-only stub ──
  it('GET /partners/:partnerId/invoices returns array stub', async () => {
    await withServer(app, async (port) => {
      const r = await fetch(`http://localhost:${port}/api/admin/partners/1/invoices`, {
        headers: { 'x-admin-key': adminKey },
      });
      expect(r.status).toBe(200);
      const body = await r.json();
      expect(Array.isArray(body)).toBe(true);
    });
  });
});
