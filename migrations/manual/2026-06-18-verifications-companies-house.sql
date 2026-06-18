-- Extend tradesman_verifications to support Companies House lookups as evidence.
--
-- Today the table is purpose-built for document uploads (insurance certs,
-- qualifications) — file_path/file_mime_type/file_size_bytes are all NOT NULL.
-- We're adding a third evidence kind, 'companies_house', whose evidence is a
-- live API lookup against the official UK register, not a file upload. So
-- the file columns need to become nullable, gated on `kind`.
--
-- Why this matters:
--   35 of 41 tradesmen are currently marked verified=true with ZERO rows in
--   tradesman_verifications. The verified badge is a lie. This migration is
--   the schema foundation for the route handlers (PR-A) and submission UI
--   (PR-C) that will let pros submit a Companies House number and have the
--   verification recorded with real evidence.
--
-- Why a JSONB blob for the evidence payload:
--   The CH /company/{number} response has ~30 fields. We render maybe 6 in
--   the badge UI today (name, status, registered address, SIC codes,
--   incorporation date). Storing the full payload as JSONB lets us evolve
--   the UI without re-fetching, plus gives us an audit trail of what the
--   register said at verification time (companies can change status later).
--
-- Why a separate company_number column instead of pulling from JSONB:
--   We want a UNIQUE constraint (one tradesman per CH number) and an index
--   for cheap lookups. JSONB extraction in indexes is ugly. Cheap to have
--   a dedicated TEXT column.
--
-- Backwards compatibility: all changes are additive. Existing 'insurance'
-- and 'qualification' rows continue to work — they always provide file
-- columns, so the new check constraint that requires file columns for
-- those kinds is satisfied automatically.

-- 1. Make file columns nullable. They're still required for file-backed
--    evidence kinds — see the kind-aware check constraint below.
ALTER TABLE tradesman_verifications
  ALTER COLUMN file_path        DROP NOT NULL,
  ALTER COLUMN file_mime_type   DROP NOT NULL,
  ALTER COLUMN file_size_bytes  DROP NOT NULL;

-- 2. New columns for Companies House evidence.
ALTER TABLE tradesman_verifications
  ADD COLUMN IF NOT EXISTS company_number  TEXT,        -- normalised (uppercase, no whitespace)
  ADD COLUMN IF NOT EXISTS evidence_data   JSONB,       -- raw CH /company/{number} response, trimmed
  ADD COLUMN IF NOT EXISTS verified_at     BIGINT,      -- epoch ms when the CH lookup succeeded (auto-set on insert for kind='companies_house')
  ADD COLUMN IF NOT EXISTS source          TEXT;        -- 'pro_submission' | 'admin_backfill' | 'automated_recheck'

-- 3. Kind-aware integrity: file kinds need file columns; CH kind needs CH columns.
--    Existing rows (kind in 'insurance','qualification', file_path populated)
--    pass automatically. The constraint is forward-looking.
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
  );

-- 4. One CH link per tradesman per company. Partial UNIQUE so pre-existing
--    file-evidence rows (NULL company_number) don't collide.
CREATE UNIQUE INDEX IF NOT EXISTS uq_tv_tradesman_company_number
  ON tradesman_verifications (tradesman_id, company_number)
  WHERE company_number IS NOT NULL;

-- 5. Fast badge-rendering lookup: "does this tradesman have any approved evidence?"
CREATE INDEX IF NOT EXISTS idx_tv_tradesman_status
  ON tradesman_verifications (tradesman_id, status)
  WHERE status = 'approved';

-- 6. Fast CH-number reverse lookup (e.g. "is this CH number already claimed by another pro?").
CREATE INDEX IF NOT EXISTS idx_tv_company_number
  ON tradesman_verifications (company_number)
  WHERE company_number IS NOT NULL;
