import { useState } from "react";
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
import { Wallet, Inbox, Star, TrendingUp, CheckCircle2, Phone, Mail, Plus, LogIn, Zap } from "lucide-react";

const PACKS = [
  { credits: 5, price: "£25" },
  { credits: 10, price: "£45" },
  { credits: 20, price: "£80" },
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

  const login = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!loginEmail) return;
    setLoggingIn(true);
    try {
      const res = await apiRequest("GET", `/api/tradesmen/login/${encodeURIComponent(loginEmail)}`);
      const t = await res.json();
      setTradesmanId(t.id);
    } catch {
      toast({ title: "No account found", description: "Try the seed account: plumsteadplumbingandheatingltd@example.co.uk", variant: "destructive" });
    } finally {
      setLoggingIn(false);
    }
  };

  const buyCredits = async (credits: number) => {
    if (!tradesmanId) return;
    setBuying(credits);
    try {
      await apiRequest("POST", "/api/credits/buy", { tradesmanId, credits, reason: `Purchased ${credits} credit pack` });
      queryClient.invalidateQueries({ queryKey: ["/api/dashboard", tradesmanId] });
      toast({ title: "Credits added", description: `${credits} lead credits added to your balance.` });
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

        <Tabs defaultValue="leads" className="mt-8">
          <TabsList>
            <TabsTrigger value="leads" data-testid="tab-leads">Leads</TabsTrigger>
            <TabsTrigger value="credits" data-testid="tab-credits">Credits</TabsTrigger>
            <TabsTrigger value="reviews" data-testid="tab-reviews">Reviews</TabsTrigger>
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
                    <Button className="mt-3 w-full" size="sm" disabled={buying === p.credits} onClick={() => buyCredits(p.credits)} data-testid={`button-buy-${p.credits}`}>
                      <Plus className="mr-1 h-4 w-4" />{buying === p.credits ? "Processing…" : "Buy"}
                    </Button>
                  </Card>
                ))}
              </div>
              <p className="mt-3 text-xs text-muted-foreground">Demo checkout — no real payment is taken. Stripe integration is on the roadmap.</p>

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
      </div>
    </Layout>
  );
}
