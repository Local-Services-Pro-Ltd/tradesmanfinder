# Local development setup

A new engineer should be able to clone, run, and ship a change to prod in under two hours using only this and `docs/DEPLOY.md`.

## Prerequisites

- **Node.js ≥ 20** (Vercel build target). Confirm with `node -v`.
- **npm ≥ 10**. (No `pnpm` / `yarn` lockfiles in the repo.)
- **A Supabase project** (any free-tier instance works for local dev). Postgres ≥ 15.
- **A Resend account** (free tier) — only needed if you're touching lead/outcome email flows. Other code paths run without it.
- **A Stripe account in test mode** — only needed for billing work (#18). Skip until then.

## First-time clone

```bash
git clone https://github.com/Local-Services-Pro-Ltd/tradesmanfinder.git
cd tradesmanfinder
npm install
```

## Environment file

```bash
cp .env.example .env
```

Edit `.env` and fill in at minimum:

- `DATABASE_URL` — the **direct** connection string from Supabase → *Project Settings → Database → Connection string → URI*. Local dev can use the direct (port 5432) URL; production uses the pooled (port 6543) URL.
- `ADMIN_KEY` — anything; the seeded default is `tradesman-admin-2024`.

Everything else has sensible fallbacks for local dev. See `docs/SECRETS.md` for the full inventory.

## Database setup

```bash
npm run db:push
```

This runs `drizzle-kit push` against `DATABASE_URL`, creating every table defined in `shared/schema.ts`. It is idempotent.

To populate the seed data (20 categories, 20 areas, 40 tradesmen, ~395 reviews, demo jobs):

```bash
npx tsx server/seed.ts
```

The seed is safe to re-run; it upserts by slug.

## Run the app

```bash
npm run dev
```

Express + Vite serve on **<http://localhost:5000>** (same port for API + client). Hot-reloads on save.

Useful URLs once running:

- `/` — homepage
- `/#/admin` — admin overview (enter `ADMIN_KEY` to unlock)
- `/#/dashboard` — tradesperson dashboard (demo seed login: `plumsteadplumbingandheatingltd@example.co.uk`)
- `/api/stats` — JSON health-style endpoint

## Mini-site local testing

Mini-site rendering keys off the `Host` header (`server/microsite-middleware.ts`). To preview a mini-site locally, override the host header with `curl`:

```bash
curl -H 'Host: blackheathbuilders.co.uk' http://localhost:5000/
```

Or add an entry to `/etc/hosts` and point a browser at `http://blackheathbuilders.co.uk.localhost:5000`.

## Tests

```bash
npm test                # full vitest suite (server + shared)
npm run test:server     # server tests only (~5s)
npm run check           # tsc --noEmit; pre-existing routes.ts:657 error is known
```

PRs are expected to keep `npm test` green. The `npm run check` failure at `server/routes.ts:657` (review schema `status` field) is a pre-existing issue tracked separately — not a blocker.

## Common gotchas

- **`DATABASE_URL` missing** → server throws on boot (`server/storage.ts:47`). The error names the missing var; check `.env` is in the repo root.
- **`data.db` left over from the old SQLite era** → delete it, no longer used. Postgres via `DATABASE_URL` is the only path.
- **Mini-site middleware matching localhost** → it only matches registered hostnames from `shared/microsites.ts`. `localhost:5000` always renders the main app.
- **Hot reload not picking up `shared/`** → restart `npm run dev`. The watcher misses non-imported files until they're imported.
