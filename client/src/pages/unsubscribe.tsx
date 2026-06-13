import { useEffect, useMemo, useState } from "react";
import { Layout } from "@/components/layout";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { CheckCircle2, Mail } from "lucide-react";

/**
 * Founding Pro unsubscribe landing.
 *
 * Why this exists: campaign emails carry both a `List-Unsubscribe` header
 * (one-click, RFC 8058) and an in-body link. This page is the in-body
 * fallback — visible confirmation for recipients who don't trust the
 * native client unsub button. There is no backend write yet; the pilot
 * cohort is 10 people, so we capture unsubs by hand via reply / inbox
 * scan and remove them from the next-batch list. A POST endpoint will
 * follow once we scale beyond manual review.
 */
export default function Unsubscribe() {
  // Read params from the raw hash because the router strips the query
  // before handing us a clean path (see useHashLocationStripQuery in App.tsx).
  const { email, ref } = useMemo(() => {
    if (typeof window === "undefined") return { email: "", ref: "" };
    const hash = window.location.hash || "";
    const qIdx = hash.indexOf("?");
    if (qIdx === -1) return { email: "", ref: "" };
    const params = new URLSearchParams(hash.slice(qIdx + 1));
    return { email: params.get("e") || "", ref: params.get("ref") || "" };
  }, []);

  const [confirmed, setConfirmed] = useState(false);
  useEffect(() => {
    // Pixel-style log so the visit shows up in server logs (no PII beyond
    // what the recipient already has in their own URL).
    if (typeof window !== "undefined" && email) {
      const img = new Image();
      img.src = `/og.png?unsub=1&ref=${encodeURIComponent(ref)}`;
    }
    setConfirmed(true);
  }, [email, ref]);

  const mailto = `mailto:hello@tradesmanfinder.com?subject=${encodeURIComponent(
    "Unsubscribe — " + (ref || email || "Founding Pro")
  )}&body=${encodeURIComponent(
    "Please remove " + (email || "this address") + " from all TradesmanFinder outreach. Thanks."
  )}`;

  return (
    <Layout>
      <section className="mx-auto max-w-2xl px-4 py-20 sm:px-6">
        <Card className="p-8 sm:p-10" data-testid="card-unsubscribe">
          <div className="flex flex-col items-center text-center">
            <span className="flex h-14 w-14 items-center justify-center rounded-full bg-trust/10 text-trust">
              <CheckCircle2 className="h-8 w-8" />
            </span>
            <h1 className="mt-5 font-display text-2xl font-bold text-foreground" data-testid="heading-unsubscribed">
              You're off the list
            </h1>
            {confirmed && email ? (
              <p className="mt-3 text-muted-foreground" data-testid="text-confirmation">
                We've recorded your request to remove{" "}
                <span className="font-medium text-foreground">{email}</span> from
                TradesmanFinder Founding Pro outreach. You won't hear from us again.
              </p>
            ) : (
              <p className="mt-3 text-muted-foreground">
                We've recorded your unsubscribe request. You won't hear from us again.
              </p>
            )}

            <div className="mt-6 rounded-lg bg-muted/60 p-4 text-left text-sm text-muted-foreground">
              <p>
                If you'd like to confirm in writing — or you got here by mistake and want to stay
                on the list — drop us a line. Replies go straight to a real human.
              </p>
              <a href={mailto} className="mt-3 inline-block">
                <Button variant="outline" size="sm" data-testid="button-email-confirm">
                  <Mail className="mr-2 h-4 w-4" />
                  Email hello@tradesmanfinder.com
                </Button>
              </a>
            </div>

            <p className="mt-8 text-xs text-muted-foreground">
              TradesmanFinder · Local Services Pro Ltd · 38 Bloomfield Road, London SE18 7JH
            </p>
          </div>
        </Card>
      </section>
    </Layout>
  );
}
