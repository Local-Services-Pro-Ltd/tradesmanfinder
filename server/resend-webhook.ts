// ─────────────────────────────────────────────────────────────────────────────
// Resend webhook handler.
//
// Resend POSTs events here for every email we send via the API. We:
//   1) Verify the request using Svix (Resend's webhook signing scheme).
//      Requires the raw request body — `req.rawBody` is attached by the
//      express.json verify hook in server/index.ts.
//   2) Dedupe by svix-id against resend_webhook_log.svix_id (UNIQUE).
//   3) For email.* events with a data.email_id, look up the email_log row
//      where resend_id matches, then:
//        - email.delivered      → status='delivered', deliveredAt=now
//        - email.opened         → status='opened' (only if not already past delivered)
//        - email.clicked        → status='clicked'
//        - email.bounced        → status='bounced', errorMessage=bounce.message
//        - email.complained     → status='complained'
//        - email.delivery_delayed → status='delayed'
//        - email.failed         → status='failed'
//   4) Write a resend_webhook_log row regardless of whether we found a
//      matching email_log row — gives us a full audit trail.
//   5) Always 200 on signature-valid events (even noops) so Resend doesn't
//      retry indefinitely. 400 only for signature failures, 500 for unexpected
//      exceptions.
//
// Suppression list integration (bounce/complained → outreach/queues/suppression_list.jsonl)
// is intentionally out of scope here: the outreach scripts run on Steve's box,
// not on Vercel, so they consult resend_webhook_log directly. See
// outreach/README_pipeline.md for the wiring.
// ─────────────────────────────────────────────────────────────────────────────
import type { Request, Response } from "express";
import { Webhook } from "svix";
import { eq } from "drizzle-orm";
import { db } from "./storage";
import { emailLog, resendWebhookLog } from "@shared/schema";

// Status precedence — once an email is past a given status, we don't downgrade.
// E.g. an `email.delivered` arriving *after* an `email.opened` (out-of-order
// delivery is rare but happens) must not roll status back to 'delivered'.
const STATUS_RANK: Record<string, number> = {
  sent: 1,
  failed: 1,        // terminal failure, same rank as sent
  delayed: 2,
  delivered: 3,
  opened: 4,
  clicked: 5,
  bounced: 6,       // terminal — bounce trumps everything except complaint
  complained: 7,    // most damaging — never overwrite
};

function statusFromEventType(t: string): string | null {
  switch (t) {
    case "email.sent": return "sent";
    case "email.delivered": return "delivered";
    case "email.delivery_delayed": return "delayed";
    case "email.opened": return "opened";
    case "email.clicked": return "clicked";
    case "email.bounced": return "bounced";
    case "email.complained": return "complained";
    case "email.failed": return "failed";
    default: return null; // contact.* / domain.* / unknown
  }
}

interface ResendEvent {
  type?: string;
  created_at?: string;
  data?: {
    email_id?: string;
    to?: string[] | string;
    from?: string;
    subject?: string;
    bounce?: { message?: string; subType?: string; type?: string };
    click?: { link?: string; ipAddress?: string; userAgent?: string; timestamp?: string };
    failed?: { reason?: string };
  };
}

/**
 * Returns a parsed event if signature verification succeeds, or null on any
 * failure. The Webhook secret comes from RESEND_WEBHOOK_SECRET; if unset
 * the handler treats every request as unverified (rejects with 500).
 */
function verifyAndParse(req: Request): { ok: true; event: ResendEvent; svixId: string } | { ok: false; status: number; reason: string } {
  const secret = process.env.RESEND_WEBHOOK_SECRET;
  if (!secret) {
    // Misconfiguration — don't accept events without a secret to verify them.
    return { ok: false, status: 500, reason: "RESEND_WEBHOOK_SECRET not set" };
  }
  const svixId = req.header("svix-id");
  const svixTimestamp = req.header("svix-timestamp");
  const svixSignature = req.header("svix-signature");
  if (!svixId || !svixTimestamp || !svixSignature) {
    return { ok: false, status: 400, reason: "Missing svix-* headers" };
  }
  const rawBody = (req as Request & { rawBody?: Buffer }).rawBody;
  if (!rawBody) {
    // express.json's verify hook in server/index.ts should always populate
    // this. If it's missing the route was mounted wrong (e.g. behind
    // middleware that re-parsed the body).
    return { ok: false, status: 500, reason: "rawBody missing — verify hook misconfigured" };
  }
  try {
    const wh = new Webhook(secret);
    const verified = wh.verify(rawBody.toString("utf8"), {
      "svix-id": svixId,
      "svix-timestamp": svixTimestamp,
      "svix-signature": svixSignature,
    }) as ResendEvent;
    return { ok: true, event: verified, svixId };
  } catch (err: any) {
    return { ok: false, status: 400, reason: `Signature verification failed: ${err?.message ?? "unknown"}` };
  }
}

/**
 * Extract the recipient address from a Resend event payload. `to` may be a
 * string or array depending on event type / how the email was sent.
 */
function firstRecipient(to: string[] | string | undefined): string | null {
  if (!to) return null;
  if (typeof to === "string") return to;
  return to[0] ?? null;
}

/**
 * Resolve and update the email_log row for this event, if we have a matching
 * resend_id. Returns the id of the email_log row we touched, or null if no
 * match. Never throws — failures here must not 4xx the webhook.
 */
async function updateEmailLogForEvent(event: ResendEvent): Promise<{ emailLogId: number | null; action: string }> {
  const resendId = event.data?.email_id;
  if (!resendId) return { emailLogId: null, action: "noop" };
  const newStatus = statusFromEventType(event.type ?? "");
  if (!newStatus) return { emailLogId: null, action: "noop" };

  // Look up the existing send row. resend_id is indexed (see migration).
  const rows = await db.select().from(emailLog).where(eq(emailLog.resendId, resendId)).limit(1);
  if (rows.length === 0) {
    return { emailLogId: null, action: "no_matching_send" };
  }
  const existing = rows[0];
  const currentRank = STATUS_RANK[existing.status] ?? 0;
  const newRank = STATUS_RANK[newStatus] ?? 0;
  if (newRank < currentRank) {
    // Don't downgrade. E.g. delivered arriving after opened.
    return { emailLogId: existing.id, action: "log_updated" };
  }

  const update: Partial<typeof emailLog.$inferInsert> = { status: newStatus };
  if (newStatus === "delivered" && !existing.deliveredAt) {
    update.deliveredAt = Date.now();
  }
  if (newStatus === "bounced") {
    update.errorMessage = event.data?.bounce?.message
      ?? `Bounce ${event.data?.bounce?.type ?? "unknown"}/${event.data?.bounce?.subType ?? "unknown"}`;
  }
  if (newStatus === "failed") {
    update.errorMessage = event.data?.failed?.reason ?? "failed (no reason supplied)";
  }
  await db.update(emailLog).set(update).where(eq(emailLog.id, existing.id));
  return { emailLogId: existing.id, action: "log_updated" };
}

/**
 * Express handler for POST /api/resend/webhook.
 */
export async function handleResendWebhook(req: Request, res: Response): Promise<void> {
  const verified = verifyAndParse(req);
  if (!verified.ok) {
    res.status(verified.status).send(verified.reason);
    return;
  }
  const { event, svixId } = verified;

  try {
    // Step 1: try to apply the event to the email_log row.
    const { emailLogId, action } = await updateEmailLogForEvent(event);

    // Step 2: write the audit row. UNIQUE(svix_id) is what makes this
    // idempotent — duplicate deliveries from Resend's retry logic are no-ops.
    const recipient = firstRecipient(event.data?.to);
    const resendCreatedAt = event.created_at ? Date.parse(event.created_at) : null;
    const rawPayload = JSON.stringify(event);
    try {
      await db.insert(resendWebhookLog).values({
        svixId,
        eventType: event.type ?? "unknown",
        resendEmailId: event.data?.email_id ?? null,
        toAddress: recipient,
        bounceType: event.data?.bounce?.type ?? null,
        bounceSubtype: event.data?.bounce?.subType ?? null,
        bounceMessage: event.data?.bounce?.message ?? null,
        clickLink: event.data?.click?.link ?? null,
        emailLogId,
        action,
        rawPayload,
        resendCreatedAt: Number.isFinite(resendCreatedAt as number) ? (resendCreatedAt as number) : null,
        createdAt: Date.now(),
      });
    } catch (err: any) {
      // UNIQUE violation on svix_id == duplicate delivery == no-op. Anything
      // else is a real DB error and we'd rather know about it.
      const msg = String(err?.message ?? "");
      if (msg.includes("resend_webhook_log_svix_id_unique") || msg.includes("duplicate key")) {
        res.status(200).send("ok (duplicate)");
        return;
      }
      throw err;
    }

    res.status(200).send("ok");
  } catch (err: any) {
    console.error(`[resend-webhook] handler error:`, err?.message ?? err);
    // 500 → Resend will retry. Choose 500 over 200 here so transient DB
    // outages don't silently drop events.
    res.status(500).send("internal_error");
  }
}
