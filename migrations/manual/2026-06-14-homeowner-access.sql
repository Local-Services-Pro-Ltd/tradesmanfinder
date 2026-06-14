-- PR D: Homeowner verification access (consent-gated)
-- Apply via Supabase MCP (apply_migration). Do NOT run via drizzle.
--
-- Depends on: magic_link_tokens (already exists from PR-A1a).
-- No FK constraints added — app uses service-role connection; all gating
-- is done in server/homeowner-auth.ts and server/storage.ts.

-- homeowner_sessions: parallel to `sessions` but for homeowners (no tradesman_id).
-- Cookie name: tf_homeowner. Sliding 30-day expiry.
CREATE TABLE IF NOT EXISTS homeowner_sessions (
  id text PRIMARY KEY,                        -- 256-bit hex cookie value
  email text NOT NULL,                        -- lowercased
  created_at bigint NOT NULL,
  expires_at bigint NOT NULL,                 -- sliding 30-day
  last_seen_at bigint NOT NULL,
  request_ip text,
  request_user_agent text
);
CREATE INDEX IF NOT EXISTS idx_hs_email ON homeowner_sessions (email);

-- verification_access_requests: homeowner requests to view tradesman proofs.
-- status: pending | granted | denied | revoked
-- granted_until: epoch ms (now + 7 days) when status='granted', null otherwise
CREATE TABLE IF NOT EXISTS verification_access_requests (
  id serial PRIMARY KEY,
  homeowner_email text NOT NULL,              -- lowercased
  tradesman_id integer NOT NULL,
  status text NOT NULL DEFAULT 'pending',     -- pending | granted | denied | revoked
  requested_at bigint NOT NULL,
  decided_at bigint,                          -- when granted/denied
  decided_by_tradesman_id integer,            -- audit
  granted_until bigint,                       -- 7d from grant time; null when not granted
  revoked_at bigint,
  notes text,                                 -- optional tradesman note (e.g. on denial)
  request_ip text,
  request_user_agent text
);
CREATE INDEX IF NOT EXISTS idx_var_email_tradesman ON verification_access_requests (homeowner_email, tradesman_id);
CREATE INDEX IF NOT EXISTS idx_var_tradesman_status ON verification_access_requests (tradesman_id, status);

-- verification_access_blocks: permanent block by tradesman of a homeowner email.
-- Different from revoke: blocks all future requests from this email to this tradesman.
-- UNIQUE(tradesman_id, homeowner_email) — one block row per pair.
CREATE TABLE IF NOT EXISTS verification_access_blocks (
  id serial PRIMARY KEY,
  tradesman_id integer NOT NULL,
  homeowner_email text NOT NULL,              -- lowercased
  created_at bigint NOT NULL,
  reason text,
  UNIQUE (tradesman_id, homeowner_email)
);

-- No changes to magic_link_tokens — the purpose column is already free-form text.
-- homeowner magic links use purpose='homeowner_verify_access'.
-- The tradesman_id column stores the target tradesman id for these tokens.
