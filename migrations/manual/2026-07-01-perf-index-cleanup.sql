-- 2026-07-01 — Performance advisor cleanup
--
-- 1. Drop duplicate unique index on founding_pro_invites(ref).
--    founding_pro_invites_ref_key (from UNIQUE constraint) and idx_fpi_ref
--    are identical. Keep the constraint-backed one; drop the redundant one.
--
-- 2. Add covering index for partner_enquiries.promoted_partner_id FK.
--    Advisor flagged this as unindexed_foreign_keys.

BEGIN;

DROP INDEX IF EXISTS public.idx_fpi_ref;

CREATE INDEX IF NOT EXISTS idx_partner_enquiries_promoted_partner_id
  ON public.partner_enquiries (promoted_partner_id);

COMMIT;
