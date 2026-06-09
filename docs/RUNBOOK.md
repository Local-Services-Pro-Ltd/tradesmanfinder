# Runbook

Operational playbook for things that go wrong. Each section: **symptom → confirm → fix → root-cause review**.

## Production looks broken (any 5xx surface)

**Symptom:** customer reports homepage white screen, or a `/api/*` route returns 500.

**Confirm:**

```bash
curl -sS -o /dev/null -w '%{http_code}\n' https://tradesmanfinder.com/
curl -sS -o /dev/null -w '%{http_code}\n' https://tradesmanfinder.com/api/stats
```

If either is non-2xx, open *Vercel → Deployments → latest Production → Functions logs*. The Express log line format is `HH:MM:SS [express] METHOD /path STATUS in Nms` — search for the failing path.

**Fix:**

1. If the latest deploy is bad and the previous one was good → **Vercel → Deployments → previous Production → Promote**. Rollback takes ~10 s and serves the prior bundle.
2. If logs show DB errors (`ECONNREFUSED`, `terminating connection`) → see "Supabase outage" below.
3. If logs show a code-level exception, file a Sev-2 issue with the stack trace, then rollback.

**Root-cause review:** within 24 h, post-mortem in the issue. Required for any rollback.

## Stripe webhook failures

**Symptom:** customer paid but credits didn't land; Stripe Dashboard → Webhooks shows red.

**Confirm:**

1. *Stripe Dashboard → Developers → Webhooks → endpoint detail → Recent deliveries*. Look at the failing event's response code and body.
2. *Vercel function logs* — search for the event ID (e.g. `evt_…`). Express logs the path `/api/stripe/webhook`.

**Fix:**

- **400 "signature verification failed"** → `STRIPE_WEBHOOK_SECRET` env var doesn't match the endpoint. Copy the *Signing secret* from the Stripe dashboard, update Vercel env var, redeploy.
- **500 from our handler** → fix the handler, redeploy, then *Stripe → Webhooks → Resend* the failed events. Idempotency keys (composite of `event.id`) must prevent double-crediting on resend.
- **Timeout (>30 s)** → the Vercel function hit its 30 s ceiling. Move heavy work behind a queue (out of scope for v1). For now, retry from the Stripe dashboard.

**Manual grant of credits while debugging:**

```sql
-- Last resort. Replace placeholders.
INSERT INTO credit_transactions (tradesman_id, delta, reason, ref)
VALUES ('<uuid>', 10, 'manual-stripe-recovery', 'evt_…');
UPDATE tradesman_credits SET balance = balance + 10 WHERE tradesman_id = '<uuid>';
```

Log the action in the issue you opened.

## Resend down / emails not arriving

**Symptom:** homeowner posts job, matched pros report no email; or daily Resend status page is red.

**Confirm:**

```bash
curl -sS https://status.resend.com/api/v2/status.json | jq -r '.status.description'
```

Also check `EMAIL_FROM` domain status in Resend → Domains.

**Fix:**

- **Resend reports degraded** → wait. Emails will queue at our side: we log to console, not to a retry table. Manually replay important notifications from the dashboard if needed.
- **`EMAIL_FROM` shows "Not verified"** → re-verify DNS records (SPF + DKIM) in IONOS. After fixing, emails sent during the outage are **lost** — there is no retry job.
- **Single recipient blocked** → check Resend → Suppressions. Remove if it's a false positive.

## Supabase outage / DB unreachable

**Symptom:** logs full of `ECONNREFUSED`, `connection terminated unexpectedly`, or `too many clients`.

**Confirm:**

- *Supabase Dashboard → Project → Logs* → look for restart events.
- `https://status.supabase.com` for region eu-west-2.

**Fix:**

- **Connection limit hit** → we use the pooled URL on port 6543. Confirm `DATABASE_URL` ends in `:6543` on Vercel. If not, fix and redeploy.
- **Region outage** → wait. No multi-region fallback in v1.
- **Local dev only** → restart `postgres` or check the Supabase project hasn't paused (free tier auto-pauses after 7 days idle).

## DB locked / migration partially applied

**Symptom:** `drizzle-kit push` fails mid-way; subsequent boot fails with "relation does not exist" or "column already exists".

**Fix:**

1. Snapshot the DB first: *Supabase → Database → Backups → Create*.
2. Inspect `pg_catalog.pg_tables` and reconcile by hand. Drizzle's `push` is schema-diff based, so re-running often completes safely once you've cleaned up the partial state.
3. If the schema is unrecoverable, restore the last good backup and re-apply migrations.

**Lesson:** versioned migrations (`drizzle-kit generate`) before any schema work bigger than two tables. Push is fine for v1 but stops being fine once #18 + #22 land.

## Deploy stuck

**Symptom:** Vercel shows "Building" for >10 min or "Queued" for >5 min.

**Fix:**

1. *Vercel → Deployments → cancel the stuck deploy*.
2. Trigger a fresh push: empty commit `git commit --allow-empty -m "trigger deploy"` and push.
3. If the build itself is failing (TS errors), `npm run check` locally first. The known `server/routes.ts:657` `tsc` error is not blocking — anything new likely is.

## Domain DNS issue (mini-site returns wrong content)

**Symptom:** `curl -H 'Host: foo.co.uk' https://tradesmanfinder.com/` doesn't serve the mini-site, OR a domain serves the bare homepage.

**Fix:**

1. Confirm domain is in `shared/microsites.ts`.
2. Confirm DNS at the authoritative NS: `dig +short A foo.co.uk @ns…ui-dns.com.` → must be `216.150.1.1`. `dig +short CNAME www.foo.co.uk @ns…` → must be `cname.vercel-dns.com.`
3. Confirm attached to Vercel: `curl -H "Authorization: Bearer $VERCEL_TOKEN" https://api.vercel.com/v10/projects/tradesmanfinder/domains/foo.co.uk?teamId=team_…`
4. If all three are correct, the issue is in `microsite-middleware.ts` — file a bug.

## Useful one-liners

```bash
# How many active leads bought in last 24h
psql "$DATABASE_URL" -c "SELECT count(*) FROM credit_transactions WHERE reason='lead' AND created_at > now() - interval '1 day';"

# Latest production deploy SHA
curl -sS -H "Authorization: Bearer $VERCEL_TOKEN" \
  "https://api.vercel.com/v6/deployments?projectId=prj_y52lp1P5U00IUoliDgdkAf5ZNb7s&teamId=team_g7D9zVbmkQqNfc5dZfMSk6lK&state=READY&limit=1" \
  | jq -r '.deployments[0].meta.githubCommitSha'

# Confirm a domain points at Vercel
ns=$(dig +short NS DOMAIN @1.1.1.1 | head -1); dig +short A DOMAIN @"$ns"
```
