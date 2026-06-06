import { useEffect, useState } from "react";
import { Link } from "wouter";
import { Layout } from "@/components/layout";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import { LogIn, MailCheck, AlertTriangle, Ban } from "lucide-react";

// Read the `?auth=…` query from the hash (e.g. `#/sign-in?auth=expired`).
// The hash router strips queries before matching <Route>, but the raw query
// is still in window.location.hash — see App.tsx for the wrapper.
function getAuthReason(): string | null {
  const hash = window.location.hash;
  const qIdx = hash.indexOf("?");
  if (qIdx === -1) return null;
  const params = new URLSearchParams(hash.slice(qIdx + 1));
  return params.get("auth");
}

const REASON_COPY: Record<string, { title: string; body: string; tone: "warn" | "ban" }> = {
  invalid: {
    title: "That sign-in link isn't valid",
    body: "The link is malformed or has never been issued. Request a fresh one below.",
    tone: "warn",
  },
  used: {
    title: "That link has already been used",
    body: "Magic links can only be used once. Request a new one to sign in again.",
    tone: "warn",
  },
  expired: {
    title: "That link has expired",
    body: "Sign-in links are valid for 15 minutes. Request a fresh one below.",
    tone: "warn",
  },
  banned: {
    title: "This account has been suspended",
    body: "Your account has been permanently banned and cannot sign in. Contact support@tradesmanfinder.com to appeal.",
    tone: "ban",
  },
};

export default function SignIn() {
  const { toast } = useToast();
  const [email, setEmail] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [sent, setSent] = useState(false);
  const [reason, setReason] = useState<string | null>(null);

  useEffect(() => {
    setReason(getAuthReason());
  }, []);

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email.trim()) return;
    setSubmitting(true);
    try {
      await apiRequest("POST", "/api/auth/request-link", { email: email.trim() });
      setSent(true);
      // Clear the auth-reason banner once the user has acted on it.
      setReason(null);
    } catch {
      toast({
        title: "Couldn't send sign-in link",
        description: "Please check your email address and try again in a moment.",
        variant: "destructive",
      });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Layout>
      <div className="mx-auto flex max-w-md flex-col px-4 py-20">
        {sent ? (
          <Card className="p-8 text-center" data-testid="card-signin-sent">
            <span className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-trust/10 text-trust">
              <MailCheck className="h-7 w-7" />
            </span>
            <h1 className="mt-4 font-display text-2xl font-bold text-foreground">Check your email</h1>
            <p className="mt-2 text-muted-foreground">
              If an account exists for <span className="font-medium text-foreground">{email}</span>, we've sent a sign-in link.
              It's valid for 15 minutes.
            </p>
            <p className="mt-4 text-sm text-muted-foreground">
              Didn't receive it? Check your spam folder, then{" "}
              <button
                className="font-medium text-primary hover:underline"
                onClick={() => setSent(false)}
                data-testid="button-signin-try-again"
              >
                try a different email
              </button>
              .
            </p>
          </Card>
        ) : (
          <>
            <div className="text-center">
              <span className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-primary/10 text-primary">
                <LogIn className="h-7 w-7" />
              </span>
              <h1 className="mt-4 font-display text-2xl font-bold text-foreground">Sign in to your account</h1>
              <p className="mt-2 text-muted-foreground">We'll email you a one-time link to sign in. No password needed.</p>
            </div>

            {reason && REASON_COPY[reason] && (
              <div
                className={
                  "mt-6 flex items-start gap-2 rounded-md border p-3 text-sm " +
                  (REASON_COPY[reason].tone === "ban"
                    ? "border-destructive/40 bg-destructive/5 text-destructive"
                    : "border-amber-300 bg-amber-50 text-amber-900")
                }
                data-testid={`banner-auth-${reason}`}
              >
                {REASON_COPY[reason].tone === "ban" ? (
                  <Ban className="mt-0.5 h-4 w-4 flex-shrink-0" />
                ) : (
                  <AlertTriangle className="mt-0.5 h-4 w-4 flex-shrink-0" />
                )}
                <div>
                  <p className="font-semibold">{REASON_COPY[reason].title}</p>
                  <p className="mt-0.5">{REASON_COPY[reason].body}</p>
                </div>
              </div>
            )}

            <Card className="mt-8 p-6">
              <form onSubmit={onSubmit} className="space-y-4">
                <div>
                  <Label htmlFor="signin-email">Email address</Label>
                  <Input
                    id="signin-email"
                    type="email"
                    autoComplete="email"
                    required
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="you@yourbusiness.co.uk"
                    data-testid="input-signin-email"
                  />
                </div>
                <Button
                  type="submit"
                  className="w-full"
                  disabled={submitting || !email.trim()}
                  data-testid="button-signin-submit"
                >
                  {submitting ? "Sending link…" : "Email me a sign-in link"}
                </Button>
              </form>
              <p className="mt-4 text-center text-sm text-muted-foreground">
                New tradesman?{" "}
                <Link href="/join" className="font-medium text-primary hover:underline">
                  Create an account
                </Link>
              </p>
            </Card>
          </>
        )}
      </div>
    </Layout>
  );
}
