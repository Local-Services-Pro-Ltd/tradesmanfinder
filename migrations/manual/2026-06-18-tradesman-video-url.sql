-- Add an optional video_url column to tradesmen so pros with a brand video
-- (e.g. Keystone London's homepage hero) can feature it on their public
-- profile alongside the existing hero image + gallery.
--
-- Why a dedicated column instead of cramming it into gallery JSON:
--   Gallery is a flat array of image URLs that the profile renders as a
--   carousel. A video has different playback affordances (poster, autoplay-
--   on-scroll, muted-by-default) and only ever appears once per profile.
--   Mixing it into the gallery would force every consumer to sniff URLs
--   for .mp4/.webm and branch the rendering. A nullable text column keeps
--   the model honest: at most one brand video per pro, optional, with the
--   image-only carousel untouched.
--
-- Backwards compatibility: additive. All existing rows get NULL and
-- consumers that don't know about the column ignore it cleanly.

ALTER TABLE tradesmen
  ADD COLUMN IF NOT EXISTS video_url TEXT;
