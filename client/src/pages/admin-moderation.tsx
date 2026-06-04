// /admin/moderation — full audit log and per-tradesman card management.
// Same admin-key gate as /admin (URL hash: #/admin/moderation?key=...).
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import { Layout } from "@/components/layout";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { apiRequest } from "@/lib/queryClient";
import { CardBadge } from "@/components/card-badge";
import { IssueCardDialog, RescindCardDialog } from "@/components/issue-card-dialog";
import type { CardSummary, Tradesman, TradesmanCard, ModerationLogEntry } from "@/lib/api-types";
import { ShieldAlert, Gavel, ArrowLeft, History, Users, Ban, AlertTriangle, Square } from "lucide-react";

interface OverviewRow {
  tradesman: Tradesman;
  cards: TradesmanCard[];
  summary: CardSummary;
}

function getInitialKey(): string {
  const hash = window.location.hash;
  const qIdx = hash.indexOf("?");
  if (qIdx === -1) return "";
  return new URLSearchParams(hash.slice(qIdx + 1)).get("key") || "";
}

function fmtDate(ms: number | null | undefined): string {
  if (!ms) return "—";
  return new Date(ms).toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short" });
}

function cardTypeIcon(t: string | null) {
  if (t === "red") return <Ban className="h-3.5 w-3.5 text-destructive" />;
  if (t === "yellow") return <Square className="h-3.5 w-3.5 fill-yellow-400 text-yellow-500" />;
  if (t === "warning") return <AlertTriangle className="h-3.5 w-3.5 text-amber-600" />;
  return null;
}

export default function AdminModeration() {
  const [key, setKey] = useState(getInitialKey());
  const [authKey, setAuthKey] = useState(getInitialKey());
  const [filter, setFilter] = useState("");

  const overviewQ = useQuery<OverviewRow[]>({
    queryKey: ["/api/admin/moderation/overview", authKey],
    queryFn: async () =>
      (await apiRequest("GET", `/api/admin/moderation/overview?key=${encodeURIComponent(authKey)}`)).json(),
    enabled: !!authKey,
    retry: false,
  });

  const logQ = useQuery<ModerationLogEntry[]>({
    queryKey: ["/api/admin/moderation/log", authKey],
    queryFn: async () =>
      (await apiRequest("GET", `/api/admin/moderation/log?key=${encodeURIComponent(authKey)}`)).json(),
    enabled: !!authKey,
    retry: false,
  });

  const filtered = useMemo(() => {
    const rows = overviewQ.data ?? [];
    if (!filter.trim()) return rows;
    const q = filter.trim().toLowerCase();
    return rows.filter(
      (r) =>
        r.tradesman.businessName.toLowerCase().includes(q) ||
        r.tradesman.ownerName.toLowerCase().includes(q) ||
        r.tradesman.email.toLowerCase().includes(q),
    );
  }, [overviewQ.data, filter]);

  const counts = useMemo(() => {
    const rows = overviewQ.data ?? [];
    let warnings = 0, yellows = 0, reds = 0;
    for (const r of rows) {
      warnings += r.summary.warnings;
      yellows += r.summary.yellows;
      reds += r.summary.reds;
    }
    return { warnings, yellows, reds, carded: rows.length };
  }, [overviewQ.data]);

  // ── Auth gate ──
  if (!authKey || overviewQ.isError || logQ.isError) {
    return (
      <Layout>
        <div className="mx-auto max-w-md px-4 py-20">
          <div className="text-center">
            <span className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-destructive/10 text-destructive">
              <ShieldAlert className="h-7 w-7" />
            </span>
            <h1 className="mt-4 font-display text-2xl font-bold text-foreground">Moderation access</h1>
            <p className="mt-2 text-muted-foreground">Enter your admin key to view the moderation log.</p>
          </div>
          <Card className="mt-8 p-6">
            <form onSubmit={(e) => { e.preventDefault(); setAuthKey(key); }} className="space-y-4">
              <div>
                <Label htmlFor="ak">Admin key</Label>
                <Input id="ak" type="password" value={key} onChange={(e) => setKey(e.target.value)} placeholder="Enter admin key" data-testid="input-mod-admin-key" />
              </div>
              {(overviewQ.isError || logQ.isError) && authKey && (
                <p className="text-sm text-destructive">Invalid key — please try again.</p>
              )}
              <Button type="submit" className="w-full" data-testid="button-mod-admin-login">Unlock</Button>
            </form>
          </Card>
        </div>
      </Layout>
    );
  }

  const isLoading = overviewQ.isLoading || logQ.isLoading;

  return (
    <Layout>
      <div className="mx-auto max-w-7xl px-4 py-10">
        <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <span className="flex h-10 w-10 items-center justify-center rounded-full bg-primary/10 text-primary">
              <Gavel className="h-5 w-5" />
            </span>
            <div>
              <h1 className="font-display text-2xl font-bold text-foreground">Moderation</h1>
              <p className="text-sm text-muted-foreground">
                Disciplinary cards issued for substantiated customer complaints. Full audit log below.
              </p>
            </div>
          </div>
          <Link href={`/admin?key=${encodeURIComponent(authKey)}`}>
            <Button variant="outline" size="sm" data-testid="button-back-to-admin">
              <ArrowLeft className="mr-1 h-4 w-4" /> Back to admin
            </Button>
          </Link>
        </div>

        {/* Stat cards */}
        <div className="mb-8 grid grid-cols-2 gap-3 md:grid-cols-4">
          <StatCard icon={<Users className="h-4 w-4" />} label="Carded tradesmen" value={counts.carded} />
          <StatCard icon={<AlertTriangle className="h-4 w-4 text-amber-600" />} label="Active warnings" value={counts.warnings} />
          <StatCard icon={<Square className="h-4 w-4 fill-yellow-400 text-yellow-500" />} label="Active yellows" value={counts.yellows} />
          <StatCard icon={<Ban className="h-4 w-4 text-destructive" />} label="Banned (Red)" value={counts.reds} tone="destructive" />
        </div>

        {/* Carded tradesmen */}
        <Card className="mb-10 overflow-hidden">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border p-4">
            <h2 className="font-display text-lg font-semibold text-foreground">Carded tradesmen</h2>
            <Input
              type="search"
              placeholder="Filter by name or email"
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              className="max-w-xs"
              data-testid="input-mod-filter"
            />
          </div>
          {isLoading ? (
            <p className="p-6 text-sm text-muted-foreground">Loading…</p>
          ) : filtered.length === 0 ? (
            <p className="p-6 text-sm text-muted-foreground">No carded tradesmen.</p>
          ) : (
            <div className="divide-y divide-border">
              {filtered.map((row) => (
                <CardedRow key={row.tradesman.id} row={row} authKey={authKey} />
              ))}
            </div>
          )}
        </Card>

        {/* Audit log */}
        <Card className="overflow-hidden">
          <div className="flex items-center gap-2 border-b border-border p-4">
            <History className="h-4 w-4 text-muted-foreground" />
            <h2 className="font-display text-lg font-semibold text-foreground">Audit log</h2>
            <span className="text-xs text-muted-foreground">(last 200 events)</span>
          </div>
          {isLoading ? (
            <p className="p-6 text-sm text-muted-foreground">Loading…</p>
          ) : (logQ.data ?? []).length === 0 ? (
            <p className="p-6 text-sm text-muted-foreground">No moderation events yet.</p>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-[170px]">When</TableHead>
                    <TableHead className="w-[110px]">Action</TableHead>
                    <TableHead className="w-[100px]">Card</TableHead>
                    <TableHead>Tradesman</TableHead>
                    <TableHead>Reason</TableHead>
                    <TableHead className="w-[110px]">Admin</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {(logQ.data ?? []).map((e) => {
                    const tm = (overviewQ.data ?? []).find((r) => r.tradesman.id === e.tradesmanId)?.tradesman;
                    return (
                      <TableRow key={e.id} data-testid={`log-row-${e.id}`}>
                        <TableCell className="text-xs text-muted-foreground">{fmtDate(e.createdAt)}</TableCell>
                        <TableCell>
                          <Badge variant={e.action === "issue" ? "destructive" : "secondary"} className="capitalize">
                            {e.action}
                          </Badge>
                        </TableCell>
                        <TableCell>
                          <span className="inline-flex items-center gap-1 text-xs capitalize">
                            {cardTypeIcon(e.cardType)} {e.cardType ?? "—"}
                          </span>
                        </TableCell>
                        <TableCell className="text-sm">
                          {tm ? (
                            <Link href={`/tradesman/${tm.slug}`} className="font-medium text-foreground hover:underline">
                              {tm.businessName}
                            </Link>
                          ) : (
                            <span className="text-muted-foreground">#{e.tradesmanId}</span>
                          )}
                        </TableCell>
                        <TableCell className="max-w-md text-sm text-foreground/80">{e.reason}</TableCell>
                        <TableCell className="text-xs text-muted-foreground">{e.adminId}</TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          )}
        </Card>
      </div>
    </Layout>
  );
}

function StatCard({ icon, label, value, tone }: { icon: React.ReactNode; label: string; value: number; tone?: "destructive" }) {
  return (
    <Card className={"p-4 " + (tone === "destructive" ? "border-destructive/30 bg-destructive/5" : "")}>
      <div className="flex items-center justify-between">
        <span className="text-xs text-muted-foreground">{label}</span>
        {icon}
      </div>
      <p className={"mt-1 text-2xl font-bold " + (tone === "destructive" ? "text-destructive" : "text-foreground")} data-testid={`stat-${label.toLowerCase().replace(/\s+/g, "-")}`}>
        {value}
      </p>
    </Card>
  );
}

function CardedRow({ row, authKey }: { row: OverviewRow; authKey: string }) {
  const { tradesman, cards, summary } = row;
  // Active first (no rescindedAt, not expired), then most recent first
  const sorted = [...cards].sort((a, b) => {
    const aActive = !a.rescindedAt && (!a.expiresAt || a.expiresAt > Date.now());
    const bActive = !b.rescindedAt && (!b.expiresAt || b.expiresAt > Date.now());
    if (aActive !== bActive) return aActive ? -1 : 1;
    return b.issuedAt - a.issuedAt;
  });

  return (
    <div className="p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <Link href={`/tradesman/${tradesman.slug}`} className="font-display text-base font-semibold text-foreground hover:underline">
              {tradesman.businessName}
            </Link>
            {summary.publicBadge && <CardBadge summary={summary} size="sm" />}
            {summary.isPubliclyHidden && (
              <Badge variant="destructive" className="text-[10px]">Hidden from public</Badge>
            )}
          </div>
          <p className="text-xs text-muted-foreground">
            {tradesman.ownerName} · {tradesman.email} · {tradesman.postcode}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <IssueCardDialog
            tradesman={tradesman}
            adminKey={authKey}
            trigger={
              <Button size="sm" variant="outline" data-testid={`mod-issue-${tradesman.id}`}>
                <Gavel className="mr-1 h-4 w-4" /> Issue another
              </Button>
            }
          />
        </div>
      </div>

      <div className="mt-3 overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-[90px]">Type</TableHead>
              <TableHead className="w-[160px]">Issued</TableHead>
              <TableHead className="w-[160px]">Expires</TableHead>
              <TableHead>Reason</TableHead>
              <TableHead className="w-[120px]">Status</TableHead>
              <TableHead className="w-[120px] text-right">Action</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {sorted.map((c) => {
              const active = !c.rescindedAt && (!c.expiresAt || c.expiresAt > Date.now());
              const label = c.cardType.charAt(0).toUpperCase() + c.cardType.slice(1);
              return (
                <TableRow key={c.id} data-testid={`card-row-${c.id}`}>
                  <TableCell>
                    <span className="inline-flex items-center gap-1 text-xs font-medium capitalize">
                      {cardTypeIcon(c.cardType)} {label}
                      {c.grossMisconduct && <Badge variant="destructive" className="ml-1 text-[9px]">Gross</Badge>}
                    </span>
                  </TableCell>
                  <TableCell className="text-xs text-muted-foreground">{fmtDate(c.issuedAt)}</TableCell>
                  <TableCell className="text-xs text-muted-foreground">
                    {c.expiresAt ? fmtDate(c.expiresAt) : "Permanent"}
                  </TableCell>
                  <TableCell className="text-sm text-foreground/80">
                    {c.reason || <span className="text-muted-foreground italic">[redacted]</span>}
                    {c.rescindedAt && c.rescindedReason && (
                      <p className="mt-1 text-xs text-muted-foreground">
                        Rescinded {fmtDate(c.rescindedAt)} — {c.rescindedReason}
                      </p>
                    )}
                  </TableCell>
                  <TableCell>
                    {active ? (
                      <Badge variant="destructive" className="text-[10px]">Active</Badge>
                    ) : c.rescindedAt ? (
                      <Badge variant="secondary" className="text-[10px]">Rescinded</Badge>
                    ) : (
                      <Badge variant="outline" className="text-[10px]">Expired</Badge>
                    )}
                  </TableCell>
                  <TableCell className="text-right">
                    {active && (
                      <RescindCardDialog
                        cardId={c.id}
                        cardLabel={`${label} card`}
                        adminKey={authKey}
                        trigger={
                          <Button size="sm" variant="ghost" data-testid={`rescind-${c.id}`}>
                            Rescind
                          </Button>
                        }
                      />
                    )}
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
