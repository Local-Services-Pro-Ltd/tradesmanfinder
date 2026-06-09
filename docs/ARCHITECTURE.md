# Architecture

This document is the mental model someone needs to debug, extend, or hand off TradesmanFinder. It deliberately avoids restating package versions — see `package.json`.

## One-paragraph summary

A single Express server (deployed as one Vercel serverless function) serves both a React SPA bundled by Vite **and** a JSON API. The Express layer also resolves the request's `Host` header against a registry of 83 mini-site domains and rewrites/serves alternate content for them. Data lives in a Supabase Postgres instance accessed via Drizzle ORM, with `shared/schema.ts` as the single source of truth shared by client and server.

## Component map

```
                                ┌──────────────────────────────┐
                                │       React SPA (Vite)       │
                                │  client/src/{pages,components}│
                                │  Hash router (wouter)        │
                                └────────────┬─────────────────┘
                                             │ fetch via apiRequest
                                             ▼
┌──────────────────────────┐   ┌──────────────────────────────────────┐
│  micrositeMiddleware     │ → │              Express                  │
│  (Host header lookup)    │   │   server/{index,routes,…}.ts          │
│  shared/microsites.ts    │   │   • REST API (/api/*)                 │
└──────────────────────────┘   │   • Mini-site HTML injection          │
                                │   • Partner click/outcome endpoints   │
                                │   • SPA fallback                       │
                                └────────────┬──────────────────────────┘
                                             │ Drizzle
                                             ▼
                                ┌──────────────────────────────┐
                                │   Supabase Postgres          │
                                │   shared/schema.ts is truth  │
                                └──────────────────────────────┘
                                             ▲
                                             │ outbound
                                ┌────────────┴─────────────┐
                                │ Resend (transactional    │
                                │  email)                  │
                                └──────────────────────────┘
```

## Layers and where each lives

| Layer | Code | Notes |
| --- | --- | --- |
| Static assets | `client/public/`, `dist/public/` after build | Served by Vercel CDN |
| React SPA | `client/src/` | Pages under `pages/`, shared logic in `lib/`, shared types from `shared/schema.ts` |
| API helper | `client/src/lib/queryClient.ts` | `apiRequest` wraps `fetch` + TanStack Query |
| Mini-site host resolution | `server/microsite-middleware.ts` | Runs **before** API + SPA; sets `req.microsite` |
| HTTP API | `server/routes.ts` + topic files (`microsite-routes`, `partners-admin`, `placement-engine`, etc.) | Single Express app |
| Mini-site SPA injection | `server/microsite-spa.ts` + `microsite-seo.ts` | Rewrites the SPA HTML to inject mini-site-specific title/meta |
| Persistence | `server/storage.ts` | One `postgres-js` client + Drizzle instance, exported as `db` |
| Schema + types | `shared/schema.ts` | Source of truth; both client and server import from here |
| Migrations | `drizzle-kit push` (no `migrations/` dir) | Push-based for now; switch to `generate` + versioned migrations once Stripe + Partner schemas land |

## Key data flows

### 1. Homeowner posts a job → matched pros

1. `POST /api/jobs` validated by zod insert schema from `shared/schema.ts`.
2. `server/routes.ts` writes the job, then runs the matcher (category + area + active tradesmen).
3. Up to 3 matched pros are returned in the response **and** notified by Resend (`server/mailer.ts`).
4. Each pro lands on `/#/dashboard?id=…` and can buy a lead credit to reveal the homeowner's contact details.

### 2. Mini-site request

1. Vercel CDN forwards the request to `api/index.js` (matching `vercel.json` rewrites) or static asset.
2. Express `micrositeMiddleware` runs first. It reads `req.hostname`, normalises (`www.` stripped), and looks up in `shared/microsites.ts`. On hit, `req.microsite` is set.
3. If the request is for the SPA HTML, `microsite-spa.ts` intercepts the response stream and rewrites `<title>` / `<meta>` per the mini-site config.
4. If the request is for `/api/*`, downstream handlers can read `req.microsite` for source attribution (which mini-site sent the lead).

### 3. Partner click + outcome (existing infra)

1. Outbound link in a partner-served surface points to `/p/c/<event_id>` (signed).
2. `click-tracking.ts` records the click in `partner_events`, then 302s to the real destination.
3. After lead delivery, a one-click outcome email arrives at the partner with `/p/o/<token>?outcome=…` links (`outcome-tokens.ts`, `outcome-capture.ts`). Tokens are HMAC-signed with `PARTNER_OUTCOME_SECRET`.

## Conventions worth knowing

- **Single Express app, multiple route registrants.** `server/routes.ts` calls `registerRoutes(app)`; topic files (mini-sites, partners) expose their own `register*Routes(app)` and are wired in `server/index.ts`. Each topic owns its tests next to it (`*.test.ts`).
- **Idempotency by composite keys.** Partner events use `(partner_id, job_id, event_type)` as the idempotency anchor. The same pattern will apply to Stripe webhook handlers (#18).
- **Type sharing is non-negotiable.** Both sides import from `shared/schema.ts`. Don't redeclare a `Tradesman` shape on the client — adjust the schema.
- **Mini-site registry is alphabetised** and protected by `shared/microsites.test.ts` (21 invariants including unique hostnames, count parity, and per-kind counts).
- **Hash routing.** `wouter`'s `useHashLocation` keeps the SPA behind a single rewrite rule (`/((?!api/|p/c/|p/o/|assets/|.*\.[a-zA-Z0-9]+$).*)` → `index.html`). In-page anchor scrolls don't change the location and so don't trigger the new `ScrollToTop` component (PR #55).

## What is *not* yet built

These are tracked elsewhere — don't assume they exist when reading the code:

- Real auth. Dashboard is email-lookup only; admin is a static key.
- Real billing. `/api/credits/buy` records credits with no charge. See issue #18 + `docs/RUNBOOK.md`.
- SEO landing pages. The runtime route `/category/:catSlug/in/:areaSlug` works; prerender + sitemap don't. See issue #19.
- Partner Programme schemas are partially in place (`partner_events`, click/outcome) but `partners`, `partner_placements`, `partner_invoices` tables are not. See issue #22.
