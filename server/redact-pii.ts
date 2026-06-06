// PII redaction for outbound transactional emails.
//
// Applied to free-text fields supplied by homeowners (e.g. job descriptions)
// before they're rendered into emails that go to matched tradespeople.
// Tradespeople see the full description ONLY after they log in to the
// dashboard — keeping the email body sparse limits exposure if a mailbox
// is shared, forwarded, or breached.
//
// Heuristics (UK-focused, deliberately conservative):
//   • UK phone numbers (mobile + landline, inc. +44 international form)
//   • Email addresses
//   • Full UK postcodes  → reduced to outward code only (e.g. "DN31 3LL" → "DN31")
//   • Long digit runs (≥7) that don't match the above patterns
//
// We do NOT attempt to redact arbitrary names — false-positive rate is too
// high for transactional copy. Names are handled by NOT passing customerName
// into the lead email body in the first place.

const PHONE_RE =
  // +44 or 0 prefix, then 9-10 more digits, allowing spaces, hyphens, brackets
  /(?:\+44\s?|\b0)(?:\d[\s\-()]*){9,10}\b/g;

const EMAIL_RE = /\b[A-Za-z0-9._%+\-]+@[A-Za-z0-9.\-]+\.[A-Za-z]{2,}\b/g;

// UK postcode: outward (1-2 letters, 1-2 digits, optional letter) + space + inward (1 digit, 2 letters)
// Match the FULL postcode so we can replace with outward-only.
const FULL_POSTCODE_RE = /\b([A-Z]{1,2}\d[A-Z\d]?)\s*(\d[A-Z]{2})\b/gi;

// Bare digit runs of 7+ that haven't already been masked.
const LONG_DIGIT_RE = /\b\d[\d\s\-]{6,}\d\b/g;

export interface RedactionResult {
  text: string;
  redactions: number;
}

/**
 * Returns the input with phone numbers, email addresses, full postcodes and
 * long digit runs replaced by `[redacted]`, plus a count of replacements made.
 * Full postcodes are reduced to outward code only (kept for area context).
 *
 * Safe on empty strings and short inputs — returns the input unchanged.
 */
export function redactPII(input: string): RedactionResult {
  if (!input) return { text: input ?? "", redactions: 0 };

  let text = input;
  let redactions = 0;

  // 1) Full UK postcodes → outward code only. Don't count as a redaction
  //    because we're preserving area context, not removing information.
  text = text.replace(FULL_POSTCODE_RE, (_m, outward) => String(outward).toUpperCase());

  // 2) Email addresses
  text = text.replace(EMAIL_RE, () => {
    redactions++;
    return "[redacted email]";
  });

  // 3) Phone numbers (UK formats)
  text = text.replace(PHONE_RE, () => {
    redactions++;
    return "[redacted phone]";
  });

  // 4) Any remaining long digit runs (mobile-style strings without country code,
  //    account numbers, etc.)
  text = text.replace(LONG_DIGIT_RE, () => {
    redactions++;
    return "[redacted number]";
  });

  return { text, redactions };
}

/**
 * Convenience: returns only the redacted text. Use when the caller doesn't
 * care about the redaction count.
 */
export function redactPIIText(input: string): string {
  return redactPII(input).text;
}
