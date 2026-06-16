-- Founding Pro claim flow: invites table + founding_pro tag on tradesmen.
-- Apply via Supabase MCP (apply_migration). Do NOT run via drizzle.
--
-- No FK constraints added — app uses the service-role connection and all
-- gating lives in server/storage.ts + server/routes.ts, matching the rest of
-- this codebase (see 2026-06-14-homeowner-access.sql).
--
-- The companies_house_number column is reserved for a future Companies House
-- pre-fill; it is OUT OF SCOPE for the claim flow PR and stays null for now.

-- 1. Tag column on tradesmen — marks profiles created via the pilot claim flow.
ALTER TABLE tradesmen
  ADD COLUMN IF NOT EXISTS founding_pro boolean NOT NULL DEFAULT false;

-- 2. founding_pro_invites: one row per pilot recipient.
-- status: invited | viewed | claimed | declined
CREATE TABLE IF NOT EXISTS founding_pro_invites (
  id serial PRIMARY KEY,
  ref text NOT NULL UNIQUE,                       -- outreach slug, e.g. 'wandsworth-plumber-1'
  recipient_email text NOT NULL,
  recipient_name text,
  company_name text,
  companies_house_number text,                    -- reserved; Companies House pre-fill is out of scope
  trade text NOT NULL,                            -- 'plumber' | 'electrician' | …
  area text NOT NULL,                             -- 'Wandsworth' | 'Dulwich' | …
  postcodes text[] NOT NULL DEFAULT '{}',         -- suggested coverage postcodes
  campaign text NOT NULL DEFAULT 'founding-pro-pilot-01',
  status text NOT NULL DEFAULT 'invited',         -- invited | viewed | claimed | declined
  claimed_tradesman_id integer,                   -- → tradesmen.id; null until claimed
  viewed_at bigint,                               -- epoch ms; stamped on first view
  claimed_at bigint,                              -- epoch ms; stamped on claim
  created_at bigint NOT NULL DEFAULT (extract(epoch from now()) * 1000)::bigint
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_fpi_ref ON founding_pro_invites (ref);
CREATE INDEX IF NOT EXISTS idx_fpi_recipient_email ON founding_pro_invites (recipient_email);
CREATE INDEX IF NOT EXISTS idx_fpi_status ON founding_pro_invites (status);

-- ──────────────────────────────────────────────────────────────────────────
-- ROLLBACK (run manually to revert this migration):
--
--   DROP INDEX IF EXISTS idx_fpi_status;
--   DROP INDEX IF EXISTS idx_fpi_recipient_email;
--   DROP INDEX IF EXISTS idx_fpi_ref;
--   DROP TABLE IF EXISTS founding_pro_invites;
--   ALTER TABLE tradesmen DROP COLUMN IF EXISTS founding_pro;
-- ──────────────────────────────────────────────────────────────────────────
