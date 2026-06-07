// /admin/partners — Stats & Invoices tab (PR-P7).
// Extracted into its own file because admin-partners.tsx is already large
// and the stats/invoice flow is largely self-contained.
import { useState, useMemo } from 'react';
import { useQuery, useMutation } from '@tanstack/react-query';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogTrigger,
} from '@/components/ui/dialog';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { useToast } from '@/hooks/use-toast';
import { apiRequest, queryClient } from '@/lib/queryClient';

// ── Types (kept local; matches admin-partners.tsx) ──

export interface PartnerLike {
  id: number;
  name: string;
}

interface StatsLine {
  placementId: number;
  surface: string;
  commercialModel: string;
  ratePence: number;
  counts: { impression: number; click: number; lead_passed: number; lead_booked: number };
  estimatedSubtotalPence: number;
}
interface PartnerStats {
  partnerId: number;
  from: number;
  to: number;
  byPlacement: StatsLine[];
  totals: { impressions: number; clicks: number; leadsPassed: number; leadsBooked: number; estimatedTotalPence: number };
}
interface InvoiceLineItem {
  placementId: number;
  surface: string;
  commercialModel: string;
  ratePence: number;
  count: number;
  subtotalPence: number;
  note?: string;
}
interface PartnerInvoice {
  id: number;
  partnerId: number;
  periodStart: number;
  periodEnd: number;
  lineItems: InvoiceLineItem[] | string;
  totalPence: number;
  status: 'draft' | 'sent' | 'paid' | 'void';
  stripeInvoiceId: string | null;
  generatedAt: number;
  sentAt: number | null;
  paidAt: number | null;
}

// ── Helpers ──

function fmtPence(p: number): string { return `£${(p / 100).toFixed(2)}`; }
function fmtDate(ms: number | null | undefined): string {
  if (!ms) return '—';
  return new Date(ms).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'UTC' });
}

/**
 * Compute the [start, end) ms range for a UTC calendar month containing `ref`.
 * Used as the default range when the admin clicks 'This month' / 'Last month'.
 */
function monthRange(ref: Date, offsetMonths = 0): { from: number; to: number; label: string } {
  const d = new Date(Date.UTC(ref.getUTCFullYear(), ref.getUTCMonth() + offsetMonths, 1));
  const from = d.getTime();
  const next = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1));
  const to = next.getTime();
  const label = d.toLocaleDateString('en-GB', { month: 'long', year: 'numeric', timeZone: 'UTC' });
  return { from, to, label };
}

function invoiceStatusBadge(status: string) {
  const map: Record<string, string> = {
    draft: 'bg-amber-100 text-amber-800',
    sent: 'bg-blue-100 text-blue-800',
    paid: 'bg-green-100 text-green-800',
    void: 'bg-zinc-200 text-zinc-700',
  };
  return <Badge className={map[status] ?? 'bg-zinc-100 text-zinc-700'}>{status}</Badge>;
}

// ── Generate-invoice dialog ──

function GenerateInvoiceDialog({ partnerId, authKey }: { partnerId: number; authKey: string }) {
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const lastMonth = useMemo(() => monthRange(new Date(), -1), []);
  const thisMonth = useMemo(() => monthRange(new Date(), 0), []);
  const [from, setFrom] = useState<number>(lastMonth.from);
  const [to, setTo] = useState<number>(lastMonth.to);

  const generateMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest('POST', `/api/admin/partners/${partnerId}/invoices/generate?key=${encodeURIComponent(authKey)}`, {
        periodStart: from, periodEnd: to,
      });
      return res.json();
    },
    onSuccess: (data: any) => {
      const existed = !!data?._existing;
      toast({
        title: existed ? 'Invoice already exists' : 'Draft invoice created',
        description: existed
          ? `An invoice for this period was already generated (#${data.id}). No new invoice was made.`
          : `Draft invoice #${data.id} for ${fmtPence(data.totalPence)}.`,
      });
      setOpen(false);
      queryClient.invalidateQueries({ queryKey: ['/api/admin/partners', partnerId, 'invoices', authKey] });
    },
    onError: (err: any) => {
      toast({ title: 'Generate failed', description: err?.message ?? String(err), variant: 'destructive' });
    },
  });

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" data-testid="button-generate-invoice">Generate invoice</Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Generate draft invoice</DialogTitle>
        </DialogHeader>
        <div className="space-y-3 text-sm">
          <p className="text-muted-foreground">
            Computes a draft invoice from events + placements for the selected period.
            Idempotent: if an invoice already exists for this exact period, it's returned
            unchanged — no duplicate is created.
          </p>
          <div className="flex gap-2">
            <Button size="sm" variant="outline" type="button" onClick={() => { setFrom(lastMonth.from); setTo(lastMonth.to); }}>
              Last month ({lastMonth.label})
            </Button>
            <Button size="sm" variant="outline" type="button" onClick={() => { setFrom(thisMonth.from); setTo(thisMonth.to); }}>
              This month ({thisMonth.label})
            </Button>
          </div>
          <div className="rounded bg-muted p-3 text-xs">
            <div><span className="text-muted-foreground">Period start (UTC):</span> {fmtDate(from)}</div>
            <div><span className="text-muted-foreground">Period end (UTC, exclusive):</span> {fmtDate(to)}</div>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
          <Button onClick={() => generateMutation.mutate()} disabled={generateMutation.isPending} data-testid="button-confirm-generate-invoice">
            {generateMutation.isPending ? 'Generating…' : 'Generate draft'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── Invoice detail dialog ──

function InvoiceDetailDialog({ partnerId, invoice, authKey }: {
  partnerId: number; invoice: PartnerInvoice; authKey: string;
}) {
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const { data: detail } = useQuery<PartnerInvoice>({
    queryKey: ['/api/admin/partners', partnerId, 'invoices', invoice.id, authKey],
    queryFn: async () => (await apiRequest('GET', `/api/admin/partners/${partnerId}/invoices/${invoice.id}?key=${encodeURIComponent(authKey)}`)).json(),
    enabled: open,
  });
  const lineItems: InvoiceLineItem[] = (() => {
    const li = detail?.lineItems ?? invoice.lineItems;
    if (Array.isArray(li)) return li;
    if (typeof li === 'string') { try { return JSON.parse(li); } catch { return []; } }
    return [];
  })();

  const patchMutation = useMutation({
    mutationFn: async (patch: { status?: string; stripeInvoiceId?: string | null }) => {
      const res = await apiRequest('PATCH', `/api/admin/partners/${partnerId}/invoices/${invoice.id}?key=${encodeURIComponent(authKey)}`, patch);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/admin/partners', partnerId, 'invoices', authKey] });
      queryClient.invalidateQueries({ queryKey: ['/api/admin/partners', partnerId, 'invoices', invoice.id, authKey] });
      toast({ title: 'Invoice updated' });
    },
    onError: (err: any) => toast({ title: 'Update failed', description: err?.message ?? String(err), variant: 'destructive' }),
  });

  const inv = detail ?? invoice;

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" variant="ghost" data-testid={`button-view-invoice-${invoice.id}`}>View</Button>
      </DialogTrigger>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle>Invoice #{inv.id} — {fmtPence(inv.totalPence)}</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 text-sm">
          <div className="grid grid-cols-2 gap-2">
            <div><span className="text-muted-foreground">Period:</span> {fmtDate(inv.periodStart)} → {fmtDate(inv.periodEnd)}</div>
            <div><span className="text-muted-foreground">Status:</span> {invoiceStatusBadge(inv.status)}</div>
            <div><span className="text-muted-foreground">Generated:</span> {fmtDate(inv.generatedAt)}</div>
            <div><span className="text-muted-foreground">Stripe ID:</span> {inv.stripeInvoiceId ?? <span className="text-muted-foreground italic">none</span>}</div>
          </div>

          <div>
            <p className="text-xs font-medium text-muted-foreground mb-2">Line items</p>
            {lineItems.length === 0 ? (
              <p className="text-xs text-muted-foreground">No line items.</p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Surface</TableHead>
                    <TableHead>Model</TableHead>
                    <TableHead className="text-right">Rate</TableHead>
                    <TableHead className="text-right">Count</TableHead>
                    <TableHead className="text-right">Subtotal</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {lineItems.map((li, i) => (
                    <TableRow key={i}>
                      <TableCell className="text-xs">{li.surface}</TableCell>
                      <TableCell className="text-xs">{li.commercialModel}</TableCell>
                      <TableCell className="text-xs text-right">{fmtPence(li.ratePence)}</TableCell>
                      <TableCell className="text-xs text-right">{li.count}</TableCell>
                      <TableCell className="text-xs text-right">{fmtPence(li.subtotalPence)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
            {lineItems.some((li) => li.note) && (
              <ul className="mt-2 list-disc pl-5 text-xs text-muted-foreground space-y-0.5">
                {lineItems.filter((li) => li.note).map((li, i) => (
                  <li key={i}>#{li.placementId}: {li.note}</li>
                ))}
              </ul>
            )}
          </div>

          <div className="flex gap-2 flex-wrap pt-2 border-t">
            <span className="text-xs text-muted-foreground self-center mr-1">Set status:</span>
            {(['draft', 'sent', 'paid', 'void'] as const).map((s) => (
              <Button
                key={s}
                size="sm"
                variant={inv.status === s ? 'default' : 'outline'}
                disabled={inv.status === s || patchMutation.isPending}
                onClick={() => patchMutation.mutate({ status: s })}
                data-testid={`button-status-${s}-${invoice.id}`}
              >{s}</Button>
            ))}
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>Close</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── StatsTab — exported top-level component ──

export function StatsTab({ authKey, partners, selectedPartnerId, onSelectPartnerId }: {
  authKey: string;
  partners: PartnerLike[];
  selectedPartnerId: number | null;
  onSelectPartnerId: (id: number | null) => void;
}) {
  // Range presets. 'this' / 'last' default to month boundaries.
  const [rangeKey, setRangeKey] = useState<'this' | 'last' | 'last30'>('this');
  const { from, to, label } = useMemo(() => {
    if (rangeKey === 'this') {
      const r = monthRange(new Date(), 0);
      return { from: r.from, to: r.to, label: `This month (${r.label})` };
    }
    if (rangeKey === 'last') {
      const r = monthRange(new Date(), -1);
      return { from: r.from, to: r.to, label: `Last month (${r.label})` };
    }
    const toMs = Date.now();
    return { from: toMs - 30 * 24 * 60 * 60 * 1000, to: toMs, label: 'Last 30 days' };
  }, [rangeKey]);

  const { data: stats, isLoading: statsLoading } = useQuery<PartnerStats>({
    queryKey: ['/api/admin/partners', selectedPartnerId, 'stats', from, to, authKey],
    queryFn: async () => (await apiRequest(
      'GET',
      `/api/admin/partners/${selectedPartnerId}/stats?from=${from}&to=${to}&key=${encodeURIComponent(authKey)}`,
    )).json(),
    enabled: !!selectedPartnerId,
  });

  const { data: invoices = [], isLoading: invoicesLoading } = useQuery<PartnerInvoice[]>({
    queryKey: ['/api/admin/partners', selectedPartnerId, 'invoices', authKey],
    queryFn: async () => (await apiRequest('GET', `/api/admin/partners/${selectedPartnerId}/invoices?key=${encodeURIComponent(authKey)}`)).json(),
    enabled: !!selectedPartnerId,
  });

  // PR-P8: outcomes for the selected range (defaults to last 90 days server-side,
  // but we pin to the same range as stats for consistency)
  const { data: outcomesResp, isLoading: outcomesLoading } = useQuery<{
    summary: { total: number; won: number; lost: number; quoted: number; totalDealValuePence: number };
    outcomes: Array<{ id: number; placementId: number; jobId: number | null; outcome: string | null; dealValuePence: number | null; recordedVia: string; occurredAt: number }>;
  }>({
    queryKey: ['/api/admin/partners', selectedPartnerId, 'outcomes', from, to, authKey],
    queryFn: async () => (await apiRequest(
      'GET',
      `/api/admin/partners/${selectedPartnerId}/outcomes?from=${from}&to=${to}&key=${encodeURIComponent(authKey)}`,
    )).json(),
    enabled: !!selectedPartnerId,
  });

  return (
    <div className="space-y-4">
      <Card className="p-4">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
          <div>
            <h2 className="font-display text-base font-semibold">Stats & Invoices</h2>
            <p className="text-xs text-muted-foreground">Estimated billing + invoice history for a single partner.</p>
          </div>
          <div className="flex gap-2">
            <Select value={String(selectedPartnerId ?? '')} onValueChange={(v) => onSelectPartnerId(v ? Number(v) : null)}>
              <SelectTrigger className="w-[260px]" data-testid="select-stats-partner">
                <SelectValue placeholder="Select a partner…" />
              </SelectTrigger>
              <SelectContent>
                {partners.map((p) => (
                  <SelectItem key={p.id} value={String(p.id)}>{p.name} #{p.id}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
      </Card>

      {!selectedPartnerId ? (
        <Card className="p-6 text-center text-sm text-muted-foreground">
          Select a partner above to see stats and invoices.
        </Card>
      ) : (
        <>
          {/* Range selector + stats */}
          <Card className="p-4 space-y-3">
            <div className="flex items-center justify-between flex-wrap gap-2">
              <h3 className="font-display text-sm font-semibold">Forward-looking stats — {label}</h3>
              <div className="flex gap-1">
                {(['this', 'last', 'last30'] as const).map((r) => (
                  <Button
                    key={r}
                    size="sm"
                    variant={rangeKey === r ? 'default' : 'outline'}
                    onClick={() => setRangeKey(r)}
                    data-testid={`button-range-${r}`}
                  >{r === 'this' ? 'This month' : r === 'last' ? 'Last month' : 'Last 30d'}</Button>
                ))}
              </div>
            </div>

            {statsLoading ? (
              <p className="text-sm text-muted-foreground">Loading…</p>
            ) : !stats ? (
              <p className="text-sm text-muted-foreground">No stats available.</p>
            ) : (
              <>
                <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
                  <div className="rounded border p-2"><p className="text-xs text-muted-foreground">Impressions</p><p className="text-lg font-semibold">{stats.totals.impressions.toLocaleString()}</p></div>
                  <div className="rounded border p-2"><p className="text-xs text-muted-foreground">Clicks</p><p className="text-lg font-semibold">{stats.totals.clicks.toLocaleString()}</p></div>
                  <div className="rounded border p-2"><p className="text-xs text-muted-foreground">Leads passed</p><p className="text-lg font-semibold">{stats.totals.leadsPassed.toLocaleString()}</p></div>
                  <div className="rounded border p-2"><p className="text-xs text-muted-foreground">Leads booked</p><p className="text-lg font-semibold">{stats.totals.leadsBooked.toLocaleString()}</p></div>
                  <div className="rounded border p-2 bg-primary/5"><p className="text-xs text-muted-foreground">Est. billing</p><p className="text-lg font-semibold text-primary">{fmtPence(stats.totals.estimatedTotalPence)}</p></div>
                </div>

                {stats.byPlacement.length === 0 ? (
                  <p className="text-xs text-muted-foreground">No placements for this partner.</p>
                ) : (
                  <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Surface</TableHead>
                        <TableHead>Model</TableHead>
                        <TableHead className="text-right">Rate</TableHead>
                        <TableHead className="text-right">Impr.</TableHead>
                        <TableHead className="text-right">Clicks</TableHead>
                        <TableHead className="text-right">Leads</TableHead>
                        <TableHead className="text-right">Booked</TableHead>
                        <TableHead className="text-right">Est. £</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {stats.byPlacement.map((row) => (
                        <TableRow key={row.placementId}>
                          <TableCell className="text-xs">{row.surface}</TableCell>
                          <TableCell className="text-xs">{row.commercialModel}</TableCell>
                          <TableCell className="text-xs text-right">{fmtPence(row.ratePence)}</TableCell>
                          <TableCell className="text-xs text-right">{row.counts.impression}</TableCell>
                          <TableCell className="text-xs text-right">{row.counts.click}</TableCell>
                          <TableCell className="text-xs text-right">{row.counts.lead_passed}</TableCell>
                          <TableCell className="text-xs text-right">{row.counts.lead_booked}</TableCell>
                          <TableCell className="text-xs text-right font-medium">{fmtPence(row.estimatedSubtotalPence)}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                  </div>
                )}
              </>
            )}
          </Card>

          {/* PR-P8: Outcomes summary */}
          <Card className="p-4 space-y-3">
            <div className="flex items-center justify-between">
              <h3 className="font-display text-sm font-semibold">Lead outcomes — {label}</h3>
              <p className="text-xs text-muted-foreground">Captured via signed email links</p>
            </div>
            {outcomesLoading ? (
              <p className="text-sm text-muted-foreground">Loading…</p>
            ) : !outcomesResp || outcomesResp.summary.total === 0 ? (
              <p className="text-sm text-muted-foreground">No outcomes recorded in this period.</p>
            ) : (
              <>
                <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
                  <div className="rounded border p-2"><p className="text-xs text-muted-foreground">Total</p><p className="text-lg font-semibold" data-testid="outcomes-total">{outcomesResp.summary.total}</p></div>
                  <div className="rounded border p-2"><p className="text-xs text-muted-foreground">Won</p><p className="text-lg font-semibold text-green-700" data-testid="outcomes-won">{outcomesResp.summary.won}</p></div>
                  <div className="rounded border p-2"><p className="text-xs text-muted-foreground">Lost</p><p className="text-lg font-semibold text-red-600" data-testid="outcomes-lost">{outcomesResp.summary.lost}</p></div>
                  <div className="rounded border p-2"><p className="text-xs text-muted-foreground">Quoted</p><p className="text-lg font-semibold text-amber-600" data-testid="outcomes-quoted">{outcomesResp.summary.quoted}</p></div>
                  <div className="rounded border p-2 bg-primary/5"><p className="text-xs text-muted-foreground">Deal value (won)</p><p className="text-lg font-semibold text-primary" data-testid="outcomes-deal-value">{fmtPence(outcomesResp.summary.totalDealValuePence)}</p></div>
                </div>
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Outcome</TableHead>
                        <TableHead>Job</TableHead>
                        <TableHead>Placement</TableHead>
                        <TableHead className="text-right">Deal £</TableHead>
                        <TableHead>Via</TableHead>
                        <TableHead>Recorded</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {outcomesResp.outcomes.slice(0, 25).map((o) => (
                        <TableRow key={o.id} data-testid={`outcome-row-${o.id}`}>
                          <TableCell className="text-xs"><Badge variant={o.outcome === 'won' ? 'default' : o.outcome === 'lost' ? 'destructive' : 'secondary'}>{o.outcome ?? '—'}</Badge></TableCell>
                          <TableCell className="text-xs">{o.jobId ?? '—'}</TableCell>
                          <TableCell className="text-xs">#{o.placementId}</TableCell>
                          <TableCell className="text-xs text-right">{o.dealValuePence != null ? fmtPence(o.dealValuePence) : '—'}</TableCell>
                          <TableCell className="text-xs text-muted-foreground">{o.recordedVia}</TableCell>
                          <TableCell className="text-xs">{fmtDate(o.occurredAt)}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
                {outcomesResp.outcomes.length > 25 && (
                  <p className="text-xs text-muted-foreground">Showing first 25 of {outcomesResp.outcomes.length} outcomes.</p>
                )}
              </>
            )}
          </Card>

          {/* Invoices history */}
          <Card className="p-4 space-y-3">
            <div className="flex items-center justify-between">
              <h3 className="font-display text-sm font-semibold">Invoices</h3>
              <GenerateInvoiceDialog partnerId={selectedPartnerId} authKey={authKey} />
            </div>
            {invoicesLoading ? (
              <p className="text-sm text-muted-foreground">Loading…</p>
            ) : invoices.length === 0 ? (
              <p className="text-sm text-muted-foreground">No invoices yet. Use 'Generate invoice' above to create the first draft.</p>
            ) : (
              <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>#</TableHead>
                    <TableHead>Period</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="text-right">Total</TableHead>
                    <TableHead>Stripe</TableHead>
                    <TableHead>Generated</TableHead>
                    <TableHead></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {invoices.map((inv) => (
                    <TableRow key={inv.id}>
                      <TableCell className="text-xs">#{inv.id}</TableCell>
                      <TableCell className="text-xs">{fmtDate(inv.periodStart)} → {fmtDate(inv.periodEnd)}</TableCell>
                      <TableCell className="text-xs">{invoiceStatusBadge(inv.status)}</TableCell>
                      <TableCell className="text-xs text-right font-medium">{fmtPence(inv.totalPence)}</TableCell>
                      <TableCell className="text-xs text-muted-foreground">{inv.stripeInvoiceId ?? '—'}</TableCell>
                      <TableCell className="text-xs">{fmtDate(inv.generatedAt)}</TableCell>
                      <TableCell className="text-xs"><InvoiceDetailDialog partnerId={selectedPartnerId} invoice={inv} authKey={authKey} /></TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
              </div>
            )}
          </Card>
        </>
      )}
    </div>
  );
}
