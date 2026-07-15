-- Add 5 London borough rows to `areas` so Founding Pro pilot tradesmen
-- in West / South West / Central London can be assigned an area_id.
--
-- Why: tradesmen.area_id is integer notNull and the current `areas` table
-- only contains London neighbourhoods (Battersea, Brixton, Dulwich, etc.).
-- The first Founding Pro signup (Keystone London, K&C) cannot be inserted
-- without a borough-level row. Multi-area coverage is a known schema gap
-- tracked separately (join table tradesman_areas).
--
-- Apply via Supabase MCP execute_sql (data-only INSERTs, idempotent via
-- ON CONFLICT on the unique slug).
--
-- Centroids (lat,lng) sourced from each borough council's published
-- coordinates / Ordnance Survey gazetteer.

INSERT INTO areas (slug, name, region, latitude, longitude) VALUES
  ('kensington-and-chelsea', 'Kensington and Chelsea', 'London SW3',  51.4990, -0.1938),
  ('westminster',            'Westminster',             'London SW1',  51.4975, -0.1357),
  ('wandsworth',             'Wandsworth',              'London SW18', 51.4571, -0.1818),
  ('hammersmith-and-fulham', 'Hammersmith and Fulham',  'London W6',   51.4927, -0.2229),
  ('lambeth',                'Lambeth',                 'London SE11', 51.4900, -0.1200)
ON CONFLICT (slug) DO NOTHING;
