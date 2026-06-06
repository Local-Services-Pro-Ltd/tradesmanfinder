import { useState } from "react";
import { Link } from "wouter";
import { Layout } from "@/components/layout";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { apiRequest } from "@/lib/queryClient";
import { LogIn, MailCheck, AlertTriangle } from "lucide-react";

// Read ?error= from the hash query string (hash router keeps query after path).
function getHashError(): string | null {
  const hash = window.location.hash; // e.g. #/login?error=invalid_or_expired
  const qIdx = hash.indexOf("?");
  if (qIdx === -1) return null;
  return new URLSearchParams(hash.slice(qIdx + 1)).get("error");
}

export default function Login() {
  const [email, setEmail] = useState("");
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);
  const [error] = useState<string | null>(getHashError());

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email) return;
    setSending(true);
    try {
      // Always succeeds with a generic message — the server never reveals
      // whether an account exists for this email.
      await apiRequest("POST", "/api/auth/request-link", { email });
    } catch {
      // request-link returns 200 for everything except rate limiting / bad
      // input. Treat any error the same as success to avoid leaking state and
      // to keep the UX simple.
    } finally {
      setSending(false);
      setSent(true);
    }
  };

  return (
    <Layout>
      <div className="mx-auto flex max-w-md flex-col px-4 py-20">
        <div className="text-center">
          <span className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-primary/10 text-primary">
            <LogIn className="h-7 w-7" />
          </span>
          <h1 className="mt-4 font-display text-2xl font-bold text-foreground">Tradesman sign in</h1>
          <p className="mt-2 text-muted-foreground">
            Enter your registered email and we'll send you a secure sign-in link.
          </p>
        </div>

        <Card className="mt-8 p-6">
          {error === "invalid_or_expired" && (
            <div
              className="mb-4 flex items-start gap-2 rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive"
              data-testid="banner-login-error"
            >
              <AlertTriangle className="mt-0.5 h-4 w-4 flex-shrink-0" />
              <span>That sign-in link was invalid or has expired. Request a new one below.</span>
            </div>
          )}

          {sent ? (
            <div
              className="flex flex-col items-center gap-3 py-4 text-center"
              data-testid="banner-link-sent"
            >
              <span className="flex h-12 w-12 items-center justify-center rounded-full bg-trust/10 text-trust">
                <MailCheck className="h-6 w-6" />
              </span>
              <p className="text-sm text-foreground">
                If an account exists with that email, we've sent you a sign-in link. Check your inbox.
              </p>
              <button
                className="text-sm text-primary underline hover:no-underline"
                onClick={() => { setSent(false); setEmail(""); }}
                data-testid="button-send-again"
              >
                Use a different email
              </button>
            </div>
          ) : (
            <form onSubmit={submit} className="space-y-4">
              <div>
                <Label htmlFor="le">Email address</Label>
                <Input
                  id="le"
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="you@yourbusiness.co.uk"
                  data-testid="input-login-email"
                  required
                />
              </div>
              <Button type="submit" className="w-full" disabled={sending} data-testid="button-send-link">
                {sending ? "Sending…" : "Send sign-in link"}
              </Button>
            </form>
          )}

          <p className="mt-4 text-center text-sm text-muted-foreground">
            No account? <Link href="/join" className="font-medium text-primary hover:underline">Create one free</Link>
          </p>
        </Card>
      </div>
    </Layout>
  );
}
