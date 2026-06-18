-- Add scope_badges to tradesmen so we can surface what a pro is *authorised
-- to do*, separately from the generic trust badges (verified / insured /
-- licensed). Scope badges are register-specific: a Gas Safe registered pro
-- gets 'Gas Work', an MCS-certified renewables installer gets 'Renewables',
-- and a multi-register pro gets both.
--
-- Why a JSON array column instead of a join table:
--   Scope badges are flat strings rendered as pills on the pro card and
--   public profile. They're derived from the union of approved register
--   evidence rows (see shared/register-implications.ts). A JOIN would be
--   read-amplifying on the listings page where we're already pulling
--   tradesmen by area — keeping the denormalised list on the row matches
--   how gallery and categories are stored.
--
-- Backwards compatibility: additive, defaults to '[]', existing consumers
-- ignore the field cleanly.

ALTER TABLE tradesmen
  ADD COLUMN IF NOT EXISTS scope_badges TEXT NOT NULL DEFAULT '[]';
