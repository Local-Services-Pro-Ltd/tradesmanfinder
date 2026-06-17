/**
 * Borough waitlist signup form.
 *
 * Shown on the area landing page when a borough has fewer than the
 * server-side density threshold of verified pros. Captures email +
 * optional postcode + optional category, POSTs to /api/homeowner-interest,
 * and shows a success state.
 *
 * Idempotent on the backend, so resubmitting the same email is safe.
 * Always returns the same 200 success copy regardless of new-vs-repeat.
 */
import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Bell, CheckCircle2 } from "lucide-react";

interface BoroughWaitlistProps {
  areaId: number;
  areaName: string;
  verifiedCount: number;
  threshold: number;
  categoryId?: number;
  categoryName?: string;
}

interface SubmitState {
  email: string;
  postcode: string;
}

export function BoroughWaitlist({
  areaId,
  areaName,
  verifiedCount,
  threshold,
  categoryId,
  categoryName,
}: BoroughWaitlistProps) {
  const [form, setForm] = useState<SubmitState>({ email: "", postcode: "" });
  const [isSubmitted, setIsSubmitted] = useState(false);

  const mutation = useMutation({
    mutationFn: async (payload: SubmitState) => {
      const res = await fetch("/api/homeowner-interest", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          email: payload.email.trim(),
          postcode: payload.postcode.trim() || undefined,
          areaId,
          categoryId,
          source: categoryId ? "category_landing" : "area_landing",
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

  const supplyCopy =
    verifiedCount === 0
      ? `We're still onboarding verified ${categoryName ? categoryName.toLowerCase() + " " : ""}pros in ${areaName}.`
      : `We have ${verifiedCount} verified ${categoryName ? categoryName.toLowerCase() + " " : ""}${verifiedCount === 1 ? "pro" : "pros"} in ${areaName} \u2014 not enough yet to give you a real choice.`;

  if (isSubmitted) {
    return (
      <div
        className="mx-auto max-w-xl rounded-xl border border-emerald-200 bg-emerald-50 p-6 sm:p-8"
        data-testid="waitlist-success"
      >
        <div className="flex items-start gap-3">
          <CheckCircle2 className="mt-0.5 h-6 w-6 flex-shrink-0 text-emerald-600" />
          <div>
            <h3 className="font-display text-lg font-semibold text-emerald-900">
              You're on the list
            </h3>
            <p className="mt-1.5 text-sm leading-relaxed text-emerald-800">
              We'll email you the moment we have enough verified
              {categoryName ? ` ${categoryName.toLowerCase()}` : ""} pros in {areaName} to give you a real choice. No spam, no list-resale.
            </p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div
      className="mx-auto max-w-xl rounded-xl border border-border bg-background p-6 shadow-sm sm:p-8"
      data-testid="waitlist-form"
    >
      <div className="flex items-start gap-3">
        <span className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
          <Bell className="h-5 w-5" />
        </span>
        <div className="flex-1">
          <h3 className="font-display text-lg font-semibold text-foreground">
            Be first to hear when {areaName} opens
          </h3>
          <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground">
            {supplyCopy} We'd rather wait until we can give you a proper shortlist than send you to one pro and hope for the best. Drop your email and we'll let you know when {areaName} is ready.
          </p>
        </div>
      </div>

      <form
        className="mt-6 space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          if (!form.email) return;
          mutation.mutate(form);
        }}
      >
        <div>
          <Label htmlFor="waitlist-email" className="text-sm font-medium">
            Email
          </Label>
          <Input
            id="waitlist-email"
            type="email"
            required
            placeholder="you@example.com"
            value={form.email}
            onChange={(e) => setForm({ ...form, email: e.target.value })}
            disabled={mutation.isPending}
            className="mt-1.5"
            data-testid="waitlist-email-input"
          />
        </div>
        <div>
          <Label htmlFor="waitlist-postcode" className="text-sm font-medium">
            Postcode <span className="font-normal text-muted-foreground">(optional, helps us prioritise)</span>
          </Label>
          <Input
            id="waitlist-postcode"
            type="text"
            placeholder={`e.g. SE13 6AA`}
            value={form.postcode}
            onChange={(e) => setForm({ ...form, postcode: e.target.value })}
            disabled={mutation.isPending}
            className="mt-1.5"
            maxLength={10}
            data-testid="waitlist-postcode-input"
          />
        </div>
        {mutation.isError && (
          <p className="text-sm text-red-600" role="alert">
            {(mutation.error as Error).message}
          </p>
        )}
        <Button
          type="submit"
          disabled={mutation.isPending || !form.email}
          className="w-full"
          data-testid="waitlist-submit"
        >
          {mutation.isPending ? "Saving\u2026" : "Notify me when ready"}
        </Button>
        <p className="text-xs text-muted-foreground">
          One-off email when we launch in {areaName}. Unsubscribe with one click. We never sell your details.
        </p>
        <p className="text-xs text-muted-foreground">
          <strong>{verifiedCount}</strong> / {threshold} verified pros so far in {areaName}.
        </p>
      </form>
    </div>
  );
}
