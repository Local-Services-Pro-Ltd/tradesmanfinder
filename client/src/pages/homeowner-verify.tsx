/**
 * HomeownerVerify page — /homeowner/verify
 *
 * The backend's GET /api/homeowner/verify route always redirects the browser
 * to /tradesman/:id?req=pending (or an error page on failure). This page
 * serves as the fallback landing if the SPA intercepts the redirect before
 * the server can send it (hash-router edge-case), or as a graceful error
 * screen if the token is invalid/expired.
 *
 * On mount:
 *   - If ?token=...&tradesmanId=... are present in the query string,
 *     immediately redirect the browser to the real server endpoint so the
 *     server can consume the token, set the homeowner cookie, and redirect
 *     back to the tradesman profile.
 *   - If no token is present and there is a ?req= param, the server already
 *     processed the magic link and redirected back — just show a status
 *     message and navigate to the tradesman profile.
 *   - Error state (401) shows a friendly "link expired" message.
 */
import { useEffect, useState } from "react";
import { useLocation } from "wouter";
import { Layout } from "@/components/layout";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { ShieldCheck, AlertTriangle, Loader2 } from "lucide-react";

type State = "redirecting" | "pending" | "error";

export default function HomeownerVerify() {
  const [, navigate] = useLocation();
  const [state, setState] = useState<State>("redirecting");
  const [tradesmanId, setTradesmanId] = useState<string | null>(null);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const token = params.get("token");
    const tid = params.get("tradesmanId");
    const req = params.get("req");

    setTradesmanId(tid);

    if (token && tid) {
      // Forward to the server endpoint — it will consume the token, set the
      // cookie, and redirect back to the tradesman profile.
      // Using window.location.href so the browser makes a full GET that the
      // server can handle (not a client-side fetch — we need the Set-Cookie).
      const serverUrl =
        `/api/homeowner/verify?token=${encodeURIComponent(token)}&tradesmanId=${encodeURIComponent(tid)}`;
      window.location.href = serverUrl;
      return;
    }

    // Server already processed the magic link and redirected to us with ?req=
    if (req === "pending" && tid) {
      setState("pending");
      // Auto-navigate to tradesman profile after a brief moment
      const timer = setTimeout(() => {
        navigate(`/tradesman/${tid}`);
      }, 2500);
      return () => clearTimeout(timer);
    }

    // No token and no req — treat as error
    setState("error");
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <Layout>
      <div className="mx-auto flex max-w-md flex-col px-4 py-20">
        {state === "redirecting" && (
          <div className="text-center">
            <Loader2 className="mx-auto h-10 w-10 animate-spin text-primary" />
            <p className="mt-4 text-muted-foreground">Verifying your link…</p>
          </div>
        )}

        {state === "pending" && (
          <Card className="p-8 text-center">
            <span className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-trust/10 text-trust">
              <ShieldCheck className="h-7 w-7" />
            </span>
            <h1 className="mt-4 font-display text-xl font-bold text-foreground">
              Request submitted
            </h1>
            <p className="mt-2 text-sm text-muted-foreground">
              Your verification request has been sent to the tradesman. You'll
              receive an email once they respond. Taking you back to the
              profile…
            </p>
            {tradesmanId && (
              <Button
                className="mt-6 w-full"
                onClick={() => navigate(`/tradesman/${tradesmanId}`)}
              >
                View profile
              </Button>
            )}
          </Card>
        )}

        {state === "error" && (
          <Card className="p-8 text-center">
            <span className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-destructive/10 text-destructive">
              <AlertTriangle className="h-7 w-7" />
            </span>
            <h1 className="mt-4 font-display text-xl font-bold text-foreground">
              Link invalid or expired
            </h1>
            <p className="mt-2 text-sm text-muted-foreground">
              This verification link has already been used or has expired
              (links are valid for 15 minutes). Please return to the
              tradesman's profile and request a new link.
            </p>
            {tradesmanId ? (
              <Button
                className="mt-6 w-full"
                onClick={() => navigate(`/tradesman/${tradesmanId}`)}
              >
                Back to profile
              </Button>
            ) : (
              <Button
                variant="outline"
                className="mt-6 w-full"
                onClick={() => navigate("/")}
              >
                Go to home
              </Button>
            )}
          </Card>
        )}
      </div>
    </Layout>
  );
}
