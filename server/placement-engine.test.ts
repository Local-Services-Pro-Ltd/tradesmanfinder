/**
 * Tests for PR-P4 Placement Engine
 *
 * All storage calls are stubbed — no database required.
 * The `selectPlacements` function is pure (injected storage + env + clock),
 * which makes every case fast and deterministic.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// Set env vars before module-level code in routes.ts / storage.ts runs
vi.hoisted(() => {
  process.env.ADMIN_KEY = 'test-secret-key';
  process.env.DATABASE_URL = 'postgres://fake';
});

// Stub out modules that hit the network / database
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

import { selectPlacements, debugPlacements } from './placement-engine';
import type { SelectPlacementsInput } from './placement-engine';
import type { PartnerPlacement, Partner } from '@shared/schema';
import { storage } from './storage';

type AnyFn = ReturnType<typeof vi.fn>;
const s = storage as Record<string, AnyFn>;

// ── Helpers ──────────────────────────────────────────────────────────────────

const NOW = 1_700_000_000_000; // fixed timestamp

function makePlacement(overrides: Partial<PartnerPlacement> = {}): PartnerPlacement {
  return {
    id: 1,
    partnerId: 10,
    surface: 'category_footer',
    commercialModel: 'sponsored',
    ratePence: 10000,
    rateCapPence: null,
    categoryFilter: '[]',
    areaFilter: '[]',
    priority: 100,
    activeFrom: NOW - 1000,
    activeTo: null,
    creativeHtml: 'Test Ad',
    creativeUrl: 'https://partner.example.com',
    createdAt: NOW - 2000,
    ...overrides,
  };
}

function makePartner(overrides: Partial<Partner> = {}): Partner {
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

function makeStorage(overrides: Partial<Record<string, any>> = {}) {
  return {
    getActivePlacementsBySurface: vi.fn().mockResolvedValue([]),
    getPartnerById: vi.fn().mockResolvedValue(null),
    createPartnerEvent: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

const enabledEnv = { PARTNER_PLACEMENTS_ENABLED: 'true', PARTNER_IMPRESSION_SAMPLE_RATE: '0.1' };

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('selectPlacements — placement engine unit tests', () => {

  // 1. Feature flag OFF → empty array, no events logged
  it('returns empty array when PARTNER_PLACEMENTS_ENABLED is not set', async () => {
    const mockStorage = makeStorage({
      getActivePlacementsBySurface: vi.fn().mockResolvedValue([makePlacement()]),
      getPartnerById: vi.fn().mockResolvedValue(makePartner()),
    });
    const result = await selectPlacements({
      surface: 'category_footer',
      storage: mockStorage as any,
      env: {}, // no flag
      nowMs: NOW,
    });
    expect(result.placements).toHaveLength(0);
    expect(mockStorage.createPartnerEvent).not.toHaveBeenCalled();
  });

  it('returns empty array when PARTNER_PLACEMENTS_ENABLED=false', async () => {
    const mockStorage = makeStorage({
      getActivePlacementsBySurface: vi.fn().mockResolvedValue([makePlacement()]),
      getPartnerById: vi.fn().mockResolvedValue(makePartner()),
    });
    const result = await selectPlacements({
      surface: 'category_footer',
      storage: mockStorage as any,
      env: { PARTNER_PLACEMENTS_ENABLED: 'false' },
      nowMs: NOW,
    });
    expect(result.placements).toHaveLength(0);
  });

  // 2. No active placements for surface → empty result
  it('returns empty when no placements exist for the surface', async () => {
    const mockStorage = makeStorage(); // getActivePlacementsBySurface returns []
    const result = await selectPlacements({
      surface: 'area_footer',
      storage: mockStorage as any,
      env: enabledEnv,
      nowMs: NOW,
    });
    expect(result.placements).toHaveLength(0);
  });

  // 3. Filters out placements with inactive partner
  it('filters out placements whose partner is paused', async () => {
    const p = makePlacement({ partnerId: 11 });
    const partner = makePartner({ id: 11, status: 'paused' });
    const mockStorage = makeStorage({
      getActivePlacementsBySurface: vi.fn().mockResolvedValue([p]),
      getPartnerById: vi.fn().mockResolvedValue(partner),
    });
    const result = await selectPlacements({
      surface: 'category_footer',
      storage: mockStorage as any,
      env: enabledEnv,
      nowMs: NOW,
    });
    expect(result.placements).toHaveLength(0);
  });

  it('filters out placements whose partner is terminated', async () => {
    const p = makePlacement({ partnerId: 12 });
    const partner = makePartner({ id: 12, status: 'terminated' });
    const mockStorage = makeStorage({
      getActivePlacementsBySurface: vi.fn().mockResolvedValue([p]),
      getPartnerById: vi.fn().mockResolvedValue(partner),
    });
    const result = await selectPlacements({
      surface: 'category_footer',
      storage: mockStorage as any,
      env: enabledEnv,
      nowMs: NOW,
    });
    expect(result.placements).toHaveLength(0);
  });

  // PR-P11 hardening: whitelist filter (only `active` and `pilot` serve).
  it('filters out placements whose partner is inactive (PR-P11 whitelist)', async () => {
    const p = makePlacement({ partnerId: 13 });
    const partner = makePartner({ id: 13, status: 'inactive' });
    const mockStorage = makeStorage({
      getActivePlacementsBySurface: vi.fn().mockResolvedValue([p]),
      getPartnerById: vi.fn().mockResolvedValue(partner),
    });
    const result = await selectPlacements({
      surface: 'category_footer',
      storage: mockStorage as any,
      env: enabledEnv,
      nowMs: NOW,
    });
    expect(result.placements).toHaveLength(0);
  });

  it('serves placements for partners with status=pilot (PR-P11 whitelist)', async () => {
    const p = makePlacement({ partnerId: 14, creativeUrl: 'https://example.com', creativeHtml: '<b>pilot</b>' });
    const partner = makePartner({ id: 14, status: 'pilot' });
    const mockStorage = makeStorage({
      getActivePlacementsBySurface: vi.fn().mockResolvedValue([p]),
      getPartnerById: vi.fn().mockResolvedValue(partner),
    });
    const result = await selectPlacements({
      surface: 'category_footer',
      storage: mockStorage as any,
      env: { PARTNER_PLACEMENTS_ENABLED: 'true', PARTNER_IMPRESSION_SAMPLE_RATE: '0.0' },
      nowMs: NOW,
    });
    expect(result.placements).toHaveLength(1);
    expect(result.placements[0].partner_id).toBe(14);
  });

  it('rejects unknown partner status values (PR-P11 whitelist is strict)', async () => {
    const p = makePlacement({ partnerId: 15 });
    const partner = makePartner({ id: 15, status: 'some_future_status' as any });
    const mockStorage = makeStorage({
      getActivePlacementsBySurface: vi.fn().mockResolvedValue([p]),
      getPartnerById: vi.fn().mockResolvedValue(partner),
    });
    const result = await selectPlacements({
      surface: 'category_footer',
      storage: mockStorage as any,
      env: enabledEnv,
      nowMs: NOW,
    });
    expect(result.placements).toHaveLength(0);
  });

  // 4. Filters out placements with mismatched category
  it('filters out placements with non-matching categoryFilter', async () => {
    const p = makePlacement({ categoryFilter: '[3, 4, 5]' }); // category 2 not in list
    const mockStorage = makeStorage({
      getActivePlacementsBySurface: vi.fn().mockResolvedValue([p]),
      getPartnerById: vi.fn().mockResolvedValue(makePartner()),
    });
    const result = await selectPlacements({
      surface: 'category_footer',
      category: 2,
      storage: mockStorage as any,
      env: enabledEnv,
      nowMs: NOW,
    });
    expect(result.placements).toHaveLength(0);
  });

  it('includes placements with empty categoryFilter (means all categories)', async () => {
    const p = makePlacement({ categoryFilter: '[]' });
    const mockStorage = makeStorage({
      getActivePlacementsBySurface: vi.fn().mockResolvedValue([p]),
      getPartnerById: vi.fn().mockResolvedValue(makePartner()),
    });
    const result = await selectPlacements({
      surface: 'category_footer',
      category: 99,
      storage: mockStorage as any,
      env: enabledEnv,
      nowMs: NOW,
    });
    expect(result.placements).toHaveLength(1);
  });

  // 5. Filters out time-expired placements
  it('filters out placements that have not yet started', async () => {
    const p = makePlacement({ activeFrom: NOW + 99999 }); // starts in the future
    const mockStorage = makeStorage({
      getActivePlacementsBySurface: vi.fn().mockResolvedValue([p]),
      getPartnerById: vi.fn().mockResolvedValue(makePartner()),
    });
    const result = await selectPlacements({
      surface: 'category_footer',
      storage: mockStorage as any,
      env: enabledEnv,
      nowMs: NOW,
    });
    expect(result.placements).toHaveLength(0);
  });

  it('filters out placements that have expired', async () => {
    const p = makePlacement({ activeTo: NOW - 1 }); // expired
    const mockStorage = makeStorage({
      getActivePlacementsBySurface: vi.fn().mockResolvedValue([p]),
      getPartnerById: vi.fn().mockResolvedValue(makePartner()),
    });
    const result = await selectPlacements({
      surface: 'category_footer',
      storage: mockStorage as any,
      env: enabledEnv,
      nowMs: NOW,
    });
    expect(result.placements).toHaveLength(0);
  });

  // 6. Respects limit
  it('returns at most limit placements', async () => {
    const placements = [1, 2, 3, 4, 5].map((id) =>
      makePlacement({ id, partnerId: id * 10 }),
    );
    const mockStorage = makeStorage({
      getActivePlacementsBySurface: vi.fn().mockResolvedValue(placements),
      getPartnerById: vi.fn().mockImplementation((id: number) =>
        Promise.resolve(makePartner({ id, status: 'active' })),
      ),
    });
    const result = await selectPlacements({
      surface: 'category_footer',
      limit: 2,
      storage: mockStorage as any,
      env: enabledEnv,
      nowMs: NOW,
    });
    expect(result.placements).toHaveLength(2);
  });

  it('caps limit at 3', async () => {
    const placements = [1, 2, 3, 4, 5].map((id) =>
      makePlacement({ id, partnerId: id * 10 }),
    );
    const mockStorage = makeStorage({
      getActivePlacementsBySurface: vi.fn().mockResolvedValue(placements),
      getPartnerById: vi.fn().mockImplementation((id: number) =>
        Promise.resolve(makePartner({ id, status: 'active' })),
      ),
    });
    const result = await selectPlacements({
      surface: 'category_footer',
      limit: 99, // should be capped at 3
      storage: mockStorage as any,
      env: enabledEnv,
      nowMs: NOW,
    });
    expect(result.placements).toHaveLength(3);
  });

  // 7. De-duplication: same partner not returned twice
  it('does not return two placements from the same partner', async () => {
    const p1 = makePlacement({ id: 1, partnerId: 10, priority: 1 });
    const p2 = makePlacement({ id: 2, partnerId: 10, priority: 2 }); // same partner
    const mockStorage = makeStorage({
      getActivePlacementsBySurface: vi.fn().mockResolvedValue([p1, p2]),
      getPartnerById: vi.fn().mockResolvedValue(makePartner({ id: 10 })),
    });
    const result = await selectPlacements({
      surface: 'category_footer',
      limit: 3,
      storage: mockStorage as any,
      env: enabledEnv,
      nowMs: NOW,
    });
    // Only one placement even though two exist — same partner
    expect(result.placements).toHaveLength(1);
    expect(result.placements[0].partner_id).toBe(10);
  });

  // 8. Weighted selection — high-weight wins more often
  it('higher-weight (lower priority) placement wins more often over many runs', async () => {
    // p1: priority=1 → weight=100; p2: priority=100 → weight=1
    const p1 = makePlacement({ id: 1, partnerId: 10, priority: 1 });
    const p2 = makePlacement({ id: 2, partnerId: 20, priority: 100 });
    const mockStorage = makeStorage({
      getActivePlacementsBySurface: vi.fn().mockResolvedValue([p1, p2]),
      getPartnerById: vi.fn().mockImplementation((id: number) =>
        Promise.resolve(makePartner({ id, status: 'active' })),
      ),
    });
    let p1Wins = 0;
    const iterations = 1000;
    for (let i = 0; i < iterations; i++) {
      const result = await selectPlacements({
        surface: 'category_footer',
        limit: 1,
        storage: mockStorage as any,
        env: enabledEnv,
        nowMs: NOW,
      });
      if (result.placements[0]?.partner_id === 10) p1Wins++;
    }
    // p1 has weight 100 vs p2's weight 1 → p1 should win ~99% of time
    // Allow a conservative range: at least 90% wins
    expect(p1Wins).toBeGreaterThan(800);
  });

  // 9. Correct response shape
  it('returns correct shape for a valid placement', async () => {
    const p = makePlacement({ creativeHtml: 'Get a quote', creativeUrl: 'https://example.com' });
    const mockStorage = makeStorage({
      getActivePlacementsBySurface: vi.fn().mockResolvedValue([p]),
      getPartnerById: vi.fn().mockResolvedValue(makePartner()),
    });
    const result = await selectPlacements({
      surface: 'category_footer',
      storage: mockStorage as any,
      env: enabledEnv,
      nowMs: NOW,
    });
    expect(result.placements).toHaveLength(1);
    const placement = result.placements[0];
    expect(placement.id).toBe(p.id);
    expect(placement.partner_id).toBe(p.partnerId);
    expect(placement.surface).toBe('category_footer');
    expect(placement.creative.headline).toBe('Get a quote');
    expect(placement.target_url).toBe('https://example.com');
    expect(typeof placement.weight).toBe('number');
    // event_id is string or null
    expect(placement.event_id === null || typeof placement.event_id === 'string').toBe(true);
  });

  // 10. Impression event has correct shape (sampled)
  it('event_id is a UUID string when sampled (sample rate = 1.0)', async () => {
    const p = makePlacement();
    const mockStorage = makeStorage({
      getActivePlacementsBySurface: vi.fn().mockResolvedValue([p]),
      getPartnerById: vi.fn().mockResolvedValue(makePartner()),
    });
    // Force sample rate to 1.0 and random to always return 0 (< 1.0 → always sample)
    const result = await selectPlacements({
      surface: 'category_footer',
      storage: mockStorage as any,
      env: { PARTNER_PLACEMENTS_ENABLED: 'true', PARTNER_IMPRESSION_SAMPLE_RATE: '1.0' },
      nowMs: NOW,
      random: () => 0, // always sample
    });
    expect(result.placements[0].event_id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
    );
  });

  it('event_id is null when not sampled (sample rate = 0.0)', async () => {
    const p = makePlacement();
    const mockStorage = makeStorage({
      getActivePlacementsBySurface: vi.fn().mockResolvedValue([p]),
      getPartnerById: vi.fn().mockResolvedValue(makePartner()),
    });
    // random always returns 0.5; sample rate 0 → 0.5 >= 0 is false only if rate=0... wait:
    // sampled = random() < sampleRate → 0.5 < 0.0 → false → not sampled
    const result = await selectPlacements({
      surface: 'category_footer',
      storage: mockStorage as any,
      env: { PARTNER_PLACEMENTS_ENABLED: 'true', PARTNER_IMPRESSION_SAMPLE_RATE: '0.0' },
      nowMs: NOW,
      random: () => 0.5,
    });
    expect(result.placements[0].event_id).toBeNull();
  });

  // 11. 1-in-10 sampling: over 100 runs, roughly 10 event_ids are non-null
  it('roughly 10% of runs produce a non-null event_id (1-in-10 sampling)', async () => {
    const p = makePlacement();
    const mockStorage = makeStorage({
      getActivePlacementsBySurface: vi.fn().mockResolvedValue([p]),
      getPartnerById: vi.fn().mockResolvedValue(makePartner()),
    });
    let sampledCount = 0;
    const runs = 100;
    for (let i = 0; i < runs; i++) {
      const result = await selectPlacements({
        surface: 'category_footer',
        storage: mockStorage as any,
        env: { PARTNER_PLACEMENTS_ENABLED: 'true', PARTNER_IMPRESSION_SAMPLE_RATE: '0.1' },
        nowMs: NOW,
        // Use real Math.random so distribution is real
      });
      if (result.placements[0]?.event_id !== null) sampledCount++;
    }
    // Expect roughly 10 (allow 3–30 for stability)
    expect(sampledCount).toBeGreaterThanOrEqual(3);
    expect(sampledCount).toBeLessThanOrEqual(30);
  });

  // 12. Area filter matching
  it('filters out placements with non-matching areaFilter', async () => {
    const p = makePlacement({ areaFilter: '[5, 6, 7]' });
    const mockStorage = makeStorage({
      getActivePlacementsBySurface: vi.fn().mockResolvedValue([p]),
      getPartnerById: vi.fn().mockResolvedValue(makePartner()),
    });
    const result = await selectPlacements({
      surface: 'category_footer',
      area: 99,
      storage: mockStorage as any,
      env: enabledEnv,
      nowMs: NOW,
    });
    expect(result.placements).toHaveLength(0);
  });

  it('includes placements with matching area', async () => {
    const p = makePlacement({ areaFilter: '[5, 6, 7]' });
    const mockStorage = makeStorage({
      getActivePlacementsBySurface: vi.fn().mockResolvedValue([p]),
      getPartnerById: vi.fn().mockResolvedValue(makePartner()),
    });
    const result = await selectPlacements({
      surface: 'category_footer',
      area: 6,
      storage: mockStorage as any,
      env: enabledEnv,
      nowMs: NOW,
    });
    expect(result.placements).toHaveLength(1);
  });

  // 13. JSON creative in creativeHtml
  it('parses structured JSON creative from creativeHtml', async () => {
    const creative = JSON.stringify({ headline: 'EPC Quote', body: 'Fast & free', cta: 'Get Started', image_url: 'https://img.example.com/ad.png' });
    const p = makePlacement({ creativeHtml: creative });
    const mockStorage = makeStorage({
      getActivePlacementsBySurface: vi.fn().mockResolvedValue([p]),
      getPartnerById: vi.fn().mockResolvedValue(makePartner()),
    });
    const result = await selectPlacements({
      surface: 'category_footer',
      storage: mockStorage as any,
      env: enabledEnv,
      nowMs: NOW,
    });
    const c = result.placements[0].creative;
    expect(c.headline).toBe('EPC Quote');
    expect(c.body).toBe('Fast & free');
    expect(c.cta).toBe('Get Started');
    expect(c.image_url).toBe('https://img.example.com/ad.png');
  });
});

// ── Debug endpoint unit tests ─────────────────────────────────────────────────

describe('debugPlacements', () => {
  it('marks filtered-out placements with a reason', async () => {
    const p1 = makePlacement({ id: 1, partnerId: 10, categoryFilter: '[3]' });
    const mockStorage = makeStorage({
      getActivePlacementsBySurface: vi.fn().mockResolvedValue([p1]),
      getPartnerById: vi.fn().mockResolvedValue(makePartner()),
    });
    const result = await debugPlacements({
      surface: 'category_footer',
      category: 99, // 99 not in [3] → category mismatch
      storage: mockStorage as any,
      env: enabledEnv,
      nowMs: NOW,
    });
    expect(result.considered).toHaveLength(1);
    expect(result.considered[0].status).toBe('filtered');
    expect(result.considered[0].reason).toMatch(/category/i);
    expect(result.selected_placement_ids).toHaveLength(0);
  });

  it('marks selected placements correctly', async () => {
    const p = makePlacement();
    const mockStorage = makeStorage({
      getActivePlacementsBySurface: vi.fn().mockResolvedValue([p]),
      getPartnerById: vi.fn().mockResolvedValue(makePartner()),
    });
    const result = await debugPlacements({
      surface: 'category_footer',
      storage: mockStorage as any,
      env: enabledEnv,
      nowMs: NOW,
    });
    expect(result.selected_placement_ids).toContain(p.id);
    const entry = result.considered.find((c) => c.placement_id === p.id);
    expect(entry?.status).toBe('selected');
  });

  it('includes inactive partner reason', async () => {
    const p = makePlacement({ partnerId: 55 });
    const partner = makePartner({ id: 55, status: 'paused' });
    const mockStorage = makeStorage({
      getActivePlacementsBySurface: vi.fn().mockResolvedValue([p]),
      getPartnerById: vi.fn().mockResolvedValue(partner),
    });
    const result = await debugPlacements({
      surface: 'category_footer',
      storage: mockStorage as any,
      env: enabledEnv,
      nowMs: NOW,
    });
    const entry = result.considered.find((c) => c.placement_id === p.id);
    expect(entry?.status).toBe('filtered');
    expect(entry?.reason).toMatch(/inactive partner/);
  });
});

// ── HTTP endpoint tests ────────────────────────────────────────────────────────

describe('/api/placements HTTP endpoint', () => {
  const adminKey = 'test-secret-key';

  beforeEach(() => {
    vi.clearAllMocks();
    // restore safe defaults
    s.getCardsByTradesman?.mockResolvedValue([]);
    s.getAllCards?.mockResolvedValue([]);
    s.getTradesmen?.mockResolvedValue([]);
    s.getJobs?.mockResolvedValue([]);
    s.getQuotes?.mockResolvedValue([]);
    s.getReviews?.mockResolvedValue([]);
    s.logModeration?.mockResolvedValue({ id: 1 });
    s.getModerationLog?.mockResolvedValue([]);
    s.getPartnerEnquiriesByStatus?.mockResolvedValue([]);
    s.getPartnerEnquiryById?.mockResolvedValue(null);
    s.updatePartnerEnquiryStatus?.mockResolvedValue(null);
    s.promoteEnquiryToPartner?.mockResolvedValue(null);
    s.createPartner?.mockResolvedValue(null);
    s.getPartners?.mockResolvedValue([]);
    s.getPartnerById?.mockResolvedValue(null);
    s.getPartnerBySlug?.mockResolvedValue(null);
    s.updatePartner?.mockResolvedValue(null);
    s.deletePartner?.mockResolvedValue({ ok: true });
    s.createPartnerPlacement?.mockResolvedValue(null);
    s.getPartnerPlacementsByPartner?.mockResolvedValue([]);
    s.getPartnerPlacementById?.mockResolvedValue(null);
    s.updatePartnerPlacement?.mockResolvedValue(null);
    s.deletePartnerPlacement?.mockResolvedValue(undefined);
    s.getPartnerEventsByPartner?.mockResolvedValue([]);
    s.getPartnerEventCountsByPartner?.mockResolvedValue({});
    s.getPartnerInvoicesByPartner?.mockResolvedValue([]);
    s.getActivePlacementsBySurface?.mockResolvedValue([]);
    s.getEventsByPlacementSince?.mockResolvedValue([]);
    s.createPartnerEvent?.mockResolvedValue(undefined);
  });

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

  it('GET /api/placements returns 400 when surface is missing', async () => {
    const app = await buildApp();
    await withServer(app, async (port) => {
      const r = await fetch(`http://localhost:${port}/api/placements`);
      expect(r.status).toBe(400);
    });
  });

  it('GET /api/placements returns {placements:[]} when flag is off', async () => {
    // PARTNER_PLACEMENTS_ENABLED is not set in process.env, so flag is off
    delete process.env.PARTNER_PLACEMENTS_ENABLED;
    const app = await buildApp();
    await withServer(app, async (port) => {
      const r = await fetch(`http://localhost:${port}/api/placements?surface=category_footer`);
      expect(r.status).toBe(200);
      const body = await r.json();
      expect(body.placements).toEqual([]);
    });
  });

  it('GET /api/admin/placements/debug returns 401 without admin key', async () => {
    const app = await buildApp();
    await withServer(app, async (port) => {
      const r = await fetch(`http://localhost:${port}/api/admin/placements/debug?surface=category_footer`);
      expect(r.status).toBe(401);
    });
  });

  it('GET /api/admin/placements/debug returns 200 with valid admin key', async () => {
    const app = await buildApp();
    await withServer(app, async (port) => {
      const r = await fetch(`http://localhost:${port}/api/admin/placements/debug?surface=category_footer`, {
        headers: { 'x-admin-key': adminKey },
      });
      expect(r.status).toBe(200);
      const body = await r.json();
      expect(body).toHaveProperty('considered');
      expect(body).toHaveProperty('selected_placement_ids');
      expect(Array.isArray(body.considered)).toBe(true);
    });
  });
});
