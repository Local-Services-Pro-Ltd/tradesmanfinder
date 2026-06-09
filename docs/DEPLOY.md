# Production deploy

TradesmanFinder runs on **Vercel** (team `localservicespro`, project `tradesmanfinder`) with **Supabase** (Postgres, eu-west-2) as the database. Domains are registered at **IONOS** and have their DNS flipped to Vercel name resolution (apex `216.150.1.1`, www CNAME `cname.vercel-dns.com.`).

## Topology at a glance

```
homeowner / tradesperson browser
              │
              ▼ HTTPS
      ┌───────────────┐
      │   Vercel CDN  │   tradesmanfinder.com + 82 mini-site domains
      └───────┬───────┘
              │
              ▼
      ┌───────────────────────┐
      │ /api/* → api/index.js │   single Node serverless fn (30s, 1GB)
      │   = Express bundle    │
      └───────┬───────────────┘
              │ pg
              ▼
      ┌────────────────────────┐
      │ Supabase Postgres      │   project jqvrelqnfuczxgpiayvg, eu-west-2
      │  (pooled, port 6543)   │
      └────────────────────────┘
```

Static client assets live in `dist/public` and are served by the Vercel CDN. The API surface — including mini-site routing — runs through the single `api/index.js` function per `vercel.json`.

## Branches and auto-deploy

- `main` → **Production** (`tradesmanfinder.com`)
- Any other branch → **Preview** deploy at `tradesmanfinder-git-<branch>-localservicespro.vercel.app`
- Vercel is wired to the GitHub repo via the GitHub App. Pushes auto-deploy.

PRs that touch only `docs/`, `*.md`, or test files don't need manual smoke tests — preview build green is sufficient.

## Environment variables (Vercel UI)

Set every variable from `.env.example` in *Vercel Project → Settings → Environment Variables*. Choose the right scope per variable:

| Variable | Production | Preview | Development |
| --- | --- | --- | --- |
| `DATABASE_URL` | pooled URL (6543) | same | direct URL (5432) locally only |
| `STRIPE_SECRET_KEY` | `sk_live_…` | `sk_test_…` | `sk_test_…` |
| `STRIPE_WEBHOOK_SECRET` | live endpoint | test endpoint | test endpoint |
| `RESEND_API_KEY` | live | live or test mode key | test mode key |
| `ADMIN_KEY` | strong random | strong random | anything |
| `APP_BASE_URL` | `https://tradesmanfinder.com` | preview URL | `http://localhost:5000` |

Vercel encrypts values at rest. Anyone with project-level *Edit Env* permission can rotate; see `docs/SECRETS.md` for the rotation matrix.

After changing env vars you **must redeploy** for them to take effect — the function bundle does not re-read them at runtime.

## Custom domains

The full domain list lives in `shared/microsites.ts` (`MICROSITE_COUNT`). All 83 domains are attached to the `tradesmanfinder` Vercel project. New domain checklist:

1. Add the entry to `shared/microsites.ts` and bump `MICROSITE_COUNT`.
2. Attach to Vercel: `POST https://api.vercel.com/v10/projects/tradesmanfinder/domains?teamId=…` with `{"name":"<host>"}`.
3. In IONOS, set apex `@` A → `216.150.1.1` and `www` CNAME → `cname.vercel-dns.com.` (delete any existing `www` A record first).
4. Verify with `dig +short A <host> @<authoritative-ns>` — public resolvers lag.

## Build and start commands

`vercel.json` already wires them:

- Build: `npm run build` → `tsx script/build.ts` (bundles client to `dist/public`, server to `dist/index.cjs`).
- Output: `dist/public`.
- Serverless function: `api/index.js` (max 30s, 1 GB memory).
- Rewrites: `/api/*`, `/checkout/return`, `/p/c/*`, `/p/o/*` → the function. Everything else → SPA `index.html`.

## Rollback

Two-click rollback in the Vercel dashboard:

1. **Vercel → Deployments**.
2. Find the last green production deploy.
3. *Promote to Production*.

That promotes the existing build — no rebuild required, so it's the fastest path back. For schema rollbacks see `docs/RUNBOOK.md`.

## Smoke checks after a production deploy

Run these from your laptop, not the Vercel dashboard:

```bash
curl -sS https://tradesmanfinder.com/api/stats | jq '.totalTradesmen'
curl -sS -H 'Host: blackheathbuilders.co.uk' https://tradesmanfinder.com/ | grep -i 'blackheath'
curl -sS -o /dev/null -w '%{http_code}\n' https://tradesmanfinder.com/
```

If any of these regress, follow `docs/RUNBOOK.md → "Production looks broken"`.
