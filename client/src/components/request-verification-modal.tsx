/**
 * RequestVerificationModal — Public profile button that lets a homeowner
 * enter their email and receive a magic link to consent to the tradesman
 * sharing their redacted verification proofs.
 *
 * Flow:
 *   Button click → Dialog opens → email entry → POST /api/homeowner/request-link
 *   202 → "Check your inbox" success state
 *   429 → "Try again later" message
 *   400 → field error
 */
import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ShieldCheck } from "lucide-react";
import { apiRequest } from "@/lib/queryClient";

interface Props {
  tradesmanId: number;
  tradesmanName: string;
  trigger?: React.ReactNode;
}

export function RequestVerificationModal({ tradesmanId, tradesmanName, trigger }: Props) {
  const [open, setOpen] = useState(false);
  const [email, setEmail] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [success, setSuccess] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const reset = () => {
    setEmail("");
    setSubmitting(false);
    setSuccess(false);
    setError(null);
  };

  const handleOpenChange = (v: boolean) => {
    setOpen(v);
    if (!v) reset();
  };

  const submit = async () => {
    setError(null);
    if (!email.trim()) {
      setError("Please enter your email address.");
      return;
    }
    setSubmitting(true);
    try {
      const res = await fetch("/api/homeowner/request-link", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ email: email.trim().toLowerCase(), tradesmanId }),
      });

      if (res.status === 202) {
        // Success (includes silent-blocked case — server intentionally returns 202)
        setSuccess(true);
        return;
      }
      if (res.status === 429) {
        setError("Too many requests. Please try again later.");
        return;
      }
      if (res.status === 400) {
        const body = await res.json().catch(() => ({}));
        setError(body?.message ?? "Please enter a valid email address.");
        return;
      }
      // Unexpected status
      const body = await res.json().catch(() => ({}));
      setError(body?.message ?? "Something went wrong. Please try again.");
    } catch {
      setError("Something went wrong. Please check your connection and try again.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger asChild>
        {trigger ?? (
          <Button
            variant="outline"
            size="sm"
            data-testid="button-request-verification"
          >
            <ShieldCheck className="mr-1.5 h-4 w-4" />
            Request to view verification
          </Button>
        )}
      </DialogTrigger>

      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <ShieldCheck className="h-5 w-5 text-primary" />
            Request verification details
          </DialogTitle>
          <DialogDescription>
            {tradesmanName} can share their insurance and qualification details
            with you. Enter your email and we'll send you a secure link — no
            account required.
          </DialogDescription>
        </DialogHeader>

        {success ? (
          <div className="py-4 text-center">
            <span className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-trust/10 text-trust">
              <ShieldCheck className="h-6 w-6" />
            </span>
            <p className="mt-3 font-semibold text-foreground">Check your inbox</p>
            <p className="mt-1 text-sm text-muted-foreground">
              If your address is eligible, a secure link has been sent to{" "}
              <strong>{email}</strong>. Follow the link to submit your request.
            </p>
          </div>
        ) : (
          <>
            <div className="space-y-3 py-2">
              <div>
                <Label htmlFor="homeowner-email" className="text-sm">
                  Your email address
                </Label>
                <Input
                  id="homeowner-email"
                  type="email"
                  autoComplete="email"
                  placeholder="you@example.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter") submit(); }}
                  disabled={submitting}
                  className="mt-1.5"
                  data-testid="input-homeowner-email"
                />
                {error && (
                  <p className="mt-1.5 text-xs text-destructive" data-testid="text-request-error">
                    {error}
                  </p>
                )}
              </div>
              <p className="text-xs text-muted-foreground">
                We'll email a one-time link (valid 15 minutes). Your address is
                only used to pass the request to the tradesman — we never sell it.
              </p>
            </div>

            <DialogFooter>
              <Button
                variant="outline"
                onClick={() => handleOpenChange(false)}
                disabled={submitting}
              >
                Cancel
              </Button>
              <Button
                onClick={submit}
                disabled={submitting || !email.trim()}
                data-testid="button-send-magic-link"
              >
                {submitting ? "Sending…" : "Send magic link"}
              </Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
