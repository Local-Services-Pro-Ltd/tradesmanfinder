-- Resend webhook audit log + index on email_log.resend_id for lookups.
--
-- Why: shipping the /api/resend/webhook handler that listens for
-- email.delivered / email.opened / email.clicked / email.bounced /
-- email.complained / email.delivery_delayed events from Resend. We need:
--
--   1) An append-only audit table (`resend_webhook_log`) for every event
--      we receive, dedup'd by svix-id. Mirrors the `payments_log` pattern
--      from PR-E2 — same idempotency story, same debugging affordance.
--
--   2) An index on `email_log.resend_id` so the webhook can look up the
--      original send row in O(log n) when applying status / delivered_at
--      updates.
--
-- Apply via Supabase MCP execute_sql. Idempotent: IF NOT EXISTS guards
-- the table and the index.

CREATE TABLE IF NOT EXISTS resend_webhook_log (
  id              SERIAL PRIMARY KEY,
  -- Svix message id from the svix-id header. Resend retries on non-2xx
  -- with the same svix-id, so this UNIQUE constraint is what makes the
  -- handler idempotent.
  svix_id         TEXT NOT NULL UNIQUE,
  -- Resend event identity
  event_type      TEXT NOT NULL,        -- 'email.delivered' | 'email.opened' | 'email.clicked' | 'email.bounced' | 'email.complained' | 'email.delivery_delayed' | 'email.sent' | 'email.failed'
  resend_email_id TEXT,                 -- data.email_id; null for contact.*/domain.* events
  to_address      TEXT,                 -- data.to[0] when present (PII; redact-safe because it's our outbound recipient)
  -- Bounce / complaint detail (only populated for those types)
  bounce_type     TEXT,                 -- 'Permanent' | 'Transient' | null
  bounce_subtype  TEXT,                 -- 'Suppressed' | 'General' | ... | null
  bounce_message  TEXT,
  -- Click detail (only populated for email.clicked)
  click_link      TEXT,
  -- Resolution against our email_log row
  email_log_id    INTEGER,              -- nullable when we couldn't find a matching send (replay of old event, etc.)
  action          TEXT NOT NULL,        -- 'log_updated' | 'no_matching_send' | 'noop' | 'failed'
  -- Raw event for debugging (~1-2KB per row)
  raw_payload     TEXT,
  -- Resend's event timestamp (epoch ms). We also have created_at = when WE received it.
  resend_created_at BIGINT,
  created_at      BIGINT NOT NULL
);

-- Lookups by resend_email_id (e.g. "show me every event for this send")
CREATE INDEX IF NOT EXISTS idx_resend_webhook_log_email
  ON resend_webhook_log (resend_email_id);

-- Speed up the email_log row lookup the webhook handler does on every event.
-- email_log.resend_id is sparse (null when send failed) so a regular btree
-- index is fine.
CREATE INDEX IF NOT EXISTS idx_email_log_resend_id
  ON email_log (resend_id);
