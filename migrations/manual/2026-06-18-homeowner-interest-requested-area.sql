-- HOMEOWNER INTEREST — capture free-text "requested area" for unmatched searches.
--
-- When a homeowner types a borough/postcode/locality that doesn't exist in our
-- `areas` table, we still want to capture the demand signal. This column
-- stores the typed string verbatim (normalised: lowercased, trimmed). It's
-- only populated when area_id IS NULL.
--
-- The existing UNIQUE(email, COALESCE(area_id,-1), COALESCE(category_id,-1))
-- index still de-dupes within the same area/category. To also de-dupe across
-- the same (email, requested_area) we add a partial unique index that only
-- fires when area_id IS NULL and requested_area IS NOT NULL.

ALTER TABLE homeowner_interest
  ADD COLUMN IF NOT EXISTS requested_area TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS uq_homeowner_interest_requested_area
  ON homeowner_interest (email, requested_area)
  WHERE area_id IS NULL AND requested_area IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_homeowner_interest_requested_area
  ON homeowner_interest (requested_area)
  WHERE requested_area IS NOT NULL;
