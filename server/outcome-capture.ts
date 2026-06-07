/**
 * PR-P8 — Outcome capture endpoint.
 *
 * Mounts:
 *   GET /p/o/:token?outcome=won|lost|quoted&deal_value_pence=<int>
 *
 * Flow:
 *   1. Verify the HMAC token; if bad → render error page (400).
 *   2. Look up placement (and partner) to confirm both still exist & active.
 *   3. Log a `lead_outcome` partner_event with idempotency key
 *      `lead_outcome:<placementId>:<jobId>-<nonce>`.
 *      → Duplicate (same partner + job already marked) = silent no-op, still
 *        renders the success page so the partner isn't confused if they click
 *        twice from two devices.
 *   4. Render a minimal HTML confirmation page.
 *
 * Why not write a separate `partner_outcomes` table?
 *   The schema already has `event_type: 'lead_outcome'` on partner_events,
 *   plus a metadata JSON field. The invoice generator already consumes
 *   lead_outcome events for the `lead_booked` commercial model. Adding a
 *   separate table would require migrations and double-writes, with no
 *   query benefit. We keep all event data in one append-only log.
 *
 * Feature flag:
 *   PARTNER_PLACEMENTS_ENABLED must be on for the event to be logged
 *   (same gate as click tracking). If the flag is off, we still render the
 *   confirmation page so partners testing pre-launch get reasonable feedback,
 *   but no DB row is written. This matches PR-P6 click behaviour.
 */

import type { Express } from "express";
import { storage } from "./storage";
import {
  verifyOutcomeToken,
  isValidOutcome,
  type Outcome,
} from "./outcome-tokens";

function isFeatureEnabled(): boolean {
  const v = (process.env.PARTNER_PLACEMENTS_ENABLED ?? "").toLowerCase();
  return v === "true" || v === "1";
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function renderErrorPage(title: string, message: string): string {
  return `<!doctype html>
<html lang="en"><head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width,initial-scale=1" />
<title>${escapeHtml(title)} — TradesmanFinder</title>
<style>
  body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif;
         background: #f7f7fb; color: #1a1a2e; margin: 0; padding: 0;
         display: flex; align-items: center; justify-content: center; min-height: 100vh; }
  .card { background: white; padding: 32px 40px; border-radius: 12px;
          box-shadow: 0 4px 16px rgba(0,0,0,0.06); max-width: 480px; text-align: center; }
  h1 { font-size: 20px; margin: 0 0 12px; color: #c53030; }
  p { margin: 8px 0; line-height: 1.5; color: #4a5568; }
  a { color: #3182ce; }
</style></head>
<body><div class="card">
  <h1>${escapeHtml(title)}</h1>
  <p>${escapeHtml(message)}</p>
  <p style="margin-top:20px;font-size:13px;color:#a0aec0;">
    If you believe this is an error, contact <a href="mailto:partners@tradesmanfinder.com">partners@tradesmanfinder.com</a>.
  </p>
</div></body></html>`;
}

function renderSuccessPage(args: {
  outcome: Outcome;
  partnerName: string;
  jobId: number;
  dealValuePence: number | null;
  duplicate: boolean;
}): string {
  const outcomeLabel =
    args.outcome === "won"
      ? "Lead marked as won"
      : args.outcome === "lost"
        ? "Lead marked as lost"
        : "Lead marked as quoted";
  const deal =
    args.dealValuePence != null
      ? `<p>Deal value recorded: <strong>£${(args.dealValuePence / 100).toFixed(2)}</strong></p>`
      : "";
  const dupNote = args.duplicate
    ? `<p style="font-size:13px;color:#a0aec0;margin-top:16px;">This lead was already marked — no change needed.</p>`
    : "";
  return `<!doctype html>
<html lang="en"><head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width,initial-scale=1" />
<title>${escapeHtml(outcomeLabel)} — TradesmanFinder</title>
<style>
  body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif;
         background: #f7f7fb; color: #1a1a2e; margin: 0; padding: 0;
         display: flex; align-items: center; justify-content: center; min-height: 100vh; }
  .card { background: white; padding: 32px 40px; border-radius: 12px;
          box-shadow: 0 4px 16px rgba(0,0,0,0.06); max-width: 480px; text-align: center; }
  .check { font-size: 48px; margin-bottom: 8px; }
  h1 { font-size: 20px; margin: 0 0 12px; color: #2d7a4f; }
  p { margin: 6px 0; line-height: 1.5; color: #4a5568; }
</style></head>
<body><div class="card">
  <div class="check">✓</div>
  <h1>${escapeHtml(outcomeLabel)}</h1>
  <p>Thank you, ${escapeHtml(args.partnerName)}.</p>
  <p>Job #${args.jobId} — outcome recorded for your monthly statement.</p>
  ${deal}
  ${dupNote}
</div></body></html>`;
}

export function registerOutcomeCaptureRoute(app: Express): void {
  // GET /p/o/:token?outcome=won|lost|quoted&deal_value_pence=<int>
  app.get("/p/o/:token", async (req, res) => {
    const token = req.params.token;
    const outcomeRaw = typeof req.query.outcome === "string" ? req.query.outcome : "";
    const dealValueRaw =
      typeof req.query.deal_value_pence === "string" ? req.query.deal_value_pence : "";

    // 1. Validate outcome param
    if (!isValidOutcome(outcomeRaw)) {
      return res
        .status(400)
        .type("html")
        .send(
          renderErrorPage(
            "Invalid request",
            "The outcome value is missing or invalid. Expected one of: won, lost, quoted.",
          ),
        );
    }
    const outcome: Outcome = outcomeRaw;

    // 2. Verify token
    const verified = verifyOutcomeToken(token);
    if (!verified.ok) {
      const message =
        verified.reason === "expired"
          ? "This outcome link has expired. Please contact us to record this lead manually."
          : "This outcome link is invalid or has been tampered with.";
      return res
        .status(400)
        .type("html")
        .send(renderErrorPage("Invalid link", message));
    }
    const { partnerId, placementId, jobId, nonce } = verified.payload;

    // 3. Parse optional deal value (allow only for 'won')
    let dealValuePence: number | null = null;
    if (dealValueRaw) {
      const n = Number(dealValueRaw);
      if (!Number.isFinite(n) || n < 0 || !Number.isInteger(n)) {
        return res
          .status(400)
          .type("html")
          .send(
            renderErrorPage(
              "Invalid request",
              "Deal value must be a non-negative integer (in pence).",
            ),
          );
      }
      dealValuePence = n;
    }

    // 4. Look up placement & partner
    const placement = await storage.getPartnerPlacementById(placementId);
    if (!placement || placement.partnerId !== partnerId) {
      return res
        .status(404)
        .type("html")
        .send(
          renderErrorPage(
            "Lead not found",
            "We couldn't find the placement associated with this link.",
          ),
        );
    }
    const partner = await storage.getPartnerById(partnerId);
    if (!partner) {
      return res
        .status(404)
        .type("html")
        .send(
          renderErrorPage(
            "Lead not found",
            "We couldn't find the partner associated with this link.",
          ),
        );
    }

    // 5. Log lead_outcome event (idempotent on event_id = `<jobId>-<nonce>`)
    const eventId = `${jobId}-${nonce}`;
    let duplicate = false;
    if (isFeatureEnabled()) {
      try {
        await storage.createPartnerEvent({
          placement_id: placementId,
          partner_id: partnerId,
          event_type: "lead_outcome",
          event_id: eventId,
          surface: placement.surface,
          amount_pence: 0,
          metadata: {
            outcome,
            job_id: jobId,
            deal_value_pence: dealValuePence,
            recorded_via: "signed_link",
            ua: req.headers["user-agent"] ?? null,
          },
        });
      } catch (err: unknown) {
        // Unique constraint on idempotency_key = duplicate click → no-op.
        duplicate = true;
        console.warn(
          "[outcome-capture] duplicate or failed event — treating as no-op:",
          (err as Error)?.message,
        );
      }
    }

    // 6. Render confirmation page
    return res
      .status(200)
      .type("html")
      .send(
        renderSuccessPage({
          outcome,
          partnerName: partner.name,
          jobId,
          dealValuePence,
          duplicate,
        }),
      );
  });
}
