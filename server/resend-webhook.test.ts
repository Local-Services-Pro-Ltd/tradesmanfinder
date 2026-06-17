// Unit tests for the Resend webhook handler.
//
// We stub:
//   - the svix Webhook class (so we don't need a real signed payload —
//     we just decide pass/fail in the verify mock)
//   - the db module (so no DB calls; we capture inserts/updates)
//
// The goal is to verify the *decision logic*:
//   - signature failure → 400
//   - missing svix headers → 400
//   - missing rawBody → 500
//   - missing secret → 500
//   - email.delivered → email_log update + audit row
//   - email.bounced → status + errorMessage + audit row
//   - opened arriving after clicked must NOT downgrade status
//   - duplicate svix-id (UNIQUE violation) → 200 ok (idempotent)
//   - no matching email_log row → audit row still written with no_matching_send
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Request, Response } from "express";

vi.mock("svix", () => {
  // The mock holds the next verification verdict + payload. Tests rewrite these.
  const state: { shouldVerify: boolean; payload: unknown; error: string } = {
    shouldVerify: true,
    payload: {},
    error: "bad signature",
  };
  class Webhook {
    constructor(_secret: string) { /* noop */ }
    verify(_body: string, _headers: Record<string, string | undefined>): unknown {
      if (!state.shouldVerify) throw new Error(state.error);
      return state.payload;
    }
  }
  return { Webhook, __state: state };
});

// db.select().from(emailLog).where(...).limit(1) → returns whatever
// `selectResult` is set to. db.insert(...).values(...) and db.update().set().where()
// just capture their args.
vi.mock("./storage", () => {
  const inserts: Array<{ table: string; values: unknown }> = [];
  const updates: Array<{ table: string; set: unknown; where: unknown }> = [];
  const state: { selectResult: unknown[]; insertThrows: Error | null } = {
    selectResult: [],
    insertThrows: null,
  };

  function makeQuery() {
    return {
      from: () => ({
        where: () => ({
          limit: () => Promise.resolve(state.selectResult),
        }),
      }),
    };
  }

  const db = {
    select: () => makeQuery(),
    insert: (table: { _ }) => ({
      values: async (vals: unknown) => {
        if (state.insertThrows) throw state.insertThrows;
        inserts.push({ table: String((table as { _?: { name?: string } })?._?.name ?? "unknown"), values: vals });
        return [];
      },
    }),
    update: (table: { _ }) => ({
      set: (vals: unknown) => ({
        where: async (predicate: unknown) => {
          updates.push({ table: String((table as { _?: { name?: string } })?._?.name ?? "unknown"), set: vals, where: predicate });
          return [];
        },
      }),
    }),
  };
  return { db, __inserts: inserts, __updates: updates, __state: state };
});

import { handleResendWebhook } from "./resend-webhook";
// Pull the mock state objects via dynamic import of the mocked modules.
import * as svixMock from "svix";
import * as storageMock from "./storage";

const svixState = (svixMock as unknown as { __state: { shouldVerify: boolean; payload: unknown; error: string } }).__state;
const dbInserts = (storageMock as unknown as { __inserts: Array<{ table: string; values: any }> }).__inserts;
const dbUpdates = (storageMock as unknown as { __updates: Array<{ table: string; set: any; where: any }> }).__updates;
const dbState = (storageMock as unknown as { __state: { selectResult: unknown[]; insertThrows: Error | null } }).__state;

function mockReq(opts: {
  headers?: Record<string, string>;
  rawBody?: Buffer | undefined;
} = {}): Request {
  const headers = {
    "svix-id": "msg_test123",
    "svix-timestamp": "1700000000",
    "svix-signature": "v1,abc",
    ...(opts.headers ?? {}),
  };
  const req = {
    headers,
    header: (name: string) => headers[name.toLowerCase()] ?? headers[name],
    rawBody: opts.rawBody === undefined ? Buffer.from("{}") : opts.rawBody,
  } as unknown as Request;
  return req;
}

function mockRes() {
  const res: Partial<Response> & { _status?: number; _send?: unknown } = {};
  res.status = vi.fn().mockImplementation((code: number) => {
    res._status = code;
    return res as Response;
  });
  res.send = vi.fn().mockImplementation((body: unknown) => {
    res._send = body;
    return res as Response;
  });
  return res as Response & { _status?: number; _send?: unknown };
}

beforeEach(() => {
  process.env.RESEND_WEBHOOK_SECRET = "whsec_test";
  svixState.shouldVerify = true;
  svixState.payload = {};
  svixState.error = "bad signature";
  dbInserts.length = 0;
  dbUpdates.length = 0;
  dbState.selectResult = [];
  dbState.insertThrows = null;
});

describe("resend-webhook — signature & shape", () => {
  it("returns 500 when RESEND_WEBHOOK_SECRET is unset", async () => {
    delete process.env.RESEND_WEBHOOK_SECRET;
    const req = mockReq();
    const res = mockRes();
    await handleResendWebhook(req, res);
    expect(res._status).toBe(500);
    expect(String(res._send)).toMatch(/RESEND_WEBHOOK_SECRET/);
  });

  it("returns 400 when svix headers are missing", async () => {
    const req = mockReq({ headers: { "svix-id": "" } });
    const res = mockRes();
    await handleResendWebhook(req, res);
    expect(res._status).toBe(400);
  });

  it("returns 500 when rawBody is missing", async () => {
    const req = mockReq({ rawBody: undefined as unknown as Buffer });
    // Have to manually delete because the mockReq default sets it
    (req as { rawBody?: Buffer }).rawBody = undefined;
    const res = mockRes();
    await handleResendWebhook(req, res);
    expect(res._status).toBe(500);
    expect(String(res._send)).toMatch(/rawBody/);
  });

  it("returns 400 on signature verification failure", async () => {
    svixState.shouldVerify = false;
    svixState.error = "no matching signature found";
    const req = mockReq();
    const res = mockRes();
    await handleResendWebhook(req, res);
    expect(res._status).toBe(400);
    expect(String(res._send)).toMatch(/Signature verification failed/);
  });
});

describe("resend-webhook — happy paths", () => {
  it("email.delivered updates email_log status + deliveredAt + writes audit row", async () => {
    svixState.payload = {
      type: "email.delivered",
      created_at: "2026-06-17T09:00:00.000Z",
      data: {
        email_id: "re_aaa",
        to: ["pro@example.com"],
        from: "steve@pros.tradesmanfinder.com",
        subject: "Founding Pro invite",
      },
    };
    dbState.selectResult = [{ id: 42, status: "sent", deliveredAt: null, resendId: "re_aaa" }];
    const res = mockRes();
    await handleResendWebhook(mockReq(), res);
    expect(res._status).toBe(200);
    // We wrote an audit row...
    expect(dbInserts.length).toBe(1);
    const insertRow = dbInserts[0].values;
    expect(insertRow.eventType).toBe("email.delivered");
    expect(insertRow.resendEmailId).toBe("re_aaa");
    expect(insertRow.emailLogId).toBe(42);
    expect(insertRow.action).toBe("log_updated");
    // ...and we updated the email_log row
    expect(dbUpdates.length).toBe(1);
    expect(dbUpdates[0].set.status).toBe("delivered");
    expect(typeof dbUpdates[0].set.deliveredAt).toBe("number");
  });

  it("email.bounced sets status=bounced + errorMessage from bounce.message", async () => {
    svixState.payload = {
      type: "email.bounced",
      created_at: "2026-06-17T09:00:00.000Z",
      data: {
        email_id: "re_bbb",
        to: ["bad@example.com"],
        bounce: { message: "Mailbox not found", type: "Permanent", subType: "General" },
      },
    };
    dbState.selectResult = [{ id: 7, status: "delivered", deliveredAt: 1700000000, resendId: "re_bbb" }];
    const res = mockRes();
    await handleResendWebhook(mockReq(), res);
    expect(res._status).toBe(200);
    expect(dbUpdates[0].set.status).toBe("bounced");
    expect(dbUpdates[0].set.errorMessage).toBe("Mailbox not found");
    const insertRow = dbInserts[0].values;
    expect(insertRow.bounceType).toBe("Permanent");
    expect(insertRow.bounceSubtype).toBe("General");
    expect(insertRow.bounceMessage).toBe("Mailbox not found");
  });

  it("email.clicked captures click.link in the audit row", async () => {
    svixState.payload = {
      type: "email.clicked",
      data: {
        email_id: "re_ccc",
        to: "pro@example.com",
        click: { link: "https://www.tradesmanfinder.com/founding-pro" },
      },
    };
    dbState.selectResult = [{ id: 11, status: "opened", deliveredAt: 1700000000, resendId: "re_ccc" }];
    const res = mockRes();
    await handleResendWebhook(mockReq(), res);
    expect(res._status).toBe(200);
    expect(dbInserts[0].values.clickLink).toBe("https://www.tradesmanfinder.com/founding-pro");
    expect(dbUpdates[0].set.status).toBe("clicked");
  });
});

describe("resend-webhook — ordering & idempotency", () => {
  it("does NOT downgrade status when delivered arrives after opened", async () => {
    svixState.payload = {
      type: "email.delivered",
      data: { email_id: "re_ddd", to: ["pro@example.com"] },
    };
    dbState.selectResult = [{ id: 5, status: "opened", deliveredAt: 1700000000, resendId: "re_ddd" }];
    const res = mockRes();
    await handleResendWebhook(mockReq(), res);
    expect(res._status).toBe(200);
    // Audit row written...
    expect(dbInserts.length).toBe(1);
    expect(dbInserts[0].values.action).toBe("log_updated");
    // ...but no update to email_log because opened (4) > delivered (3)
    expect(dbUpdates.length).toBe(0);
  });

  it("duplicate svix-id (UNIQUE violation) returns 200 ok (duplicate)", async () => {
    svixState.payload = {
      type: "email.delivered",
      data: { email_id: "re_eee", to: ["pro@example.com"] },
    };
    dbState.selectResult = [{ id: 9, status: "sent", deliveredAt: null, resendId: "re_eee" }];
    dbState.insertThrows = new Error('duplicate key value violates unique constraint "resend_webhook_log_svix_id_unique"');
    const res = mockRes();
    await handleResendWebhook(mockReq(), res);
    expect(res._status).toBe(200);
    expect(String(res._send)).toMatch(/duplicate/);
  });

  it("event for an unknown resend_id still writes an audit row with no_matching_send", async () => {
    svixState.payload = {
      type: "email.opened",
      data: { email_id: "re_unknown", to: ["pro@example.com"] },
    };
    dbState.selectResult = []; // no email_log row found
    const res = mockRes();
    await handleResendWebhook(mockReq(), res);
    expect(res._status).toBe(200);
    expect(dbUpdates.length).toBe(0);
    expect(dbInserts.length).toBe(1);
    expect(dbInserts[0].values.action).toBe("no_matching_send");
    expect(dbInserts[0].values.emailLogId).toBeNull();
  });

  it("unknown event type writes an audit row with action=noop and does not touch email_log", async () => {
    svixState.payload = {
      type: "contact.created",
      data: { id: "abc", audience_id: "aud-1", email: "x@y.com" },
    };
    const res = mockRes();
    await handleResendWebhook(mockReq(), res);
    expect(res._status).toBe(200);
    expect(dbUpdates.length).toBe(0);
    expect(dbInserts.length).toBe(1);
    expect(dbInserts[0].values.action).toBe("noop");
  });
});
