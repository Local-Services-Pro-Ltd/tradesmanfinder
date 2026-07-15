-- Extend tradesman_verifications to support Gas Safe Register lookups as evidence.
--
-- Why this exists:
--   The UK Gas Safe Register is the legal source of truth for who is allowed to
--   work on gas appliances. Asking a Gas Safe-registered plumber to scan and
--   email us their certificate is the wrong UX — the register itself is public,
--   searchable by business name or registration number, and updated daily by
--   Gas Safe themselves. Tonight's first Founding Pro (Keystone London Group)
--   went silent after we asked for a certificate scan; the right move is to
--   make Gas Safe a first-class verification kind that doesn't ask for any
--   document at all.
--
-- Mirror of the 2026-06-18 Companies House migration: same shape, different
-- register. We add a TEXT column for the registration number, a TEXT column
-- for the canonical register URL (Gas Safe's signed `cp=` deep-link), and
-- reuse the existing JSONB evidence_data column for the snapshotted register
-- payload (business name, address, approved categories, engineer list).
--
-- Backwards compatibility: all changes are additive. Existing insurance,
-- qualification, and companies_house rows pass the new check constraint
-- without modification.

-- 1. New columns for Gas Safe evidence.
ALTER TABLE tradesman_verifications
  ADD COLUMN IF NOT EXISTS gas_safe_number       TEXT,    -- normalised (digits only, leading zeros preserved)
  ADD COLUMN IF NOT EXISTS gas_safe_register_url TEXT;    -- canonical Gas Safe register deep-link (signed cp=… URL)

-- 2. Replace the kind-aware integrity constraint to cover gas_safe as a fourth
--    kind. File kinds still need file columns; CH still needs company_number;
--    gas_safe needs gas_safe_number. evidence_data is required for all
--    register-backed kinds (CH + gas_safe) so we have an audit trail of what
--    the register said at verification time.
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
  );

-- 3. One Gas Safe link per tradesman per registration number. Partial UNIQUE
--    so pre-existing rows (NULL gas_safe_number) don't collide.
CREATE UNIQUE INDEX IF NOT EXISTS uq_tv_tradesman_gas_safe_number
  ON tradesman_verifications (tradesman_id, gas_safe_number)
  WHERE gas_safe_number IS NOT NULL;

-- 4. Fast reverse lookup ("is this Gas Safe number already claimed by another pro?")
CREATE INDEX IF NOT EXISTS idx_tv_gas_safe_number
  ON tradesman_verifications (gas_safe_number)
  WHERE gas_safe_number IS NOT NULL;

-- 5. Public-facing flag on the tradesman row. Flipped to true when an approved
--    gas_safe verification row exists, never auto-revoked (same policy as the
--    other three booleans). Drives the "Gas Safe Registered" badge on listing
--    cards and the public profile page.
ALTER TABLE tradesmen
  ADD COLUMN IF NOT EXISTS gas_safe_verified BOOLEAN NOT NULL DEFAULT FALSE;
