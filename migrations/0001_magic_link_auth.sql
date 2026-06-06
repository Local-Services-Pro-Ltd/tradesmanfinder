-- PR-A1: magic-link authentication
-- Apply to Supabase (same project used for the PR-E1 add_stripe_columns_and_payments_log migration).
-- Migration name to use when applying via the Supabase connector: magic_link_auth

-- New column on tradesmen: when the account first verified a sign-in link.
ALTER TABLE tradesmen
  ADD COLUMN IF NOT EXISTS email_verified_at TIMESTAMPTZ NULL;

-- Single-use magic-link sign-in tokens. Only the sha256 hash is stored.
CREATE TABLE IF NOT EXISTS auth_tokens (
  id           BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  tradesman_id BIGINT NOT NULL REFERENCES tradesmen(id) ON DELETE CASCADE,
  token_hash   TEXT NOT NULL,
  expires_at   TIMESTAMPTZ NOT NULL,
  consumed_at  TIMESTAMPTZ NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  ip           INET NULL,
  user_agent   TEXT NULL
);

-- token_hash is the lookup key on verify; must be unique (no hash collisions / reuse).
CREATE UNIQUE INDEX IF NOT EXISTS auth_tokens_token_hash_key
  ON auth_tokens (token_hash);

-- Supports the DB-backed per-email rate limit window query
-- (count rows for a tradesman within the last 15 minutes).
CREATE INDEX IF NOT EXISTS auth_tokens_tradesman_created_idx
  ON auth_tokens (tradesman_id, created_at);
