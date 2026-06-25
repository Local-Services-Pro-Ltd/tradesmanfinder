/**
 * Generic register submission helper (PR-F).
 *
 * One route factory drives all seven submit-for-admin-review register kinds
 * (NICEIC, NAPIT, MCS, OFTEC, TrustMark, F-Gas, CIPHE). Each register
 * registers its kind with the factory; the factory takes care of:
 *
 *   - zod validation (registrationNumber/businessName/postcode)
 *   - per-register format normalisation + validation (from REGISTER_CONFIGS)
 *   - dedupe pre-check via the shared storage method
 *   - DB insert via storage.createGenericRegisterVerification
 *   - admin-side deep-link generation (via buildRegisterUrl)
 *   - never-auto-approves (server CANNOT reach any of these registers from
 *     a Vercel datacenter IP without WAF or auth blocking)
 *
 * Why this exists:
 *   PR-E implemented Gas Safe as a one-off. Repeating that pattern seven
 *   times = ~1,400 LOC of near-duplicate route handlers and storage
 *   methods. This factory makes each new register a ~20-LOC binding.
 */

import type { Express, RequestHandler } from "express";
import express from "express";
import { z } from "zod";

import {
  REGISTER_CONFIGS,
  isGenericRegisterKind,
} from "../shared/register-configs";
import type { GenericRegisterKind } from "../shared/schema";
import type { IStorage } from "./storage";
import { rateLimit } from "./spam-guard";

interface RegisterMiddleware {
  requireAuth: RequestHandler;
  requireSelf: (paramName: string) => RequestHandler;
  /** Optional override for the rate limiter. Defaults to ./spam-guard's
   *  process-global IP bucket (10/min). Tests pass a no-op to avoid
   *  cross-test leakage. */
  rateLimit?: RequestHandler;
}

/**
 * Normalise a UK postcode to a single canonical form (uppercased, single
 * space before the 3-char inward code). Same logic as gas-safe.normalisePostcode
 * — re-declared here so this module is self-contained and the gas_safe
 * version can be deleted in a later cleanup PR. Cheap defense against
 * trivial typos like double spaces; the admin step catches anything else.
 */
export function normalisePostcode(raw: string): string {
  const compact = raw.trim().toUpperCase().replace(/\s+/g, "");
  if (compact.length < 5 || compact.length > 8) return compact;
  return `${compact.slice(0, -3)} ${compact.slice(-3)}`;
}

const submitRegisterSchema = z.object({
  registrationNumber: z.string().trim().min(1).max(40),
  businessName: z.string().trim().min(2).max(200),
  postcode: z.string().trim().min(5).max(10),
});

/**
 * Register all seven generic register POST routes on the given Express app.
 *
 * Route shape (identical across registers, only the URL slug differs):
 *
 *   POST /api/tradesmen/:id/verifications/:registerKind
 *   body: { registrationNumber, businessName, postcode }
 *   auth: requireAuth + requireSelf("id"), rate-limited (10/min)
 *   returns: 201 { id, status, registrationNumber, registerUrl, submittedAt }
 *           409 if (tradesmanId, kind, registrationNumber) already submitted
 *           400 on bad format
 *   status: always "pending" — admin must approve manually
 */
export function registerGenericRegisterRoutes(
  app: Express,
  storage: IStorage,
  middleware: RegisterMiddleware,
): void {
  const { requireAuth, requireSelf } = middleware;
  const limiter =
    middleware.rateLimit ?? rateLimit({ windowMs: 60 * 1000, max: 10 });
  const jsonParser = express.json({ limit: "4kb" });

  // Mount one route per kind. Each closes over its config but shares the
  // same handler body — the only differences are the URL and the
  // per-register normalisation / validation rules.
  for (const kind of Object.keys(REGISTER_CONFIGS) as GenericRegisterKind[]) {
    const config = REGISTER_CONFIGS[kind];
    app.post(
      `/api/tradesmen/:id/verifications/${config.kind}`,
      jsonParser,
      limiter,
      requireAuth,
      requireSelf("id"),
      async (req, res) => {
        const tradesmanId = Number(req.params.id);
        if (!Number.isFinite(tradesmanId)) {
          return res.status(400).json({ message: "Invalid tradesman id" });
        }

        const parsed = submitRegisterSchema.safeParse(req.body);
        if (!parsed.success) {
          return res.status(400).json({
            message: "Invalid submission",
            errors: parsed.error.flatten(),
          });
        }

        const number = config.normaliseNumber(parsed.data.registrationNumber);
        const formatErr = config.validateNumber(number);
        if (formatErr) {
          return res.status(400).json({ message: formatErr });
        }

        const businessName = parsed.data.businessName.trim().slice(0, 200);
        const postcode = normalisePostcode(parsed.data.postcode);

        // Dedupe pre-check — the unique partial index
        // uq_tv_tradesman_kind_registration_number is the hard guarantee;
        // this returns a clearer 409 when a row already exists.
        const existing =
          await storage.getGenericRegisterVerificationByTradesmanAndNumber(
            tradesmanId,
            kind,
            number,
          );
        if (existing) {
          return res.status(409).json({
            message:
              existing.status === "approved"
                ? `You're already verified for this ${config.label} number.`
                : `You already have a pending ${config.label} verification for this number.`,
            existingId: existing.id,
            status: existing.status,
          });
        }

        try {
          const row = await storage.createGenericRegisterVerification({
            tradesmanId,
            kind,
            registrationNumber: number,
            registerUrl: config.buildRegisterUrl(number),
            evidenceData: {
              // What the pro told us — NOT verified by us. Surfaced verbatim
              // to the admin reviewer, who confirms against the public register.
              registration_number: number,
              business_name: businessName,
              postcode,
              submitted_at: new Date().toISOString(),
              // Explicit marker for any downstream consumer of evidence_data.
              verification_method: "pro_self_submission_pending_admin_review",
            },
            source: "pro_submission",
            verifiedAt: null,
            // Cannot auto-approve — none of these registers are reachable
            // from a backend service. Admin must click through and confirm.
            autoApprove: false,
          });
          res.status(201).json({
            id: row.id,
            status: row.status,
            registrationNumber: row.registrationNumber,
            registerUrl: row.registerUrl,
            submittedAt: row.submittedAt,
          });
        } catch (e: any) {
          if (e?.code === "23505") {
            return res.status(409).json({
              message: `A verification for this ${config.label} number was just created.`,
            });
          }
          console.error(`[${kind}] insert failed:`, e);
          res.status(500).json({ message: "Could not save verification" });
        }
      },
    );
  }
}

/** Re-export for tests and callers that need to introspect the configured kinds. */
export { isGenericRegisterKind };
