/**
 * Area unavailable / unmatched-search page.
 *
 * Route: /area/unavailable?q=<typed-string>
 *
 * Reached when a homeowner types a borough/postcode/locality that the
 * resolver can't map to a seeded `areas` row. Instead of a dead-end
 * "we don't cover that" message, we show the UnmatchedAreaWaitlist
 * component so the search converts into demand signal.
 *
 * If the query string is missing or invalid (the validation rules from
 * `homeownerInterestRequestSchema.requestedArea`), we render a soft
 * fallback that nudges the user back to the main search instead of
 * exposing them to a half-broken form.
 */
import { Link } from "wouter";
import { UnmatchedAreaWaitlist } from "@/components/unmatched-area-waitlist";

const REQUESTED_AREA_OK = /^[A-Za-z0-9 \-]+$/;

function readQueryParam(name: string): string {
  // The app uses hash-routing with the query string stripped from the
  // wouter path. The original hash still lives in window.location.hash,
  // shaped like `#/area/unavailable?q=Streatham`.
  if (typeof window === "undefined") return "";
  const hash = window.location.hash;
  const qIdx = hash.indexOf("?");
  if (qIdx === -1) return "";
  return new URLSearchParams(hash.slice(qIdx + 1)).get(name) || "";
}

export default function AreaUnavailable() {
  const raw = readQueryParam("q").trim();
  const isValid = raw.length >= 2 && raw.length <= 80 && REQUESTED_AREA_OK.test(raw);

  if (!isValid) {
    return (
      <div className="mx-auto max-w-xl px-4 py-16 text-center">
        <h1 className="font-display text-2xl font-semibold">Looking for a tradesman?</h1>
        <p className="mt-2 text-muted-foreground">
          Use the search box on the home page to find verified pros in your area, or
          browse our covered boroughs.
        </p>
        <p className="mt-6">
          <Link
            href="/"
            className="text-primary underline-offset-4 hover:underline"
            data-testid="area-unavailable-back-home"
          >
            Back to home
          </Link>
        </p>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-2xl px-4 py-12">
      <UnmatchedAreaWaitlist requestedArea={raw} />
      <div className="mt-8 text-center text-sm text-muted-foreground">
        <p>
          Already on the list?{" "}
          <Link
            href="/"
            className="text-primary underline-offset-4 hover:underline"
            data-testid="area-unavailable-back-home"
          >
            Back to home
          </Link>
        </p>
      </div>
    </div>
  );
}
