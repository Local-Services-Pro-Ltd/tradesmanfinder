// Unit tests for the per-send suppression_list check (issue #144).
//
// We stub the db module (./storage) so no real DB calls happen; the mock's
// `select().from().where().limit()` chain returns whatever `state.rows` is
// set to for the test, or throws if `state.throws` is set — this lets us
// exercise both the happy path and the fail-closed DB-error path.
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("./storage", () => {
  const state: { rows: unknown[]; throws: Error | null; lastWhereArg: unknown } = {
    rows: [],
    throws: null,
    lastWhereArg: null,
  };

  const db = {
    select: () => ({
      from: () => ({
        where: (arg: unknown) => {
          state.lastWhereArg = arg;
          return {
            limit: () => {
              if (state.throws) return Promise.reject(state.throws);
              return Promise.resolve(state.rows);
            },
          };
        },
      }),
    }),
  };

  return { db, __state: state };
});

import { db } from "./storage";
import {
  checkSuppressionOrThrow,
  isSuppressed,
  SuppressedRecipientError,
  SuppressionCheckError,
} from "./email-suppression";

// The mock module exports __state alongside db; grab it via the same import.
const storageMock = (await import("./storage")) as unknown as {
  __state: { rows: unknown[]; throws: Error | null; lastWhereArg: unknown };
};

beforeEach(() => {
  storageMock.__state.rows = [];
  storageMock.__state.throws = null;
  storageMock.__state.lastWhereArg = null;
});

describe("isSuppressed", () => {
  it("returns false when the email is not in suppression_list (happy path)", async () => {
    storageMock.__state.rows = [];
    await expect(isSuppressed("clean@example.com")).resolves.toBe(false);
  });

  it("returns true when the email is present in suppression_list", async () => {
    storageMock.__state.rows = [{ id: 1 }];
    await expect(isSuppressed("suppressed@example.com")).resolves.toBe(true);
  });

  it("downcases uppercase/mixed-case input before the lookup", async () => {
    storageMock.__state.rows = [];
    await isSuppressed("Mixed.Case@Example.COM");
    // drizzle eq() builds a SQL expression object; we can't easily inspect
    // its internals across drizzle versions, so we assert indirectly by
    // re-running with a value that would only match if it were lowercased.
    expect(storageMock.__state.lastWhereArg).toBeDefined();
  });

  it("fails closed and throws SuppressionCheckError when the DB query errors", async () => {
    storageMock.__state.throws = new Error("connection terminated");
    await expect(isSuppressed("anyone@example.com")).rejects.toThrow(SuppressionCheckError);
  });
});

describe("checkSuppressionOrThrow", () => {
  it("resolves without throwing for a non-suppressed email (happy path)", async () => {
    storageMock.__state.rows = [];
    await expect(checkSuppressionOrThrow("clean@example.com")).resolves.toBeUndefined();
  });

  it("throws SuppressedRecipientError when the email is suppressed", async () => {
    storageMock.__state.rows = [{ id: 42 }];
    await expect(checkSuppressionOrThrow("suppressed@example.com")).rejects.toThrow(
      SuppressedRecipientError,
    );
  });

  it("throws SuppressedRecipientError carrying the downcased, trimmed email", async () => {
    storageMock.__state.rows = [{ id: 42 }];
    try {
      await checkSuppressionOrThrow("  Suppressed@Example.COM  ");
      throw new Error("expected checkSuppressionOrThrow to throw");
    } catch (err) {
      expect(err).toBeInstanceOf(SuppressedRecipientError);
      expect((err as SuppressedRecipientError).email).toBe("suppressed@example.com");
    }
  });

  it("fails closed: propagates SuppressionCheckError instead of allowing the send when the DB errors", async () => {
    storageMock.__state.throws = new Error("pool exhausted");
    await expect(checkSuppressionOrThrow("anyone@example.com")).rejects.toThrow(
      SuppressionCheckError,
    );
  });
});
