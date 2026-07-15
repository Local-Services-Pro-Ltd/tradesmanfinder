-- Generalise tradesman_verifications to support arbitrary UK trade registers
-- via a single pair of columns, instead of per-register columns.
--
-- Why this exists:
--   PR-E shipped Gas Safe as a first-class verification kind with two
--   bespoke columns (gas_safe_number, gas_safe_register_url) and a bespoke
--   storage method. The next 7 registers (NICEIC, NAPIT, MCS, OFTEC,
--   TrustMark, F-Gas, CIPHE) would each demand the same bespoke
--   columns + indexes + check-constraint branches. Eight registers means
--   16 columns, 16 indexes, an unwieldy CHECK constraint, and 8 near-
--   identical storage methods.
--
-- Approach (additive, backward-compatible):
--   1. Add a generic pair: registration_number + register_url. Any
--      register-backed kind that is NOT companies_house and NOT gas_safe
--      uses these columns. (CH and gas_safe keep their existing dedicated
--      columns to avoid a risky data migration; new registers use generic.)
--   2. Extend the tv_evidence_shape CHECK to accept all 7 new kinds, each
--      requiring registration_number + evidence_data.
--   3. One partial UNIQUE per (tradesman_id, kind, registration_number)
--      so a pro can hold both NICEIC and NAPIT but not two NICEIC rows.
--   4. Index registration_number for reverse lookups.
--   5. Add per-register tradesman boolean flags so existing badge-rendering
--      code (which reads tradesmen.gas_safe_verified, etc.) can light up
--      verified pros without joining the verifications table.
--
-- Rollback: dropping the generic columns + flags leaves CH and gas_safe
-- untouched. No existing rows reference registration_number.

-- ─────────────────────────────────────────────────────────────────────
-- 1. Generic register columns.
-- ─────────────────────────────────────────────────────────────────────
ALTER TABLE tradesman_verifications
  ADD COLUMN IF NOT EXISTS registration_number TEXT,  -- normalised per-register (uppercase, no whitespace, format up to caller)
  ADD COLUMN IF NOT EXISTS register_url        TEXT;  -- canonical deep-link for admin reviewer

-- ─────────────────────────────────────────────────────────────────────
-- 2. Extend the kind-aware integrity constraint. Each new register kind
--    requires registration_number + evidence_data; CH and gas_safe keep
--    their bespoke columns; insurance/qualification still demand file_*.
-- ─────────────────────────────────────────────────────────────────────
ALTER TABLE tradesman_verifications
  DROP CONSTRAINT IF EXISTS tv_evidence_shape;

ALTER TABLE tradesman_verifications
  ADD CONSTRAINT tv_evidence_shape
  CHECK (
    (kind IN ('insurance', 'qualification') AND
       file_path IS NOT NULL AND file_mime_type IS NOT NULL AND file_size_bytes IS NOT NULL)
    OR
    (kind = 'companies_house' AND
       company_number IS NOT NULL AND evidence_data IS NOT NULL)
    OR
    (kind = 'gas_safe' AND
       gas_safe_number IS NOT NULL AND evidence_data IS NOT NULL)
    OR
    (kind IN ('niceic', 'napit', 'mcs', 'oftec', 'trustmark', 'fgas', 'ciphe') AND
       registration_number IS NOT NULL AND evidence_data IS NOT NULL)
  );

-- ─────────────────────────────────────────────────────────────────────
-- 3. Dedupe: one (tradesman, kind, registration_number) row, partial so
--    pre-existing NULL registration_numbers don't collide.
-- ─────────────────────────────────────────────────────────────────────
CREATE UNIQUE INDEX IF NOT EXISTS uq_tv_tradesman_kind_registration_number
  ON tradesman_verifications (tradesman_id, kind, registration_number)
  WHERE registration_number IS NOT NULL;

-- 4. Reverse lookup ("is this NICEIC number already claimed elsewhere?")
CREATE INDEX IF NOT EXISTS idx_tv_kind_registration_number
  ON tradesman_verifications (kind, registration_number)
  WHERE registration_number IS NOT NULL;

-- ─────────────────────────────────────────────────────────────────────
-- 5. Per-register public-facing boolean flags on the tradesman row.
--    Mirror gas_safe_verified — flipped to true when an approved row of
--    the corresponding kind exists, never auto-revoked. Drive listing
--    badges and public-profile chips without an extra join.
--    All default FALSE for additive backfill.
-- ─────────────────────────────────────────────────────────────────────
ALTER TABLE tradesmen
  ADD COLUMN IF NOT EXISTS niceic_verified    BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS napit_verified     BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS mcs_verified       BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS oftec_verified     BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS trustmark_verified BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS fgas_verified      BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS ciphe_verified     BOOLEAN NOT NULL DEFAULT FALSE;
