/**
 * Unmatched-area waitlist.
 *
 * Shown when a homeowner typed a borough/postcode/locality the resolver
 * couldn't map to a seeded `areas` row (e.g. "Streatham", "SE13", "Finsbury
 * Park"). Same email-capture pattern as BoroughWaitlist but POSTs with
 * `requestedArea` instead of `areaId` and `source: "unmatched_search"`.
 *
 * Surfacing this rather than a dead-end "we don't cover that yet" page
 * turns every unsupported-area search into a list-build + demand signal
 * we can use to prioritise the next borough to seed.
 */
import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Bell, CheckCircle2 } from "lucide-react";

interface UnmatchedAreaWaitlistProps {
  /** What the user typed, verbatim. Used both for display and for the API payload. */
  requestedArea: string;
}

export function UnmatchedAreaWaitlist({ requestedArea }: UnmatchedAreaWaitlistProps) {
  const [email, setEmail] = useState("");
  const [postcode, setPostcode] = useState("");
  const [isSubmitted, setIsSubmitted] = useState(false);

  const mutation = useMutation({
    mutationFn: async () => {
      const res = await fetch("/api/homeowner-interest", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          email: email.trim(),
          postcode: postcode.trim() || undefined,
          requestedArea,
          source: "unmatched_search",
        }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.message || "Sign-up failed. Please try again.");
      }
      return res.json();
    },
    onSuccess: () => setIsSubmitted(true),
  });

  // Title-case the typed string for display (matches the server-side helper).
  const display = displayCase(requestedArea);

  if (isSubmitted) {
    return (
      <div
        className="mx-auto max-w-xl rounded-xl border border-emerald-200 bg-emerald-50 p-6 sm:p-8"
        data-testid="unmatched-waitlist-success"
      >
        <div className="flex items-start gap-3">
          <CheckCircle2 className="mt-0.5 h-6 w-6 flex-shrink-0 text-emerald-600" />
          <div>
            <h3 className="font-display text-lg font-semibold text-emerald-900">
              Thanks — you're on the list
            </h3>
            <p className="mt-1.5 text-sm leading-relaxed text-emerald-800">
              We'll email you the moment we have enough verified pros in {display} to give
              you a real choice. No spam, no list-resale.
            </p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div
      className="mx-auto max-w-xl rounded-xl border border-border bg-background p-6 shadow-sm sm:p-8"
      data-testid="unmatched-waitlist-form"
    >
      <div className="flex items-start gap-3">
        <span className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
          <Bell className="h-5 w-5" />
        </span>
        <div className="flex-1">
          <h3 className="font-display text-lg font-semibold text-foreground">
            We're not in {display} yet
          </h3>
          <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground">
            Drop your email and we'll let you know the moment we have verified pros
            in {display}. Every pro on TradesmanFinder is identity-checked, insured,
            and (where the trade requires it) holds the proper certifications.
          </p>
        </div>
      </div>

      <form
        className="mt-6 space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          if (!email) return;
          mutation.mutate();
        }}
      >
        <div>
          <Label htmlFor="unmatched-email" className="text-sm font-medium">
            Email
          </Label>
          <Input
            id="unmatched-email"
            type="email"
            required
            placeholder="you@example.com"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            disabled={mutation.isPending}
            className="mt-1.5"
            data-testid="unmatched-waitlist-email"
          />
        </div>
        <div>
          <Label htmlFor="unmatched-postcode" className="text-sm font-medium">
            Postcode <span className="font-normal text-muted-foreground">(optional, helps us prioritise)</span>
          </Label>
          <Input
            id="unmatched-postcode"
            type="text"
            placeholder="e.g. SW2 1AB"
            value={postcode}
            onChange={(e) => setPostcode(e.target.value)}
            disabled={mutation.isPending}
            className="mt-1.5"
            maxLength={10}
            data-testid="unmatched-waitlist-postcode"
          />
        </div>
        {mutation.isError && (
          <p className="text-sm text-red-600" role="alert">
            {(mutation.error as Error).message}
          </p>
        )}
        <Button
          type="submit"
          disabled={mutation.isPending || !email}
          className="w-full"
          data-testid="unmatched-waitlist-submit"
        >
          {mutation.isPending ? "Saving…" : `Notify me about ${display}`}
        </Button>
        <p className="text-xs text-muted-foreground">
          One-off email when we launch in {display}. Unsubscribe with one click. We never sell your details.
        </p>
      </form>
    </div>
  );
}

/**
 * Mirror of server-side toTitleCase: postcodes stay uppercase, multi-word
 * inputs get title-cased. Kept simple — the user typed it, we just clean
 * up the case for display.
 */
function displayCase(raw: string): string {
  if (/^[a-z]{1,2}\d[a-z\d]?( \d[a-z]{2})?$/i.test(raw)) return raw.toUpperCase();
  return raw
    .split(/\s+/)
    .map((w) => (w.length ? w[0].toUpperCase() + w.slice(1).toLowerCase() : w))
    .join(" ");
}
