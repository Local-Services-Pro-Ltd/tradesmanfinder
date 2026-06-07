/**
 * Tests for the pure invoice-generator functions (PR-P7).
 *
 * No DB / mocking required — these functions take raw arrays and return
 * computed line items. Covers each commercial model, pro-rating, idempotency
 * (same inputs → same outputs), and a handful of edge cases.
 */
import { describe, it, expect } from "vitest";
import {
  computeInvoice,
  computeStats,
  activeDaysInPeriod,
  daysInPeriod,
  eventsInPeriod,
} from "./invoice-generator";
import type { Partner, PartnerPlacement, PartnerEvent } from "@shared/schema";

const MS_PER_DAY = 24 * 60 * 60 * 1000;

// Helpers — these match the schema shape but only set fields the generator cares about.
function makePartner(overrides: Partial<Partner> = {}): Partner {
  return {
    id: 1,
    slug: "test-partner",
    name: "Test Partner",
    vertical: "insurance",
    status: "active",
    billingEmail: null,
    billingContact: null,
    stripeCustomerId: null,
    notes: null,
    createdAt: 0,
    ...overrides,
  } as Partner;
}

function makePlacement(overrides: Partial<PartnerPlacement> = {}): PartnerPlacement {
  return {
    id: 100,
    partnerId: 1,
    surface: "category_footer",
    commercialModel: "sponsored",
    ratePence: 10000, // £100
    rateCapPence: null,
    categoryFilter: "[]",
    areaFilter: "[]",
    priority: 100,
    activeFrom: 0,
    activeTo: null,
    creativeHtml: null,
    creativeUrl: null,
    createdAt: 0,
    ...overrides,
  } as PartnerPlacement;
}

function makeEvent(overrides: Partial<PartnerEvent> = {}): PartnerEvent {
  return {
    id: 1,
    partnerId: 1,
    placementId: 100,
    eventType: "impression",
    jobId: null,
    tradesmanId: null,
    idempotencyKey: `evt-${Math.random()}`,
    occurredAt: 0,
    metadata: null,
    ...overrides,
  } as PartnerEvent;
}

// June 2026: [Jun 1 00:00 UTC, Jul 1 00:00 UTC) — exactly 30 days
const JUN_START = Date.UTC(2026, 5, 1);
const JUL_START = Date.UTC(2026, 6, 1);

describe("invoice-generator — primitives", () => {
  it("daysInPeriod returns 30 for June 2026", () => {
    expect(daysInPeriod(JUN_START, JUL_START)).toBeCloseTo(30, 5);
  });

  it("activeDaysInPeriod: fully active = full period", () => {
    const p = makePlacement({ activeFrom: 0, activeTo: null });
    expect(activeDaysInPeriod(p, JUN_START, JUL_START)).toBeCloseTo(30, 5);
  });

  it("activeDaysInPeriod: starts mid-period = partial days", () => {
    const p = makePlacement({ activeFrom: JUN_START + 15 * MS_PER_DAY, activeTo: null });
    expect(activeDaysInPeriod(p, JUN_START, JUL_START)).toBeCloseTo(15, 5);
  });

  it("activeDaysInPeriod: ends before period = 0", () => {
    const p = makePlacement({ activeFrom: 0, activeTo: JUN_START - 1 });
    expect(activeDaysInPeriod(p, JUN_START, JUL_START)).toBe(0);
  });

  it("activeDaysInPeriod: starts after period = 0", () => {
    const p = makePlacement({ activeFrom: JUL_START + 1, activeTo: null });
    expect(activeDaysInPeriod(p, JUN_START, JUL_START)).toBe(0);
  });

  it("eventsInPeriod: [start, end) — boundary at end is excluded", () => {
    const events = [
      makeEvent({ id: 1, occurredAt: JUN_START }),       // included
      makeEvent({ id: 2, occurredAt: JUL_START - 1 }),   // included
      makeEvent({ id: 3, occurredAt: JUL_START }),       // excluded (== end)
      makeEvent({ id: 4, occurredAt: JUN_START - 1 }),   // excluded (< start)
    ];
    const filtered = eventsInPeriod(events, JUN_START, JUL_START);
    expect(filtered.map((e) => e.id)).toEqual([1, 2]);
  });
});

describe("computeInvoice — sponsored model", () => {
  it("full-month flat rate (no pro-rating)", () => {
    const placement = makePlacement({ commercialModel: "sponsored", ratePence: 10000, activeFrom: 0 });
    const invoice = computeInvoice({
      partner: makePartner(),
      placements: [placement],
      events: [],
      periodStart: JUN_START,
      periodEnd: JUL_START,
    });
    expect(invoice.lineItems).toHaveLength(1);
    expect(invoice.lineItems[0].subtotalPence).toBe(10000);
    expect(invoice.lineItems[0].note).toMatch(/Flat monthly rate/);
    expect(invoice.totalPence).toBe(10000);
  });

  it("half-month pro-rating (active for 15 days of 30)", () => {
    const placement = makePlacement({
      commercialModel: "sponsored",
      ratePence: 10000,
      activeFrom: JUN_START + 15 * MS_PER_DAY,
    });
    const invoice = computeInvoice({
      partner: makePartner(),
      placements: [placement],
      events: [],
      periodStart: JUN_START,
      periodEnd: JUL_START,
    });
    expect(invoice.lineItems[0].subtotalPence).toBe(5000); // 15/30 of £100
    expect(invoice.lineItems[0].note).toMatch(/Pro-rated/);
  });

  it("placement that ended before period = no line item", () => {
    const placement = makePlacement({
      commercialModel: "sponsored",
      ratePence: 10000,
      activeFrom: 0,
      activeTo: JUN_START - 1,
    });
    const invoice = computeInvoice({
      partner: makePartner(),
      placements: [placement],
      events: [],
      periodStart: JUN_START,
      periodEnd: JUL_START,
    });
    expect(invoice.lineItems).toHaveLength(0);
    expect(invoice.totalPence).toBe(0);
  });
});

describe("computeInvoice — lead_qualified model", () => {
  it("counts only lead_passed events in period", () => {
    const placement = makePlacement({ commercialModel: "lead_qualified", ratePence: 500 }); // £5/lead
    const events = [
      makeEvent({ id: 1, eventType: "lead_passed", occurredAt: JUN_START + 1 }),
      makeEvent({ id: 2, eventType: "lead_passed", occurredAt: JUN_START + 2 }),
      makeEvent({ id: 3, eventType: "impression", occurredAt: JUN_START + 3 }),         // wrong type
      makeEvent({ id: 4, eventType: "lead_passed", occurredAt: JUL_START + 1 }),        // out of period
      makeEvent({ id: 5, eventType: "lead_passed", placementId: 999, occurredAt: JUN_START + 4 }), // wrong placement
    ];
    const invoice = computeInvoice({
      partner: makePartner(),
      placements: [placement],
      events,
      periodStart: JUN_START,
      periodEnd: JUL_START,
    });
    expect(invoice.lineItems[0].count).toBe(2);
    expect(invoice.lineItems[0].subtotalPence).toBe(1000); // 2 × £5
  });

  it("zero leads still emits a line item with a 'no leads' note", () => {
    const placement = makePlacement({ commercialModel: "lead_qualified", ratePence: 500 });
    const invoice = computeInvoice({
      partner: makePartner(),
      placements: [placement],
      events: [],
      periodStart: JUN_START,
      periodEnd: JUL_START,
    });
    expect(invoice.lineItems).toHaveLength(1);
    expect(invoice.lineItems[0].subtotalPence).toBe(0);
    expect(invoice.lineItems[0].note).toMatch(/No qualified leads/);
  });
});

describe("computeInvoice — lead_booked model", () => {
  it("counts only lead_outcome events with metadata.outcome === 'booked'", () => {
    const placement = makePlacement({ commercialModel: "lead_booked", ratePence: 2500 }); // £25/booking
    const events = [
      makeEvent({ id: 1, eventType: "lead_outcome", metadata: JSON.stringify({ outcome: "booked" }), occurredAt: JUN_START + 1 }),
      makeEvent({ id: 2, eventType: "lead_outcome", metadata: JSON.stringify({ outcome: "rejected" }), occurredAt: JUN_START + 2 }),
      makeEvent({ id: 3, eventType: "lead_outcome", metadata: JSON.stringify({ outcome: "booked" }), occurredAt: JUN_START + 3 }),
      makeEvent({ id: 4, eventType: "lead_passed", occurredAt: JUN_START + 4 }), // wrong type
      makeEvent({ id: 5, eventType: "lead_outcome", metadata: null, occurredAt: JUN_START + 5 }), // missing outcome
    ];
    const invoice = computeInvoice({
      partner: makePartner(),
      placements: [placement],
      events,
      periodStart: JUN_START,
      periodEnd: JUL_START,
    });
    expect(invoice.lineItems[0].count).toBe(2);
    expect(invoice.lineItems[0].subtotalPence).toBe(5000); // 2 × £25
  });

  it("tolerates malformed metadata JSON (returns 0 booked, doesn't throw)", () => {
    const placement = makePlacement({ commercialModel: "lead_booked", ratePence: 2500 });
    const events = [
      makeEvent({ id: 1, eventType: "lead_outcome", metadata: "{not-json", occurredAt: JUN_START + 1 }),
    ];
    expect(() => computeInvoice({
      partner: makePartner(), placements: [placement], events,
      periodStart: JUN_START, periodEnd: JUL_START,
    })).not.toThrow();
  });
});

describe("computeInvoice — rev_share + unknown models", () => {
  it("rev_share emits £0 line item with manual-review note", () => {
    const placement = makePlacement({ commercialModel: "rev_share", ratePence: 1000 });
    const invoice = computeInvoice({
      partner: makePartner(),
      placements: [placement],
      events: [],
      periodStart: JUN_START,
      periodEnd: JUL_START,
    });
    expect(invoice.lineItems[0].subtotalPence).toBe(0);
    expect(invoice.lineItems[0].note).toMatch(/finance team/i);
  });

  it("unknown commercial model fails closed with explanatory note", () => {
    const placement = makePlacement({ commercialModel: "moon_lottery", ratePence: 99999 });
    const invoice = computeInvoice({
      partner: makePartner(),
      placements: [placement],
      events: [],
      periodStart: JUN_START,
      periodEnd: JUL_START,
    });
    expect(invoice.lineItems[0].subtotalPence).toBe(0);
    expect(invoice.lineItems[0].note).toMatch(/Unknown commercial model/);
  });
});

describe("computeInvoice — multi-placement totals + idempotency", () => {
  it("sums subtotals across mixed-model placements", () => {
    const placements = [
      makePlacement({ id: 100, commercialModel: "sponsored",      ratePence: 10000 }),     // £100 flat
      makePlacement({ id: 101, commercialModel: "lead_qualified", ratePence: 500 }),       // £5 × leads
      makePlacement({ id: 102, commercialModel: "lead_booked",    ratePence: 2500 }),      // £25 × bookings
    ];
    const events = [
      makeEvent({ placementId: 101, eventType: "lead_passed", occurredAt: JUN_START + 1 }),
      makeEvent({ placementId: 101, eventType: "lead_passed", occurredAt: JUN_START + 2 }),
      makeEvent({ placementId: 101, eventType: "lead_passed", occurredAt: JUN_START + 3 }),
      makeEvent({ placementId: 102, eventType: "lead_outcome", metadata: JSON.stringify({ outcome: "booked" }), occurredAt: JUN_START + 4 }),
    ];
    const invoice = computeInvoice({
      partner: makePartner(), placements, events,
      periodStart: JUN_START, periodEnd: JUL_START,
    });
    // £100 (sponsored) + 3 × £5 (qualified) + 1 × £25 (booked) = £140
    expect(invoice.totalPence).toBe(10000 + 1500 + 2500);
    expect(invoice.lineItems).toHaveLength(3);
  });

  it("idempotent: same inputs → identical outputs", () => {
    const placements = [makePlacement({ commercialModel: "lead_qualified", ratePence: 500 })];
    const events = [
      makeEvent({ eventType: "lead_passed", occurredAt: JUN_START + 1 }),
      makeEvent({ eventType: "lead_passed", occurredAt: JUN_START + 2 }),
    ];
    const args = { partner: makePartner(), placements, events, periodStart: JUN_START, periodEnd: JUL_START };
    const a = computeInvoice(args);
    const b = computeInvoice(args);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });

  it("rejects invalid period (end <= start)", () => {
    expect(() => computeInvoice({
      partner: makePartner(), placements: [], events: [],
      periodStart: JUL_START, periodEnd: JUN_START,
    })).toThrow(/Invalid period/);
  });
});

describe("computeStats", () => {
  it("aggregates per-placement counts + totals across event types", () => {
    const placements = [
      makePlacement({ id: 100, commercialModel: "sponsored", ratePence: 10000 }),
      makePlacement({ id: 101, commercialModel: "lead_qualified", ratePence: 500 }),
    ];
    const events = [
      makeEvent({ placementId: 100, eventType: "impression", occurredAt: JUN_START + 1 }),
      makeEvent({ placementId: 100, eventType: "impression", occurredAt: JUN_START + 2 }),
      makeEvent({ placementId: 100, eventType: "click",      occurredAt: JUN_START + 3 }),
      makeEvent({ placementId: 101, eventType: "lead_passed", occurredAt: JUN_START + 4 }),
      makeEvent({ placementId: 101, eventType: "lead_outcome", metadata: JSON.stringify({ outcome: "booked" }), occurredAt: JUN_START + 5 }),
    ];
    const stats = computeStats({ placements, events, from: JUN_START, to: JUL_START });
    expect(stats.totals.impressions).toBe(2);
    expect(stats.totals.clicks).toBe(1);
    expect(stats.totals.leadsPassed).toBe(1);
    expect(stats.totals.leadsBooked).toBe(1);
    // sponsored full month (£100) + 1 qualified lead (£5) = £105
    expect(stats.totals.estimatedTotalPence).toBe(10000 + 500);
  });

  it("empty events → zeros for all counts", () => {
    const placements = [makePlacement({ commercialModel: "lead_qualified" })];
    const stats = computeStats({ placements, events: [], from: JUN_START, to: JUL_START });
    expect(stats.totals).toEqual({
      impressions: 0, clicks: 0, leadsPassed: 0, leadsBooked: 0, estimatedTotalPence: 0,
    });
  });
});
