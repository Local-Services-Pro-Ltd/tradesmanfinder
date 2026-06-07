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

---

## Click Tracking (PR-P6)

### Click endpoint

```
GET /p/c/:event_id?p=<placement_id>
```

- **Public, no auth required.**
- Logs a `click` event to `partner_events` (idempotency key: `click:<placement_id>:<event_id>`).
- 302-redirects the browser to the partner's `creative_url`.
- The redirect target preserves no additional query params (the `?p=` param stays on the `/p/c/` URL, not the destination).
- If the placement has no `creative_url` → 404.
- If the partner is `paused` or `terminated` → redirect still happens, click not logged.
- If `PARTNER_PLACEMENTS_ENABLED` is off → redirect still happens, click not logged.
- If `:event_id` is not a valid UUID → redirect still happens, click not logged.
- Duplicate clicks (same `event_id` + `placement_id`) are silently absorbed by the unique constraint on `idempotency_key`.

### Client wiring

`<PartnerPlacement>` routes its CTA `href` through `/p/c/…` when `event_id` is present
(i.e. the impression was sampled at the 10% rate). When `event_id` is `null` (unsampled
impression, ~90% of cases), the link goes directly to the partner URL — no click tracking
for those impressions.

### Email wiring

`appendEmailPlacement` in `server/mailer.ts` constructs an absolute URL:
```
https://<PUBLIC_APP_URL>/p/c/<event_id>?p=<placement_id>
```
The environment variable `PUBLIC_APP_URL` (or `PUBLIC_URL`) controls the origin.
Falls back to `https://tradesmanfinder.com`.

---

## Lead Attribution (deferred — PR-P6 API surface only)

### Status

The `logLeadPassed` helper is exported from `server/placement-engine.ts` but is **not yet
wired into any job-acceptance flow**. Wiring is deferred to a future PR once the
lead-from-partner attribution design is finalised.

### API surface

```ts
import { logLeadPassed } from "./placement-engine";

await logLeadPassed(
  {
    placement_id: 42,
    partner_id: 7,
    job_id: 1234,
    event_id: "f47ac10b-58cc-4372-a567-0e02b2c3d479", // impression UUID or fresh UUID
  },
  storage,
);
```

This logs a `lead_passed` event to `partner_events`. The `event_id` should be the
impression UUID if it is available (carried through from the original placement response);
otherwise pass `crypto.randomUUID()`.

### Attribution flow (future)

The intended wiring point is when a tradesman accepts a job whose lead email contained a
`?eid=<uuid>` query param (embedded by `appendEmailPlacement` in PR-P5). The eid needs
to be stored on the job at lead-creation time, and then passed to `logLeadPassed` when
the job transitions to "accepted". This design is not implemented yet.
