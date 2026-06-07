// /admin/microsites — per-host lead volume across the mini-site programme.
// Same admin-key gate pattern as /admin and /admin/moderation
// (URL hash: #/admin/microsites?key=...).
//
// Backed by GET /api/admin/microsites/stats (PR-M4). Shows summary cards,
// a window selector (7d / 30d / 90d / all-time), and a sortable table of
// every source that has produced at least one lead in the window.
//
// Drift detection: any row whose source starts with `microsite:` but whose
// host is NOT in the registry surfaces with a red "Unregistered" badge so
// we can spot mis-attribution before it compounds across 81 domains.
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import { Layout } from "@/components/layout";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { apiRequest } from "@/lib/queryClient";
import {
  ShieldAlert, Globe, ArrowLeft, TrendingUp, Server, AlertTriangle,
  CheckCircle2, ArrowUpDown,
} from "lucide-react";

// Mirrors the route response shape in server/routes.ts.
interface StatsRow {
  source: string;
  count: number;
  lastLeadAt: number;
  host: string | null;
  registered: boolean | null;
  kind: string | null;
  trade: string | null;
  area: string | null;
  vertical: string | null;
  canonical: string | null;
}

interface StatsResponse {
  windowDays: number;
  sinceMs: number;
  generatedAt: number;
  summary: {
    totalMicrositeLeads: number;
    totalWebLeads: number;
    activeMicrositeHosts: number;
    registeredMicrositeCount: number;
  };
  rows: StatsRow[];
}

type SortKey = "count" | "lastLeadAt" | "host";
type SortDir = "asc" | "desc";

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

function fmtRelative(ms: number | null | undefined): string {
  if (!ms) return "—";
  const diffMs = Date.now() - ms;
  if (diffMs < 0) return "just now";
  const mins = Math.floor(diffMs / 60_000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  if (days < 30) return `${days}d ago`;
  const months = Math.floor(days / 30);
  if (months < 12) return `${months}mo ago`;
  return `${Math.floor(months / 12)}y ago`;
}

const WINDOW_OPTIONS: ReadonlyArray<{ value: string; label: string; days: number }> = [
  { value: "7", label: "Last 7 days", days: 7 },
  { value: "30", label: "Last 30 days", days: 30 },
  { value: "90", label: "Last 90 days", days: 90 },
  { value: "0", label: "All-time", days: 0 },
];

export default function AdminMicrosites() {
  const [key, setKey] = useState(getInitialKey());
  const [authKey, setAuthKey] = useState(getInitialKey());
  const [windowDays, setWindowDays] = useState("30");
  const [filter, setFilter] = useState("");
  const [sortKey, setSortKey] = useState<SortKey>("count");
  const [sortDir, setSortDir] = useState<SortDir>("desc");

  const statsQ = useQuery<StatsResponse>({
    queryKey: ["/api/admin/microsites/stats", authKey, windowDays],
    queryFn: async () =>
      (
        await apiRequest(
          "GET",
          `/api/admin/microsites/stats?days=${encodeURIComponent(windowDays)}&key=${encodeURIComponent(authKey)}`,
        )
      ).json(),
    enabled: !!authKey,
    retry: false,
  });

  // Derive: filter + sort. Declared before any early return so hook order
  // is stable across the auth-gate transition (Rules of Hooks).
  const data = statsQ.data;
  const visibleRows = useMemo(() => {
    if (!data) return [] as StatsRow[];
    const q = filter.trim().toLowerCase();
    let rows = data.rows;
    if (q) {
      rows = rows.filter((r) =>
        (r.host ?? "").toLowerCase().includes(q) ||
        r.source.toLowerCase().includes(q) ||
        (r.trade ?? "").toLowerCase().includes(q) ||
        (r.area ?? "").toLowerCase().includes(q),
      );
    }
    const dir = sortDir === "asc" ? 1 : -1;
    const sorted = [...rows].sort((a, b) => {
      if (sortKey === "count") return (a.count - b.count) * dir;
      if (sortKey === "lastLeadAt") return (a.lastLeadAt - b.lastLeadAt) * dir;
      // host (string) — keep web rows last on host sort regardless of dir
      if (a.host === null && b.host === null) return 0;
      if (a.host === null) return 1;
      if (b.host === null) return -1;
      return a.host.localeCompare(b.host) * dir;
    });
    return sorted;
  }, [data, filter, sortKey, sortDir]);

  const driftCount = useMemo(() => {
    if (!data) return 0;
    return data.rows.filter((r) => r.registered === false).length;
  }, [data]);

  // ── Auth gate ──
  if (!authKey || statsQ.isError) {
    return (
      <Layout>
        <div className="mx-auto max-w-md px-4 py-20">
          <div className="text-center">
            <span className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-destructive/10 text-destructive">
              <ShieldAlert className="h-7 w-7" />
            </span>
            <h1 className="mt-4 font-display text-2xl font-bold text-foreground">Mini-site stats</h1>
            <p className="mt-2 text-muted-foreground">Enter your admin key to view lead attribution.</p>
          </div>
          <Card className="mt-8 p-6">
            <form onSubmit={(e) => { e.preventDefault(); setAuthKey(key); }} className="space-y-4">
              <div>
                <Label htmlFor="ak">Admin key</Label>
                <Input
                  id="ak"
                  type="password"
                  value={key}
                  onChange={(e) => setKey(e.target.value)}
                  placeholder="Enter admin key"
                  data-testid="input-ms-admin-key"
                />
              </div>
              {statsQ.isError && authKey && (
                <p className="text-sm text-destructive">Invalid key — please try again.</p>
              )}
              <Button type="submit" className="w-full" data-testid="button-ms-admin-login">Unlock</Button>
            </form>
          </Card>
        </div>
      </Layout>
    );
  }

  const isLoading = statsQ.isLoading;

  const toggleSort = (k: SortKey) => {
    if (sortKey === k) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(k);
      setSortDir("desc");
    }
  };

  return (
    <Layout>
      <div className="mx-auto max-w-7xl px-4 py-10">
        {/* Header */}
        <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <span className="flex h-10 w-10 items-center justify-center rounded-full bg-primary/10 text-primary">
              <Globe className="h-5 w-5" />
            </span>
            <div>
              <h1 className="font-display text-2xl font-bold text-foreground">Mini-site lead attribution</h1>
              <p className="text-sm text-muted-foreground">
                Per-host lead volume across all {data?.summary.registeredMicrositeCount ?? "—"} registered mini-sites.
              </p>
            </div>
          </div>
          <Link href={`/admin?key=${encodeURIComponent(authKey)}`}>
            <Button variant="outline" size="sm" data-testid="button-back-to-admin">
              <ArrowLeft className="mr-1 h-4 w-4" /> Back to admin
            </Button>
          </Link>
        </div>

        {/* Summary cards */}
        <div className="mb-6 grid grid-cols-2 gap-3 md:grid-cols-4">
          <StatCard
            icon={<TrendingUp className="h-4 w-4 text-primary" />}
            label="Mini-site leads"
            value={data?.summary.totalMicrositeLeads ?? 0}
            testId="stat-microsite-leads"
          />
          <StatCard
            icon={<Globe className="h-4 w-4 text-muted-foreground" />}
            label="Main-site leads"
            value={data?.summary.totalWebLeads ?? 0}
            testId="stat-web-leads"
          />
          <StatCard
            icon={<Server className="h-4 w-4 text-primary" />}
            label="Active hosts"
            value={data?.summary.activeMicrositeHosts ?? 0}
            sublabel={`of ${data?.summary.registeredMicrositeCount ?? 0} registered`}
            testId="stat-active-hosts"
          />
          <StatCard
            icon={<AlertTriangle className="h-4 w-4 text-destructive" />}
            label="Drift (unregistered hosts)"
            value={driftCount}
            tone={driftCount > 0 ? "destructive" : undefined}
            testId="stat-drift"
          />
        </div>

        {/* Controls */}
        <Card className="mb-6 p-4">
          <div className="flex flex-wrap items-end gap-3">
            <div className="flex-1 min-w-[220px]">
              <Label htmlFor="ms-filter" className="text-xs">Filter</Label>
              <Input
                id="ms-filter"
                type="search"
                placeholder="Filter by host, trade, or area"
                value={filter}
                onChange={(e) => setFilter(e.target.value)}
                data-testid="input-ms-filter"
              />
            </div>
            <div className="w-[180px]">
              <Label className="text-xs">Window</Label>
              <Select value={windowDays} onValueChange={setWindowDays}>
                <SelectTrigger data-testid="select-ms-window">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {WINDOW_OPTIONS.map((o) => (
                    <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="text-xs text-muted-foreground">
              {data && (
                <>
                  Window since {fmtDate(data.sinceMs || null)}<br />
                  Generated {fmtRelative(data.generatedAt)}
                </>
              )}
            </div>
          </div>
        </Card>

        {/* Table */}
        <Card className="overflow-hidden">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border p-4">
            <h2 className="font-display text-lg font-semibold text-foreground">Lead sources</h2>
            <span className="text-xs text-muted-foreground">
              {visibleRows.length} source{visibleRows.length === 1 ? "" : "s"}
            </span>
          </div>
          {isLoading ? (
            <p className="p-6 text-sm text-muted-foreground" data-testid="ms-loading">Loading…</p>
          ) : visibleRows.length === 0 ? (
            <div className="p-10 text-center" data-testid="ms-empty">
              <Server className="mx-auto h-8 w-8 text-muted-foreground/60" />
              <p className="mt-3 text-sm text-muted-foreground">
                {filter.trim()
                  ? "No sources match your filter."
                  : "No leads recorded in this window yet."}
              </p>
              {!filter.trim() && (
                <p className="mt-1 text-xs text-muted-foreground/80">
                  Once DNS for the mini-site domains is pointed at Vercel, attributed leads will appear here.
                </p>
              )}
            </div>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <SortableHead label="Host / source" sortKey="host" current={sortKey} dir={sortDir} onSort={toggleSort} />
                    <TableHead className="w-[120px]">Kind</TableHead>
                    <TableHead className="w-[140px]">Trade</TableHead>
                    <TableHead className="w-[140px]">Area</TableHead>
                    <SortableHead label="Leads" sortKey="count" current={sortKey} dir={sortDir} onSort={toggleSort} className="w-[100px] text-right" />
                    <SortableHead label="Last lead" sortKey="lastLeadAt" current={sortKey} dir={sortDir} onSort={toggleSort} className="w-[180px]" />
                    <TableHead className="w-[140px]">Status</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {visibleRows.map((r) => (
                    <TableRow key={r.source} data-testid={`ms-row-${r.source}`}>
                      <TableCell className="font-mono text-xs">
                        {r.host ? (
                          <a
                            href={`https://${r.host}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="font-medium text-foreground hover:underline"
                          >
                            {r.host}
                          </a>
                        ) : (
                          <span className="font-medium text-foreground">{r.source}</span>
                        )}
                        {r.canonical && (
                          <p className="text-[10px] text-muted-foreground">
                            canonical: {r.canonical}
                          </p>
                        )}
                      </TableCell>
                      <TableCell className="text-xs capitalize text-muted-foreground">
                        {r.kind ?? "—"}
                      </TableCell>
                      <TableCell className="text-xs capitalize text-muted-foreground">
                        {r.trade ?? "—"}
                      </TableCell>
                      <TableCell className="text-xs capitalize text-muted-foreground">
                        {r.area ?? "—"}
                      </TableCell>
                      <TableCell className="text-right font-mono text-sm font-semibold tabular-nums">
                        {r.count.toLocaleString("en-GB")}
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground" title={fmtDate(r.lastLeadAt)}>
                        {fmtRelative(r.lastLeadAt)}
                      </TableCell>
                      <TableCell>
                        {r.source === "web" ? (
                          <Badge variant="secondary" className="text-[10px]">Main site</Badge>
                        ) : r.registered === true ? (
                          <Badge variant="outline" className="text-[10px]">
                            <CheckCircle2 className="mr-1 h-3 w-3 text-emerald-600" /> Registered
                          </Badge>
                        ) : (
                          <Badge variant="destructive" className="text-[10px]" data-testid={`ms-drift-${r.source}`}>
                            <AlertTriangle className="mr-1 h-3 w-3" /> Unregistered
                          </Badge>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </Card>
      </div>
    </Layout>
  );
}

function StatCard({
  icon, label, value, sublabel, tone, testId,
}: {
  icon: React.ReactNode;
  label: string;
  value: number;
  sublabel?: string;
  tone?: "destructive";
  testId?: string;
}) {
  return (
    <Card className={"p-4 " + (tone === "destructive" ? "border-destructive/30 bg-destructive/5" : "")}>
      <div className="flex items-center justify-between">
        <span className="text-xs text-muted-foreground">{label}</span>
        {icon}
      </div>
      <p
        className={"mt-1 text-2xl font-bold tabular-nums " + (tone === "destructive" ? "text-destructive" : "text-foreground")}
        data-testid={testId}
      >
        {value.toLocaleString("en-GB")}
      </p>
      {sublabel && <p className="mt-0.5 text-[11px] text-muted-foreground">{sublabel}</p>}
    </Card>
  );
}

function SortableHead({
  label, sortKey: thisKey, current, dir, onSort, className,
}: {
  label: string;
  sortKey: SortKey;
  current: SortKey;
  dir: SortDir;
  onSort: (k: SortKey) => void;
  className?: string;
}) {
  const active = current === thisKey;
  return (
    <TableHead className={className}>
      <button
        type="button"
        onClick={() => onSort(thisKey)}
        className={
          "inline-flex items-center gap-1 text-xs font-medium hover:text-foreground " +
          (active ? "text-foreground" : "text-muted-foreground")
        }
        data-testid={`sort-${thisKey}`}
      >
        {label}
        <ArrowUpDown className={"h-3 w-3 " + (active ? "opacity-100" : "opacity-40")} />
        {active && <span className="text-[9px]">{dir === "asc" ? "↑" : "↓"}</span>}
      </button>
    </TableHead>
  );
}
