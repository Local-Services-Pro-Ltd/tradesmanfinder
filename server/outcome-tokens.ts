/**
 * PR-P8 — Outcome capture: signed-token utilities.
 *
 * Partners receive emails like:
 *   "Did this lead convert?
 *      [Mark as won]   https://tradesmanfinder.com/p/o/<token>?outcome=won
 *      [Mark as lost]  https://tradesmanfinder.com/p/o/<token>?outcome=lost
 *      [Quoted]        https://tradesmanfinder.com/p/o/<token>?outcome=quoted"
 *
 * The token is a base64url-encoded payload + HMAC-SHA256 signature, so the
 * outcome endpoint can verify (a) the partner/placement/job tuple was issued
 * by us, and (b) the link has not expired. No DB lookup required to validate.
 *
 * Payload shape (compact JSON):
 *   { p:<partnerId>, l:<placementId>, j:<jobId>, e:<expiresAtMs>, n:<nonceHex> }
 *
 * Format on the wire: `<payloadB64Url>.<sigB64Url>`
 *
 * The `nonceHex` is 8 random bytes (16 hex chars). It serves two purposes:
 *   1. Makes the token uniquely identifiable so we can use it as the
 *      partner_events idempotency key (`outcome:<partnerId>:<jobId>:<nonce>`).
 *   2. Prevents identical links being predictable if the same triple were
 *      ever signed twice.
 *
 * Secret precedence: PARTNER_OUTCOME_SECRET → ADMIN_KEY. ADMIN_KEY is always
 * set in prod (asserted at boot), so we always have a viable signing key.
 */

import { createHmac, randomBytes } from "node:crypto";

export interface OutcomeTokenPayload {
  partnerId: number;
  placementId: number;
  jobId: number;
  expiresAtMs: number;
  nonce: string; // 16 hex chars
}

/** Compact wire form of the payload — short JSON keys to keep URLs short. */
interface WirePayload {
  p: number;
  l: number;
  j: number;
  e: number;
  n: string;
}

function getSecret(): string {
  const s = process.env.PARTNER_OUTCOME_SECRET || process.env.ADMIN_KEY;
  if (!s) {
    throw new Error(
      "Cannot sign outcome tokens: neither PARTNER_OUTCOME_SECRET nor ADMIN_KEY is set",
    );
  }
  return s;
}

/** Base64url (no padding) encode/decode helpers — Buffer.toString('base64url') in Node 16+. */
function b64uEncode(buf: Buffer): string {
  return buf.toString("base64url");
}
function b64uDecode(s: string): Buffer {
  return Buffer.from(s, "base64url");
}

function hmac(message: string): string {
  return b64uEncode(createHmac("sha256", getSecret()).update(message).digest());
}

/** Constant-time string comparison to avoid timing attacks on the HMAC check. */
function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}

/**
 * Sign a new outcome token. Defaults to a 90-day expiry — finance flows are
 * monthly and partners sometimes mark outcomes late, so leave generous slack.
 *
 * The optional `now` and `nonce` params exist for deterministic testing.
 */
export function signOutcomeToken(
  args: {
    partnerId: number;
    placementId: number;
    jobId: number;
    ttlMs?: number;
  },
  opts?: { now?: number; nonce?: string },
): string {
  const ttlMs = args.ttlMs ?? 90 * 24 * 60 * 60 * 1000;
  const now = opts?.now ?? Date.now();
  const nonce = opts?.nonce ?? randomBytes(8).toString("hex");

  const payload: WirePayload = {
    p: args.partnerId,
    l: args.placementId,
    j: args.jobId,
    e: now + ttlMs,
    n: nonce,
  };
  const payloadB64 = b64uEncode(Buffer.from(JSON.stringify(payload)));
  const sig = hmac(payloadB64);
  return `${payloadB64}.${sig}`;
}

export type VerifyOutcomeTokenResult =
  | { ok: true; payload: OutcomeTokenPayload }
  | { ok: false; reason: "malformed" | "bad_signature" | "expired" };

/**
 * Verify a token. Returns the decoded payload on success, or a structured
 * error reason on failure. Never throws on bad input.
 */
export function verifyOutcomeToken(
  token: string,
  opts?: { now?: number },
): VerifyOutcomeTokenResult {
  if (typeof token !== "string" || !token.includes(".")) {
    return { ok: false, reason: "malformed" };
  }
  const dot = token.indexOf(".");
  const payloadB64 = token.slice(0, dot);
  const sig = token.slice(dot + 1);
  if (!payloadB64 || !sig) {
    return { ok: false, reason: "malformed" };
  }

  // Verify signature first (constant-time) before parsing payload — keeps
  // the malformed-vs-bad-signature distinction tight.
  const expected = hmac(payloadB64);
  if (!timingSafeEqual(sig, expected)) {
    return { ok: false, reason: "bad_signature" };
  }

  let raw: unknown;
  try {
    raw = JSON.parse(b64uDecode(payloadB64).toString("utf8"));
  } catch {
    return { ok: false, reason: "malformed" };
  }

  if (
    !raw ||
    typeof raw !== "object" ||
    typeof (raw as WirePayload).p !== "number" ||
    typeof (raw as WirePayload).l !== "number" ||
    typeof (raw as WirePayload).j !== "number" ||
    typeof (raw as WirePayload).e !== "number" ||
    typeof (raw as WirePayload).n !== "string"
  ) {
    return { ok: false, reason: "malformed" };
  }

  const wire = raw as WirePayload;
  const now = opts?.now ?? Date.now();
  if (wire.e < now) {
    return { ok: false, reason: "expired" };
  }

  return {
    ok: true,
    payload: {
      partnerId: wire.p,
      placementId: wire.l,
      jobId: wire.j,
      expiresAtMs: wire.e,
      nonce: wire.n,
    },
  };
}

/** Build the full public URL for a signed outcome token. */
export function buildOutcomeLink(
  token: string,
  outcome: "won" | "lost" | "quoted",
  baseUrl?: string,
): string {
  const base =
    baseUrl ||
    process.env.APP_BASE_URL ||
    (process.env.NODE_ENV === "production"
      ? "https://tradesmanfinder.com"
      : "http://localhost:5173");
  return `${base}/p/o/${token}?outcome=${outcome}`;
}

/** Valid outcome values accepted by the capture endpoint. */
export const OUTCOME_VALUES = ["won", "lost", "quoted"] as const;
export type Outcome = (typeof OUTCOME_VALUES)[number];

export function isValidOutcome(v: string | undefined): v is Outcome {
  return typeof v === "string" && (OUTCOME_VALUES as readonly string[]).includes(v);
}
