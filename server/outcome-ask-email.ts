// PR-P9 — Pure builder for the partner outcome-ask email.
//
// Lives in its own module (separate from mailer.ts) so it can be unit-tested
// without transitively loading ./storage (which requires DATABASE_URL at
// module-load time). Mailer.ts re-exports `buildOutcomeAskEmail` for
// backward compatibility with any callers that import it from "./mailer".
//
// No env / DB / network dependencies — given inputs, returns deterministic
// { subject, html, text }.

export interface OutcomeAskEmailLinks {
  won: string;
  lost: string;
  quoted: string;
}

export interface BuildOutcomeAskEmailInput {
  partnerName: string;
  jobId: number;
  jobTitle?: string;       // optional; shown if present
  area?: string;           // optional area / postcode label
  links: OutcomeAskEmailLinks;
  expiresInDays: number;   // for footer copy
}

// Local HTML escape — duplicated from mailer.ts to keep this module pure
// (no transitive imports). Cheap, identical behaviour.
function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" } as Record<string, string>)[c]);
}

// Tailored email chrome for the partner outcome-ask email. Modelled on the
// branded wrap() in mailer.ts but with a "Partner Programme" header band
// instead of "Moderation" (this isn't a moderation/enforcement notice).
function wrapOutcomeAskHtml(opts: { title: string; bodyHtml: string; accent: string }): string {
  return `<!DOCTYPE html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(opts.title)}</title></head>
<body style="margin:0;padding:0;background:#f3f4f6;font-family:Arial,Helvetica,sans-serif;color:#111827">
  <table cellpadding="0" cellspacing="0" border="0" width="100%" style="background:#f3f4f6;padding:32px 16px">
    <tr><td align="center">
      <table cellpadding="0" cellspacing="0" border="0" width="100%" style="max-width:560px;background:#ffffff;border:1px solid #e5e7eb;border-radius:8px;overflow:hidden">
        <tr><td style="background:${opts.accent};padding:18px 24px;color:#ffffff;font-size:14px;font-weight:600;letter-spacing:0.5px;text-transform:uppercase">TradesmanFinder &middot; Partner Programme</td></tr>
        <tr><td style="padding:24px">
          <h1 style="margin:0 0 12px 0;font-size:20px;color:#111827">${escapeHtml(opts.title)}</h1>
          ${opts.bodyHtml}
        </td></tr>
        <tr><td style="background:#f9fafb;padding:14px 24px;font-size:11px;color:#9ca3af;text-align:center">
          &copy; ${new Date().getFullYear()} TradesmanFinder. This is a transactional notice about your Partner Programme account.
        </td></tr>
      </table>
    </td></tr>
  </table>
</body></html>`;
}

/**
 * Pure builder — returns the same shape `send()` accepts. Exported for
 * unit testing.
 */
export function buildOutcomeAskEmail(input: BuildOutcomeAskEmailInput): {
  subject: string;
  html: string;
  text: string;
} {
  const subject = `Did lead #${input.jobId} convert?`;
  const titleLine = input.jobTitle ? escapeHtml(input.jobTitle) : `Job #${input.jobId}`;
  const areaLine = input.area
    ? `<div><strong>Area:</strong> ${escapeHtml(input.area)}</div>`
    : "";

  // Three side-by-side CTA buttons. Inline styles so most clients render
  // them consistently. The signed token in each URL is the entire auth.
  const button = (label: string, color: string, href: string) =>
    `<a href="${href}" style="display:inline-block;padding:11px 22px;margin:0 6px 8px 0;background:${color};color:#ffffff;font-family:Arial,Helvetica,sans-serif;font-size:14px;font-weight:600;text-decoration:none;border-radius:6px">${label}</a>`;

  const bodyHtml = `
    <p style="margin:0 0 14px 0;font-size:15px;line-height:1.55">Hi ${escapeHtml(input.partnerName)},</p>
    <p style="margin:0 0 14px 0;font-size:15px;line-height:1.55">
      We're closing the loop on a lead we passed to you. Could you tell us how it ended?
    </p>
    <table cellpadding="0" cellspacing="0" border="0" width="100%" style="margin:18px 0;background:#f9fafb;border:1px solid #e5e7eb;border-radius:6px">
      <tr><td style="padding:14px 16px;font-size:13px;line-height:1.7;color:#374151">
        <div><strong>Lead:</strong> ${titleLine}</div>
        <div><strong>Job #:</strong> ${input.jobId}</div>
        ${areaLine}
      </td></tr>
    </table>
    <p style="margin:0 0 12px 0;font-size:14px;line-height:1.55;color:#374151">One click is all it takes:</p>
    <p style="margin:0 0 16px 0">
      ${button("✓ Won", "#16a34a", input.links.won)}
      ${button("Quoted", "#d97706", input.links.quoted)}
      ${button("✗ Lost", "#dc2626", input.links.lost)}
    </p>
    <p style="margin:0 0 12px 0;font-size:13px;line-height:1.55;color:#6b7280">
      If you marked the lead as <strong>won</strong>, our finance team may follow up to confirm the deal value for your monthly statement. To record a deal value directly, append <code>&amp;deal_value_pence=N</code> to the "Won" link (N in pence — e.g. <code>250000</code> for £2,500).
    </p>
    <p style="margin:0 0 14px 0;font-size:12px;line-height:1.55;color:#9ca3af">
      These links expire in ${input.expiresInDays} day${input.expiresInDays === 1 ? "" : "s"}. If you've already marked this lead, clicking again is harmless — we won't double-count it.
    </p>
  `;

  const html = wrapOutcomeAskHtml({
    title: subject,
    bodyHtml,
    accent: "#16a34a", // green, matching the "Won" CTA
  });

  const text =
    `Hi ${input.partnerName},\n\n` +
    `We're closing the loop on a lead we passed to you. Could you tell us how it ended?\n\n` +
    `Lead: ${input.jobTitle ?? `Job #${input.jobId}`}\n` +
    `Job #: ${input.jobId}\n` +
    (input.area ? `Area: ${input.area}\n` : "") +
    `\nOne click is all it takes:\n` +
    `  Won:    ${input.links.won}\n` +
    `  Quoted: ${input.links.quoted}\n` +
    `  Lost:   ${input.links.lost}\n\n` +
    `If you mark the lead as won, our finance team may follow up to confirm the deal value. ` +
    `To record a deal value directly, append &deal_value_pence=N to the Won link ` +
    `(N in pence — e.g. 250000 for £2,500).\n\n` +
    `These links expire in ${input.expiresInDays} day${input.expiresInDays === 1 ? "" : "s"}. ` +
    `If you've already marked this lead, clicking again is harmless.\n\n— TradesmanFinder Partner Team`;

  return { subject, html, text };
}
