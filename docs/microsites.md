# Mini-Site Programme

TradesmanFinder operates **81 mini-site domains** as a hyper-local SEO surface. They all point at the main TradesmanFinder app — the server resolves each request's `Host` header against a typed registry and renders a host-specific landing page with its own `<title>`, meta, canonical, JSON-LD, sitemap, and robots.

## Why one app, not 81

Running 81 separate Vercel projects (or 81 separate repos) would multiply build minutes, secrets, and review surface for zero functional benefit. The mini-sites differ only in copy + SEO; the underlying data (categories, areas, tradesmen, jobs) is shared. We attach all 81 domains to the same Vercel project (`tradesmanfinder`) and discriminate per-request via middleware.

## Registry shape

The single source of truth is `shared/microsites.ts`. Each entry is keyed by lowercase hostname (no protocol, no port):

```ts
type Microsite = {
  host: string;           // lowercase, e.g. 'blackheathbuilders.co.uk'
  kind: 'geo-trade' | 'generic-directory' | 'vertical' | 'redirect';
  trade?: string;         // DB category slug (matches /api/categories)
  area?: string;          // DB area slug (matches /api/areas)
  vertical?: string;      // vertical sites only
  title?: string;         // override for vertical
  leadTrade?: string;     // vertical sites' default lead trade
  canonical?: string;     // duplicate-canonical (other host 301s to this)
  redirectTo?: string;    // redirect kind only — full HTTPS URL
};
```

Counts (enforced by `shared/microsites.test.ts`):

| Kind | Count | Behaviour |
|---|---|---|
| `geo-trade` | 55 | Renders mini-site page with trade + area copy |
| `generic-directory` | 20 | Renders mini-site page with national trade copy |
| `vertical` | 3 | Renders mini-site page with custom title |
| `redirect` | 3 | 301s to `redirectTo` (no content served) |

`MICROSITE_COUNT = 81`.

## Request flow

```
Request → micrositeMiddleware ─┬─→ kind===redirect ? 301 to redirectTo
                               ├─→ canonical set?    301 to canonical (pages only)
                               └─→ attach req.microsite, next()

                               ↓
                    /api/* handlers (POST /api/jobs uses
                    req.microsite to attribute source)

                               ↓
                    registerMicrositeRoutes:
                      /robots.txt → per-host robots
                      /sitemap.xml → single-URL XML

                               ↓
                    registerMicrositeSpa:
                      catch-all HTML → load index.html,
                      inject SEO + window.__MICROSITE__,
                      send

                               ↓
                    serveStatic (assets only — HTML is consumed above)
```

The middleware mounts in `server/index.ts` **before** `registerRoutes`, so API handlers see `req.microsite`. The SEO injector mounts **before** `serveStatic` (production only) so it gets first crack at HTML requests.

## Adding a new site

1. Register the domain at IONOS (or wherever).
2. Add an entry to `MICROSITES` in `shared/microsites.ts`.
3. If it's a `geo-trade` entry, ensure the trade slug exists in `/api/categories` and the area slug exists in `/api/areas`. If the area is missing, add it via a Supabase `apply_migration` seed (idempotent `INSERT … ON CONFLICT (slug) DO NOTHING`).
4. Update the snapshot constants in `shared/microsites.test.ts` (`DB_TRADES`, `DB_AREAS`) so the registry test still passes.
5. Add the domain to Vercel: `vercel domains add <host> --project tradesmanfinder` (or via the dashboard).
6. Open a PR. CI runs the registry tests which catch typos in trade/area slugs before they reach prod.

## IONOS DNS

All 81 domains are at IONOS. For each host, set:

```
@   A    76.76.21.21        (Vercel's anycast)
www CNAME cname.vercel-dns.com.
```

Vercel automatically issues a Let's Encrypt cert when the domain is attached and DNS resolves.

For the 3 redirect-kind hosts (ikeahandyman.co.uk, screwfixhandyman.co.uk, wickeshandyman.co.uk), the same DNS is used — the redirect happens at the application layer rather than at DNS — so a single misconfiguration window won't expose un-redirected content.

## Brand-piggyback (redirect-kind) policy

Three domains in the portfolio reference third-party brands: `ikeahandyman.co.uk`, `screwfixhandyman.co.uk`, `wickeshandyman.co.uk`. Hosting content on these domains creates trademark exposure.

**Policy:** these hosts 301 to `https://tradesmanfinder.com` for every path (handled by `micrositeMiddleware`). No content is served, no sitemap is advertised, no robots.txt is published. The redirect preserves the request path so deep-links remain usable on the canonical site. If any of the trademark owners ever objects, we transfer/release the domain without losing application traffic.

If you ever consider serving content on a brand-piggyback domain, **stop and consult legal first.**

## Source attribution

`POST /api/jobs` writes `source = 'microsite:<host>'` for any lead coming from a mini-site host, and `source = 'web'` for everyone else. The value is server-derived from `req.microsite` (not user input) so it can't be spoofed by the client. The `jobs.source` column has a btree index for per-host reporting:

```sql
SELECT source, COUNT(*) FROM jobs WHERE created_at > now() - interval '30 days' GROUP BY source ORDER BY 2 DESC;
```

## Radius fallback

When a `geo-trade` host has zero tradesmen with an exact `areaId` match, the client renderer falls back to tradesmen within `MICROSITE_FALLBACK_RADIUS_MILES` (default 8) of the area centroid using a haversine great-circle distance. The hero copy is updated to say "Showing tradesmen within 8 miles of {area}" so users aren't misled.

The fallback exists because each mini-site needs at least one credible card on the page; in the first weeks after launch many of the 38 new seeded areas will have 0 directly-registered tradesmen. The radius pulls in the most plausible nearby pros.

## Tests

| File | What it checks |
|---|---|
| `shared/microsites.test.ts` | Registry shape, host uniqueness, taxonomy match, kind counts |
| `shared/geo.test.ts` | Haversine distance correctness |
| `server/microsite-middleware.test.ts` | Host resolution, redirect-kind 301, canonical 301, API/sitemap exemption |
| `server/microsite-seo.test.ts` | Title/description/canonical/JSON-LD building + HTML injection (incl. HTML-escape) |
| `server/microsite-routes.test.ts` | Per-host /robots.txt + /sitemap.xml, main-site fallthrough |
| `server/microsite-source-attribution.test.ts` | `req.microsite` → `jobs.source` derivation |

Run them with `npm test`.
