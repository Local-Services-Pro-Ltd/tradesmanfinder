/**
 * PR-P6 — Click Tracking
 *
 * Provides:
 *  - `registerClickRoute(app)` — mounts `GET /p/c/:event_id?p=<placement_id>`
 *    which logs a click event and 302-redirects to the partner's target URL.
 *
 * Design notes:
 *  - Public, no auth required.
 *  - Duplicate clicks (same event_id + placement_id) are silently ignored via
 *    the NOT NULL UNIQUE constraint on partner_events.idempotency_key.
 *  - If the feature flag PARTNER_PLACEMENTS_ENABLED is off, we still redirect
 *    the user but we don't log a click event.
 *  - If the partner is paused or terminated, we still redirect (don't punish
 *    the user) but we don't log.
 *  - A valid UUID is required for logging; non-UUID event_ids redirect direct.
 */

import type { Express } from "express";
import { storage } from "./storage";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function isValidUuid(s: string): boolean {
  return UUID_RE.test(s);
}

function isFeatureEnabled(): boolean {
  const v = (process.env.PARTNER_PLACEMENTS_ENABLED ?? "").toLowerCase();
  return v === "true" || v === "1";
}

export function registerClickRoute(app: Express): void {
  // GET /p/c/:event_id?p=<placement_id>
  app.get("/p/c/:event_id", async (req, res) => {
    const eventId = req.params.event_id;
    const placementIdRaw = req.query.p ? Number(req.query.p) : NaN;

    // 1. Validate placement_id param
    if (!Number.isFinite(placementIdRaw)) {
      return res.status(404).type("text").send("Placement not found");
    }
    const placementId = placementIdRaw;

    // 2. Look up placement
    const placement = await storage.getPartnerPlacementById(placementId);
    if (!placement) {
      return res.status(404).type("text").send("Placement not found");
    }

    // 3. Require a non-empty target URL
    if (!placement.creativeUrl) {
      return res.status(404).type("text").send("Placement has no target URL");
    }

    const targetUrl = placement.creativeUrl;

    // 4. Determine whether to log a click event (all conditions must hold)
    const shouldLog = (() => {
      // Feature flag must be on
      if (!isFeatureEnabled()) return false;

      // UUID must be valid
      if (!isValidUuid(eventId)) return false;

      return true;
    })();

    if (shouldLog) {
      // 5. Look up partner — if inactive, redirect without logging
      const partner = await storage.getPartnerById(placement.partnerId);
      const partnerActive =
        partner && partner.status !== "paused" && partner.status !== "terminated";

      if (partnerActive) {
        // 6. Log click event (duplicate key = already counted → silent no-op)
        try {
          await storage.createPartnerEvent({
            placement_id: placementId,
            partner_id: placement.partnerId,
            event_type: "click",
            event_id: eventId,
            surface: placement.surface,
            amount_pence: 0,
            metadata: {
              referer: req.headers.referer ?? null,
            },
          });
        } catch (err: unknown) {
          // Unique constraint violation on idempotency_key means the click was
          // already counted (e.g. user double-clicked). Treat as no-op.
          console.warn("[click-tracking] duplicate or failed click event — skipping:", (err as Error)?.message);
        }
      }
    }

    // 7. 302 redirect to target URL
    return res.redirect(302, targetUrl);
  });
}
