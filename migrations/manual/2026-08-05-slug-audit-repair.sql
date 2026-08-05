-- Slug audit + repair + CHECK enforcement (issue #138).
--
-- Audit findings (2026-08-05, prod project jqvrelqnfuczxgpiayvg):
--   * Total rows: 95
--   * NULL or empty slug: 0
--   * Length out of [3..80]: 0
--   * Duplicate slugs: 0
--   * URL-unsafe (fails ^[a-z0-9]+(-[a-z0-9]+)*$): 4
--
-- The 4 URL-unsafe rows are Scottish pre-list rows where the Companies
-- House number suffix retained its uppercase "SC" prefix:
--
--     id=100  atlas-services-solutions-scotland-ltd-SC704009
--     id=101  local-plumbers-glasgow-ltd-SC710080
--     id=102  dc-electrical-scotland-limited-SC731024
--     id=103  nga-eco-solutions-ltd-SC731473
--
-- Root cause: the pre-list seed script (workspace-local, not in this repo)
-- downcased the business-name portion but concatenated raw ch_company_number
-- from the Companies House public-search fallback, which retains the SC
-- prefix uppercase.
--
-- Root-cause fix: the in-repo slugify() at server/routes.ts:204 is correct
-- (it downcases everything). No new pre-list seed uses that seed script;
-- future pre-list ingest goes through slugify() and cannot repeat this bug.
-- The regressed rows are the entire population — a schema-level CHECK
-- would have caught the seed script at import time.
--
-- Impact of the repair: none of the 4 slugs are referenced anywhere in
-- the codebase (grep verified), and none have been claimed yet — /pro/{slug}
-- isn't publicly linked because the public profile page (issue #139) hasn't
-- shipped. No external sitemap or search-engine indexation risk.

BEGIN;

-- Step 1: repair the 4 known rows to lowercase.
-- Written as targeted UPDATE per id to keep the intent explicit and to
-- avoid a table-wide lower(slug) that would touch every row's write log.
UPDATE tradesmen SET slug = lower(slug) WHERE id = 100 AND slug = 'atlas-services-solutions-scotland-ltd-SC704009';
UPDATE tradesmen SET slug = lower(slug) WHERE id = 101 AND slug = 'local-plumbers-glasgow-ltd-SC710080';
UPDATE tradesmen SET slug = lower(slug) WHERE id = 102 AND slug = 'dc-electrical-scotland-limited-SC731024';
UPDATE tradesmen SET slug = lower(slug) WHERE id = 103 AND slug = 'nga-eco-solutions-ltd-SC731473';

-- Step 2: sanity check inside the transaction. If any slug still fails
-- the URL-safe regex, abort so we don't leave the CHECK add half-done.
DO $$
DECLARE
  offender_count INTEGER;
BEGIN
  SELECT COUNT(*) INTO offender_count
    FROM tradesmen
    WHERE slug !~ '^[a-z0-9]+(-[a-z0-9]+)*$';
  IF offender_count > 0 THEN
    RAISE EXCEPTION 'Slug repair incomplete: % rows still fail URL-safe regex', offender_count;
  END IF;
END $$;

-- Step 3: add the schema-level CHECK so this can never happen again.
-- The regex mirrors the one used in server/routes.ts:204 slugify().
ALTER TABLE tradesmen
  DROP CONSTRAINT IF EXISTS tradesmen_slug_url_safe_check;

ALTER TABLE tradesmen
  ADD CONSTRAINT tradesmen_slug_url_safe_check
  CHECK (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$' AND length(slug) BETWEEN 3 AND 80);

COMMIT;
