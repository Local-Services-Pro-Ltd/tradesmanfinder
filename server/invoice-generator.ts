/**
 * PARTNER INVOICE GENERATOR (PR-P7)
 *
 * Pure functions for computing monthly partner invoices from raw events.
 * No DB access here — all I/O is done by the caller (routes.ts) which then
 * persists the result via storage.createPartnerInvoice().
 *
 * Pricing model (depends on placement.commercialModel):
 *   - sponsored       → flat monthly rate, PRO-RATED if placement was only
 *                       active for part of the billing period
 *   - lead_qualified  → ratePence × count(lead_passed events in period)
 *   - lead_booked     → ratePence × count(lead_outcome events with
 *                       metadata.outcome === 'booked' in period)
 *   - rev_share       → out of scope for v1; emits a zero-pence line item
 *                       with a note so the finance team handles it manually
 *
 * The v1 generator is intentionally manually-triggered (not cron) — partners
 * are still few enough that a human reviews each invoice before it's raised
 * on Stripe. When volume grows, wrap `computeInvoice` in a scheduled task.
 */

import type { Partner, PartnerPlacement, PartnerEvent } from "@shared/schema";

export type InvoiceLineItem = {
  placementId: number;
  surface: string;
  commercialModel: string;
  /** Per-unit rate at the time the invoice was generated, in pence. */
  ratePence: number;
  /** Units billed (days for sponsored, events for lead_*). */
  count: number;
  /** Subtotal in pence: count × rate (with pro-rating baked in for sponsored). */
  subtotalPence: number;
  /** Human-readable note for the finance team (e.g. "pro-rated 12/30 days"). */
  note?: string;
};

export type ComputedInvoice = {
  partnerId: number;
  periodStart: number;
  periodEnd: number;
  lineItems: InvoiceLineItem[];
  totalPence: number;
};

/**
 * Count how many days of a placement's active window fall inside the billing
 * period. Used to pro-rate `sponsored` placements that only ran for part
 * of the month (e.g. partner onboarded mid-month).
 *
 * Returns a float — the caller decides how to round to pence.
 */
export function activeDaysInPeriod(
  placement: Pick<PartnerPlacement, "activeFrom" | "activeTo">,
  periodStart: number,
  periodEnd: number,
): number {
  // Intersect [activeFrom, activeTo ?? +∞] with [periodStart, periodEnd]
  const placementEnd = placement.activeTo ?? Number.POSITIVE_INFINITY;
  const overlapStart = Math.max(placement.activeFrom, periodStart);
  const overlapEnd = Math.min(placementEnd, periodEnd);
  if (overlapEnd <= overlapStart) return 0;
  const MS_PER_DAY = 24 * 60 * 60 * 1000;
  return (overlapEnd - overlapStart) / MS_PER_DAY;
}

/**
 * Days in the billing period. Used as the denominator for pro-rating.
 * Periods are passed as [start, end) — exclusive end — so a 30-day month
 * is exactly 30 days.
 */
export function daysInPeriod(periodStart: number, periodEnd: number): number {
  const MS_PER_DAY = 24 * 60 * 60 * 1000;
  return (periodEnd - periodStart) / MS_PER_DAY;
}

/**
 * Filter an event list down to those that occurred within the billing period.
 * Note: `occurredAt` semantics are "instant of event" — we use a [start, end)
 * interval so an event exactly at the start of the next month doesn't double-bill.
 */
export function eventsInPeriod(
  events: PartnerEvent[],
  periodStart: number,
  periodEnd: number,
): PartnerEvent[] {
  return events.filter((e) => e.occurredAt >= periodStart && e.occurredAt < periodEnd);
}

/**
 * Parse the metadata blob (stored as JSON text) defensively. Returns {} on
 * any parse failure — partner_events rows from older code paths might have
 * null or malformed metadata, and the invoice math must not throw.
 */
function parseMetadata(raw: string | null | undefined): Record<string, unknown> {
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw);
    return (parsed && typeof parsed === "object" && !Array.isArray(parsed)) ? parsed as Record<string, unknown> : {};
  } catch {
    return {};
  }
}

/**
 * Compute a draft invoice from raw events + placement config.
 *
 * Idempotent: same inputs always produce the same output. The caller is
 * responsible for deciding whether to persist it (e.g. checking for an
 * existing invoice on the same period).
 *
 * @param partner       The partner row (used only for the partnerId on the result)
 * @param placements    All placements for this partner (active + inactive — we
 *                      pro-rate active days, and zero-out inactive ones)
 * @param events        All events for this partner over the period (or wider —
 *                      we filter down to the period internally)
 * @param periodStart   Inclusive start of billing period (unix ms)
 * @param periodEnd     Exclusive end of billing period (unix ms)
 */
export function computeInvoice({
  partner, placements, events, periodStart, periodEnd,
}: {
  partner: Pick<Partner, "id">;
  placements: PartnerPlacement[];
  events: PartnerEvent[];
  periodStart: number;
  periodEnd: number;
}): ComputedInvoice {
  if (periodEnd <= periodStart) {
    throw new Error(`Invalid period: periodEnd (${periodEnd}) must be > periodStart (${periodStart})`);
  }

  const periodDays = daysInPeriod(periodStart, periodEnd);
  const periodEvents = eventsInPeriod(events, periodStart, periodEnd);

  const lineItems: InvoiceLineItem[] = [];

  for (const placement of placements) {
    const activeDays = activeDaysInPeriod(placement, periodStart, periodEnd);
    if (activeDays <= 0) {
      // Placement wasn't active at all during this period — no line item.
      // We deliberately skip rather than emit a £0.00 line item, to keep
      // invoices visually clean for the finance team.
      continue;
    }

    if (placement.commercialModel === "sponsored") {
      // Pro-rate flat monthly rate by active days. Round to whole pence
      // (no fractional pence on invoices) using banker's-style floor to
      // avoid systematically over-billing.
      const fullRate = placement.ratePence;
      const proRated = (fullRate * activeDays) / periodDays;
      const subtotal = Math.floor(proRated);
      const isProRated = activeDays < periodDays;
      lineItems.push({
        placementId: placement.id,
        surface: placement.surface,
        commercialModel: placement.commercialModel,
        ratePence: placement.ratePence,
        count: Math.round(activeDays * 100) / 100, // 2dp for display
        subtotalPence: subtotal,
        note: isProRated
          ? `Pro-rated: ${activeDays.toFixed(2)} of ${periodDays.toFixed(0)} days active`
          : `Flat monthly rate (full ${periodDays.toFixed(0)} days)`,
      });
      continue;
    }

    if (placement.commercialModel === "lead_qualified") {
      const qualifiedEvents = periodEvents.filter(
        (e) => e.placementId === placement.id && e.eventType === "lead_passed",
      );
      const count = qualifiedEvents.length;
      lineItems.push({
        placementId: placement.id,
        surface: placement.surface,
        commercialModel: placement.commercialModel,
        ratePence: placement.ratePence,
        count,
        subtotalPence: count * placement.ratePence,
        note: count === 0 ? "No qualified leads in period" : undefined,
      });
      continue;
    }

    if (placement.commercialModel === "lead_booked") {
      const bookedEvents = periodEvents.filter((e) => {
        if (e.placementId !== placement.id) return false;
        if (e.eventType !== "lead_outcome") return false;
        const meta = parseMetadata(e.metadata);
        return meta.outcome === "booked";
      });
      const count = bookedEvents.length;
      lineItems.push({
        placementId: placement.id,
        surface: placement.surface,
        commercialModel: placement.commercialModel,
        ratePence: placement.ratePence,
        count,
        subtotalPence: count * placement.ratePence,
        note: count === 0 ? "No booked leads in period" : undefined,
      });
      continue;
    }

    if (placement.commercialModel === "rev_share") {
      // Rev-share isn't computed automatically in v1 — partners on this
      // model are billed via a custom calculation the finance team owns.
      // We still emit a £0 line item so it's visible on the draft invoice
      // and someone can replace it manually before sending.
      lineItems.push({
        placementId: placement.id,
        surface: placement.surface,
        commercialModel: placement.commercialModel,
        ratePence: placement.ratePence, // basis points, semantically
        count: 0,
        subtotalPence: 0,
        note: "Rev-share — finance team to compute manually (not auto-billed in v1)",
      });
      continue;
    }

    // Unknown commercial model — fail closed with a visible line item rather
    // than silently dropping. This prevents schema drift from quietly under-billing.
    lineItems.push({
      placementId: placement.id,
      surface: placement.surface,
      commercialModel: placement.commercialModel,
      ratePence: placement.ratePence,
      count: 0,
      subtotalPence: 0,
      note: `Unknown commercial model "${placement.commercialModel}" — review manually`,
    });
  }

  const totalPence = lineItems.reduce((sum, item) => sum + item.subtotalPence, 0);

  return {
    partnerId: partner.id,
    periodStart,
    periodEnd,
    lineItems,
    totalPence,
  };
}

/**
 * Compute a partner stats summary — the same shape used by the admin Stats
 * page. Unlike `computeInvoice`, this does NOT pro-rate or filter by active
 * days; it's a raw read of "how many of each event type happened, what
 * would they cost". The Stats page shows a forward-looking estimate so the
 * admin can decide when to generate a real invoice.
 */
export function computeStats({
  placements, events, from, to,
}: {
  placements: PartnerPlacement[];
  events: PartnerEvent[];
  from: number;
  to: number;
}): {
  byPlacement: Array<{
    placementId: number;
    surface: string;
    commercialModel: string;
    ratePence: number;
    counts: { impression: number; click: number; lead_passed: number; lead_booked: number };
    estimatedSubtotalPence: number;
  }>;
  totals: { impressions: number; clicks: number; leadsPassed: number; leadsBooked: number; estimatedTotalPence: number };
} {
  const periodEvents = eventsInPeriod(events, from, to);
  const byPlacement = placements.map((p) => {
    const pEvents = periodEvents.filter((e) => e.placementId === p.id);
    const impression = pEvents.filter((e) => e.eventType === "impression").length;
    const click = pEvents.filter((e) => e.eventType === "click").length;
    const lead_passed = pEvents.filter((e) => e.eventType === "lead_passed").length;
    const lead_booked = pEvents.filter((e) => {
      if (e.eventType !== "lead_outcome") return false;
      return parseMetadata(e.metadata).outcome === "booked";
    }).length;

    // Forward-looking estimate. Mirrors the same math as computeInvoice but
    // without pro-rating (since the stats page typically shows month-to-date).
    let estimatedSubtotalPence = 0;
    if (p.commercialModel === "sponsored") {
      // Pro-rate to days elapsed in the requested window.
      const activeDays = activeDaysInPeriod(p, from, to);
      const windowDays = daysInPeriod(from, to);
      if (windowDays > 0) {
        estimatedSubtotalPence = Math.floor((p.ratePence * activeDays) / windowDays);
      }
    } else if (p.commercialModel === "lead_qualified") {
      estimatedSubtotalPence = lead_passed * p.ratePence;
    } else if (p.commercialModel === "lead_booked") {
      estimatedSubtotalPence = lead_booked * p.ratePence;
    }
    // rev_share intentionally 0 in stats — same reasoning as computeInvoice.

    return {
      placementId: p.id,
      surface: p.surface,
      commercialModel: p.commercialModel,
      ratePence: p.ratePence,
      counts: { impression, click, lead_passed, lead_booked },
      estimatedSubtotalPence,
    };
  });

  const totals = byPlacement.reduce(
    (acc, p) => ({
      impressions: acc.impressions + p.counts.impression,
      clicks: acc.clicks + p.counts.click,
      leadsPassed: acc.leadsPassed + p.counts.lead_passed,
      leadsBooked: acc.leadsBooked + p.counts.lead_booked,
      estimatedTotalPence: acc.estimatedTotalPence + p.estimatedSubtotalPence,
    }),
    { impressions: 0, clicks: 0, leadsPassed: 0, leadsBooked: 0, estimatedTotalPence: 0 },
  );

  return { byPlacement, totals };
}
