import { useState } from "react";
import { PartnerPlacement } from "@/components/partner-placement";
import { Link } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { Layout } from "@/components/layout";
import { StarRating } from "@/components/brand";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import type { DashboardData } from "@/lib/api-types";
import { timeAgo } from "@/lib/api-types";
import { Wallet, Inbox, Star, TrendingUp, CheckCircle2, Phone, Mail, Plus, LogIn, Zap, Gavel, AlertTriangle, Ban, Square, Info } from "lucide-react";
import { CardBadge } from "@/components/card-badge";

// Lead pack catalogue. The `priceEnvKey` matches a STRIPE_PRICE_LEAD_PACK_*
// env var exposed to the client via Vite's VITE_ prefix. If the env var is
// missing at build time the pack falls back to the legacy /api/credits/buy
// path so dev environments without Stripe still work.
const PACKS = [
  { credits: 5,  price: "£25", priceId: import.meta.env.VITE_STRIPE_PRICE_LEAD_PACK_5  as string | undefined },
  { credits: 10, price: "£45", priceId: import.meta.env.VITE_STRIPE_PRICE_LEAD_PACK_10 as string | undefined },
  { credits: 20, price: "£80", priceId: import.meta.env.VITE_STRIPE_PRICE_LEAD_PACK_20 as string | undefined },
];

// Read ?id= from the hash query string (hash router keeps query after the path).
function getInitialId(): number | null {
  const hash = window.location.hash; // e.g. #/dashboard?id=2
  const qIdx = hash.indexOf("?");
  if (qIdx === -1) return null;
  const params = new URLSearchParams(hash.slice(qIdx + 1));
  const id = params.get("id");
  return id ? Number(id) : null;
}

export default function Dashboard() {
  const { toast } = useToast();
  const [tradesmanId, setTradesmanId] = useState<number | null>(getInitialId());
  const [loginEmail, setLoginEmail] = useState("");
  const [loggingIn, setLoggingIn] = useState(false);
  const [buying, setBuying] = useState<number | null>(null);

  const { data, isLoading } = useQuery<DashboardData>({
    queryKey: ["/api/dashboard", tradesmanId],
    queryFn: async () => (await apiRequest("GET", `/api/dashboard/${tradesmanId}`)).json(),
    enabled: !!tradesmanId,
  });

  const [bannedNotice, setBannedNotice] = useState<string | null>(null);

  const login = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!loginEmail) return;
    setLoggingIn(true);
    setBannedNotice(null);
    try {
      const res = await apiRequest("GET", `/api/tradesmen/login/${encodeURIComponent(loginEmail)}`);
      const t = await res.json();
      setTradesmanId(t.id);
    } catch (err: any) {
      let banned = false;
      let msg = "";
      try {
        const body = await err?.response?.json?.();
        if (body?.banned) { banned = true; msg = body.message; }
      } catch {}
      if (banned) {
        setBannedNotice(msg || "This account has been permanently banned.");
      } else {
        toast({ title: "No account found", description: "Try the seed account: plumsteadplumbingandheatingltd@example.co.uk", variant: "destructive" });
      }
    } finally {
      setLoggingIn(false);
    }
  };

  // Redirect to Stripe Checkout for a lead pack purchase. Credits are
  // granted by the webhook handler after Stripe confirms payment — the user
  // returns to /#/dashboard?id=...&purchase=success.
  const buyCredits = async (credits: number, priceId: string | undefined) => {
    if (!tradesmanId) return;
    setBuying(credits);
    try {
      if (priceId) {
        const res = await apiRequest("POST", "/api/checkout/lead-pack", { tradesmanId, priceId });
        const body = await res.json();
        if (!body?.url) throw new Error("No checkout URL returned");
        window.location.href = body.url;
        return; // do not clear `buying` — page is unloading
      }
      // Fallback (dev environments without Stripe env vars): legacy fake path.
      await apiRequest("POST", "/api/credits/buy", { tradesmanId, credits, reason: `Purchased ${credits} credit pack (dev)` });
      queryClient.invalidateQueries({ queryKey: ["/api/dashboard", tradesmanId] });
      toast({ title: "Credits added", description: `${credits} lead credits added to your balance (dev mode).` });
    } catch {
      toast({ title: "Payment failed", description: "Please try again.", variant: "destructive" });
    } finally {
      setBuying(null);
    }
  };

  // ── Login gate ──
  if (!tradesmanId) {
    return (
      <Layout>
        <div className="mx-auto flex max-w-md flex-col px-4 py-20">
          <div className="text-center">
            <span className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-primary/10 text-primary"><LogIn className="h-7 w-7" /></span>
            <h1 className="mt-4 font-display text-2xl font-bold text-foreground">Tradesman sign in</h1>
            <p className="mt-2 text-muted-foreground">Enter your registered email to view your leads and credits.</p>
          </div>
          <Card className="mt-8 p-6">
            <form onSubmit={login} className="space-y-4">
              <div>
                <Label htmlFor="le">Email address</Label>
                <Input id="le" type="email" value={loginEmail} onChange={(e) => setLoginEmail(e.target.value)} placeholder="you@yourbusiness.co.uk" data-testid="input-login-email" />
              </div>
              <Button type="submit" className="w-full" disabled={loggingIn} data-testid="button-login">{loggingIn ? "Signing in…" : "Sign in"}</Button>
              {bannedNotice && (
                <div className="flex items-start gap-2 rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive" data-testid="banner-login-banned">
                  <Ban className="mt-0.5 h-4 w-4 flex-shrink-0" />
                  <span>{bannedNotice}</span>
                </div>
              )}
            </form>
            <div className="mt-4 rounded-lg bg-muted/60 p-3 text-xs text-muted-foreground">
              <p className="font-medium text-foreground">Demo account</p>
              <button className="mt-1 underline hover:text-primary" onClick={() => setLoginEmail("plumsteadplumbingandheatingltd@example.co.uk")} data-testid="button-demo-fill">
                plumsteadplumbingandheatingltd@example.co.uk
              </button>
            </div>
            <p className="mt-4 text-center text-sm text-muted-foreground">No account? <Link href="/join" className="font-medium text-primary hover:underline">Create one free</Link></p>
          </Card>
        </div>
      </Layout>
    );
  }

  if (isLoading || !data) {
    return <Layout><div className="mx-auto max-w-7xl px-4 py-20"><div className="h-72 animate-pulse rounded-xl bg-muted" /></div></Layout>;
  }

  const t = data.tradesman;
  const openLeads = data.leads.filter((l) => l.job.status !== "closed");

  return (
    <Layout>
      <div className="border-b border-border bg-navy">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-4 px-4 py-8 sm:px-6">
          <div className="flex items-center gap-4">
            <span className="flex h-12 w-12 items-center justify-center rounded-full bg-white/10 font-display text-lg font-bold text-white">{t.businessName.charAt(0)}</span>
            <div>
              <div className="flex items-center gap-2">
                <h1 className="font-display text-xl font-bold text-white" data-testid="text-dashboard-business">{t.businessName}</h1>
                {t.verified && <Badge className="bg-trust text-white hover:bg-trust">Verified</Badge>}
                {t.featured && <Badge className="bg-primary text-primary-foreground hover:bg-primary">Featured</Badge>}
              </div>
              <p className="text-sm text-white/60">Welcome back, {t.ownerName.split(" ")[0]}</p>
            </div>
          </div>
          <Link href={`/tradesman/${t.slug}`}><Button variant="outline" className="border-white/30 bg-transparent text-white hover:bg-white/10 hover:text-white" data-testid="button-view-public">View public profile</Button></Link>
        </div>
      </div>

      <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6">
        {/* Stat cards */}
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <Card className="p-5">
            <div className="flex items-center justify-between"><span className="text-sm text-muted-foreground">Credit balance</span><Wallet className="h-4 w-4 text-primary" /></div>
            <p className="mt-2 font-display text-2xl font-bold text-foreground" data-testid="text-credit-balance">{data.credits}</p>
          </Card>
          <Card className="p-5">
            <div className="flex items-center justify-between"><span className="text-sm text-muted-foreground">Open leads</span><Inbox className="h-4 w-4 text-primary" /></div>
            <p className="mt-2 font-display text-2xl font-bold text-foreground" data-testid="text-open-leads">{openLeads.length}</p>
          </Card>
          <Card className="p-5">
            <div className="flex items-center justify-between"><span className="text-sm text-muted-foreground">Rating</span><Star className="h-4 w-4 text-primary" /></div>
            <p className="mt-2 flex items-center gap-2 font-display text-2xl font-bold text-foreground">{t.ratingAverage.toFixed(1)}<StarRating value={t.ratingAverage} size={15} /></p>
          </Card>
          <Card className="p-5">
            <div className="flex items-center justify-between"><span className="text-sm text-muted-foreground">Total reviews</span><TrendingUp className="h-4 w-4 text-primary" /></div>
            <p className="mt-2 font-display text-2xl font-bold text-foreground">{t.ratingCount}</p>
          </Card>
        </div>

        {/* Conduct banner */}
        {data.cardSummary?.publicBadge && (
          <div
            className={
              "mt-6 flex items-start gap-3 rounded-lg border p-4 " +
              (data.cardSummary.highestActive === "red"
                ? "border-destructive/40 bg-destructive/5"
                : data.cardSummary.highestActive === "yellow"
                ? "border-yellow-300 bg-yellow-50"
                : "border-amber-300 bg-amber-50")
            }
            data-testid="banner-conduct"
          >
            <Gavel className="mt-0.5 h-5 w-5 text-foreground/70" />
            <div className="min-w-0">
              <p className="text-sm font-semibold text-foreground">
                {data.cardSummary.highestActive === "red" && "Your account has been permanently banned (Red card)."}
                {data.cardSummary.highestActive === "yellow" && "You have an active Yellow card."}
                {data.cardSummary.highestActive === "warning" && "You have an active formal warning."}
              </p>
              <p className="mt-1 text-sm text-foreground/80">
                {data.cardSummary.highestActive === "red"
                  ? "Your profile is hidden from the public directory. Contact support to appeal."
                  : data.cardSummary.highestActive === "yellow"
                  ? `Featured status is revoked while this card is active.${data.cardSummary.suspendedUntil ? ` You are excluded from new job matches until ${new Date(data.cardSummary.suspendedUntil).toLocaleDateString("en-GB")}.` : ""}`
                  : "A third substantiated complaint within the warning window will result in escalation. Reasons are listed in the Conduct tab below."}
              </p>
            </div>
          </div>
        )}

        <Tabs defaultValue="leads" className="mt-8">
          <TabsList>
            <TabsTrigger value="leads" data-testid="tab-leads">Leads</TabsTrigger>
            <TabsTrigger value="credits" data-testid="tab-credits">Credits</TabsTrigger>
            <TabsTrigger value="reviews" data-testid="tab-reviews">Reviews</TabsTrigger>
            <TabsTrigger value="conduct" data-testid="tab-conduct">
              Conduct{data.cardSummary && (data.cardSummary.warnings + data.cardSummary.yellows + data.cardSummary.reds) > 0 ? ` (${data.cardSummary.warnings + data.cardSummary.yellows + data.cardSummary.reds})` : ""}
            </TabsTrigger>
          </TabsList>

          {/* Leads */}
          <TabsContent value="leads" className="mt-5">
            <div className="space-y-3">
              {data.leads.length === 0 && <Card className="p-8 text-center text-muted-foreground">No leads yet. Keep your profile complete to attract more enquiries.</Card>}
              {data.leads.map(({ quote, job }) => (
                <Card key={quote.id} className="p-5" data-testid={`lead-${quote.id}`}>
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <h3 className="font-semibold text-foreground">{job.title}</h3>
                        {job.urgency === "emergency" && <Badge variant="destructive">Emergency</Badge>}
                      </div>
                      <p className="mt-1 text-sm text-muted-foreground">{job.description}</p>
                      <div className="mt-3 flex flex-wrap gap-4 text-sm text-muted-foreground">
                        <span>📍 {job.postcode}</span>
                        {job.budgetRange && <span>💷 {job.budgetRange}</span>}
                        <span>🕑 {timeAgo(job.createdAt)}</span>
                      </div>
                    </div>
                    <Badge variant="secondary" className="capitalize">{quote.status}</Badge>
                  </div>
                  <div className="mt-4 flex flex-wrap gap-3 border-t border-border pt-4 text-sm">
                    <a href={`tel:${job.customerPhone}`} className="flex items-center gap-1.5 text-foreground hover:text-primary"><Phone className="h-4 w-4 text-primary" /> {job.customerPhone}</a>
                    <a href={`mailto:${job.customerEmail}`} className="flex items-center gap-1.5 text-foreground hover:text-primary"><Mail className="h-4 w-4 text-primary" /> {job.customerEmail}</a>
                    <span className="text-muted-foreground">· {job.customerName}</span>
                  </div>
                </Card>
              ))}
            </div>
          </TabsContent>

          {/* Credits */}
          <TabsContent value="credits" className="mt-5">
            <Card className="p-6">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-muted-foreground">Current balance</p>
                  <p className="font-display text-2xl font-bold text-foreground">{data.credits} credits</p>
                </div>
                <span className="flex h-12 w-12 items-center justify-center rounded-full bg-primary/10 text-primary"><Zap className="h-6 w-6" /></span>
              </div>
              <h3 className="mt-6 font-display text-base font-semibold text-foreground">Buy more credits</h3>
              <div className="mt-3 grid gap-3 sm:grid-cols-3">
                {PACKS.map((p) => (
                  <Card key={p.credits} className="p-4 text-center">
                    <p className="font-display text-xl font-bold text-foreground">{p.credits}</p>
                    <p className="text-sm text-muted-foreground">credits · {p.price}</p>
                    <Button className="mt-3 w-full" size="sm" disabled={buying === p.credits} onClick={() => buyCredits(p.credits, p.priceId)} data-testid={`button-buy-${p.credits}`}>
                      <Plus className="mr-1 h-4 w-4" />{buying === p.credits ? "Processing…" : "Buy"}
                    </Button>
                  </Card>
                ))}
              </div>
              <p className="mt-3 text-xs text-muted-foreground">Secure checkout via Stripe. Credits are added automatically after payment.</p>

              <h3 className="mt-8 font-display text-base font-semibold text-foreground">Transaction history</h3>
              <div className="mt-3 divide-y divide-border">
                {data.transactions.map((tx) => (
                  <div key={tx.id} className="flex items-center justify-between py-2.5 text-sm" data-testid={`tx-${tx.id}`}>
                    <span className="text-foreground">{tx.reason}</span>
                    <span className={`font-medium ${tx.amount >= 0 ? "text-trust" : "text-destructive"}`}>{tx.amount >= 0 ? "+" : ""}{tx.amount}</span>
                  </div>
                ))}
              </div>
            </Card>
          </TabsContent>

          {/* Conduct / Card history */}
          <TabsContent value="conduct" className="mt-5">
            <Card className="p-6">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <h3 className="font-display text-base font-semibold text-foreground">Disciplinary record</h3>
                  <p className="mt-1 text-sm text-muted-foreground">
                    Cards are issued only for substantiated customer complaints or verified negative reviews.
                    Three strikes (Warning → Yellow → Red) results in removal from TradesmanFinder.
                  </p>
                </div>
                {data.cardSummary?.publicBadge && <CardBadge summary={data.cardSummary} />}
              </div>

              <div className="mt-6 grid grid-cols-3 gap-3">
                <ConductStat icon={<AlertTriangle className="h-4 w-4 text-amber-600" />} label="Warnings" value={data.cardSummary?.warnings ?? 0} />
                <ConductStat icon={<Square className="h-4 w-4 fill-yellow-400 text-yellow-500" />} label="Yellow cards" value={data.cardSummary?.yellows ?? 0} />
                <ConductStat icon={<Ban className="h-4 w-4 text-destructive" />} label="Red cards" value={data.cardSummary?.reds ?? 0} tone={data.cardSummary?.reds ? "destructive" : undefined} />
              </div>

              <h4 className="mt-8 font-display text-sm font-semibold text-foreground">Card history</h4>
              {(!data.cards || data.cards.length === 0) ? (
                <div className="mt-3 rounded-md border border-dashed border-border bg-muted/30 p-6 text-center text-sm text-muted-foreground">
                  <CheckCircle2 className="mx-auto mb-2 h-6 w-6 text-trust" />
                  Clean record — no disciplinary action on file.
                </div>
              ) : (
                <div className="mt-3 space-y-3">
                  {[...data.cards].sort((a, b) => b.issuedAt - a.issuedAt).map((c) => {
                    const active = !c.rescindedAt && (!c.expiresAt || c.expiresAt > Date.now());
                    const tone =
                      c.cardType === "red" ? "border-destructive/40 bg-destructive/5" :
                      c.cardType === "yellow" ? "border-yellow-300 bg-yellow-50/60" :
                      "border-amber-300 bg-amber-50/60";
                    return (
                      <div key={c.id} className={`rounded-lg border p-4 ${tone}`} data-testid={`my-card-${c.id}`}>
                        <div className="flex flex-wrap items-start justify-between gap-2">
                          <div className="flex items-center gap-2">
                            {c.cardType === "red" && <Ban className="h-4 w-4 text-destructive" />}
                            {c.cardType === "yellow" && <Square className="h-4 w-4 fill-yellow-400 text-yellow-500" />}
                            {c.cardType === "warning" && <AlertTriangle className="h-4 w-4 text-amber-600" />}
                            <span className="font-semibold capitalize text-foreground">{c.cardType} card</span>
                            {c.grossMisconduct && <Badge variant="destructive" className="text-[10px]">Gross misconduct</Badge>}
                            {active ? (
                              <Badge variant="destructive" className="text-[10px]">Active</Badge>
                            ) : c.rescindedAt ? (
                              <Badge variant="secondary" className="text-[10px]">Rescinded</Badge>
                            ) : (
                              <Badge variant="outline" className="text-[10px]">Expired</Badge>
                            )}
                          </div>
                          <div className="text-right text-xs text-muted-foreground">
                            <div>Issued {new Date(c.issuedAt).toLocaleDateString("en-GB", { dateStyle: "medium" })}</div>
                            <div>{c.expiresAt ? `Expires ${new Date(c.expiresAt).toLocaleDateString("en-GB", { dateStyle: "medium" })}` : "Permanent"}</div>
                          </div>
                        </div>
                        {c.reason && (
                          <div className="mt-3 rounded-md bg-white/60 p-3 text-sm text-foreground/90">
                            <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Reason</div>
                            <p className="mt-1">{c.reason}</p>
                          </div>
                        )}
                        {c.rescindedAt && (
                          <div className="mt-2 rounded-md bg-white/60 p-3 text-sm text-foreground/80">
                            <div className="text-xs font-semibold uppercase tracking-wide text-trust">Rescinded</div>
                            <p className="mt-1">{new Date(c.rescindedAt).toLocaleDateString("en-GB", { dateStyle: "medium" })}{c.rescindedReason ? ` — ${c.rescindedReason}` : ""}</p>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}

              <div className="mt-6 flex items-start gap-2 rounded-md border border-border bg-muted/30 p-3 text-xs text-muted-foreground">
                <Info className="mt-0.5 h-3.5 w-3.5 flex-shrink-0" />
                <span>
                  To appeal a card, email <a className="text-primary hover:underline" href="mailto:support@tradesmanfinder.com">support@tradesmanfinder.com</a> with the card date and supporting evidence.
                </span>
              </div>
            </Card>
          </TabsContent>

          {/* Reviews */}
          <TabsContent value="reviews" className="mt-5">
            <div className="space-y-3">
              {data.reviews.length === 0 && <Card className="p-8 text-center text-muted-foreground">No reviews yet.</Card>}
              {data.reviews.map((r) => (
                <Card key={r.id} className="p-5" data-testid={`review-${r.id}`}>
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <span className="flex h-9 w-9 items-center justify-center rounded-full bg-navy text-sm font-semibold text-white">{r.customerName.charAt(0)}</span>
                      <div>
                        <p className="text-sm font-semibold text-foreground">{r.customerName}</p>
                        <p className="text-xs text-muted-foreground">{timeAgo(r.createdAt)}{r.verified ? " · Verified" : ""}</p>
                      </div>
                    </div>
                    <StarRating value={r.rating} size={14} />
                  </div>
                  {r.title && <p className="mt-2 text-sm font-medium text-foreground">{r.title}</p>}
                  <p className="mt-1 text-sm text-muted-foreground">{r.body}</p>
                </Card>
              ))}
            </div>
          </TabsContent>
        </Tabs>
        <PartnerPlacement surface="dashboard_sidebar" className="mt-6" />
      </div>
    </Layout>
  );
}

function ConductStat({ icon, label, value, tone }: { icon: React.ReactNode; label: string; value: number; tone?: "destructive" }) {
  return (
    <div className={"rounded-lg border p-3 " + (tone === "destructive" ? "border-destructive/30 bg-destructive/5" : "border-border bg-card")}>
      <div className="flex items-center justify-between">
        <span className="text-xs text-muted-foreground">{label}</span>
        {icon}
      </div>
      <p className={"mt-1 font-display text-xl font-bold " + (tone === "destructive" ? "text-destructive" : "text-foreground")}>
        {value}
      </p>
    </div>
  );
}
