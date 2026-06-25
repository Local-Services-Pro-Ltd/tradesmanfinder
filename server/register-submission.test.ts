/**
 * Smoke tests for the generic register submission factory.
 *
 * Calls the Express app via http.createServer so we don't need supertest.
 * Verifies:
 *   1. Each generic register kind gets a mounted POST route.
 *   2. The route returns 400 on bad format.
 *   3. The route returns 409 on dedupe hit.
 *   4. The route returns 201 + a pending row when valid.
 *   5. Postcode is normalised before persistence.
 */

import http from "http";
import { AddressInfo } from "net";
import express from "express";
import { describe, expect, it, vi, afterAll } from "vitest";

import { registerGenericRegisterRoutes } from "./register-submission";
import { GENERIC_REGISTER_KINDS } from "../shared/schema";

function makeStorage(opts: { existing?: any } = {}) {
  const created: any[] = [];
  let nextId = 1000;
  return {
    created,
    getGenericRegisterVerificationByTradesmanAndNumber: vi
      .fn()
      .mockResolvedValue(opts.existing),
    createGenericRegisterVerification: vi.fn().mockImplementation(async (input: any) => {
      const row = {
        id: nextId++,
        status: input.autoApprove ? "approved" : "pending",
        registrationNumber: input.registrationNumber,
        registerUrl: input.registerUrl,
        submittedAt: Date.now(),
        ...input,
      };
      created.push(row);
      return row;
    }),
  } as any;
}

const servers: http.Server[] = [];
afterAll(async () => {
  await Promise.all(
    servers.map(
      (s) => new Promise<void>((resolve) => s.close(() => resolve())),
    ),
  );
});

async function makeServer(storage: any) {
  const app = express();
  const requireAuth = (_req: any, _res: any, next: any) => next();
  const requireSelf = (_p: string) => (_req: any, _res: any, next: any) => next();
  const noopRateLimit = (_req: any, _res: any, next: any) => next();
  registerGenericRegisterRoutes(app, storage, {
    requireAuth,
    requireSelf,
    rateLimit: noopRateLimit,
  });
  const server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, resolve));
  servers.push(server);
  const port = (server.address() as AddressInfo).port;
  return { url: `http://127.0.0.1:${port}` };
}

async function post(url: string, path: string, body: unknown) {
  const res = await fetch(`${url}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  let json: any = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    /* leave as null */
  }
  return { status: res.status, body: json };
}

describe("registerGenericRegisterRoutes", () => {
  it("mounts a route for every generic register kind", async () => {
    const storage = makeStorage();
    const { url } = await makeServer(storage);
    for (const kind of GENERIC_REGISTER_KINDS) {
      const res = await post(url, `/api/tradesmen/42/verifications/${kind}`, {
        registrationNumber: "D123456",
        businessName: "Test Co Ltd",
        postcode: "SE10 8DH",
      });
      expect(res.status, `${kind} route is not mounted`).not.toBe(404);
    }
  });

  it("returns 400 on bad registration-number format", async () => {
    const storage = makeStorage();
    const { url } = await makeServer(storage);
    const res = await post(url, "/api/tradesmen/42/verifications/trustmark", {
      registrationNumber: "AB",
      businessName: "Test Co Ltd",
      postcode: "SE10 8DH",
    });
    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/TrustMark/i);
  });

  it("returns 409 when the dedupe pre-check finds an existing row", async () => {
    const storage = makeStorage({ existing: { id: 7, status: "pending" } });
    const { url } = await makeServer(storage);
    const res = await post(url, "/api/tradesmen/42/verifications/niceic", {
      registrationNumber: "D123456",
      businessName: "Test Co Ltd",
      postcode: "SE10 8DH",
    });
    expect(res.status).toBe(409);
    expect(res.body.existingId).toBe(7);
  });

  it("returns 201 and never auto-approves for a valid submission", async () => {
    const storage = makeStorage();
    const { url } = await makeServer(storage);
    const res = await post(url, "/api/tradesmen/42/verifications/niceic", {
      registrationNumber: "D123456",
      businessName: "Test Co Ltd",
      postcode: "SE10 8DH",
    });
    expect(res.status).toBe(201);
    expect(res.body.status).toBe("pending");
    expect(res.body.registrationNumber).toBe("D123456");
    expect(res.body.registerUrl).toContain("niceic.com");
    expect(storage.createGenericRegisterVerification).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: "niceic",
        autoApprove: false,
        source: "pro_submission",
      }),
    );
  });

  it("normalises the postcode before saving", async () => {
    const storage = makeStorage();
    const { url } = await makeServer(storage);
    await post(url, "/api/tradesmen/42/verifications/oftec", {
      registrationNumber: "C12345",
      businessName: "Test Co Ltd",
      postcode: "se108dh",
    });
    const call = storage.createGenericRegisterVerification.mock.calls[0][0];
    expect(call.evidenceData.postcode).toBe("SE10 8DH");
  });

  it("rejects invalid tradesman id", async () => {
    const storage = makeStorage();
    const { url } = await makeServer(storage);
    const res = await post(url, "/api/tradesmen/abc/verifications/niceic", {
      registrationNumber: "D123456",
      businessName: "Test Co Ltd",
      postcode: "SE10 8DH",
    });
    expect(res.status).toBe(400);
  });
});
