import { useEffect, useState } from "react";
import { useLocation } from "wouter";
import { Layout } from "@/components/layout";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import { Check, CheckCircle2, Clock, MapPin } from "lucide-react";

/* ─────────────────────────────────────────────
   /founding-pro/interest — Founding Pro interest
   form. Quick-fix replacement for the mailto:
   CTAs on /founding-pro that opened the user's
   default mail client (Gmail compose) and broke
   the click-through for the live pilot cohort.

   No DB write — submission emails Steve at the
   hello@ address that already receives outreach
   replies. A proper /founding-pro/claim flow
   with profile pre-fill from Companies House
   will replace this in a follow-up PR.
   ───────────────────────────────────────────── */

type FormState = {
  companyName: string;
  contactName: string;
  email: string;
  phone: string;
  trades: string;
  postcodes: string;
  bio: string;
  // honeypot — must stay empty; server's publicFormGuard rejects if filled
  company_website: string;
};

const EMPTY: FormState = {
  companyName: "",
  contactName: "",
  email: "",
  phone: "",
  trades: "",
  postcodes: "",
  bio: "",
  company_website: "",
};

function readRefFromUrl(): string | null {
  if (typeof window === "undefined") return null;
  const params = new URLSearchParams(window.location.search);
  const ref = params.get("ref");
  if (!ref) return null;
  // Defensive — keep it simple, server caps to 80 chars and validates.
  return ref.slice(0, 80);
}

export default function FoundingProInterest() {
  const { toast } = useToast();
  const [, setLocation] = useLocation();
  const [form, setForm] = useState<FormState>(EMPTY);
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [ref, setRef] = useState<string | null>(null);

  useEffect(() => {
    setRef(readRefFromUrl());
  }, []);

  const set = <K extends keyof FormState>(k: K, v: FormState[K]) =>
    setForm((f) => ({ ...f, [k]: v }));

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (submitting) return;

    // Lightweight client-side validation — server is the source of truth.
    if (
      !form.companyName.trim() ||
      !form.contactName.trim() ||
      !form.email.trim() ||
      !form.phone.trim() ||
      !form.trades.trim() ||
      !form.postcodes.trim() ||
      !form.bio.trim()
    ) {
      toast({
        title: "Almost there",
        description: "Please fill in every field — it only takes 60 seconds.",
        variant: "destructive",
      });
      return;
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email.trim())) {
      toast({
        title: "Check your email",
        description: "That doesn't look like a valid email address.",
        variant: "destructive",
      });
      return;
    }

    setSubmitting(true);
    try {
      const payload: Record<string, unknown> = {
        companyName: form.companyName.trim(),
        contactName: form.contactName.trim(),
        email: form.email.trim(),
        phone: form.phone.trim(),
        trades: form.trades.trim(),
        postcodes: form.postcodes.trim(),
        bio: form.bio.trim(),
        company_website: form.company_website, // honeypot
        ref,
      };
      await apiRequest("POST", "/api/founding-pro/interest", payload);
      setSubmitted(true);
      setForm(EMPTY);
      toast({
        title: "Thanks — you're on the list",
        description: "Steve will reply within 24h to publish your profile.",
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Please try again in a moment.";
      toast({ title: "Something went wrong", description: msg, variant: "destructive" });
    } finally {
      setSubmitting(false);
    }
  };

  if (submitted) {
    return (
      <Layout>
        <section className="mx-auto max-w-2xl px-4 py-20 sm:px-6">
          <div className="rounded-lg border border-border bg-card p-8 text-center">
            <span className="inline-flex h-14 w-14 items-center justify-center rounded-full bg-trust/10 text-trust">
              <CheckCircle2 className="h-8 w-8" />
            </span>
            <h1 className="mt-5 font-display text-2xl font-bold text-foreground" data-testid="heading-thanks">
              You're on the list
            </h1>
            <p className="mt-3 text-muted-foreground">
              Thanks — we've got your details. Steve will reply within 24 hours from{" "}
              <strong>hello@tradesmanfinder.com</strong> to publish your Founding Pro profile and send
              your dashboard link.
            </p>
            <p className="mt-3 text-sm text-muted-foreground">
              Your 30-day free-unlock window starts the moment your profile goes live — not today.
            </p>
            <div className="mt-7">
              <Button onClick={() => setLocation("/")} data-testid="button-back-home">
                Back to TradesmanFinder
              </Button>
            </div>
          </div>
        </section>
      </Layout>
    );
  }

  return (
    <Layout>
      {/* Hero */}
      <section className="relative overflow-hidden bg-navy">
        <div
          className="absolute inset-0 opacity-[0.07]"
          style={{
            backgroundImage: "radial-gradient(circle at 20% 30%, white 1px, transparent 1px)",
            backgroundSize: "28px 28px",
          }}
        />
        <div className="relative mx-auto max-w-3xl px-4 py-12 sm:py-16 sm:px-6">
          <Badge className="bg-primary text-primary-foreground hover:bg-primary">
            Founding Pro · Invite only
          </Badge>
          <h1
            className="mt-4 font-display text-2xl font-bold leading-tight text-white sm:text-3xl"
            data-testid="heading-claim"
          >
            Claim your Founding Pro spot
          </h1>
          <p className="mt-4 text-white/70">
            Takes 60 seconds. We'll pre-fill your Companies House details and publish your profile
            within 24 hours — your 30-day free-unlock window starts the moment it goes live.
          </p>
          <div className="mt-6 flex flex-wrap gap-x-8 gap-y-2 text-sm text-white/60">
            <span className="flex items-center gap-1.5">
              <Check className="h-4 w-4 text-primary" /> No card required
            </span>
            <span className="flex items-center gap-1.5">
              <Clock className="h-4 w-4 text-primary" /> 60 seconds
            </span>
            <span className="flex items-center gap-1.5">
              <MapPin className="h-4 w-4 text-primary" /> London pilot areas
            </span>
          </div>
        </div>
      </section>

      {/* Form */}
      <section className="mx-auto max-w-3xl px-4 py-12 sm:px-6">
        <Card className="p-6 sm:p-8">
          <form onSubmit={onSubmit} className="space-y-5" data-testid="form-founding-pro-interest">
            {/* honeypot — invisible to humans, attractive to bots */}
            <div className="hidden" aria-hidden="true">
              <Label htmlFor="company_website">Company website</Label>
              <Input
                id="company_website"
                tabIndex={-1}
                autoComplete="off"
                value={form.company_website}
                onChange={(e) => set("company_website", e.target.value)}
              />
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <Label htmlFor="companyName">Company name *</Label>
                <Input
                  id="companyName"
                  value={form.companyName}
                  onChange={(e) => set("companyName", e.target.value)}
                  data-testid="input-company-name"
                  placeholder="e.g. Keystone Plumbing Ltd"
                />
              </div>
              <div>
                <Label htmlFor="contactName">Your name *</Label>
                <Input
                  id="contactName"
                  value={form.contactName}
                  onChange={(e) => set("contactName", e.target.value)}
                  data-testid="input-contact-name"
                />
              </div>
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <Label htmlFor="email">Email *</Label>
                <Input
                  id="email"
                  type="email"
                  value={form.email}
                  onChange={(e) => set("email", e.target.value)}
                  data-testid="input-email"
                />
              </div>
              <div>
                <Label htmlFor="phone">Phone (shown to homeowners) *</Label>
                <Input
                  id="phone"
                  value={form.phone}
                  onChange={(e) => set("phone", e.target.value)}
                  data-testid="input-phone"
                  placeholder="020 1234 5678"
                />
              </div>
            </div>

            <div>
              <Label htmlFor="trades">Trades you cover *</Label>
              <Input
                id="trades"
                value={form.trades}
                onChange={(e) => set("trades", e.target.value)}
                data-testid="input-trades"
                placeholder="e.g. plumbing, heating, gas"
              />
            </div>

            <div>
              <Label htmlFor="postcodes">Postcodes / areas you cover *</Label>
              <Input
                id="postcodes"
                value={form.postcodes}
                onChange={(e) => set("postcodes", e.target.value)}
                data-testid="input-postcodes"
                placeholder="e.g. SW3, SW7, SW10, W8"
              />
            </div>

            <div>
              <Label htmlFor="bio">Short bio (1–2 sentences) *</Label>
              <Textarea
                id="bio"
                rows={4}
                value={form.bio}
                onChange={(e) => set("bio", e.target.value)}
                data-testid="input-bio"
                placeholder="e.g. Gas Safe registered plumbers covering Kensington & Chelsea since 2014 — boiler, leak, and bathroom work. 24/7 emergency call-outs."
              />
            </div>

            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <p className="text-xs text-muted-foreground">
                By submitting you agree we'll email you about your Founding Pro profile. We never
                share your details.
              </p>
              <Button
                type="submit"
                size="lg"
                disabled={submitting}
                data-testid="button-submit-interest"
              >
                {submitting ? "Sending…" : "Claim my Founding Pro spot"}
              </Button>
            </div>
          </form>
        </Card>
      </section>
    </Layout>
  );
}
