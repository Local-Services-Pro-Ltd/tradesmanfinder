import { describe, expect, it } from "vitest";
import { getFeaturedState, formatFeaturedDate } from "./featured-state";

const NOW = new Date("2026-06-10T18:00:00.000Z").getTime();
const FUTURE = NOW + 7 * 24 * 60 * 60 * 1000; // +7d
const PAST = NOW - 7 * 24 * 60 * 60 * 1000;   // -7d

describe("getFeaturedState", () => {
  // ── "none" — the upsell surface ───────────────────────────────────────────
  it("returns 'none' when never subscribed", () => {
    expect(getFeaturedState(null, null, NOW)).toBe("none");
  });

  it("returns 'none' when featuredUntil is undefined", () => {
    expect(getFeaturedState(undefined, undefined, NOW)).toBe("none");
  });

  it("returns 'none' when featuredUntil has lapsed and no subscription survives", () => {
    expect(getFeaturedState(PAST, "canceled", NOW)).toBe("none");
    expect(getFeaturedState(PAST, "active", NOW)).toBe("none");
    expect(getFeaturedState(PAST, null, NOW)).toBe("none");
  });

  it("returns 'none' for unrecognised subscription statuses with no paid-through period", () => {
    expect(getFeaturedState(null, "weirdo", NOW)).toBe("none");
    expect(getFeaturedState(PAST, "incomplete", NOW)).toBe("none");
  });

  // ── "active" — happy path ─────────────────────────────────────────────────
  it("returns 'active' for paid-through period with status=active", () => {
    expect(getFeaturedState(FUTURE, "active", NOW)).toBe("active");
  });

  it("returns 'active' for paid-through period with status=trialing", () => {
    expect(getFeaturedState(FUTURE, "trialing", NOW)).toBe("active");
  });

  // ── "past_due" — Smart Retries in progress ────────────────────────────────
  it("returns 'past_due' regardless of featuredUntil", () => {
    expect(getFeaturedState(FUTURE, "past_due", NOW)).toBe("past_due");
    expect(getFeaturedState(PAST,   "past_due", NOW)).toBe("past_due");
    expect(getFeaturedState(null,   "past_due", NOW)).toBe("past_due");
  });

  // past_due must win even over the seemingly-active combination so the
  // user sees the "Update card" CTA instead of "Manage billing".
  it("prefers past_due over active when both could match", () => {
    // shouldn't happen in practice (active + past_due can't coexist) but
    // make the ordering explicit to lock the precedence in tests.
    expect(getFeaturedState(FUTURE, "past_due", NOW)).toBe("past_due");
  });

  // ── "lapsing" — cancelled but period not yet ended ────────────────────────
  it("returns 'lapsing' for canceled subscriptions still inside the paid period", () => {
    expect(getFeaturedState(FUTURE, "canceled", NOW)).toBe("lapsing");
  });

  it("returns 'lapsing' for unpaid subscriptions inside the paid period", () => {
    expect(getFeaturedState(FUTURE, "unpaid", NOW)).toBe("lapsing");
  });

  it("does NOT return 'lapsing' once featuredUntil has elapsed", () => {
    expect(getFeaturedState(PAST, "canceled", NOW)).toBe("none");
    expect(getFeaturedState(PAST, "unpaid",   NOW)).toBe("none");
  });

  // ── Edge: now is exactly featuredUntil ────────────────────────────────────
  it("treats featuredUntil === now as expired (strictly greater than)", () => {
    expect(getFeaturedState(NOW, "active", NOW)).toBe("none");
  });
});

describe("formatFeaturedDate", () => {
  it("formats UK-style short month dates", () => {
    // Picked a date with a single-digit day to confirm no leading zero.
    const ms = new Date("2026-07-07T12:00:00Z").getTime();
    // Output looks like "7 Jul 2026" in en-GB.
    expect(formatFeaturedDate(ms)).toMatch(/^7 Jul 2026$/);
  });

  it("handles two-digit days", () => {
    const ms = new Date("2026-12-25T12:00:00Z").getTime();
    expect(formatFeaturedDate(ms)).toMatch(/^25 Dec 2026$/);
  });
});
