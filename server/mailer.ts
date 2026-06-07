// Email notifications via Resend (https://resend.com).
// Uses direct HTTPS to keep the serverless bundle small (no SDK dependency).
//
// Required env vars:
//   RESEND_API_KEY  — Resend API key (re_...). If unset, sends are silently skipped.
//   EMAIL_FROM      — From address, e.g. "TradesmanFinder Moderation <moderation@tradesmanfinder.com>"
//                     Falls back to "TradesmanFinder <onboarding@resend.dev>" if unset.

import type { TradesmanCard } from "@shared/schema";
import { emailLog } from "@shared/schema";
import { db } from "./storage";
import { redactPII } from "./redact-pii";
import { selectPlacements } from "./placement-engine";
import { storage } from "./storage";
import { signOutcomeToken, buildOutcomeLink } from "./outcome-tokens";
import { buildOutcomeAskEmail, type OutcomeAskEmailLinks, type BuildOutcomeAskEmailInput } from "./outcome-ask-email";

// Re-export the pure builder + its types so callers that already import
// from "./mailer" keep working. The builder itself lives in
// ./outcome-ask-email so it can be unit-tested without loading ./storage.
export { buildOutcomeAskEmail };
export type { BuildOutcomeAskEmailInput, OutcomeAskEmailLinks };

const RESEND_API = "https://api.resend.com/emails";
const PUBLIC_URL = process.env.PUBLIC_URL || "https://tradesmanfinder.com";
const SUPPORT_EMAIL = process.env.SUPPORT_EMAIL || "support@tradesmanfinder.com";

function getFrom(): string {
  return (
    process.env.EMAIL_FROM ||
    "TradesmanFinder Moderation <moderation@tradesmanfinder.com>"
  );
}

interface SendArgs {
  to: string;
  subject: string;
  html: string;
  text: string;
  tag?: string; // analytics label
  // Persisted to email_log for audit + admin debugging. Optional only to keep
  // back-compat with callers that have not been updated yet — new callers
  // should always populate this.
  log?: {
    template: string; // e.g. 'new_lead', 'card_warning_issued'
    jobId?: number | null;
    tradesmanId?: number | null;
    partnerId?: number | null;
    redactionCount?: number;
  };
}

// Persist a row to email_log. Never throws — logging must not block sends.
async function persistEmailLog(args: {
  template: string;
  to: string;
  from: string;
  subject: string;
  resendId: string | null;
  status: "sent" | "failed";
  errorMessage: string | null;
  jobId?: number | null;
  tradesmanId?: number | null;
  partnerId?: number | null;
  redactionCount?: number;
}): Promise<void> {
  try {
    await db.insert(emailLog).values({
      template: args.template,
      toAddress: args.to,
      fromAddress: args.from,
      subject: args.subject,
      resendId: args.resendId,
      status: args.status,
      errorMessage: args.errorMessage,
      jobId: args.jobId ?? null,
      tradesmanId: args.tradesmanId ?? null,
      partnerId: args.partnerId ?? null,
      redactionCount: args.redactionCount ?? 0,
      createdAt: Date.now(),
      deliveredAt: null,
    });
  } catch (err: any) {
    // Audit log failure is non-fatal. Surface in server logs but do not
    // propagate — the email itself may have succeeded.
    console.error(`[mailer] email_log insert failed for ${args.to}:`, err?.message);
  }
}

async function send({ to, subject, html, text, tag, log }: SendArgs): Promise<{ ok: boolean; id?: string; error?: string }> {
  const key = process.env.RESEND_API_KEY;
  const from = getFrom();
  if (!key) {
    console.log(`[mailer] RESEND_API_KEY not set — would send to ${to}: ${subject}`);
    if (log) {
      await persistEmailLog({
        template: log.template, to, from, subject,
        resendId: null, status: "failed", errorMessage: "no_api_key",
        jobId: log.jobId, tradesmanId: log.tradesmanId, partnerId: log.partnerId,
        redactionCount: log.redactionCount,
      });
    }
    return { ok: false, error: "no_api_key" };
  }
  try {
    const body: Record<string, unknown> = { from, to: [to], subject, html, text };
    if (tag) body.tags = [{ name: "category", value: tag }];

    const res = await fetch(RESEND_API, {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const data: any = await res.json().catch(() => ({}));
    if (!res.ok) {
      console.error(`[mailer] Resend ${res.status} for ${to}:`, data);
      if (log) {
        await persistEmailLog({
          template: log.template, to, from, subject,
          resendId: null, status: "failed",
          errorMessage: data?.message || `http_${res.status}`,
          jobId: log.jobId, tradesmanId: log.tradesmanId, partnerId: log.partnerId,
          redactionCount: log.redactionCount,
        });
      }
      return { ok: false, error: data?.message || `http_${res.status}` };
    }
    if (log) {
      await persistEmailLog({
        template: log.template, to, from, subject,
        resendId: data?.id || null, status: "sent", errorMessage: null,
        jobId: log.jobId, tradesmanId: log.tradesmanId, partnerId: log.partnerId,
        redactionCount: log.redactionCount,
      });
    }
    return { ok: true, id: data?.id };
  } catch (err: any) {
    console.error(`[mailer] send failed for ${to}:`, err?.message);
    if (log) {
      await persistEmailLog({
        template: log.template, to, from, subject,
        resendId: null, status: "failed",
        errorMessage: err?.message || "send_failed",
        jobId: log.jobId, tradesmanId: log.tradesmanId, partnerId: log.partnerId,
        redactionCount: log.redactionCount,
      });
    }
    return { ok: false, error: err?.message || "send_failed" };
  }
}

// ── Branded HTML wrapper ──
function wrap(opts: { title: string; bodyHtml: string; ctaUrl?: string; ctaLabel?: string; accent?: "amber" | "yellow" | "red" | "green" }): string {
  const accentColours = {
    amber: "#f59e0b",
    yellow: "#eab308",
    red: "#dc2626",
    green: "#16a34a",
  };
  const accent = opts.accent ? accentColours[opts.accent] : "#2563eb";
  const cta = opts.ctaUrl
    ? `<table cellpadding="0" cellspacing="0" border="0" style="margin:24px 0"><tr><td style="background:${accent};border-radius:6px"><a href="${opts.ctaUrl}" style="display:inline-block;padding:12px 22px;color:#ffffff;font-family:Arial,Helvetica,sans-serif;font-size:14px;font-weight:600;text-decoration:none">${opts.ctaLabel || "View details"}</a></td></tr></table>`
    : "";

  return `<!DOCTYPE html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(opts.title)}</title></head>
<body style="margin:0;padding:0;background:#f3f4f6;font-family:Arial,Helvetica,sans-serif;color:#111827">
  <table cellpadding="0" cellspacing="0" border="0" width="100%" style="background:#f3f4f6;padding:32px 16px">
    <tr><td align="center">
      <table cellpadding="0" cellspacing="0" border="0" width="100%" style="max-width:560px;background:#ffffff;border:1px solid #e5e7eb;border-radius:8px;overflow:hidden">
        <tr><td style="background:${accent};padding:18px 24px;color:#ffffff;font-size:14px;font-weight:600;letter-spacing:0.5px;text-transform:uppercase">TradesmanFinder &middot; Moderation</td></tr>
        <tr><td style="padding:24px">
          <h1 style="margin:0 0 12px 0;font-size:20px;color:#111827">${escapeHtml(opts.title)}</h1>
          ${opts.bodyHtml}
          ${cta}
          <hr style="border:none;border-top:1px solid #e5e7eb;margin:24px 0">
          <p style="margin:0;font-size:12px;color:#6b7280;line-height:1.5">
            To appeal or query this decision, reply to this email or write to
            <a href="mailto:${SUPPORT_EMAIL}" style="color:${accent}">${SUPPORT_EMAIL}</a>
            with the date of the card and any supporting evidence.
          </p>
        </td></tr>
        <tr><td style="background:#f9fafb;padding:14px 24px;font-size:11px;color:#9ca3af;text-align:center">
          &copy; ${new Date().getFullYear()} TradesmanFinder. This is a transactional notice about your tradesperson account.
        </td></tr>
      </table>
    </td></tr>
  </table>
</body></html>`;
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" } as Record<string, string>)[c]);
}

function fmtDate(ms: number | null | undefined): string {
  if (!ms) return "—";
  return new Date(ms).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" });
}

// ── Card-issued email ──
type CardType = "warning" | "yellow" | "red";

export async function sendCardIssuedEmail(opts: {
  to: string;
  businessName: string;
  ownerName: string;
  card: TradesmanCard;
  suspendedUntil: number | null;
}) {
  const { to, businessName, ownerName, card, suspendedUntil } = opts;
  const cardType = card.cardType as CardType;
  const typeLabel = cardType.charAt(0).toUpperCase() + cardType.slice(1);
  const dashboardUrl = `${PUBLIC_URL}/dashboard`;

  const subjectMap: Record<CardType, string> = {
    warning: `Formal warning issued — ${businessName}`,
    yellow: `Yellow card issued — ${businessName}`,
    red: card.grossMisconduct
      ? `Account terminated for gross misconduct — ${businessName}`
      : `Account terminated (Red card) — ${businessName}`,
  };

  const accentMap: Record<CardType, "amber" | "yellow" | "red"> = { warning: "amber", yellow: "yellow", red: "red" };

  const explanations: Record<CardType, string> = {
    warning: `This is a <strong>first formal warning</strong>. Your profile remains fully active on TradesmanFinder. A second substantiated complaint within the next 6 months will result in a Yellow card; a third will trigger account termination (Red card).`,
    yellow: `Your <strong>Featured status has been revoked</strong> and your profile is excluded from new job matches${suspendedUntil ? ` until <strong>${fmtDate(suspendedUntil)}</strong>` : ""}. The Yellow card badge will be visible to the public on your profile for 12 months. A further substantiated complaint within this period will result in account termination.`,
    red: card.grossMisconduct
      ? `Due to <strong>gross misconduct</strong>, your TradesmanFinder account has been <strong>permanently terminated with immediate effect</strong>. Your profile has been removed from the public directory and you can no longer sign in. This decision is final.`
      : `Following three substantiated complaints, your TradesmanFinder account has been <strong>permanently terminated</strong>. Your profile has been removed from the public directory and you can no longer sign in.`,
  };

  const bodyHtml = `
    <p style="margin:0 0 14px 0;font-size:15px;line-height:1.55">Dear ${escapeHtml(ownerName)},</p>
    <p style="margin:0 0 14px 0;font-size:15px;line-height:1.55">
      A <strong>${typeLabel} card</strong> has been issued against <strong>${escapeHtml(businessName)}</strong> by TradesmanFinder's moderation team in response to a substantiated customer complaint or verified negative review.
    </p>
    <table cellpadding="0" cellspacing="0" border="0" width="100%" style="margin:18px 0;background:#f9fafb;border:1px solid #e5e7eb;border-radius:6px">
      <tr><td style="padding:14px 16px;font-size:13px;line-height:1.6;color:#374151">
        <div><strong>Card type:</strong> ${typeLabel}${card.grossMisconduct ? " (Gross misconduct)" : ""}</div>
        <div><strong>Issued:</strong> ${fmtDate(card.issuedAt)}</div>
        <div><strong>Expires:</strong> ${card.expiresAt ? fmtDate(card.expiresAt) : "Permanent"}</div>
        <div style="margin-top:10px"><strong>Reason recorded:</strong></div>
        <div style="margin-top:4px;color:#111827">${escapeHtml(card.reason)}</div>
      </td></tr>
    </table>
    <p style="margin:0 0 14px 0;font-size:14px;line-height:1.55;color:#374151">${explanations[cardType]}</p>
    <p style="margin:0 0 14px 0;font-size:14px;line-height:1.55;color:#374151">You can view your full card history and the public badge in your dashboard.</p>
  `;

  const text =
    `Dear ${ownerName},\n\n` +
    `A ${typeLabel} card has been issued against ${businessName} by TradesmanFinder's moderation team.\n\n` +
    `Card type: ${typeLabel}${card.grossMisconduct ? " (Gross misconduct)" : ""}\n` +
    `Issued: ${fmtDate(card.issuedAt)}\n` +
    `Expires: ${card.expiresAt ? fmtDate(card.expiresAt) : "Permanent"}\n` +
    `Reason: ${card.reason}\n\n` +
    `Dashboard: ${dashboardUrl}\n\n` +
    `To appeal this decision, reply to this email or write to ${SUPPORT_EMAIL} with the card date and any supporting evidence.\n\n` +
    `— TradesmanFinder Moderation`;

  const html = wrap({
    title: subjectMap[cardType],
    bodyHtml,
    ctaUrl: cardType === "red" ? undefined : dashboardUrl,
    ctaLabel: "Open your dashboard",
    accent: accentMap[cardType],
  });

  return send({
    to,
    subject: subjectMap[cardType],
    html,
    text,
    tag: `card_${cardType}_issued`,
    log: {
      template: `card_${cardType}_issued`,
      tradesmanId: card.tradesmanId,
    },
  });
}

// ── Card-rescinded email ──
export async function sendCardRescindedEmail(opts: {
  to: string;
  businessName: string;
  ownerName: string;
  card: TradesmanCard;
}) {
  const { to, businessName, ownerName, card } = opts;
  const cardType = card.cardType as CardType;
  const typeLabel = cardType.charAt(0).toUpperCase() + cardType.slice(1);
  const subject = `${typeLabel} card rescinded — ${businessName}`;
  const dashboardUrl = `${PUBLIC_URL}/dashboard`;

  const bodyHtml = `
    <p style="margin:0 0 14px 0;font-size:15px;line-height:1.55">Dear ${escapeHtml(ownerName)},</p>
    <p style="margin:0 0 14px 0;font-size:15px;line-height:1.55">
      The <strong>${typeLabel} card</strong> previously issued against <strong>${escapeHtml(businessName)}</strong> has been <strong>rescinded</strong> by TradesmanFinder's moderation team.
    </p>
    <table cellpadding="0" cellspacing="0" border="0" width="100%" style="margin:18px 0;background:#f0fdf4;border:1px solid #bbf7d0;border-radius:6px">
      <tr><td style="padding:14px 16px;font-size:13px;line-height:1.6;color:#14532d">
        <div><strong>Card originally issued:</strong> ${fmtDate(card.issuedAt)}</div>
        <div><strong>Rescinded:</strong> ${fmtDate(card.rescindedAt)}</div>
        ${card.rescindedReason ? `<div style="margin-top:10px"><strong>Reason for rescission:</strong></div><div style="margin-top:4px;color:#052e16">${escapeHtml(card.rescindedReason)}</div>` : ""}
      </td></tr>
    </table>
    <p style="margin:0 0 14px 0;font-size:14px;line-height:1.55;color:#374151">
      The card no longer counts toward our 3-strike rule. If this card had caused suspension or removal of Featured status, those effects are now reversed${cardType === "red" ? " and your account has been reinstated" : ""}.
    </p>
  `;

  const text =
    `Dear ${ownerName},\n\n` +
    `The ${typeLabel} card previously issued against ${businessName} has been rescinded by TradesmanFinder's moderation team.\n\n` +
    `Originally issued: ${fmtDate(card.issuedAt)}\n` +
    `Rescinded: ${fmtDate(card.rescindedAt)}\n` +
    (card.rescindedReason ? `Reason: ${card.rescindedReason}\n` : "") +
    `\nThis card no longer counts toward our 3-strike rule.\n\n` +
    `Dashboard: ${dashboardUrl}\n\n— TradesmanFinder Moderation`;

  const html = wrap({
    title: subject,
    bodyHtml,
    ctaUrl: dashboardUrl,
    ctaLabel: "Open your dashboard",
    accent: "green",
  });

  return send({
    to,
    subject,
    html,
    text,
    tag: `card_${cardType}_rescinded`,
    log: {
      template: `card_${cardType}_rescinded`,
      tradesmanId: card.tradesmanId,
    },
  });
}

/**
 * Appends a single placement block to email body HTML.
 * Returns the original html unchanged if no placement found or on any error.
 * The event_id is embedded as ?eid=<uuid> on the target URL for PR-P6 click attribution.
 */
async function appendEmailPlacement(bodyHtml: string, categoryId?: number | null): Promise<string> {
  try {
    const result = await selectPlacements({
      surface: "lead_email_footer",
      category: categoryId ?? null,
      limit: 1,
      storage,
    });
    const placement = result.placements[0];
    if (!placement) return bodyHtml;

    // PR-P6: Route email CTA clicks through the server-side click-tracking
    // endpoint when the impression was sampled (event_id present). We need
    // the full origin so email clients get an absolute URL.
    // PUBLIC_APP_URL takes precedence over PUBLIC_URL; both fall back to the
    // production hostname.
    const appUrl = (process.env.PUBLIC_APP_URL ?? process.env.PUBLIC_URL ?? "https://tradesmanfinder.com").replace(/\/$/, "");
    // Trade-off: unsampled impressions (event_id is null) link direct to the
    // partner URL — we cannot track those clicks without a UUID.
    const targetUrl = placement.event_id
      ? `${appUrl}/p/c/${placement.event_id}?p=${placement.id}`
      : placement.target_url;
    const headline = escapeHtml(placement.creative.headline);
    const bodyText = placement.creative.body ? `<p style="margin:6px 0 0;font-size:12px;color:#6b7280">${escapeHtml(placement.creative.body)}</p>` : "";
    const ctaLabel = escapeHtml(placement.creative.cta || "Learn more");

    const snippet =
      `<hr style="border:none;border-top:1px solid #e5e7eb;margin:20px 0">` +
      `<table cellpadding="0" cellspacing="0" border="0" width="100%" style="background:#f9fafb;border:1px solid #e5e7eb;border-radius:6px">` +
      `<tr><td style="padding:12px 14px">` +
      `<p style="margin:0 0 2px;font-size:10px;color:#9ca3af;text-transform:uppercase;letter-spacing:0.5px">Sponsored</p>` +
      `<p style="margin:0;font-size:13px;font-weight:600;color:#111827">${headline}</p>` +
      bodyText +
      `<a href="${targetUrl}" rel="sponsored noopener" target="_blank" ` +
      `style="display:inline-block;margin-top:8px;padding:6px 14px;background:#2563eb;color:#fff;font-size:12px;font-weight:600;text-decoration:none;border-radius:4px">${ctaLabel}</a>` +
      `</td></tr></table>`;

    return bodyHtml + snippet;
  } catch (err: any) {
    console.error("[mailer] placement append failed — skipping:", err?.message);
    return bodyHtml;
  }
}

export async function sendNewLeadEmail(opts: {
  to: string;
  businessName: string;
  ownerName: string;
  jobTitle: string;
  postcode: string;
  trade: string;
  urgency: string;
  budgetRange: string;
  description: string;
  categoryId?: number | null;
  jobId?: number;
  tradesmanId?: number;
  redactionCount?: number;
}) {
  const { to, businessName, ownerName, jobTitle, postcode, trade, urgency, budgetRange, description } = opts;
  const dashboardUrl = `${PUBLIC_URL}/dashboard`;
  const subject = `New lead: ${jobTitle} in ${postcode}`;
  // Strip PII (phone / email / full postcode / long digit runs) before the body
  // ever leaves our server. Full description is still available in-dashboard
  // once the tradesperson signs in.
  const { text: safeDesc, redactions } = redactPII(description);
  const shortDesc = safeDesc.length > 280 ? safeDesc.slice(0, 280) + "\u2026" : safeDesc;
  if (redactions > 0) {
    console.log(`[mailer] new_lead: redacted ${redactions} PII item(s) from description before send`);
  }
  const urgencyLabel = urgency.charAt(0).toUpperCase() + urgency.slice(1);
  const budgetLine = budgetRange ? `<tr><td style="padding:4px 0;color:#6b7280">Budget</td><td style="padding:4px 0;font-weight:600">${escapeHtml(budgetRange)}</td></tr>` : "";
  const bodyHtml =
    `<p style="margin:0 0 12px">Hi ${escapeHtml(ownerName)},</p>` +
    `<p style="margin:0 0 16px">You have a new lead matched to <strong>${escapeHtml(businessName)}</strong> on TradesmanFinder.</p>` +
    `<table cellpadding="0" cellspacing="0" border="0" style="font-family:Arial,Helvetica,sans-serif;font-size:14px;color:#111827">` +
    `<tr><td style="padding:4px 12px 4px 0;color:#6b7280">Job</td><td style="padding:4px 0;font-weight:600">${escapeHtml(jobTitle)}</td></tr>` +
    `<tr><td style="padding:4px 0;color:#6b7280">Trade</td><td style="padding:4px 0;font-weight:600">${escapeHtml(trade)}</td></tr>` +
    `<tr><td style="padding:4px 0;color:#6b7280">Area</td><td style="padding:4px 0;font-weight:600">${escapeHtml(postcode)}</td></tr>` +
    `<tr><td style="padding:4px 0;color:#6b7280">Urgency</td><td style="padding:4px 0;font-weight:600">${escapeHtml(urgencyLabel)}</td></tr>` +
    budgetLine +
    `</table>` +
    `<p style="margin:16px 0 4px;color:#6b7280">Details</p>` +
    `<p style="margin:0 0 8px">${escapeHtml(shortDesc)}</p>` +
    `<p style="margin:16px 0 0;color:#6b7280;font-size:13px">Log in to your dashboard to view the customer's contact details and send a quote.</p>`;
  const bodyHtmlWithPlacement = await appendEmailPlacement(bodyHtml, opts.categoryId);
  const html = wrap({
    title: subject,
    bodyHtml: bodyHtmlWithPlacement,
    ctaUrl: dashboardUrl,
    ctaLabel: "View lead & quote",
    accent: "green",
  });
  const text =
    `Hi ${ownerName},\n\n` +
    `You have a new lead matched to ${businessName} on TradesmanFinder.\n\n` +
    `Job: ${jobTitle}\nTrade: ${trade}\nArea: ${postcode}\nUrgency: ${urgencyLabel}\n` +
    (budgetRange ? `Budget: ${budgetRange}\n` : "") +
    `\nDetails: ${shortDesc}\n\n` +
    `Log in to your dashboard to view contact details and send a quote: ${dashboardUrl}\n\n— TradesmanFinder`;
  return send({
    to,
    subject,
    html,
    text,
    tag: "new_lead",
    log: {
      template: "new_lead",
      jobId: opts.jobId ?? null,
      tradesmanId: opts.tradesmanId ?? null,
      // Use the count computed locally above; opts.redactionCount is only an
      // override for callers that ran redaction earlier in the pipeline.
      redactionCount: opts.redactionCount ?? redactions,
    },
  });
}

// ── Partner enquiry notification — sent to ops on each /partners form submission ──
// Single-recipient internal notification; no public-facing email is sent to the
// prospective partner from here (PR-P3 admin tooling will add an explicit ack).
export async function sendPartnerEnquiryNotification(opts: {
  enquiryId: number;
  companyName: string;
  contactName: string;
  email: string;
  phone: string | null;
  vertical: string;
  monthlyBudget: string | null;
  message: string;
}): Promise<{ ok: boolean; id?: string; error?: string }> {
  const adminUrl = `${PUBLIC_URL}/admin#partner-enquiry-${opts.enquiryId}`;
  const subject = `New partner enquiry — ${opts.companyName} (${opts.vertical})`;

  const bodyHtml = `
    <p style="margin:0 0 14px 0;font-size:15px;line-height:1.55">A new partner enquiry has come in from the <strong>/partners</strong> marketing page.</p>
    <table cellpadding="0" cellspacing="0" border="0" width="100%" style="margin:18px 0;background:#f9fafb;border:1px solid #e5e7eb;border-radius:6px">
      <tr><td style="padding:14px 16px;font-size:13px;line-height:1.7;color:#374151">
        <div><strong>Company:</strong> ${escapeHtml(opts.companyName)}</div>
        <div><strong>Contact:</strong> ${escapeHtml(opts.contactName)}</div>
        <div><strong>Email:</strong> <a href="mailto:${escapeHtml(opts.email)}" style="color:#1d4ed8">${escapeHtml(opts.email)}</a></div>
        ${opts.phone ? `<div><strong>Phone:</strong> ${escapeHtml(opts.phone)}</div>` : ""}
        <div><strong>Vertical:</strong> ${escapeHtml(opts.vertical)}</div>
        ${opts.monthlyBudget ? `<div><strong>Budget:</strong> ${escapeHtml(opts.monthlyBudget)}</div>` : ""}
        <div style="margin-top:10px"><strong>Message:</strong></div>
        <div style="margin-top:4px;color:#111827;white-space:pre-wrap">${escapeHtml(opts.message)}</div>
      </td></tr>
    </table>
    <p style="margin:0 0 14px 0;font-size:13px;line-height:1.55;color:#6b7280">Enquiry #${opts.enquiryId} — reply within 24h for best conversion. Convert to a partner record in the admin console once the call is booked.</p>
  `;

  const text =
    `New partner enquiry — ${opts.companyName} (${opts.vertical})\n\n` +
    `Contact: ${opts.contactName}\n` +
    `Email: ${opts.email}\n` +
    (opts.phone ? `Phone: ${opts.phone}\n` : "") +
    `Vertical: ${opts.vertical}\n` +
    (opts.monthlyBudget ? `Budget: ${opts.monthlyBudget}\n` : "") +
    `\nMessage:\n${opts.message}\n\n` +
    `Enquiry #${opts.enquiryId}\nAdmin: ${adminUrl}\n`;

  const html = wrap({
    title: subject,
    bodyHtml,
    ctaUrl: adminUrl,
    ctaLabel: "Open admin console",
  });

  // Recipient: env-driven, defaults to moderation@ which already exists in DNS.
  // We don't reuse SUPPORT_EMAIL because that's the customer-facing reply-to;
  // partner enquiries are an internal sales notification.
  const to = process.env.PARTNER_NOTIFICATION_EMAIL || "moderation@tradesmanfinder.com";

  return send({
    to,
    subject,
    html,
    text,
    tag: "partner_enquiry",
    log: {
      template: "partner_enquiry",
      partnerId: null,
    },
  });
}

export async function sendMagicLinkEmail(opts: {
  to: string;
  token: string;          // raw token (this is the ONLY place the raw token escapes the server)
  purpose: "sign_in" | "sign_up";
  tradesmanId?: number | null;
  ttlMinutes?: number;    // for copy only; default 15
}): Promise<{ ok: boolean; id?: string; error?: string }> {
  const ttlMinutes = opts.ttlMinutes ?? 15;
  const verifyUrl = `${PUBLIC_URL}/api/auth/verify?token=${encodeURIComponent(opts.token)}`;
  const isSignUp = opts.purpose === "sign_up";

  const subject = isSignUp
    ? "Confirm your TradesmanFinder account"
    : "Your TradesmanFinder sign-in link";

  const ctaLabel = isSignUp ? "Confirm and sign in" : "Sign in to TradesmanFinder";
  const headline = isSignUp
    ? "Welcome to TradesmanFinder"
    : "Sign in to TradesmanFinder";
  const intro = isSignUp
    ? "Click the button below to confirm your email address and finish setting up your account."
    : "Click the button below to sign in to your dashboard. You won't need a password.";

  const html = `
    <div style="font-family:system-ui,-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;max-width:560px;margin:0 auto;color:#111">
      <h2 style="font-size:20px;margin:0 0 12px">${headline}</h2>
      <p style="font-size:15px;line-height:1.5;margin:0 0 20px">${intro}</p>
      <p style="margin:0 0 24px">
        <a href="${verifyUrl}"
           style="display:inline-block;background:#0f172a;color:#fff;text-decoration:none;padding:12px 20px;border-radius:8px;font-weight:600">
          ${ctaLabel}
        </a>
      </p>
      <p style="font-size:13px;color:#475569;margin:0 0 6px">
        This link expires in ${ttlMinutes} minutes and can only be used once.
      </p>
      <p style="font-size:13px;color:#475569;margin:0 0 20px">
        If you didn't request this, you can safely ignore the email — no account changes will be made.
      </p>
      <p style="font-size:12px;color:#64748b;margin:0 0 4px">Trouble with the button? Copy and paste this link into your browser:</p>
      <p style="font-size:12px;color:#64748b;word-break:break-all;margin:0">${verifyUrl}</p>
      <hr style="border:none;border-top:1px solid #e2e8f0;margin:24px 0" />
      <p style="font-size:12px;color:#64748b;margin:0">Questions? Reply to this email or contact ${SUPPORT_EMAIL}.</p>
    </div>
  `;
  const text =
    `${headline}\n\n` +
    `${intro}\n\n` +
    `${ctaLabel}: ${verifyUrl}\n\n` +
    `This link expires in ${ttlMinutes} minutes and can only be used once. ` +
    `If you didn't request it, you can safely ignore this email.\n\n` +
    `Questions? Reply to this email or contact ${SUPPORT_EMAIL}.\n`;

  return send({
    to: opts.to,
    subject,
    html,
    text,
    tag: isSignUp ? "magic_link_sign_up" : "magic_link_sign_in",
    log: {
      template: isSignUp ? "magic_link_sign_up" : "magic_link_sign_in",
      tradesmanId: opts.tradesmanId ?? null,
    },
  });
}

// ── PR-P9: Partner outcome-ask email ────────────────────────────────────────
// Asks a partner "Did lead #N convert?" with 3 signed buttons (won / lost /
// quoted). The links are HMAC-signed by outcome-tokens.ts so a partner
// clicking them resolves to /p/o/:token without admin auth.
//
// Why this lives in mailer.ts (vs outcome-capture.ts):
//   - Reuses the same `wrap()` chrome and `send()` plumbing as every other
//     transactional email.
//   - Keeps outcome-capture.ts focused on the receive-side endpoint.
//
// Why pure builder + thin sender:
//   - `buildOutcomeAskEmail` is exported and unit-tested without env / DB /
//     network. The sender just composes it with `send`.

// `buildOutcomeAskEmail` is imported and re-exported at the top of this
// file (see imports). It lives in ./outcome-ask-email so unit tests can
// load it without transitively loading ./storage.

/**
 * Sign outcome tokens, build the email, and send it. Returns the standard
 * mailer result so callers can react to send failures.
 *
 * Idempotency note: each call generates a fresh nonce, so calling this twice
 * for the same (partnerId, placementId, jobId) produces two emails with two
 * different tokens. Both tokens resolve to the same logical idempotency key
 * in `partner_events` (lead_outcome:<placementId>:<jobId>-<nonce>) so only
 * the FIRST click counted; the SECOND is a silent no-op.
 */
export async function sendOutcomeAskEmail(opts: {
  to: string;
  partnerId: number;
  partnerName: string;
  placementId: number;
  jobId: number;
  jobTitle?: string;
  area?: string;
  ttlDays?: number;
}): Promise<{ ok: boolean; id?: string; error?: string }> {
  const ttlDays = opts.ttlDays ?? 90;
  const token = signOutcomeToken({
    partnerId: opts.partnerId,
    placementId: opts.placementId,
    jobId: opts.jobId,
    ttlMs: ttlDays * 24 * 60 * 60 * 1000,
  });
  const links: OutcomeAskEmailLinks = {
    won: buildOutcomeLink(token, "won"),
    lost: buildOutcomeLink(token, "lost"),
    quoted: buildOutcomeLink(token, "quoted"),
  };

  const { subject, html, text } = buildOutcomeAskEmail({
    partnerName: opts.partnerName,
    jobId: opts.jobId,
    jobTitle: opts.jobTitle,
    area: opts.area,
    links,
    expiresInDays: ttlDays,
  });

  return send({
    to: opts.to,
    subject,
    html,
    text,
    tag: "partner_outcome_ask",
    log: {
      template: "partner_outcome_ask",
      partnerId: opts.partnerId,
      jobId: opts.jobId,
    },
  });
}
