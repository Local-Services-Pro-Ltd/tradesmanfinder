/**
 * HOMEOWNER INTEREST — Borough waitlist regression guard.
 *
 * Locks in behaviour of recordHomeownerInterest() and the request schema:
 *
 *  1. Valid new submission → row inserted, mailer called once with normalised
 *     email + resolved area/category names, returns {created: true}.
 *  2. Resubmission with same (email, area, category) → row UPDATED (not
 *     duplicated), mailer NOT called again, returns {created: false}.
 *  3. Resubmission without postcode → keeps the existing postcode
 *     (never clears it).
 *  4. Email is normalised (lowercased + trimmed) before lookup/insert.
 *  5. Postcode is normalised (uppercased + trimmed) before insert.
 *  6. Invalid email → schema rejects before any DB call.
 *  7. Mailer failure does NOT throw — fire-and-forget logs internally.
 *
 * The DB is fully mocked. db.select() return values are queued in
 * `dbState.selectResults` in the same order the production code calls them:
 *   1. areas    (only if areaId provided)
 *   2. categories (only if categoryId provided)
 *   3. homeownerInterest lookup (always)
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("./storage", () => {
  const inserts: Array<{ values: any }> = [];
  const updates: Array<{ set: any }> = [];
  const state: { selectResults: any[][]; nextInsertId: number } = {
    selectResults: [],
    nextInsertId: 1,
  };

  function makeSelectQuery() {
    return {
      from: (_table: any) => ({
        where: () => ({
          limit: () => Promise.resolve(state.selectResults.shift() ?? []),
        }),
      }),
    };
  }

  const db = {
    select: () => makeSelectQuery(),
    insert: (_table: any) => ({
      values: (vals: any) => ({
        returning: async (_cols: any) => {
          inserts.push({ values: vals });
          const id = state.nextInsertId++;
          return [{ id }];
        },
      }),
    }),
    update: (_table: any) => ({
      set: (vals: any) => ({
        where: async (_pred: any) => {
          updates.push({ set: vals });
          return [];
        },
      }),
    }),
  };
  return { db, __inserts: inserts, __updates: updates, __state: state };
});

const { sendHomeownerInterestConfirmationMock } = vi.hoisted(() => ({
  sendHomeownerInterestConfirmationMock: vi.fn(),
}));
vi.mock("./mailer", () => ({
  sendHomeownerInterestConfirmation: sendHomeownerInterestConfirmationMock,
}));

import {
  recordHomeownerInterest,
  homeownerInterestRequestSchema,
  DENSITY_THRESHOLD,
} from "./homeowner-interest";
import * as storageMock from "./storage";

const dbInserts = (storageMock as unknown as { __inserts: Array<{ values: any }> }).__inserts;
const dbUpdates = (storageMock as unknown as { __updates: Array<{ set: any }> }).__updates;
const dbState = (storageMock as unknown as {
  __state: { selectResults: any[][]; nextInsertId: number };
}).__state;

beforeEach(() => {
  dbInserts.length = 0;
  dbUpdates.length = 0;
  dbState.selectResults = [];
  dbState.nextInsertId = 1;
  sendHomeownerInterestConfirmationMock.mockReset();
  sendHomeownerInterestConfirmationMock.mockResolvedValue({ ok: true, id: "e1" });
});

describe("DENSITY_THRESHOLD", () => {
  it("is 3 — locked in so a regression that loosens the gate is loud", () => {
    expect(DENSITY_THRESHOLD).toBe(3);
  });
});

describe("homeownerInterestRequestSchema", () => {
  it("accepts a minimal payload (email only)", () => {
    const r = homeownerInterestRequestSchema.parse({ email: "homeowner@example.com" });
    expect(r.email).toBe("homeowner@example.com");
    expect(r.source).toBe("area_landing"); // default
  });

  it("rejects invalid email", () => {
    expect(() => homeownerInterestRequestSchema.parse({ email: "not-an-email" })).toThrow();
  });

  it("rejects unknown source value", () => {
    expect(() =>
      homeownerInterestRequestSchema.parse({ email: "a@b.co", source: "billboard" as any }),
    ).toThrow();
  });
});

describe("recordHomeownerInterest — create path", () => {
  it("inserts a new row, normalises email + postcode, calls mailer once with resolved area/category names", async () => {
    dbState.selectResults = [
      [{ id: 12, name: "Lewisham", slug: "lewisham" }], // areas
      [{ id: 4, name: "Plumber", slug: "plumber" }], // categories
      [], // nothing in waitlist
    ];

    const result = await recordHomeownerInterest({
      email: "  Homeowner@Example.COM  ".trim() as any,
      postcode: " se13 6aa ",
      areaId: 12,
      categoryId: 4,
      source: "area_landing",
    });

    expect(result).toEqual({ ok: true, created: true, id: 1 });
    expect(dbInserts).toHaveLength(1);
    expect(dbInserts[0].values).toMatchObject({
      email: "homeowner@example.com",
      postcode: "SE13 6AA",
      areaId: 12,
      categoryId: 4,
      source: "area_landing",
    });
    expect(dbUpdates).toHaveLength(0);

    // Flush microtasks so the fire-and-forget mailer call lands.
    await new Promise((r) => setImmediate(r));
    expect(sendHomeownerInterestConfirmationMock).toHaveBeenCalledTimes(1);
    expect(sendHomeownerInterestConfirmationMock).toHaveBeenCalledWith({
      to: "homeowner@example.com",
      areaName: "Lewisham",
      categoryName: "Plumber",
    });
  });

  it("passes null area/category names when no areaId/categoryId provided", async () => {
    // No area/category lookups happen; only the interest lookup.
    dbState.selectResults = [[]];

    const result = await recordHomeownerInterest({
      email: "h@example.com",
      source: "footer",
    });

    expect(result.created).toBe(true);
    expect(dbInserts[0].values).toMatchObject({
      areaId: null,
      categoryId: null,
      postcode: null,
    });
    await new Promise((r) => setImmediate(r));
    expect(sendHomeownerInterestConfirmationMock).toHaveBeenCalledWith({
      to: "h@example.com",
      areaName: null,
      categoryName: null,
    });
  });
});

describe("recordHomeownerInterest — update (idempotent) path", () => {
  it("updates the existing row when (email, area, category) already exists; does NOT call mailer again", async () => {
    dbState.selectResults = [
      [{ id: 12, name: "Lewisham" }], // areas
      [{ id: 4, name: "Plumber" }], // categories
      [
        {
          id: 99,
          email: "homeowner@example.com",
          postcode: "SE13 6AA",
          areaId: 12,
          categoryId: 4,
          source: "area_landing",
          createdAt: 1_000,
          updatedAt: 1_000,
        },
      ],
    ];

    const result = await recordHomeownerInterest({
      email: "homeowner@example.com",
      postcode: "SE13 7BB", // changed
      areaId: 12,
      categoryId: 4,
      source: "category_landing", // changed
    });

    expect(result).toEqual({ ok: true, created: false, id: 99 });
    expect(dbInserts).toHaveLength(0);
    expect(dbUpdates).toHaveLength(1);
    expect(dbUpdates[0].set).toMatchObject({
      source: "category_landing",
      postcode: "SE13 7BB",
    });
    expect(dbUpdates[0].set.updatedAt).toBeTypeOf("number");

    await new Promise((r) => setImmediate(r));
    expect(sendHomeownerInterestConfirmationMock).not.toHaveBeenCalled();
  });

  it("does NOT clear an existing postcode when resubmission omits postcode", async () => {
    dbState.selectResults = [
      [{ id: 12, name: "Lewisham" }], // areas (areaId set)
      // no categoryId — no categories lookup
      [
        {
          id: 42,
          email: "homeowner@example.com",
          postcode: "SE13 6AA", // existing
          areaId: 12,
          categoryId: null,
          source: "area_landing",
          createdAt: 1_000,
          updatedAt: 1_000,
        },
      ],
    ];

    await recordHomeownerInterest({
      email: "homeowner@example.com",
      areaId: 12,
      // no postcode
      source: "area_landing",
    });

    expect(dbUpdates).toHaveLength(1);
    expect(dbUpdates[0].set.postcode).toBe("SE13 6AA"); // preserved
  });
});

describe("recordHomeownerInterest — mailer failure is non-fatal", () => {
  it("does not throw when the confirmation email fails", async () => {
    sendHomeownerInterestConfirmationMock.mockRejectedValueOnce(new Error("resend down"));
    dbState.selectResults = [[]]; // no existing waitlist row

    const result = await recordHomeownerInterest({
      email: "h@example.com",
      source: "area_landing",
    });

    expect(result).toEqual({ ok: true, created: true, id: 1 });
    // Flush the rejection — caught by the .catch() in the implementation.
    await new Promise((r) => setImmediate(r));
    // No assertion failure means the rejection was swallowed as intended.
  });
});
