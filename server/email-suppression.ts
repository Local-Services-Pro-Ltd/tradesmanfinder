// Per-send suppression_list check (issue #144).
//
// Non-negotiable compliance requirement: every outbound send must check
// suppression_list for the destination email address immediately before
// the send decision is made — no cached snapshots, no batch pre-filtering,
// no in-memory Set. Suppression can be added (via unsubscribe, reply-DELETE,
// bounce, or complaint webhook) seconds after any batch snapshot would have
// been taken, so only a per-row indexed lookup at send time is safe.
//
// suppression_list.email is stored lowercase (see shared/schema.ts comment
// "lowercased at write time"), so callers must downcase before the lookup —
// this module does that internally so callers cannot forget it.
//
// Fail-closed: if the suppression_list query itself errors (DB down,
// connection pool exhausted, etc.) we do NOT let the send proceed. A broken
// check must never be silently treated as "not suppressed" — that would be
// a compliance violation. Callers should catch SuppressionCheckError (or
// let it propagate) and skip the send, logging the skip rather than sending
// around a failed check.
import { eq } from "drizzle-orm";
import { suppressionList } from "@shared/schema";
import { db } from "./storage";

/** Thrown when the destination email is present in suppression_list. */
export class SuppressedRecipientError extends Error {
  readonly email: string;

  constructor(email: string) {
    super(`Recipient is suppressed: ${email}`);
    this.name = "SuppressedRecipientError";
    this.email = email;
  }
}

/**
 * Thrown when the suppression_list lookup itself fails (DB error). Distinct
 * from SuppressedRecipientError so callers can tell "known-suppressed" apart
 * from "we couldn't find out" — both must block the send, but the log
 * messages and alerting should differ.
 */
export class SuppressionCheckError extends Error {
  readonly email: string;
  readonly cause: unknown;

  constructor(email: string, cause: unknown) {
    const causeMessage = cause instanceof Error ? cause.message : String(cause);
    super(`Suppression check failed for ${email}: ${causeMessage}`);
    this.name = "SuppressionCheckError";
    this.email = email;
    this.cause = cause;
  }
}

/**
 * Returns true if `email` (case-insensitive) is present in suppression_list.
 *
 * Fail-closed: if the query errors, this throws SuppressionCheckError rather
 * than returning false. A DB error must never be interpreted as "not
 * suppressed" — callers must catch and skip the send, not send around it.
 */
export async function isSuppressed(email: string): Promise<boolean> {
  const normalized = email.trim().toLowerCase();
  try {
    const rows = await db
      .select({ id: suppressionList.id })
      .from(suppressionList)
      .where(eq(suppressionList.email, normalized))
      .limit(1);
    return rows.length > 0;
  } catch (err) {
    throw new SuppressionCheckError(normalized, err);
  }
}

/**
 * Throws if `email` (case-insensitive) is present in suppression_list.
 * Throws SuppressionCheckError if the lookup itself fails — fail-closed,
 * same recipient-blocking behaviour as an actual suppression hit.
 *
 * Intended to be called immediately before every outbound send decision,
 * in the same request as the send — not from a pre-computed batch list.
 */
export async function checkSuppressionOrThrow(email: string): Promise<void> {
  const normalized = email.trim().toLowerCase();
  const suppressed = await isSuppressed(normalized);
  if (suppressed) {
    throw new SuppressedRecipientError(normalized);
  }
}
