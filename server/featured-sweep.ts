// ─────────────────────────────────────────────────────────────────────────────
// Past-due Featured Listing sweep (PR-E3e).
//
// PR-E3b's webhook flips subscriptionStatus to 'past_due' and writes a
// `featured_degraded` payments_log row when Stripe says a renewal failed. But
// we deliberately don't kill featuredUntil at that moment — Stripe runs a
// dunning sequence (Smart Retries) over ~3 weeks before giving up, and most
// failed cards recover within a day or two. Killing featured on first failure
// would punish honest customers for transient bank declines.
//
// Instead this sweep runs daily (Vercel Cron) and revokes featuredUntil for
// tradespeople who have been past_due longer than the grace period. Default
// is 7 days, configurable via PAST_DUE_GRACE_DAYS env var so we can tighten
// or loosen without redeploying logic.
//
// Detection rule:
//   - tradesman.subscriptionStatus = 'past_due'
//   - tradesman.featuredUntil > now (i.e. still being shown as featured)
//   - most recent payments_log row with action='featured_degraded' has
//     createdAt > graceMs ago
//
// We use the log timestamp (not a column on tradesmen) because the webhook
// already writes that row at the exact past_due transition. Adding a
// dedicated past_due_since column would duplicate state. The log row is also
// our audit trail for "why did we revoke" — exactly what an admin needs when
// a tradesperson complains.
//
// Action: clear featuredUntil, write a `featured_swept` log row so the
// sweep itself is auditable (and so we don't re-process the same record on
// the next run — the query filter `featuredUntil > now` excludes it).
// ─────────────────────────────────────────────────────────────────────────────
import type { IStorage } from "./storage";

export const DEFAULT_PAST_DUE_GRACE_DAYS = 7;

function graceDaysFromEnv(): number {
  const raw = process.env.PAST_DUE_GRACE_DAYS;
  if (!raw) return DEFAULT_PAST_DUE_GRACE_DAYS;
  const n = Number(raw);
  // Refuse nonsense values rather than silently using 0 (which would revoke
  // immediately on first failure — exactly the behaviour we're avoiding).
  if (!Number.isFinite(n) || n < 1 || n > 90) return DEFAULT_PAST_DUE_GRACE_DAYS;
  return Math.floor(n);
}

export interface SweepResult {
  candidates: number;
  swept: number;
  graceDays: number;
  nowMs: number;
  swept_ids: number[];
}

export interface SweepDeps {
  storage: IStorage;
  now?: () => number;
  graceDays?: number;
}

export async function sweepPastDueFeatured(deps: SweepDeps): Promise<SweepResult> {
  const now = deps.now ? deps.now() : Date.now();
  const graceDays = deps.graceDays ?? graceDaysFromEnv();
  const graceMs = graceDays * 24 * 60 * 60 * 1000;

  const candidates = await deps.storage.getTradesmenWithSubscriptionStatus("past_due", now);

  const sweptIds: number[] = [];
  for (const t of candidates) {
    const transition = await deps.storage.getMostRecentPaymentsLogAction(
      t.id,
      "featured_degraded",
    );
    if (!transition) {
      // No log row means we don't actually know when past_due started.
      // Safer to skip than to revoke based on assumed timing.
      continue;
    }
    if (now - transition.createdAt < graceMs) continue;

    await deps.storage.updateTradesman(t.id, {
      featuredUntil: null,
    } as Parameters<typeof deps.storage.updateTradesman>[1]);
    // Synthetic event id so the unique index on payments_log.event_id still
    // protects us against double-runs in the same millisecond. Including
    // tradesman id + now keeps it deterministic per-record per-tick.
    await deps.storage.createPaymentsLog({
      eventId: `sweep_past_due:${t.id}:${now}`,
      eventType: "internal.cron.past_due_sweep",
      amountPence: null,
      currency: null,
      stripeCustomerId: t.stripeCustomerId ?? null,
      stripeSubscriptionId: t.stripeSubscriptionId ?? null,
      stripeCheckoutSessionId: null,
      stripePaymentIntentId: null,
      stripeInvoiceId: null,
      stripeChargeId: null,
      tradesmanId: t.id,
      productKind: "featured_monthly",
      action: "featured_swept",
      creditsDelta: 0,
      notes: `Past-due since ${new Date(transition.createdAt).toISOString()}; grace=${graceDays}d; featuredUntil cleared.`,
      rawPayload: null,
    });
    sweptIds.push(t.id);
  }

  return {
    candidates: candidates.length,
    swept: sweptIds.length,
    graceDays,
    nowMs: now,
    swept_ids: sweptIds,
  };
}
