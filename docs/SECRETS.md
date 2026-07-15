# Secrets and environment variables

The canonical list of every env var the app reads, where it's stored, who can rotate it, and what breaks if it's wrong. See `.env.example` for the developer-facing copy with default placeholders.

## Storage locations

| Where | What lives there |
| --- | --- |
| **Vercel → Project → Settings → Environment Variables** | All runtime secrets for production + preview |
| **Local `.env`** | Developer copies for `npm run dev` — gitignored |
| **Supabase Dashboard → Project Settings** | Database connection strings, service role key |
| **Stripe Dashboard → Developers** | Stripe keys, webhook signing secrets |
| **Resend Dashboard → API Keys** | Resend API keys + sender domain records |
| **IONOS Domain Control Panel** | DNS records (SPF/DKIM/DMARC), domain renewal billing |

## Variable inventory

| Variable | Required | Used in | If wrong / missing | Rotation owner |
| --- | --- | --- | --- | --- |
| `DATABASE_URL` | yes | server boot | Server throws at startup (`server/storage.ts:47`); 100% downtime | Steve (Supabase) |
| `ADMIN_KEY` | yes | `/api/admin/*` | Admin endpoints unauthorised — non-admin surfaces unaffected | Steve |
| `RESEND_API_KEY` | recommended | `server/mailer.ts`, outcome emails | Email sends throw caught errors; jobs still match but pros don't get notified | Steve (Resend) |
| `RESEND_WEBHOOK_SECRET` | recommended | `server/resend-webhook.ts` (Svix signature verify) | Handler returns 500 on every event; delivery status never updates in `email_log`. Set when adding the endpoint in the Resend dashboard. | Steve (Resend) |
| `EMAIL_FROM` | required when Resend is used | `mailer.ts` | Resend rejects send with "domain not verified" | Steve |
| `SUPPORT_EMAIL` | optional | email footers | Falls back to `EMAIL_FROM` | Steve |
| `PARTNER_NOTIFICATION_EMAIL` | optional | partner outreach replies | Replies bounce; outbound unaffected | Steve |
| `APP_BASE_URL` / `PUBLIC_APP_URL` / `PUBLIC_URL` | yes (prod) | absolute URLs in emails, OG tags, sitemaps | Email links + OG previews point to wrong host | Steve |
| `PORT` | optional | server boot | Defaults to 5000 | n/a |
| `STRIPE_SECRET_KEY` | required for #18 | Stripe SDK calls | Checkout sessions fail to create | Steve (Stripe) |
| `STRIPE_WEBHOOK_SECRET` | required for #18 | webhook signature verification | All webhook events 400 "signature verification failed" | Steve (Stripe) |
| `STRIPE_PRICE_LEAD_PACK_STARTER` / `_STANDARD` / `_PRO` | required for #18 | Checkout session line items | Buy-credit flow fails with "price not found" | Steve |
| `STRIPE_PRICE_FEATURED_MONTHLY` | required for #18 | featured-listing subscription | Featured upsell fails to start subscription | Steve |
| `VITE_STRIPE_PRICE_LEAD_PACK_*` | required for #18 (client) | Vite inlines into client bundle | Buy-credit UI can't open the right Checkout session | Steve |
| `VITE_STRIPE_PRICE_FEATURED_MONTHLY` | required for #18 (client) | Vite inlines into client bundle for dashboard Featured CTA | Featured upsell button is disabled | Steve |
| `PARTNER_IMPRESSION_SAMPLE_RATE` | optional | `placement-engine.ts` | Defaults to 10 (sample 1-in-10) | Steve |
| `PARTNER_OUTCOME_SECRET` | required when partner emails go out | `outcome-tokens.ts` HMAC | Outcome links 401; cannot capture outcomes | Steve |
| `PARTNER_PLACEMENTS_ENABLED` | optional kill-switch | `placements-api.ts` | Set to `false` to disable all partner surfaces in seconds | Steve |
| `NODE_ENV` | yes | Express, Vite | Wrong mode disables minification or enables dev middleware in prod | Vercel sets automatically |

## Rotation procedure

1. **Generate** the new secret at the source (Stripe dashboard, Resend, Supabase, etc.).
2. **Update Vercel** *Environment Variables* — set the new value for Production. Leave the previous one for Preview if you want a soak period.
3. **Redeploy production** — the function bundle does not re-read env vars at runtime.
4. **Verify** the smoke checks in `docs/DEPLOY.md → "Smoke checks after a production deploy"`.
5. **Revoke** the old secret at the source.
6. **Document** the rotation in the relevant issue or a short note in the engineering channel.

### Stripe-specific rotation gotcha

`STRIPE_WEBHOOK_SECRET` is tied to a specific webhook endpoint in the Stripe dashboard. If you rotate the secret without also rotating the *endpoint*, both endpoints share the same secret — which is fine. If you create a **new endpoint** for a new environment, it gets its own secret.

### Resend-specific rotation gotcha

Resend API keys are scoped (sending vs full access). Rotate to a new key of the **same scope**, otherwise unrelated code paths (domain management, suppressions) silently start returning 403.

## Things that look like secrets but aren't

- `ADMIN_KEY` is a static guard, not auth. Treat it as a stopgap. Replacing it with real auth (Lucia / Supabase Auth) is on the README's "TODO before production" list.
- `STRIPE_PRICE_*` IDs aren't sensitive — they're product references safe to expose in client bundles. They're listed here to keep the inventory complete, not because they need hiding.
- The seed admin email `plumsteadplumbingandheatingltd@example.co.uk` is fixed in `server/seed.ts`. Treat as fictional demo data; do not associate with the real Plumstead Plumbing business.

## What to do on suspected leak

1. **Rotate immediately** at the source — don't wait for a code change.
2. **Audit Stripe / Supabase / Resend logs** for usage from unknown IPs in the last 24 h.
3. **File a Sev-1 issue** with the rotation timestamp and any anomalies.
4. **Force redeploy** to invalidate any leaked bundle that might contain a baked-in `VITE_*` value.
