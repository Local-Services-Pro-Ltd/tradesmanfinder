/**
 * /api/og — dynamic per-page OpenGraph image renderer (PR-#19-G).
 *
 * Renders a 1200x630 PNG branded card for the hyperlocal landing pages
 * /{cat}-in-{area}. Inputs travel as query params:
 *
 *   /api/og?trade=Plumber&area=Manchester&n=5
 *
 * Why a separate Vercel function (not part of api/index.js):
 *   - @vercel/og uses Satori + WASM rendering, which is heavy. Keeping
 *     it out of the main Express bundle saves cold-start time on every
 *     non-OG request.
 *   - Vercel auto-detects api/*.tsx and builds them with its own
 *     pipeline (Node 20, React 18). No tsx/esbuild config needed here.
 *   - Routing: Vercel's filesystem router resolves /api/og BEFORE the
 *     /api/(.*) rewrite catch-all runs, so this file wins for that
 *     exact path and the Express bundle still gets everything else.
 *
 * Performance / cost:
 *   - O(1) per request — no DB lookups (all data in the query).
 *   - Cache-Control: public, immutable, max-age=31536000.
 *     The trade/area/n triple is the cache key. Counts update at most
 *     once per partner-onboarding (slow), so a long TTL is safe and
 *     a CSS revalidation isn't worth the cycles. If the count drifts
 *     and a fresh card is required, bump a `v=` cache-buster in the
 *     query — the URL is built by shared/og-params.ts.
 *
 * Safety:
 *   - Bad / missing params -> 302 redirect to the static /og-default.png.
 *     We deliberately do NOT 5xx — Slack / X / LinkedIn crawlers treat
 *     a 5xx on og:image as a hard miss for that URL, and we'd rather
 *     ship the brand image than nothing.
 *   - Length-capped inputs (see shared/og-params.ts) defend against
 *     hostile crawler URLs.
 */

// DEBUG (PR #87): defer the @vercel/og import + wrap the whole handler
// so we can surface the real error instead of a generic 500.
import { parseOgImageQuery } from "../shared/og-params";

// No `export const config = { runtime: ... }` here.
//
// For non-framework Vercel Functions (plain api/*.tsx), the supported
// shape is a named `GET` (or method) export that receives a Web-API
// `Request`. Vercel's builder picks this up automatically as a
// Node.js runtime function when `"type": "module"` is set in
// package.json — which we do. Adding `runtime: "nodejs"` here is
// redundant and an earlier attempt with a default export + this
// config string crashed at boot with FUNCTION_INVOCATION_FAILED
// because the builder couldn't find a method-named export.

// 1200x630 is the canonical OG/Twitter card aspect. Twitter's
// summary_large_image actually crops to ~1.91:1 (≈1200x628) — 630 is
// the de-facto standard that both honour without letterboxing.
const OG_WIDTH = 1200;
const OG_HEIGHT = 630;

// Static fallback URL. Used when query params fail validation — we
// 302 here so the crawler caches the brand image against the
// requested URL and doesn't keep hammering this endpoint.
const FALLBACK_PATH = "/og-default.png";

export async function GET(request: Request): Promise<Response> {
  // DEBUG: surface any error as text/plain so we can read it via curl.
  try {
    return await handle(request);
  } catch (err: any) {
    const msg = err?.stack || err?.message || String(err);
    return new Response(`OG_DEBUG_ERROR\n${msg}`, {
      status: 500,
      headers: { "Content-Type": "text/plain; charset=utf-8" },
    });
  }
}

async function handle(request: Request): Promise<Response> {
  // Dynamic import so we can catch a load-time crash above.
  const { ImageResponse } = await import("@vercel/og");

  // Defensive URL parse — Vercel passes an absolute URL here, but if
  // a future runtime ever passes a relative one we don't want to 5xx
  // before reaching our fallback.
  let url: URL;
  try {
    url = new URL(request.url);
  } catch {
    return new Response(null, {
      status: 302,
      headers: { Location: FALLBACK_PATH },
    });
  }
  const parsed = parseOgImageQuery(url.searchParams);

  if (!parsed) {
    // Defensive: bad inputs land on the static brand card. 302
    // because the resolution may change as we improve validation;
    // a 301 would let intermediaries cache the redirect forever.
    return new Response(null, {
      status: 302,
      headers: { Location: `${url.origin}${FALLBACK_PATH}` },
    });
  }

  const { trade, area, supply } = parsed;
  const showCount = supply > 0;

  try {
    // Layout:
    //   ┌─────────────────────────────────────────┐
    //   │  TF logo + wordmark                     │
    //   │                                         │
    //   │  {Trade}s in                            │  ← supporting line
    //   │  {Area}                                 │  ← hero line, huge
    //   │  ┌─────────────────────────┐            │
    //   │  │ {n} verified local pros │            │  ← count chip (if n>0)
    //   │  └─────────────────────────┘            │
    //   │                                         │
    //   │  tradesmanfinder.com                    │  ← domain footer
    //   └─────────────────────────────────────────┘
    //
    // Colours match the static brand image generated in PR-#19-F:
    //   Background: navy gradient #0F2A44 → #163b60
    //   Logo:       orange #F38B1C
    //   Text:       white #FFFFFF
    //   Count chip: white-on-translucent-white
    return new ImageResponse(
      (
        <div
          style={{
            width: "100%",
            height: "100%",
            display: "flex",
            flexDirection: "column",
            justifyContent: "space-between",
            background:
              "linear-gradient(135deg, #0F2A44 0%, #163b60 100%)",
            padding: "72px 88px",
            fontFamily: "system-ui, -apple-system, sans-serif",
            color: "#FFFFFF",
          }}
        >
          {/* Header — logo mark + wordmark */}
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: "20px",
            }}
          >
            <div
              style={{
                width: "56px",
                height: "56px",
                background: "#F38B1C",
                borderRadius: "12px",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                fontSize: "32px",
                fontWeight: 900,
                color: "#0F2A44",
              }}
            >
              TF
            </div>
            <div
              style={{
                fontSize: "32px",
                fontWeight: 800,
                letterSpacing: "-0.5px",
              }}
            >
              TradesmanFinder
            </div>
          </div>

          {/* Hero — trade + area */}
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              gap: "12px",
            }}
          >
            <div
              style={{
                fontSize: "44px",
                fontWeight: 500,
                color: "#B8C9DC",
                lineHeight: 1.1,
              }}
            >
              {trade}s in
            </div>
            <div
              style={{
                fontSize: "96px",
                fontWeight: 900,
                lineHeight: 1.05,
                letterSpacing: "-2px",
                // Cap to two lines visually — Satori doesn't do
                // ellipses, so we lean on the input length caps in
                // shared/og-params.ts. 40 chars at 96px wraps OK.
              }}
            >
              {area}
            </div>

            {showCount && (
              <div
                style={{
                  display: "flex",
                  marginTop: "32px",
                }}
              >
                <div
                  style={{
                    background: "rgba(255, 255, 255, 0.14)",
                    border: "2px solid rgba(255, 255, 255, 0.3)",
                    borderRadius: "999px",
                    padding: "16px 32px",
                    fontSize: "32px",
                    fontWeight: 700,
                    display: "flex",
                    alignItems: "center",
                    gap: "12px",
                  }}
                >
                  <span style={{ color: "#F38B1C" }}>✓</span>
                  <span>
                    {supply} verified local pro{supply === 1 ? "" : "s"}
                  </span>
                </div>
              </div>
            )}
          </div>

          {/* Footer — domain */}
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              fontSize: "26px",
              color: "#B8C9DC",
              fontWeight: 600,
            }}
          >
            <div>tradesmanfinder.com</div>
            <div style={{ display: "flex", gap: "20px" }}>
              <span>Verified</span>
              <span style={{ color: "#F38B1C" }}>·</span>
              <span>Reviewed</span>
              <span style={{ color: "#F38B1C" }}>·</span>
              <span>Free quotes</span>
            </div>
          </div>
        </div>
      ),
      {
        width: OG_WIDTH,
        height: OG_HEIGHT,
        headers: {
          // Long TTL — the (trade, area, n) triple barely changes.
          // If a partner's count flips meaningfully, bump a `v=` in
          // the SEO builder. CDNs respect both s-maxage and the
          // immutable hint.
          "Cache-Control":
            "public, max-age=31536000, s-maxage=31536000, immutable",
          // Tell the CDN to vary on Accept so future Webp/AVIF
          // negotiation doesn't get cross-poisoned.
          Vary: "Accept",
        },
      },
    );
  } catch (err) {
    // Belt-and-braces: any Satori / WASM glitch falls through to the
    // static brand card instead of 5xx-ing the crawler.
    console.error("[api/og] render failed:", err);
    return new Response(null, {
      status: 302,
      headers: { Location: `${url.origin}${FALLBACK_PATH}` },
    });
  }
}
