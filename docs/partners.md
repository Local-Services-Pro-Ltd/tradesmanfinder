# Partner Programme — Operations Guide

## Overview

The Partner Programme lets commercial partners (builders' merchants, EPC providers, insurance, etc.)
purchase placements on TradesmanFinder surfaces. This document covers environment variables,
feature flags, and how to enable the placement engine.

---

## Environment Variables

### `PARTNER_PLACEMENTS_ENABLED`

Controls whether the placement engine is active.

| Value | Behaviour |
|-------|-----------|
| _(unset)_ | Off — `GET /api/placements` returns `{"placements": []}` |
| `"true"` or `"1"` | On — engine runs, placements are served and sampled impressions are logged |

**Do NOT enable in production until PR-P5 (render surfaces) has shipped.**

```bash
# Enable (e.g. in Vercel project settings or .env.local):
PARTNER_PLACEMENTS_ENABLED=true
```

### `PARTNER_IMPRESSION_SAMPLE_RATE`

Fraction of impressions that get an event written to `partner_events`.
Defaults to `"0.1"` (10%). Valid range: `0.0` to `1.0`.

Setting to `"1.0"` logs every impression; setting to `"0"` logs none.
Click-tracking (PR-P6) is always 100% — this flag only affects impressions.

```bash
# Log every impression (useful in staging):
PARTNER_IMPRESSION_SAMPLE_RATE=1.0
```

---

## Placement Engine — How It Works (PR-P4)

### Public endpoint

```
GET /api/placements?surface=<surface>&category=<category_id>&area=<area_id>&limit=<1-3>
```

- **surface** (required) — one of the surface identifiers defined in `PARTNER_SURFACES`
  (e.g. `category_footer`, `area_footer`, `dashboard_sidebar`, etc.)
- **category** — optional integer category id; narrows to placements whose `categoryFilter`
  includes this id (or has an empty filter meaning "all")
- **area** — optional integer area id; same logic as category
- **limit** — 1–3 (default 1, max 3); number of placements to return

Returns:

```json
{
  "placements": [
    {
      "id": 42,
      "partner_id": 7,
      "surface": "category_footer",
      "creative": { "headline": "Get a free EPC quote" },
      "target_url": "https://epcpartner.example.com/?ref=tf",
      "weight": 1,
      "event_id": "f47ac10b-..."
    }
  ]
}
```

`event_id` is a UUID that identifies the impression event (if sampled); `null` if not sampled.
PR-P6 click-tracking will use this id for attribution.

### Admin debug endpoint

```
GET /api/admin/placements/debug?surface=<surface>&category=<id>&area=<id>&limit=<1-3>
```

Requires `x-admin-key` header (or `?key=<ADMIN_KEY>`). Returns a full trace of which
placements were considered, which were filtered out and why, and which were selected.

```json
{
  "surface": "category_footer",
  "category": 3,
  "area": null,
  "considered": [
    { "placement_id": 1, "partner_id": 7, "weight": 1, "status": "selected" },
    { "placement_id": 2, "partner_id": 8, "weight": 1, "status": "filtered", "reason": "inactive partner" }
  ],
  "selected_placement_ids": [1]
}
```

### Ranking algorithm

1. Fetch all placements for the requested surface from the database.
2. Filter client-side: drop placements outside their `activeFrom`/`activeTo` window.
3. Drop placements whose `categoryFilter` excludes the requested category (empty filter = all).
4. Drop placements whose `areaFilter` excludes the requested area (empty filter = all).
5. Drop placements whose partner has `status = 'paused'` or `'terminated'`.
6. Apply weighted random selection using the Efraimidis–Spirakis reservoir algorithm,
   with weight derived from `placement.priority` (lower priority number = higher weight).
7. De-duplicate by partner — a single response never includes two placements from the same partner.
8. Return the top `limit` survivors.

### Impression sampling

For each placement returned, a UUID is generated. With probability
`PARTNER_IMPRESSION_SAMPLE_RATE` (default 10%), an `impression` event is written to
`partner_events` asynchronously (fire-and-forget, non-blocking). The `event_id` field
in the response carries the UUID if sampled, or `null` if not.

---

## Enabling the Feature (Checklist)

1. PR-P5 has merged and render surfaces are live.
2. At least one `partner` row exists with `status = 'active'`.
3. At least one `partner_placements` row exists with the correct `surface` and an
   `activeFrom` in the past (and `activeTo` in the future or null).
4. Set `PARTNER_PLACEMENTS_ENABLED=true` in the Vercel project environment.
5. Verify via `GET /api/placements?surface=<surface>` that placements are returned.
6. Use the admin debug endpoint to confirm the expected partner is being selected.
