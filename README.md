# TradesmanFinder

> Find a trusted local tradesman — a UK tradesman directory & lead-generation marketplace, modelled on Service.com.au.

TradesmanFinder is a production-grade fullstack MVP that connects UK homeowners with verified local
tradespeople (builders, plumbers, electricians, and 17 other trades). Homeowners post a job for free and
receive quotes; tradespeople buy lead credits to respond. The platform also powers a network of
hyper-local SEO mini-sites (see the companion `minisite-template` project).

## Stack

- **Frontend:** React + Vite + Tailwind CSS v3 + shadcn/ui, hash-based routing via `wouter`
- **Backend:** Express (single port, dev + prod)
- **Database:** SQLite (`better-sqlite3`) + Drizzle ORM — file `data.db`, created and seeded on first run
- **Data fetching:** TanStack Query v5 through a shared `apiRequest` helper (`client/src/lib/queryClient.ts`)
- **Type sharing:** `shared/schema.ts` is the single source of truth for both client and server

## Brand

- **Tagline:** "Find a trusted local tradesman"
- **Palette:** deep navy/charcoal `#0F2A44` primary, warm amber/orange accent for CTAs, off-white surfaces
- **Type:** Inter (body), Manrope semibold (display)
- **Dark mode:** fully supported (toggle in the nav; seeded from `prefers-color-scheme`)

## Running locally

```bash
npm install
npm run dev          # Express + Vite on http://localhost:5000
```

The dev server serves the API and the React app on the same port (5000). On first boot the SQLite
database `data.db` is created and seeded automatically.

### Production build

```bash
npm run build                              # bundles client (dist/public) + server (dist/index.cjs)
NODE_ENV=production node dist/index.cjs    # serves on port 5000
```

## Data model (`shared/schema.ts`)

Eight tables: `categories`, `areas`, `tradesmen`, `jobs`, `quotes`, `reviews`,
`credit_transactions`, `tradesman_credits`.

> SQLite has no array type. List fields (e.g. a tradesman's trades/areas) are stored as JSON text
> columns and parsed in application code via `parseJsonArray` in `client/src/lib/api-types.ts`.

## API surface (`server/routes.ts`)

| Method | Route | Purpose |
| --- | --- | --- |
| GET | `/api/categories`, `/api/categories/:slug` | Trade categories |
| GET | `/api/areas`, `/api/areas/:slug` | Service areas |
| GET | `/api/tradesmen`, `/api/tradesmen/:id`, `/api/tradesmen/by-slug/:slug` | Directory listings & profiles |
| GET | `/api/tradesmen/login/:email` | Email-based pseudo-login for the dashboard |
| POST | `/api/tradesmen` | Tradesman signup (starts unverified with 3 welcome credits) |
| POST | `/api/jobs` | Post a job — returns `{ job, matched: [...] }` (up to 3 matched pros) |
| GET | `/api/jobs/:id` | Job detail |
| POST | `/api/quotes`, GET `/api/quotes` | Quotes/leads |
| POST | `/api/reviews` | Reviews |
| GET | `/api/dashboard/:tradesmanId` | Leads, credits, transactions, reviews for a tradesman |
| POST | `/api/credits/buy` | Buy a lead-credit pack |
| GET | `/api/stats` | Homepage trust stats |
| GET | `/api/admin/overview?key=...` | Admin dashboard (guarded) |
| POST | `/api/admin/tradesmen/:id/verify?key=...` | Verify a tradesman |
| POST | `/api/admin/tradesmen/:id/feature?key=...` | Feature/unfeature a tradesman |

## Pages (16 routes)

Home, All trades, Category, Area, Hyper-local (`/category/:catSlug/in/:areaSlug`), Tradesman profile,
Post a Job (4-step wizard), For Tradesmen (pricing), Join (signup), Dashboard, Admin, and the static
pages About / Contact / Terms / Privacy / FAQ.

## Editing seed data & admin access

- **Seed data:** `server/seed.ts` defines the 20 categories, 20 areas, 40 tradesmen, ~395 reviews and
  the demo jobs. To re-seed, delete `data.db` and restart (`rm data.db && npm run dev`).
- **Admin key:** the admin overview is guarded by a static key. Default: `tradesman-admin-2024`
  (search `server/routes.ts` for `ADMIN_KEY`). Visit `/#/admin`, enter the key to unlock.
  **Replace this with a real auth check before production.**
- **Dashboard demo login:** `/#/dashboard`, use the demo seed email
  `plumsteadplumbingandheatingltd@example.co.uk` (or pass `?id=<tradesmanId>` in the hash).

## Migrating SQLite → Supabase (Postgres)

The app uses Drizzle, so switching to Supabase/Postgres is mostly a driver swap:

1. Create a Supabase project and copy the connection string.
2. `npm install postgres drizzle-orm` (the `postgres` driver), and remove `better-sqlite3`.
3. In `shared/schema.ts`, change `sqliteTable` → `pgTable` and column helpers
   (`integer`/`text` → `serial`/`text`/`timestamp` as appropriate). Convert the JSON-text list columns
   to native `jsonb` if you prefer (then drop the `parseJsonArray` calls).
4. In `server/storage.ts`, replace the `better-sqlite3` Drizzle client with
   `drizzle(postgres(process.env.DATABASE_URL))`. Note Postgres queries are async — add `await` and
   change `.get()/.all()/.run()` to the Postgres equivalents (`.then(rows => rows[0])` / array results).
5. Run `drizzle-kit push` against the new database, then port `server/seed.ts`.
6. (Optional) Use Supabase Auth instead of the email pseudo-login below.

See `skills/website-building/webapp/references/supabase.md` for the database-only Supabase setup.

## TODO before production

**Payments (Stripe)** — credit purchases are currently recorded directly in the DB with no real charge.
- [ ] Add Stripe Checkout / Payment Intents on the "Buy credits" and "Featured listing" flows
- [ ] Create products/prices for the three lead packs (£25 / £45 / £80) and Featured (£29/mo)
- [ ] Add a Stripe webhook endpoint to grant credits only after `payment_intent.succeeded`
- [ ] Store `stripeCustomerId` on the tradesman record

**Real authentication** — the dashboard uses an email lookup and the admin a static key (no sessions).
- [ ] Add password or magic-link auth (Supabase Auth or Lucia/Auth.js) for tradesmen
- [ ] Protect admin routes with a real role check + session, replacing the static `ADMIN_KEY`
- [ ] Add CSRF protection and rate limiting on POST endpoints

**Other**
- [ ] Replace seed reviews with a moderated review-submission flow tied to completed jobs
- [ ] Email/SMS notifications when a job is matched (the matching logic already returns the pros)
- [ ] Image uploads for tradesman portfolios (currently uses generated section imagery)

## Production deploy notes

- Build then run `node dist/index.cjs` behind a process manager (PM2/systemd) or a container.
- `data.db` must live on a persistent volume — it is git-ignored.
- Set `ADMIN_KEY` (and Stripe/Supabase secrets) via environment variables, never commit them.
- The static client is in `dist/public`; the Express server serves it and proxies `/api/*`.

## Project layout

```
shared/schema.ts        # data model + zod insert schemas (source of truth)
server/                 # index.ts, routes.ts, storage.ts, seed.ts, vite.ts
client/src/
  lib/                  # queryClient.ts (apiRequest), api-types.ts (client types + helpers)
  components/           # brand.tsx, theme.tsx, layout.tsx, tradesman-card.tsx, search-bar.tsx, ...
  pages/                # all 16 route pages + static-pages.tsx
  App.tsx               # routes wrapped in <Router hook={useHashLocation}> + ThemeProvider
```


<!-- Deploy trigger: 2026-06-05 — connect Git auto-deploy & ship footer rebrand to Local Services Pro Ltd. -->
