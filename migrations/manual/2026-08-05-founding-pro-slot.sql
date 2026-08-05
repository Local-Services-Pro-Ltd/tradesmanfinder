-- Add founding_pro_slot to tradesmen (issue #137).
--
-- Purpose: each area (London borough, city) has 10 "Founding Pro" slots
-- reserved for the first 10 pre-list tradesmen who CLAIM their profile
-- (not the first 10 invited — the first 10 to convert). This column
-- records which slot 1..10 a tradesman was awarded.
--
-- Business rules encoded here (schema-level; application also enforces):
--   * Slot is 1..10 inclusive. Enforced by CHECK.
--   * founding_pro (boolean) and founding_pro_slot (integer) must both be
--     set or both be null. Enforced by a composite CHECK so we can never
--     end up with founding_pro=true and slot=null (an "unnumbered"
--     founder) or founding_pro=false and slot=5 (a "phantom" slot).
--   * A given area can have at most one tradesman per slot number.
--     Enforced by a partial UNIQUE index scoped to (area_id, slot) where
--     both are non-null.
--   * Only pre-list rows are eligible for founder status. That is
--     enforced by the application (issue #145) in the atomic claim
--     transaction, not at the schema level, because listing_source can
--     legitimately be updated during data-repair operations and we
--     don't want the schema to block that.
--
-- Backwards compatibility: additive. Existing rows get NULL slot and
-- keep their founding_pro=false default from the earlier migration.
-- No data backfill required — the 42 organic rows are ineligible by
-- policy, and none of the 50 pre-list rows have been claimed yet.
--
-- Index rationale: idx_tradesmen_area already exists on area_id alone.
-- The new partial UNIQUE index on (area_id, founding_pro_slot) is the
-- one that matters for #145 — the founder-slot lookup during claim
-- runs "SELECT MAX(founding_pro_slot) WHERE area_id=$1 AND founding_pro=true"
-- inside a SELECT FOR UPDATE, and the partial UNIQUE guarantees that
-- two concurrent claims can never both write slot=N for the same area.

ALTER TABLE tradesmen
  ADD COLUMN IF NOT EXISTS founding_pro_slot INTEGER;

ALTER TABLE tradesmen
  DROP CONSTRAINT IF EXISTS tradesmen_founding_pro_slot_range_check;

ALTER TABLE tradesmen
  ADD CONSTRAINT tradesmen_founding_pro_slot_range_check
  CHECK (founding_pro_slot IS NULL OR (founding_pro_slot BETWEEN 1 AND 10));

ALTER TABLE tradesmen
  DROP CONSTRAINT IF EXISTS tradesmen_founding_pro_slot_pair_check;

ALTER TABLE tradesmen
  ADD CONSTRAINT tradesmen_founding_pro_slot_pair_check
  CHECK (
    (founding_pro = true  AND founding_pro_slot IS NOT NULL) OR
    (founding_pro = false AND founding_pro_slot IS NULL)
  );

-- Partial UNIQUE: only enforce uniqueness on rows that actually have
-- a slot, so pre-slot NULLs don't collide with each other.
CREATE UNIQUE INDEX IF NOT EXISTS tradesmen_area_founding_slot_unique
  ON tradesmen (area_id, founding_pro_slot)
  WHERE area_id IS NOT NULL AND founding_pro_slot IS NOT NULL;
