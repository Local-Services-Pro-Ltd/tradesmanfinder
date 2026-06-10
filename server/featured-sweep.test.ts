// Unit tests for the past-due sweep (PR-E3e). Storage is fully mocked so the
// test reasons about policy decisions, not Postgres.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { sweepPastDueFeatured, DEFAULT_PAST_DUE_GRACE_DAYS } from "./featured-sweep";
import type { IStorage } from "./storage";

function mkStorage() {
  return {
    getTradesmenWithSubscriptionStatus: vi.fn(),
    getMostRecentPaymentsLogAction: vi.fn(),
    updateTradesman: vi.fn(),
    createPaymentsLog: vi.fn().mockResolvedValue({ id: 1 }),
  } as unknown as IStorage & {
    getTradesmenWithSubscriptionStatus: ReturnType<typeof vi.fn>;
    getMostRecentPaymentsLogAction: ReturnType<typeof vi.fn>;
    updateTradesman: ReturnType<typeof vi.fn>;
    createPaymentsLog: ReturnType<typeof vi.fn>;
  };
}

const DAY = 24 * 60 * 60 * 1000;
const NOW = 1_800_000_000_000; // arbitrary fixed instant

describe("sweepPastDueFeatured", () => {
  let storage: ReturnType<typeof mkStorage>;
  beforeEach(() => {
    storage = mkStorage();
  });

  it("revokes featuredUntil when past_due exceeds grace period", async () => {
    storage.getTradesmenWithSubscriptionStatus.mockResolvedValue([
      {
        id: 42,
        stripeCustomerId: "cus_x",
        stripeSubscriptionId: "sub_x",
        featuredUntil: NOW + 5 * DAY,
        subscriptionStatus: "past_due",
      },
    ]);
    storage.getMostRecentPaymentsLogAction.mockResolvedValue({
      createdAt: NOW - 8 * DAY, // 8 days past_due, grace=7d → sweep
    });

    const result = await sweepPastDueFeatured({
      storage,
      now: () => NOW,
      graceDays: 7,
    });

    expect(result.swept).toBe(1);
    expect(result.swept_ids).toEqual([42]);
    expect(storage.updateTradesman).toHaveBeenCalledWith(42, { featuredUntil: null });
    expect(storage.createPaymentsLog).toHaveBeenCalledWith(
      expect.objectContaining({
        tradesmanId: 42,
        action: "featured_swept",
        eventType: "internal.cron.past_due_sweep",
        productKind: "featured_monthly",
        creditsDelta: 0,
      }),
    );
  });

  it("leaves alone tradesmen still within grace period", async () => {
    storage.getTradesmenWithSubscriptionStatus.mockResolvedValue([
      { id: 42, stripeCustomerId: "cus_x", featuredUntil: NOW + 5 * DAY },
    ]);
    storage.getMostRecentPaymentsLogAction.mockResolvedValue({
      createdAt: NOW - 3 * DAY, // 3 days past_due, grace=7d → leave
    });

    const result = await sweepPastDueFeatured({ storage, now: () => NOW, graceDays: 7 });

    expect(result.swept).toBe(0);
    expect(result.candidates).toBe(1);
    expect(storage.updateTradesman).not.toHaveBeenCalled();
    expect(storage.createPaymentsLog).not.toHaveBeenCalled();
  });

  it("skips tradesmen with no featured_degraded log row (unknown past_due start)", async () => {
    storage.getTradesmenWithSubscriptionStatus.mockResolvedValue([
      { id: 42, stripeCustomerId: "cus_x", featuredUntil: NOW + 5 * DAY },
    ]);
    storage.getMostRecentPaymentsLogAction.mockResolvedValue(undefined);

    const result = await sweepPastDueFeatured({ storage, now: () => NOW, graceDays: 7 });

    expect(result.swept).toBe(0);
    expect(storage.updateTradesman).not.toHaveBeenCalled();
  });

  it("synthesises a deterministic event_id so the unique index protects against double-runs", async () => {
    storage.getTradesmenWithSubscriptionStatus.mockResolvedValue([
      { id: 42, stripeCustomerId: "cus_x", featuredUntil: NOW + 5 * DAY },
    ]);
    storage.getMostRecentPaymentsLogAction.mockResolvedValue({
      createdAt: NOW - 10 * DAY,
    });

    await sweepPastDueFeatured({ storage, now: () => NOW, graceDays: 7 });

    const [entry] = storage.createPaymentsLog.mock.calls[0];
    expect(entry.eventId).toBe(`sweep_past_due:42:${NOW}`);
  });

  it("processes multiple candidates independently", async () => {
    storage.getTradesmenWithSubscriptionStatus.mockResolvedValue([
      { id: 1, stripeCustomerId: "cus_1", featuredUntil: NOW + 5 * DAY },
      { id: 2, stripeCustomerId: "cus_2", featuredUntil: NOW + 5 * DAY },
      { id: 3, stripeCustomerId: "cus_3", featuredUntil: NOW + 5 * DAY },
    ]);
    storage.getMostRecentPaymentsLogAction
      .mockResolvedValueOnce({ createdAt: NOW - 10 * DAY }) // sweep
      .mockResolvedValueOnce({ createdAt: NOW - 1 * DAY }) // within grace
      .mockResolvedValueOnce({ createdAt: NOW - 30 * DAY }); // sweep

    const result = await sweepPastDueFeatured({ storage, now: () => NOW, graceDays: 7 });

    expect(result.candidates).toBe(3);
    expect(result.swept).toBe(2);
    expect(result.swept_ids).toEqual([1, 3]);
  });

  it("defaults graceDays from env / fallback when not passed", async () => {
    storage.getTradesmenWithSubscriptionStatus.mockResolvedValue([]);
    const result = await sweepPastDueFeatured({ storage, now: () => NOW });
    expect(result.graceDays).toBe(DEFAULT_PAST_DUE_GRACE_DAYS);
  });

  it("honours PAST_DUE_GRACE_DAYS env override", async () => {
    const prev = process.env.PAST_DUE_GRACE_DAYS;
    process.env.PAST_DUE_GRACE_DAYS = "3";
    try {
      storage.getTradesmenWithSubscriptionStatus.mockResolvedValue([]);
      const result = await sweepPastDueFeatured({ storage, now: () => NOW });
      expect(result.graceDays).toBe(3);
    } finally {
      if (prev === undefined) delete process.env.PAST_DUE_GRACE_DAYS;
      else process.env.PAST_DUE_GRACE_DAYS = prev;
    }
  });

  it("ignores nonsense env values and falls back to default", async () => {
    const prev = process.env.PAST_DUE_GRACE_DAYS;
    process.env.PAST_DUE_GRACE_DAYS = "0"; // would sweep immediately on first failure — refuse
    try {
      storage.getTradesmenWithSubscriptionStatus.mockResolvedValue([]);
      const result = await sweepPastDueFeatured({ storage, now: () => NOW });
      expect(result.graceDays).toBe(DEFAULT_PAST_DUE_GRACE_DAYS);
    } finally {
      if (prev === undefined) delete process.env.PAST_DUE_GRACE_DAYS;
      else process.env.PAST_DUE_GRACE_DAYS = prev;
    }
  });
});
