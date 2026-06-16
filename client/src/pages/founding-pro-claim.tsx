import { useEffect, useState } from "react";
import { useLocation } from "wouter";
import { Layout } from "@/components/layout";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import { Check, CheckCircle2, Clock, MapPin, Pencil, X } from "lucide-react";

/* ─────────────────────────────────────────────
   /founding-pro/claim — ref-aware Founding Pro
   claim page. Canonical path (supersedes the
   /founding-pro/interest quick form from PR #106,
   which stays as a no-ref fallback).

   Reads ?ref= from the URL, fetches the invite to
   pre-fill company/trade/area + suggested
   postcodes, and on submit creates a tradesman
   record tagged Founding Pro via
   POST /api/founding-pro/claim/:ref.
   ───────────────────────────────────────────── */

// Suggested coverage postcodes per pilot area. Mirrors the backend pilot
// areas; used to pre-tick a sensible default the pro can adjust.
const AREA_POSTCODES: Record<string, string[]> = {
  Wandsworth: ["SW8", "SW11", "SW12", "SW15", "SW17", "SW18"],
  Dulwich: ["SE21", "SE22"],
  "Kensington & Chelsea": ["SW3", "SW5", "SW7", "SW10", "W8", "W10", "W11", "W14"],
  Richmond: ["TW9", "TW10"],
};

// The launch trades. The invite's own trade is always included + pre-selected.
const TRADE_OPTIONS = ["plumber", "electrician", "heating", "gas", "bathroom", "general"];

type Invite = {
  ref: string;
  recipientName: string | null;
  companyName: string | null;
  trade: string;
  area: string;
  postcodes: string[];
  campaign: string;
  status: string;
  alreadyClaimed: boolean;
  claimedTradesmanId: number | null;
};

function readRefFromUrl(): string | null {
  if (typeof window === "undefined") return null;
  const params = new URLSearchParams(window.location.search);
  const ref = params.get("ref");
  if (!ref) return null;
  return ref.slice(0, 80);
}

function suggestedPostcodes(invite: Invite): string[] {
  // Prefer postcodes seeded on the invite; fall back to the area defaults.
  if (invite.postcodes && invite.postcodes.length) return invite.postcodes;
  return AREA_POSTCODES[invite.area] ?? [];
}

export default function FoundingProClaim() {
  const { toast } = useToast();
  const [, setLocation] = useLocation();

  const [ref, setRef] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [invite, setInvite] = useState<Invite | null>(null);
  const [submitting, setSubmitting] = useState(false);

  // Editable fields
  const [companyName, setCompanyName] = useState("");
  const [editCompany, setEditCompany] = useState(false);
  const [phone, setPhone] = useState("");
  const [bio, setBio] = useState("");
  const [website, setWebsite] = useState("");
  const [trades, setTrades] = useState<string[]>([]);
  const [postcodes, setPostcodes] = useState<string[]>([]);
  const [newPostcode, setNewPostcode] = useState("");
  const [marketingConsent, setMarketingConsent] = useState(false);
  // Honeypot — must stay empty.
  const [websiteUrl, setWebsiteUrl] = useState("");

  useEffect(() => {
    const r = readRefFromUrl();
    setRef(r);
    if (!r) {
      setLoading(false);
      setNotFound(true);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const res = await apiRequest("GET", `/api/founding-pro/invite/${encodeURIComponent(r)}`);
        const data: Invite = await res.json();
        if (cancelled) return;
        setInvite(data);
        setCompanyName(data.companyName ?? "");
        // Pre-select the invite's trade plus dedupe against the option list.
        const initialTrades = data.trade ? [data.trade] : [];
        setTrades(initialTrades);
        setPostcodes(suggestedPostcodes(data));
        if (data.alreadyClaimed && data.claimedTradesmanId) {
          // Already claimed — bounce straight to the welcome page.
          setLocation(`/founding-pro/welcome?tradesmanId=${data.claimedTradesmanId}`);
        }
      } catch {
        if (!cancelled) setNotFound(true);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [setLocation]);

  const toggleTrade = (t: string) =>
    setTrades((prev) => (prev.includes(t) ? prev.filter((x) => x !== t) : [...prev, t]));

  const togglePostcode = (p: string) =>
    setPostcodes((prev) => (prev.includes(p) ? prev.filter((x) => x !== p) : [...prev, p]));

  const addPostcode = () => {
    const p = newPostcode.trim().toUpperCase();
    if (!p) return;
    if (!postcodes.includes(p)) setPostcodes((prev) => [...prev, p]);
    setNewPostcode("");
  };

  const tradeOptions = invite
    ? Array.from(new Set([invite.trade, ...TRADE_OPTIONS]))
    : TRADE_OPTIONS;
  const postcodeOptions = invite
    ? Array.from(new Set([...suggestedPostcodes(invite), ...postcodes]))
    : postcodes;

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (submitting || !ref) return;

    if (!phone.trim()) {
      toast({ title: "Phone required", description: "Add a contact number homeowners can call.", variant: "destructive" });
      return;
    }
    if (bio.trim().length < 10 || bio.trim().length > 600) {
      toast({ title: "Check your bio", description: "Your bio needs to be between 10 and 600 characters.", variant: "destructive" });
      return;
    }
    if (trades.length < 1) {
      toast({ title: "Pick a trade", description: "Select at least one trade you cover.", variant: "destructive" });
      return;
    }
    if (postcodes.length < 1) {
      toast({ title: "Add postcodes", description: "Select at least one postcode you cover.", variant: "destructive" });
      return;
    }
    if (!marketingConsent) {
      toast({ title: "One more thing", description: "Please tick the consent box so we can email you your dashboard link.", variant: "destructive" });
      return;
    }

    setSubmitting(true);
    try {
      const payload: Record<string, unknown> = {
        phone: phone.trim(),
        bio: bio.trim(),
        trades,
        postcodes,
        website: website.trim() || undefined,
        marketing_consent: marketingConsent,
        website_url: websiteUrl, // honeypot
      };
      const res = await apiRequest("POST", `/api/founding-pro/claim/${encodeURIComponent(ref)}`, payload);
      const data: { tradesmanId: number; dashboardUrl: string } = await res.json();
      setLocation(`/founding-pro/welcome?tradesmanId=${data.tradesmanId}`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Please try again in a moment.";
      toast({ title: "Something went wrong", description: msg, variant: "destructive" });
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) {
    return (
      <Layout>
        <section className="mx-auto max-w-2xl px-4 py-24 text-center sm:px-6">
          <p className="text-muted-foreground" data-testid="text-loading">Loading your invite…</p>
        </section>
      </Layout>
    );
  }

  if (notFound || !invite) {
    return (
      <Layout>
        <section className="mx-auto max-w-2xl px-4 py-20 sm:px-6">
          <div className="rounded-lg border border-border bg-card p-8 text-center">
            <span className="inline-flex h-14 w-14 items-center justify-center rounded-full bg-destructive/10 text-destructive">
              <X className="h-8 w-8" />
            </span>
            <h1 className="mt-5 font-display text-2xl font-bold text-foreground" data-testid="heading-not-found">
              This invite link wasn't recognised
            </h1>
            <p className="mt-3 text-muted-foreground">
              The link may have expired or been mistyped. You can still register your interest and
              we'll set up your Founding Pro profile by hand.
            </p>
            <div className="mt-7 flex flex-wrap justify-center gap-3">
              <Button onClick={() => setLocation("/founding-pro/interest")} data-testid="button-go-interest">
                Register your interest
              </Button>
              <Button variant="outline" onClick={() => setLocation("/")} data-testid="button-back-home">
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
            {invite.recipientName ? `${invite.recipientName}, claim your` : "Claim your"} Founding Pro spot
          </h1>
          <p className="mt-4 text-white/70">
            We've pre-filled what we know about{" "}
            <strong className="text-white">{invite.companyName || "your business"}</strong> in{" "}
            <strong className="text-white">{invite.area}</strong>. Review it, add a few details, and
            publish — your 30-day free-unlock window starts the moment you do.
          </p>
          <div className="mt-6 flex flex-wrap gap-x-8 gap-y-2 text-sm text-white/60">
            <span className="flex items-center gap-1.5">
              <Check className="h-4 w-4 text-primary" /> No card required
            </span>
            <span className="flex items-center gap-1.5">
              <Clock className="h-4 w-4 text-primary" /> 60 seconds
            </span>
            <span className="flex items-center gap-1.5">
              <MapPin className="h-4 w-4 text-primary" /> {invite.area}
            </span>
          </div>
        </div>
      </section>

      {/* Form */}
      <section className="mx-auto max-w-3xl px-4 py-12 sm:px-6">
        <Card className="p-6 sm:p-8">
          <form onSubmit={onSubmit} className="space-y-5" data-testid="form-founding-pro-claim">
            {/* honeypot — invisible to humans, attractive to bots */}
            <div className="hidden" aria-hidden="true">
              <Label htmlFor="website_url">Website URL</Label>
              <Input
                id="website_url"
                tabIndex={-1}
                autoComplete="off"
                value={websiteUrl}
                onChange={(e) => setWebsiteUrl(e.target.value)}
              />
            </div>

            {/* Company name — readonly with edit toggle */}
            <div>
              <Label htmlFor="companyName">Company name</Label>
              <div className="flex items-center gap-2">
                <Input
                  id="companyName"
                  value={companyName}
                  readOnly={!editCompany}
                  onChange={(e) => setCompanyName(e.target.value)}
                  data-testid="input-company-name"
                  className={editCompany ? "" : "bg-muted/50"}
                />
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => setEditCompany((v) => !v)}
                  data-testid="button-edit-company"
                >
                  <Pencil className="mr-1 h-3.5 w-3.5" />
                  {editCompany ? "Done" : "Edit"}
                </Button>
              </div>
            </div>

            {/* Area — readonly */}
            <div>
              <Label htmlFor="area">Area</Label>
              <Input id="area" value={invite.area} readOnly className="bg-muted/50" data-testid="input-area" />
            </div>

            {/* Trades — multi-select chips */}
            <div>
              <Label>Trades you cover *</Label>
              <div className="mt-2 flex flex-wrap gap-2" data-testid="group-trades">
                {tradeOptions.map((t) => {
                  const active = trades.includes(t);
                  return (
                    <button
                      key={t}
                      type="button"
                      onClick={() => toggleTrade(t)}
                      data-testid={`chip-trade-${t}`}
                      className={
                        "rounded-full border px-3 py-1.5 text-sm capitalize transition-colors " +
                        (active
                          ? "border-primary bg-primary text-primary-foreground"
                          : "border-border bg-background text-foreground hover:bg-muted")
                      }
                    >
                      {active && <Check className="mr-1 inline h-3.5 w-3.5" />}
                      {t}
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Postcodes — multi-select chips + free-add */}
            <div>
              <Label>Postcodes you cover *</Label>
              <div className="mt-2 flex flex-wrap gap-2" data-testid="group-postcodes">
                {postcodeOptions.map((p) => {
                  const active = postcodes.includes(p);
                  return (
                    <button
                      key={p}
                      type="button"
                      onClick={() => togglePostcode(p)}
                      data-testid={`chip-postcode-${p}`}
                      className={
                        "rounded-full border px-3 py-1.5 text-sm transition-colors " +
                        (active
                          ? "border-primary bg-primary text-primary-foreground"
                          : "border-border bg-background text-foreground hover:bg-muted")
                      }
                    >
                      {active && <Check className="mr-1 inline h-3.5 w-3.5" />}
                      {p}
                    </button>
                  );
                })}
              </div>
              <div className="mt-3 flex gap-2">
                <Input
                  value={newPostcode}
                  onChange={(e) => setNewPostcode(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      addPostcode();
                    }
                  }}
                  placeholder="Add another postcode, e.g. SW19"
                  data-testid="input-add-postcode"
                />
                <Button type="button" variant="outline" onClick={addPostcode} data-testid="button-add-postcode">
                  Add
                </Button>
              </div>
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <Label htmlFor="phone">Phone (shown to homeowners) *</Label>
                <Input
                  id="phone"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  data-testid="input-phone"
                  placeholder="020 1234 5678"
                />
              </div>
              <div>
                <Label htmlFor="website">Website (optional)</Label>
                <Input
                  id="website"
                  value={website}
                  onChange={(e) => setWebsite(e.target.value)}
                  data-testid="input-website"
                  placeholder="https://…"
                />
              </div>
            </div>

            {/* Bio with live char counter */}
            <div>
              <div className="flex items-center justify-between">
                <Label htmlFor="bio">Short bio *</Label>
                <span
                  className={
                    "text-xs " +
                    (bio.trim().length >= 10 && bio.trim().length <= 600
                      ? "text-muted-foreground"
                      : "text-destructive")
                  }
                  data-testid="text-bio-counter"
                >
                  {bio.trim().length}/600
                </span>
              </div>
              <Textarea
                id="bio"
                rows={4}
                value={bio}
                onChange={(e) => setBio(e.target.value)}
                data-testid="input-bio"
                placeholder="e.g. Gas Safe registered plumbers covering Wandsworth since 2014 — boiler, leak, and bathroom work. 24/7 emergency call-outs."
              />
            </div>

            <div className="flex items-start gap-3">
              <Checkbox
                id="marketingConsent"
                checked={marketingConsent}
                onCheckedChange={(v) => setMarketingConsent(v === true)}
                data-testid="checkbox-consent"
              />
              <Label htmlFor="marketingConsent" className="text-sm font-normal text-muted-foreground">
                I agree TradesmanFinder can email me about my Founding Pro profile, leads, and my
                dashboard link. We never share your details. *
              </Label>
            </div>

            <div className="flex justify-end">
              <Button type="submit" size="lg" disabled={submitting} data-testid="button-submit-claim">
                {submitting ? "Publishing…" : "Publish my Founding Pro profile"}
              </Button>
            </div>
          </form>
        </Card>
      </section>
    </Layout>
  );
}

export function FoundingProWelcome() {
  const { toast } = useToast();
  const [, setLocation] = useLocation();
  const [tradesmanId, setTradesmanId] = useState<string | null>(null);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const params = new URLSearchParams(window.location.search);
    setTradesmanId(params.get("tradesmanId"));
  }, []);

  const dashboardUrl =
    typeof window !== "undefined" ? `${window.location.origin}/#/dashboard` : "/#/dashboard";

  const copyLink = async () => {
    try {
      await navigator.clipboard.writeText(dashboardUrl);
      toast({ title: "Copied", description: "Dashboard link copied to your clipboard." });
    } catch {
      toast({ title: "Couldn't copy", description: dashboardUrl, variant: "destructive" });
    }
  };

  return (
    <Layout>
      <section className="mx-auto max-w-2xl px-4 py-20 sm:px-6">
        <div className="rounded-lg border border-border bg-card p-8 text-center">
          <span className="inline-flex h-14 w-14 items-center justify-center rounded-full bg-trust/10 text-trust">
            <CheckCircle2 className="h-8 w-8" />
          </span>
          <h1 className="mt-5 font-display text-2xl font-bold text-foreground" data-testid="heading-welcome">
            You're in.
          </h1>
          <p className="mt-3 text-muted-foreground" data-testid="text-welcome-body">
            We've emailed you the dashboard link. Your Founding Pro profile is live and your 30-day
            free-unlock window starts now.
          </p>
          <div className="mt-7 flex flex-wrap justify-center gap-3">
            <Button onClick={copyLink} data-testid="button-copy-link">
              Copy my dashboard link
            </Button>
            <Button variant="outline" onClick={() => setLocation("/dashboard")} data-testid="button-open-dashboard">
              Open dashboard
            </Button>
          </div>
          {tradesmanId && (
            <p className="mt-4 text-xs text-muted-foreground" data-testid="text-tradesman-id">
              Profile #{tradesmanId}
            </p>
          )}
        </div>
      </section>
    </Layout>
  );
}
