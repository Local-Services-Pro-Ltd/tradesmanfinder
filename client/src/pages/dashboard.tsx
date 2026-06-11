import { useState } from "react";
import { PartnerPlacement } from "@/components/partner-placement";
import { Link, useLocation } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { Layout } from "@/components/layout";
import { StarRating } from "@/components/brand";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient, getQueryFn } from "@/lib/queryClient";
import type { DashboardData, Tradesman } from "@/lib/api-types";
import { timeAgo } from "@/lib/api-types";
import { getFeaturedState, formatFeaturedDate, type FeaturedState } from "@shared/featured-state";
import { Wallet, Inbox, Star, TrendingUp, CheckCircle2, Phone, Mail, Plus, LogIn, Zap, Gavel, AlertTriangle, AlertCircle, Ban, Square, Info, LogOut, CreditCard } from "lucide-react";
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

// Featured Listing monthly subscription price. Server validates that this
// Stripe price ID resolves to the Featured product before opening Checkout
// (PR-E3a), so a misconfigured env can't silently sell something else.
const FEATURED_PRICE_ID = import.meta.env.VITE_STRIPE_PRICE_FEATURED_MONTHLY as string | undefined;
const FEATURED_PRICE_LABEL = "£49/mo";

// Identity is now session-driven: GET /api/auth/me returns the signed-in
// tradesman (or 401 if not signed in). The `?id=` URL parameter is no longer
// the source of truth — the session cookie is.

export default function Dashboard() {
  const { toast } = useToast();
  const [, navigate] = useLocation();
  const [buying, setBuying] = useState<number | null>(null);
  const [signingOut, setSigningOut] = useState(false);
  const [openingPortal, setOpeningPortal] = useState(false);
  const [subscribing, setSubscribing] = useState(false);

  // Identity probe. `on401: returnNull` so we can render the signed-out CTA
  // without throwing. retry:false so a real outage doesn't spin.
  const { data: me, isLoading: meLoading } = useQuery<{ tradesman: Tradesman } | null>({
    queryKey: ["/api/auth/me"],
    queryFn: getQueryFn({ on401: "returnNull" }),
    retry: false,
  });

  const tradesmanId = me?.tradesman?.id ?? null;

  const { data, isLoading } = useQuery<DashboardData>({
    queryKey: ["/api/dashboard", tradesmanId],
    queryFn: async () => (await apiRequest("GET", `/api/dashboard/${tradesmanId}`)).json(),
    enabled: !!tradesmanId,
  });

  const signOut = async () => {
    setSigningOut(true);
    try {
      await apiRequest("POST", "/api/auth/logout");
    } catch {
      // Even if the server call fails, wipe local cache and bounce — the
      // cookie may already be invalid.
    } finally {
      // Drop every cached query so the next sign-in starts fresh.
      queryClient.clear();
      setSigningOut(false);
      navigate("/sign-in");
    }
  };

  // Start the Featured Listing subscription. Reuses the PR-E3a endpoint;
  // server validates the price ID maps to the Featured product before
  // opening Checkout. Returns the user to /checkout/return?kind=featured.
  const subscribeFeatured = async () => {
    if (!tradesmanId) return;
    if (!FEATURED_PRICE_ID) {
      toast({
        title: "Featured listing unavailable",
        description: "Stripe is not configured for Featured subscriptions. Please contact support.",
        variant: "destructive",
      });
      return;
    }
    setSubscribing(true);
    try {
      const res = await apiRequest("POST", "/api/checkout/featured", { tradesmanId, priceId: FEATURED_PRICE_ID });
      const body = await res.json();
      if (!body?.url) throw new Error("No checkout URL returned");
      window.location.href = body.url;
      return; // page unloading
    } catch {
      toast({
        title: "Couldn’t start Featured subscription",
        description: "Please try again, or contact support if the issue persists.",
        variant: "destructive",
      });
    } finally {
      setSubscribing(false);
    }
  };

  // Open Stripe's hosted Customer Billing Portal. The endpoint returns a
  // short-lived URL we redirect the browser to; the portal handles all
  // payment-method, invoice, and cancellation flows for us. Returns the user
  // back to /checkout/return?kind=portal when they're done.
  const openBillingPortal = async () => {
    if (!tradesmanId) return;
    setOpeningPortal(true);
    try {
      const res = await apiRequest("POST", "/api/billing/portal", { tradesmanId });
      const body = await res.json();
      if (!body?.url) throw new Error("No portal URL returned");
      window.location.href = body.url;
      return; // page unloading
    } catch {
      toast({
        title: "Couldn’t open billing portal",
        description: "Please try again, or contact support if the issue persists.",
        variant: "destructive",
      });
    } finally {
      setOpeningPortal(false);
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

  // ── Loading the identity probe ──
  if (meLoading) {
    return (
      <Layout>
        <div className="mx-auto max-w-7xl px-4 py-20">
          <div className="h-72 animate-pulse rounded-xl bg-muted" />
        </div>
      </Layout>
    );
  }

  // ── Signed-out gate ──
  if (!tradesmanId) {
    return (
      <Layout>
        <div className="mx-auto flex max-w-md flex-col px-4 py-20">
          <div className="text-center">
            <span className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-primary/10 text-primary">
              <LogIn className="h-7 w-7" />
            </span>
            <h1 className="mt-4 font-display text-2xl font-bold text-foreground">Please sign in</h1>
            <p className="mt-2 text-muted-foreground">
              You need to be signed in to view your dashboard.
            </p>
          </div>
          <Card className="mt-8 p-6 text-center">
            <Link href="/sign-in">
              <Button className="w-full" data-testid="button-go-signin">
                Go to sign in
              </Button>
            </Link>
            <p className="mt-4 text-sm text-muted-foreground">
              New tradesman?{" "}
              <Link href="/join" className="font-medium text-primary hover:underline">
                Create an account
              </Link>
            </p>
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
              <div className="flex flex-wrap items-center gap-2">
                <h1 className="font-display text-xl font-bold text-white" data-testid="text-dashboard-business">{t.businessName}</h1>
                {t.verified && <Badge className="bg-trust text-white hover:bg-trust">Verified</Badge>}
                {t.featured && <Badge className="bg-primary text-primary-foreground hover:bg-primary">Featured</Badge>}
                {/* past_due pill (PR-D3) — amber chip with payment-failed copy.
                    Sits next to Featured/Verified so it's the first thing a
                    tradesperson sees on the dashboard, before they scroll to
                    the Featured card. Visible regardless of featuredUntil
                    because past_due is a billing failure, not a state-machine
                    derivation. Clicking opens the Stripe portal to update
                    the payment method — same affordance as the Featured
                    card's past_due CTA, just promoted into the header. */}
                {t.subscriptionStatus === "past_due" && (
                  <button
                    type="button"
                    onClick={openBillingPortal}
                    disabled={openingPortal}
                    data-testid="badge-past-due"
                    className="inline-flex items-center gap-1 rounded-full border border-amber-300/60 bg-amber-100 px-2.5 py-0.5 text-xs font-semibold text-amber-900 transition hover:bg-amber-200 focus:outline-none focus:ring-2 focus:ring-amber-300 disabled:opacity-60"
                  >
                    <AlertCircle className="h-3 w-3" />
                    {openingPortal ? "Opening…" : "Payment failed — update card"}
                  </button>
                )}
              </div>
              <p className="text-sm text-white/60">Welcome back, {t.ownerName.split(" ")[0]}</p>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Link href={`/tradesman/${t.slug}`}><Button variant="outline" className="border-white/30 bg-transparent text-white hover:bg-white/10 hover:text-white" data-testid="button-view-public">View public profile</Button></Link>
            {/* Manage billing — only rendered for tradespeople who have a
                Stripe customer record (i.e. they’ve completed at least one
                Checkout). The endpoint returns 409 if customer is missing,
                so we gate at the UI to avoid a confusing error toast. */}
            {t.stripeCustomerId && (
              <Button
                variant="outline"
                className="border-white/30 bg-transparent text-white hover:bg-white/10 hover:text-white"
                disabled={openingPortal}
                onClick={openBillingPortal}
                data-testid="button-manage-billing"
              >
                <CreditCard className="mr-1.5 h-4 w-4" />
                {openingPortal ? "Opening…" : "Manage billing"}
              </Button>
            )}
            <Button
              variant="outline"
              className="border-white/30 bg-transparent text-white hover:bg-white/10 hover:text-white"
              disabled={signingOut}
              onClick={signOut}
              data-testid="button-signout"
            >
              <LogOut className="mr-1.5 h-4 w-4" />
              {signingOut ? "Signing out…" : "Sign out"}
            </Button>
          </div>
        </div>
      </div>

      <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6">
        {/* Stat cards */}
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <Card className="p-5">
            <div className="flex items-center justify-between"><span className="text-sm text-muted-foreground">Leads remaining</span><Wallet className="h-4 w-4 text-primary" /></div>
            <p className="mt-2 font-display text-2xl font-bold text-foreground" data-testid="text-credit-balance">{data.credits}</p>
            {/* PR-D3: "Credit balance" was ambiguous — 1 credit = 1 lead
                unlock. Surface that mapping explicitly under the number so
                tradespeople don't have to read the credits tab to learn
                what one credit buys. */}
            <p className="mt-1 text-xs text-muted-foreground" data-testid="text-credit-balance-sub">
              {data.credits === 1 ? "1 lead unlock available" : `${data.credits} lead unlocks available`}
            </p>
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

        {/* Featured listing card (PR-D2) — surface for the Featured monthly
            subscription. State machine in getFeaturedState():
              none      → upsell CTA
              active    → "Featured until DATE" + portal link
              past_due  → amber warning + portal link to update card
              lapsing   → "Ends DATE, resubscribe" + checkout CTA */}
        <FeaturedCard
          state={getFeaturedState(t.featuredUntil, t.subscriptionStatus)}
          featuredUntil={t.featuredUntil}
          priceLabel={FEATURED_PRICE_LABEL}
          subscribing={subscribing}
          openingPortal={openingPortal}
          stripeReady={Boolean(FEATURED_PRICE_ID)}
          hasCustomer={Boolean(t.stripeCustomerId)}
          onSubscribe={subscribeFeatured}
          onManage={openBillingPortal}
        />

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
                  To appeal a card, email <a className="text-primary hover:underline" href="mailto:support@tradesmanfinder.com">support@tradesmanfinder.com</a> with the card date and any supporting evidence.
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

// Featured listing surface. Pure-display component — every state derives from
// the `state` prop (computed by getFeaturedState). Kept here rather than a
// dedicated file because the parent owns subscribe / portal handlers and we
// want a single place to grep when iterating on copy.
function FeaturedCard({
  state,
  featuredUntil,
  priceLabel,
  subscribing,
  openingPortal,
  stripeReady,
  hasCustomer,
  onSubscribe,
  onManage,
}: {
  state: FeaturedState;
  featuredUntil: number | null;
  priceLabel: string;
  subscribing: boolean;
  openingPortal: boolean;
  stripeReady: boolean;
  hasCustomer: boolean;
  onSubscribe: () => void;
  onManage: () => void;
}) {
  const dateLabel = featuredUntil ? formatFeaturedDate(featuredUntil) : null;
  // Tone styling per state. We don't use the destructive variant for past_due
  // because it's a recoverable, customer-action-required state — amber
  // matches the conduct banner's "warning" tone for consistency.
  const toneClass =
    state === "active"
      ? "border-emerald-300 bg-emerald-50"
      : state === "past_due"
      ? "border-amber-300 bg-amber-50"
      : state === "lapsing"
      ? "border-border bg-card"
      : "border-primary/30 bg-primary/5";

  const heading =
    state === "active"
      ? "Featured listing active"
      : state === "past_due"
      ? "Featured listing — payment failed"
      : state === "lapsing"
      ? "Featured listing ending soon"
      : "Boost your visibility with Featured";

  const body =
    state === "active"
      ? `Featured until ${dateLabel}. Renews automatically.`
      : state === "past_due"
      ? `Your card was declined. Update your payment method to keep Featured status${dateLabel ? ` past ${dateLabel}` : ""}.`
      : state === "lapsing"
      ? `Featured ends ${dateLabel}. Resubscribe to keep your profile at the top of search.`
      : "Pin your profile to the top of search results for your trade and area. Cancel anytime.";

  return (
    <Card className={"mt-6 flex flex-col gap-4 p-5 sm:flex-row sm:items-center sm:justify-between " + toneClass} data-testid={`card-featured-${state}`}>
      <div className="flex items-start gap-3">
        <Zap className={"mt-0.5 h-5 w-5 " + (state === "active" ? "text-emerald-600" : state === "past_due" ? "text-amber-600" : "text-primary")} />
        <div className="min-w-0">
          <p className="font-display text-base font-semibold text-foreground" data-testid="text-featured-heading">{heading}</p>
          <p className="mt-1 text-sm text-foreground/80" data-testid="text-featured-body">{body}</p>
        </div>
      </div>
      <div className="flex shrink-0 flex-wrap gap-2">
        {/* CTA matrix:
              none     → Subscribe (£49/mo)
              active   → Manage billing (cancel/upgrade card)
              past_due → Update payment (→ portal)
              lapsing  → Renew Featured (new checkout) */}
        {state === "none" && (
          <Button onClick={onSubscribe} disabled={subscribing || !stripeReady} data-testid="button-featured-subscribe">
            <Zap className="mr-1.5 h-4 w-4" />
            {subscribing ? "Opening checkout…" : `Make my profile Featured · ${priceLabel}`}
          </Button>
        )}
        {state === "active" && (
          <Button variant="outline" onClick={onManage} disabled={openingPortal || !hasCustomer} data-testid="button-featured-manage">
            {openingPortal ? "Opening…" : "Manage billing"}
          </Button>
        )}
        {state === "past_due" && (
          <Button onClick={onManage} disabled={openingPortal || !hasCustomer} data-testid="button-featured-update-payment">
            {openingPortal ? "Opening…" : "Update payment method"}
          </Button>
        )}
        {state === "lapsing" && (
          <Button onClick={onSubscribe} disabled={subscribing || !stripeReady} data-testid="button-featured-renew">
            <Zap className="mr-1.5 h-4 w-4" />
            {subscribing ? "Opening checkout…" : "Renew Featured"}
          </Button>
        )}
      </div>
    </Card>
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
