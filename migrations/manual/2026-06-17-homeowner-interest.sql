-- Homeowner interest signups for boroughs/categories with low pro density.
--
-- Purpose: when an area has < N verified pros, the landing page swaps the
-- search experience for a "we're still onboarding pros — notify me when
-- ready" form. This table captures those signups so we can:
--   1. Notify homeowners when supply crosses the threshold.
--   2. Prove demand to prospective Founding Pros ("12 homeowners already
--      waiting in Lewisham").
--   3. Prioritise outreach into the highest-demand boroughs.
--
-- Idempotent via UNIQUE(email, area_id, category_id) — re-submission updates
-- the row's `updated_at` and `source` but doesn't duplicate.

CREATE TABLE IF NOT EXISTS homeowner_interest (
  id              SERIAL PRIMARY KEY,
  email           TEXT NOT NULL,      -- lowercased before insert
  postcode        TEXT,               -- optional, UK format (e.g. "SE13 6AA"); uppercased before insert
  area_id         INTEGER,            -- references areas(id); nullable when postcode given but no matching area
  category_id    INTEGER,             -- references categories(id); nullable means "any trade"
  source          TEXT NOT NULL DEFAULT 'area_landing', -- 'area_landing' | 'category_landing' | 'footer' | 'manual'
  notified_at     BIGINT,             -- epoch ms — set when we send the launch email
  created_at      BIGINT NOT NULL,
  updated_at      BIGINT NOT NULL
);

-- Idempotency: one row per (email, area, category) combination.
-- COALESCE collapses NULL category_id to -1 so the unique constraint catches
-- duplicates where category is "any trade" (NULL).
CREATE UNIQUE INDEX IF NOT EXISTS uq_homeowner_interest_dedupe
  ON homeowner_interest (email, COALESCE(area_id, -1), COALESCE(category_id, -1));

CREATE INDEX IF NOT EXISTS idx_homeowner_interest_area
  ON homeowner_interest (area_id);

CREATE INDEX IF NOT EXISTS idx_homeowner_interest_notified
  ON homeowner_interest (notified_at) WHERE notified_at IS NULL;
