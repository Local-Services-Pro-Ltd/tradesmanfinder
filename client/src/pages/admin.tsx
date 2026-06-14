import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Layout } from "@/components/layout";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import type { Tradesman, Job } from "@/lib/api-types";
import { ShieldAlert, Users, BadgeCheck, Clock, Briefcase, PoundSterling, Star, Gavel, Globe, ShieldCheck } from "lucide-react";
import { Link } from "wouter";
import { IssueCardDialog } from "@/components/issue-card-dialog";
import { CardBadge } from "@/components/card-badge";

interface Overview {
  tradesmen: Tradesman[];
  jobs: Job[];
  pending: Tradesman[];
  stats: { totalTradesmen: number; verified: number; pending: number; totalJobs: number; openJobs: number; totalLeads: number; leadRevenue: number; carded: number; banned: number };
}

function getInitialKey(): string {
  const hash = window.location.hash;
  const qIdx = hash.indexOf("?");
  if (qIdx === -1) return "";
  return new URLSearchParams(hash.slice(qIdx + 1)).get("key") || "";
}

export default function Admin() {
  const { toast } = useToast();
  const [key, setKey] = useState(getInitialKey());
  const [authKey, setAuthKey] = useState(getInitialKey());

  const { data, isLoading, isError } = useQuery<Overview>({
    queryKey: ["/api/admin/overview", authKey],
    queryFn: async () => (await apiRequest("GET", `/api/admin/overview?key=${encodeURIComponent(authKey)}`)).json(),
    enabled: !!authKey,
    retry: false,
  });

  const act = async (id: number, action: "verify" | "feature") => {
    try {
      await apiRequest("POST", `/api/admin/tradesmen/${id}/${action}?key=${encodeURIComponent(authKey)}`, {});
      queryClient.invalidateQueries({ queryKey: ["/api/admin/overview", authKey] });
      queryClient.invalidateQueries({ queryKey: ["/api/tradesmen"] });
      toast({ title: action === "verify" ? "Tradesman verified" : "Featured status toggled" });
    } catch {
      toast({ title: "Action failed", variant: "destructive" });
    }
  };

  // ── Auth gate ──
  if (!authKey || isError) {
    return (
      <Layout>
        <div className="mx-auto max-w-md px-4 py-20">
          <div className="text-center">
            <span className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-destructive/10 text-destructive"><ShieldAlert className="h-7 w-7" /></span>
            <h1 className="mt-4 font-display text-2xl font-bold text-foreground">Admin access</h1>
            <p className="mt-2 text-muted-foreground">Enter your admin key to manage the marketplace.</p>
          </div>
          <Card className="mt-8 p-6">
            <form onSubmit={(e) => { e.preventDefault(); setAuthKey(key); }} className="space-y-4">
              <div>
                <Label htmlFor="ak">Admin key</Label>
                <Input id="ak" type="password" value={key} onChange={(e) => setKey(e.target.value)} placeholder="Enter admin key" data-testid="input-admin-key" />
              </div>
              {isError && authKey && <p className="text-sm text-destructive">Invalid key — please try again.</p>}
              <Button type="submit" className="w-full" data-testid="button-admin-login">Unlock dashboard</Button>
            </form>
          </Card>
        </div>
      </Layout>
    );
  }

  if (isLoading || !data) {
    return <Layout><div className="mx-auto max-w-7xl px-4 py-20"><div className="h-72 animate-pulse rounded-xl bg-muted" /></div></Layout>;
  }

  const s = data.stats;
  const cards = [
    { label: "Tradesmen", value: s.totalTradesmen, icon: Users },
    { label: "Verified", value: s.verified, icon: BadgeCheck },
    { label: "Pending review", value: s.pending, icon: Clock },
    { label: "Total jobs", value: s.totalJobs, icon: Briefcase },
    { label: "Leads sent", value: s.totalLeads, icon: Star },
    { label: "Lead revenue", value: `£${s.leadRevenue}`, icon: PoundSterling },
    { label: "Active cards", value: s.carded ?? 0, icon: Gavel },
    { label: "Banned (Red)", value: s.banned ?? 0, icon: ShieldAlert },
  ];

  return (
    <Layout>
      <div className="border-b border-border bg-navy">
        <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6">
          <h1 className="font-display text-xl font-bold text-white">Admin dashboard</h1>
          <p className="text-sm text-white/60">Marketplace overview & tradesman management</p>
        </div>
      </div>

      <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6">
        <div className="grid gap-4 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-8">
          {cards.map((c) => (
            <Card key={c.label} className="p-4" data-testid={`stat-${c.label.toLowerCase().replace(/\s/g, "-")}`}>
              <div className="flex items-center justify-between"><span className="text-xs text-muted-foreground">{c.label}</span><c.icon className="h-4 w-4 text-primary" /></div>
              <p className="mt-1.5 font-display text-xl font-bold text-foreground">{c.value}</p>
            </Card>
          ))}
        </div>

        {/* Pending verification */}
        {data.pending.length > 0 && (
          <Card className="mt-8 p-6">
            <h2 className="font-display text-lg font-semibold text-foreground">Pending verification ({data.pending.length})</h2>
            <div className="mt-4 space-y-2">
              {data.pending.map((t) => (
                <div key={t.id} className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border p-3" data-testid={`pending-${t.id}`}>
                  <div>
                    <p className="font-medium text-foreground">{t.businessName}</p>
                    <p className="text-sm text-muted-foreground">{t.ownerName} · {t.email}</p>
                  </div>
                  <Button size="sm" onClick={() => act(t.id, "verify")} data-testid={`button-verify-${t.id}`}><BadgeCheck className="mr-1 h-4 w-4" /> Verify</Button>
                </div>
              ))}
            </div>
          </Card>
        )}

        {/* Admin shortcuts */}
        <div className="mt-6 flex flex-wrap gap-2">
          <Link href="/admin/moderation">
            <Button variant="outline" data-testid="button-moderation-page"><Gavel className="mr-2 h-4 w-4" /> Moderation &amp; cards</Button>
          </Link>
          <Link href={`/admin/verifications?key=${encodeURIComponent(authKey)}`}>
            <Button variant="outline" data-testid="button-verifications-page"><ShieldCheck className="mr-2 h-4 w-4" /> Verifications queue</Button>
          </Link>
          <Link href={`/admin/microsites?key=${encodeURIComponent(authKey)}`}>
            <Button variant="outline" data-testid="button-microsites-page"><Globe className="mr-2 h-4 w-4" /> Mini-site stats</Button>
          </Link>
        </div>

        {/* All tradesmen */}
        <Card className="mt-8 overflow-hidden">
          <div className="border-b border-border p-6 pb-4"><h2 className="font-display text-lg font-semibold text-foreground">All tradesmen</h2></div>
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Business</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Rating</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.tradesmen.map((t) => (
                  <TableRow key={t.id} data-testid={`row-tradesman-${t.id}`}>
                    <TableCell>
                      <p className="font-medium text-foreground">{t.businessName}</p>
                      <p className="text-xs text-muted-foreground">{t.ownerName}</p>
                    </TableCell>
                    <TableCell>
                      <div className="flex flex-wrap items-center gap-1">
                        {t.verified ? <Badge className="bg-trust text-white hover:bg-trust">Verified</Badge> : <Badge variant="outline">Pending</Badge>}
                        {t.featured && !t.cardSummary?.isFeaturedRevoked && <Badge className="bg-primary text-primary-foreground hover:bg-primary">Featured</Badge>}
                        <CardBadge summary={t.cardSummary} size="sm" />
                      </div>
                    </TableCell>
                    <TableCell className="text-foreground">{t.ratingAverage.toFixed(1)} ({t.ratingCount})</TableCell>
                    <TableCell className="text-right">
                      <div className="flex flex-wrap justify-end gap-2">
                        {!t.verified && <Button size="sm" variant="outline" onClick={() => act(t.id, "verify")} data-testid={`button-verify-row-${t.id}`}>Verify</Button>}
                        <Button size="sm" variant={t.featured ? "secondary" : "outline"} onClick={() => act(t.id, "feature")} data-testid={`button-feature-${t.id}`}>
                          {t.featured ? "Unfeature" : "Feature"}
                        </Button>
                        <IssueCardDialog tradesman={{ id: t.id, businessName: t.businessName }} adminKey={authKey} />
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </Card>
      </div>
    </Layout>
  );
}
