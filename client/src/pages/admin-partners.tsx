// /admin/partners — Partner Programme admin: enquiries, partners CRUD, placements.
// Auth pattern matches admin.tsx exactly (URL hash ?key=...).
import { useState, useMemo } from 'react';
import { useQuery, useMutation } from '@tanstack/react-query';
import { Layout } from '@/components/layout';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table';
import {
  Tabs, TabsContent, TabsList, TabsTrigger,
} from '@/components/ui/tabs';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogTrigger,
} from '@/components/ui/dialog';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { useToast } from '@/hooks/use-toast';
import { apiRequest, queryClient } from '@/lib/queryClient';
import { ShieldAlert, Building2, ArrowLeft, ChevronDown, ChevronUp } from 'lucide-react';
import { Link } from 'wouter';
import { StatsTab } from './admin-partners-stats';

// ── Types ──

interface PartnerEnquiry {
  id: number;
  companyName: string;
  contactName: string;
  email: string;
  phone: string | null;
  vertical: string;
  monthlyBudget: string | null;
  message: string;
  status: string;
  createdAt: number;
  promotedPartnerId: number | null;
}

interface Partner {
  id: number;
  slug: string;
  name: string;
  vertical: string;
  status: string;
  billingEmail: string | null;
  billingContact: string | null;
  notes: string | null;
  createdAt: number;
  // enriched by GET /api/admin/partners/:id
  recentPlacements?: PartnerPlacement[];
  eventCounts?: Record<string, number>;
}

interface PartnerPlacement {
  id: number;
  partnerId: number;
  surface: string;
  commercialModel: string;
  ratePence: number;
  rateCapPence: number | null;
  categoryFilter: string;
  areaFilter: string;
  priority: number;
  activeFrom: number;
  activeTo: number | null;
  creativeHtml: string | null;
  creativeUrl: string | null;
  createdAt: number;
}

// PR-P7
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

// ── Constants ──
const PARTNER_STATUSES = ['inactive', 'pilot', 'active', 'paused', 'terminated'] as const;
const PARTNER_VERTICALS = ['insurance', 'epc', 'solicitor', 'builders_merchant', 'finance', 'other'] as const;
const PARTNER_SURFACES = ['category_footer', 'area_footer', 'job_confirmation', 'dashboard_sidebar', 'lead_email_footer', 'partners_page'] as const;
const PARTNER_COMMERCIAL_MODELS = ['sponsored', 'lead_qualified', 'lead_booked', 'rev_share'] as const;
const ENQUIRY_STATUSES = ['new', 'contacted', 'qualified', 'won', 'lost'] as const;

// ── Helpers ──

function getInitialKey(): string {
  const hash = window.location.hash;
  const qIdx = hash.indexOf('?');
  if (qIdx === -1) return '';
  return new URLSearchParams(hash.slice(qIdx + 1)).get('key') || '';
}

function fmtDate(ms: number | null | undefined): string {
  if (!ms) return '—';
  return new Date(ms).toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' });
}

function fmtPence(p: number): string {
  return `£${(p / 100).toFixed(2)}`;
}

function toKebab(s: string): string {
  return s.toLowerCase().replace(/&/g, 'and').replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
}

function statusBadge(status: string) {
  const colours: Record<string, string> = {
    inactive: 'bg-muted text-muted-foreground',
    pilot: 'bg-blue-100 text-blue-700',
    active: 'bg-green-100 text-green-700',
    paused: 'bg-amber-100 text-amber-700',
    terminated: 'bg-destructive/10 text-destructive',
  };
  return (
    <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium capitalize ${colours[status] ?? 'bg-muted text-muted-foreground'}`}>
      {status}
    </span>
  );
}

function enquiryStatusBadge(status: string) {
  const colours: Record<string, string> = {
    new: 'bg-blue-100 text-blue-700',
    contacted: 'bg-amber-100 text-amber-700',
    qualified: 'bg-purple-100 text-purple-700',
    won: 'bg-green-100 text-green-700',
    lost: 'bg-muted text-muted-foreground',
  };
  return (
    <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium capitalize ${colours[status] ?? 'bg-muted text-muted-foreground'}`}>
      {status}
    </span>
  );
}

// ── Auth gate (shared pattern) ──

function AuthGate({ onUnlock }: { onUnlock: (key: string) => void }) {
  const [key, setKey] = useState('');
  return (
    <Layout>
      <div className="mx-auto max-w-md px-4 py-20">
        <div className="text-center">
          <span className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-destructive/10 text-destructive">
            <ShieldAlert className="h-7 w-7" />
          </span>
          <h1 className="mt-4 font-display text-2xl font-bold text-foreground">Partners admin</h1>
          <p className="mt-2 text-muted-foreground">Enter your admin key to manage the Partner Programme.</p>
        </div>
        <Card className="mt-8 p-6">
          <form onSubmit={(e) => { e.preventDefault(); onUnlock(key); }} className="space-y-4">
            <div>
              <Label htmlFor="ak">Admin key</Label>
              <Input id="ak" type="password" value={key} onChange={(e) => setKey(e.target.value)} placeholder="Enter admin key" data-testid="input-partners-admin-key" />
            </div>
            <Button type="submit" className="w-full" data-testid="button-partners-admin-login">Unlock</Button>
          </form>
        </Card>
      </div>
    </Layout>
  );
}

// ── Convert-to-partner dialog ──

function ConvertDialog({
  enquiry, authKey, onSuccess,
}: { enquiry: PartnerEnquiry; authKey: string; onSuccess: () => void }) {
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [slug, setSlug] = useState(toKebab(enquiry.companyName));
  const [billingEmail, setBillingEmail] = useState(enquiry.email);
  const [billingContact, setBillingContact] = useState(enquiry.contactName);
  const [notes, setNotes] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      await apiRequest('POST', `/api/admin/partner-enquiries/${enquiry.id}/convert?key=${encodeURIComponent(authKey)}`, {
        slug, billingEmail, billingContact, notes,
      });
      toast({ title: `${enquiry.companyName} converted to partner` });
      setOpen(false);
      onSuccess();
    } catch (err: any) {
      toast({ title: err?.message ?? 'Convert failed', variant: 'destructive' });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" data-testid={`convert-${enquiry.id}`}>Convert to partner →</Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Convert enquiry: {enquiry.companyName}</DialogTitle>
        </DialogHeader>
        <form onSubmit={submit} className="space-y-4 pt-2">
          <div>
            <Label>Partner slug</Label>
            <Input value={slug} onChange={(e) => setSlug(e.target.value)} placeholder="e.g. acme-insurance" />
            <p className="mt-1 text-xs text-muted-foreground">Lowercase, letters/numbers/hyphens only. Will be used in partner URLs.</p>
          </div>
          <div>
            <Label>Billing email</Label>
            <Input value={billingEmail} onChange={(e) => setBillingEmail(e.target.value)} type="email" />
          </div>
          <div>
            <Label>Billing contact</Label>
            <Input value={billingContact} onChange={(e) => setBillingContact(e.target.value)} />
          </div>
          <div>
            <Label>Internal notes</Label>
            <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} placeholder="Optional" />
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
            <Button type="submit" disabled={busy}>Convert</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

// ── Enquiry detail dialog ──

function EnquiryDetailDialog({ enquiry }: { enquiry: PartnerEnquiry }) {
  const [open, setOpen] = useState(false);
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" variant="ghost">View detail</Button>
      </DialogTrigger>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{enquiry.companyName}</DialogTitle>
        </DialogHeader>
        <div className="space-y-2 text-sm">
          <p><span className="font-medium">Contact:</span> {enquiry.contactName}</p>
          <p><span className="font-medium">Email:</span> {enquiry.email}</p>
          {enquiry.phone && <p><span className="font-medium">Phone:</span> {enquiry.phone}</p>}
          <p><span className="font-medium">Vertical:</span> {enquiry.vertical}</p>
          {enquiry.monthlyBudget && <p><span className="font-medium">Budget:</span> {enquiry.monthlyBudget}</p>}
          <p><span className="font-medium">Received:</span> {fmtDate(enquiry.createdAt)}</p>
          <div className="mt-3 rounded-md bg-muted p-3">
            <p className="text-xs font-medium text-muted-foreground mb-1">Message</p>
            <p className="whitespace-pre-wrap">{enquiry.message}</p>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ── Status action buttons ──

function EnquiryStatusActions({ enquiry, authKey }: { enquiry: PartnerEnquiry; authKey: string }) {
  const { toast } = useToast();

  const updateStatus = async (status: string) => {
    try {
      await apiRequest('POST', `/api/admin/partner-enquiries/${enquiry.id}/status?key=${encodeURIComponent(authKey)}`, { status });
      queryClient.invalidateQueries({ queryKey: ['/api/admin/partner-enquiries', authKey] });
      toast({ title: `Status updated to ${status}` });
    } catch {
      toast({ title: 'Update failed', variant: 'destructive' });
    }
  };

  const next: Record<string, string[]> = {
    new: ['contacted', 'lost'],
    contacted: ['qualified', 'lost'],
    qualified: ['won', 'lost'],
  };
  const actions = next[enquiry.status] ?? [];
  if (!actions.length) return null;

  return (
    <div className="flex gap-1">
      {actions.map((s) => (
        <Button key={s} size="sm" variant="outline" onClick={() => updateStatus(s)} data-testid={`status-${enquiry.id}-${s}`}>
          Mark {s}
        </Button>
      ))}
    </div>
  );
}

// ── Enquiries Tab ──

function EnquiriesTab({ authKey, onConvert }: { authKey: string; onConvert: () => void }) {
  const [statusFilter, setStatusFilter] = useState('active');

  const { data: enquiries = [], isLoading } = useQuery<PartnerEnquiry[]>({
    queryKey: ['/api/admin/partner-enquiries', authKey, statusFilter],
    queryFn: async () => {
      const params = statusFilter === 'all' ? '' : statusFilter === 'active' ? '' : `?status=${encodeURIComponent(statusFilter)}`;
      // active = new + contacted + qualified; fetch all and filter client-side
      const url = `/api/admin/partner-enquiries?key=${encodeURIComponent(authKey)}`;
      return (await apiRequest('GET', url)).json();
    },
    retry: false,
  });

  const filtered = useMemo(() => {
    if (statusFilter === 'all') return enquiries;
    if (statusFilter === 'active') return enquiries.filter((e) => ['new', 'contacted', 'qualified'].includes(e.status));
    return enquiries.filter((e) => e.status === statusFilter);
  }, [enquiries, statusFilter]);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="font-display text-lg font-semibold">Inbound enquiries</h2>
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="w-40">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="active">Active (new/contacted/qualified)</SelectItem>
            <SelectItem value="all">All</SelectItem>
            {ENQUIRY_STATUSES.map((s) => (
              <SelectItem key={s} value={s}>{s}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <Card className="overflow-hidden">
        {isLoading ? (
          <p className="p-6 text-sm text-muted-foreground">Loading…</p>
        ) : filtered.length === 0 ? (
          <p className="p-6 text-sm text-muted-foreground">No enquiries match the filter.</p>
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Company</TableHead>
                  <TableHead>Vertical</TableHead>
                  <TableHead>Budget</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Received</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtered.map((enq) => (
                  <TableRow key={enq.id} data-testid={`enquiry-row-${enq.id}`}>
                    <TableCell>
                      <p className="font-medium">{enq.companyName}</p>
                      <p className="text-xs text-muted-foreground">{enq.contactName} · {enq.email}</p>
                    </TableCell>
                    <TableCell className="text-sm">{enq.vertical}</TableCell>
                    <TableCell className="text-sm">{enq.monthlyBudget ?? '—'}</TableCell>
                    <TableCell>{enquiryStatusBadge(enq.status)}</TableCell>
                    <TableCell className="text-xs text-muted-foreground">{fmtDate(enq.createdAt)}</TableCell>
                    <TableCell>
                      <div className="flex flex-wrap items-center justify-end gap-1">
                        <EnquiryDetailDialog enquiry={enq} />
                        <EnquiryStatusActions enquiry={enq} authKey={authKey} />
                        {!enq.promotedPartnerId && enq.status !== 'lost' && (
                          <ConvertDialog enquiry={enq} authKey={authKey} onSuccess={() => {
                            queryClient.invalidateQueries({ queryKey: ['/api/admin/partner-enquiries', authKey] });
                            queryClient.invalidateQueries({ queryKey: ['/api/admin/partners', authKey] });
                            onConvert();
                          }} />
                        )}
                        {enq.promotedPartnerId && (
                          <span className="text-xs text-muted-foreground">Partner #{enq.promotedPartnerId}</span>
                        )}
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </Card>
    </div>
  );
}

// ── Create Partner dialog ──

function CreatePartnerDialog({ authKey }: { authKey: string }) {
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [slug, setSlug] = useState('');
  const [vertical, setVertical] = useState('');
  const [billingEmail, setBillingEmail] = useState('');
  const [billingContact, setBillingContact] = useState('');
  const [notes, setNotes] = useState('');
  const [busy, setBusy] = useState(false);

  const reset = () => { setName(''); setSlug(''); setVertical(''); setBillingEmail(''); setBillingContact(''); setNotes(''); };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      await apiRequest('POST', `/api/admin/partners?key=${encodeURIComponent(authKey)}`, {
        slug, name, vertical, billingEmail: billingEmail || undefined, billingContact: billingContact || undefined, notes: notes || undefined,
      });
      toast({ title: `Partner "${name}" created` });
      queryClient.invalidateQueries({ queryKey: ['/api/admin/partners', authKey] });
      setOpen(false);
      reset();
    } catch (err: any) {
      toast({ title: err?.message ?? 'Create failed', variant: 'destructive' });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(v) => { setOpen(v); if (!v) reset(); }}>
      <DialogTrigger asChild>
        <Button data-testid="create-partner-button">Create partner</Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader><DialogTitle>Create partner</DialogTitle></DialogHeader>
        <form onSubmit={submit} className="space-y-3 pt-2">
          <div>
            <Label>Company name</Label>
            <Input value={name} onChange={(e) => { setName(e.target.value); setSlug(toKebab(e.target.value)); }} required />
          </div>
          <div>
            <Label>Slug</Label>
            <Input value={slug} onChange={(e) => setSlug(e.target.value)} required pattern="[a-z0-9-]+" />
          </div>
          <div>
            <Label>Vertical</Label>
            <Select value={vertical} onValueChange={setVertical} required>
              <SelectTrigger><SelectValue placeholder="Select vertical" /></SelectTrigger>
              <SelectContent>
                {PARTNER_VERTICALS.map((v) => <SelectItem key={v} value={v}>{v}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label>Billing email</Label>
            <Input value={billingEmail} onChange={(e) => setBillingEmail(e.target.value)} type="email" />
          </div>
          <div>
            <Label>Billing contact</Label>
            <Input value={billingContact} onChange={(e) => setBillingContact(e.target.value)} />
          </div>
          <div>
            <Label>Notes</Label>
            <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} />
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
            <Button type="submit" disabled={busy || !vertical}>Create</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

// ── Edit Partner dialog ──

function EditPartnerDialog({ partner, authKey, onSaved }: { partner: Partner; authKey: string; onSaved: () => void }) {
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState(partner.name);
  const [status, setStatus] = useState(partner.status);
  const [billingEmail, setBillingEmail] = useState(partner.billingEmail ?? '');
  const [billingContact, setBillingContact] = useState(partner.billingContact ?? '');
  const [notes, setNotes] = useState(partner.notes ?? '');
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      await apiRequest('PATCH', `/api/admin/partners/${partner.id}?key=${encodeURIComponent(authKey)}`, {
        name, status,
        billingEmail: billingEmail || null,
        billingContact: billingContact || null,
        notes: notes || null,
      });
      toast({ title: 'Partner updated' });
      onSaved();
      setOpen(false);
    } catch (err: any) {
      toast({ title: err?.message ?? 'Update failed', variant: 'destructive' });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" variant="outline" data-testid={`edit-partner-${partner.id}`}>Edit</Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader><DialogTitle>Edit: {partner.name}</DialogTitle></DialogHeader>
        <form onSubmit={submit} className="space-y-3 pt-2">
          <div>
            <Label>Name</Label>
            <Input value={name} onChange={(e) => setName(e.target.value)} required />
          </div>
          <div>
            <Label>Status</Label>
            <Select value={status} onValueChange={setStatus}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {PARTNER_STATUSES.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label>Billing email</Label>
            <Input value={billingEmail} onChange={(e) => setBillingEmail(e.target.value)} type="email" />
          </div>
          <div>
            <Label>Billing contact</Label>
            <Input value={billingContact} onChange={(e) => setBillingContact(e.target.value)} />
          </div>
          <div>
            <Label>Notes</Label>
            <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} />
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
            <Button type="submit" disabled={busy}>Save</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

// ── Partner detail panel ──

function PartnerDetailPanel({
  partner, authKey, onClose, onSwitchToTab3,
}: { partner: Partner; authKey: string; onClose: () => void; onSwitchToTab3: (partnerId: number) => void }) {
  const { data: detail } = useQuery<Partner>({
    queryKey: ['/api/admin/partners', partner.id, authKey],
    queryFn: async () => (await apiRequest('GET', `/api/admin/partners/${partner.id}?key=${encodeURIComponent(authKey)}`)).json(),
    retry: false,
  });

  const p = detail ?? partner;

  return (
    <div className="mt-4 rounded-lg border border-border p-4 space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="font-display text-base font-semibold">{p.name} <span className="text-muted-foreground text-sm">#{p.id}</span></h3>
        <div className="flex gap-2">
          <EditPartnerDialog partner={p} authKey={authKey} onSaved={() => {
            queryClient.invalidateQueries({ queryKey: ['/api/admin/partners', p.id, authKey] });
            queryClient.invalidateQueries({ queryKey: ['/api/admin/partners', authKey] });
          }} />
          <Button size="sm" variant="ghost" onClick={onClose}>Close</Button>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-2 text-sm">
        <div><span className="text-muted-foreground">Slug:</span> {p.slug}</div>
        <div><span className="text-muted-foreground">Vertical:</span> {p.vertical}</div>
        <div><span className="text-muted-foreground">Status:</span> {statusBadge(p.status)}</div>
        <div><span className="text-muted-foreground">Created:</span> {fmtDate(p.createdAt)}</div>
        {p.billingEmail && <div><span className="text-muted-foreground">Billing email:</span> {p.billingEmail}</div>}
        {p.billingContact && <div><span className="text-muted-foreground">Billing contact:</span> {p.billingContact}</div>}
      </div>
      {p.notes && (
        <div className="rounded bg-muted p-2 text-sm">
          <span className="text-muted-foreground text-xs font-medium">Notes: </span>{p.notes}
        </div>
      )}

      {/* Event counts (last 30 days) */}
      {p.eventCounts && Object.keys(p.eventCounts).length > 0 && (
        <div>
          <p className="text-xs font-medium text-muted-foreground mb-2">Event counts (last 30 days)</p>
          <div className="flex flex-wrap gap-2">
            {Object.entries(p.eventCounts).map(([type, count]) => (
              <span key={type} className="rounded bg-primary/10 px-2 py-0.5 text-xs font-medium text-primary">
                {type}: {count}
              </span>
            ))}
          </div>
        </div>
      )}

      {/* Placements summary */}
      {p.recentPlacements !== undefined && (
        <div>
          <div className="flex items-center justify-between mb-2">
            <p className="text-xs font-medium text-muted-foreground">Placements ({p.recentPlacements.length})</p>
            <Button size="sm" variant="ghost" className="h-auto p-0 text-xs text-primary underline-offset-4 hover:underline" onClick={() => onSwitchToTab3(p.id)}>
              Manage placements →
            </Button>
          </div>
          {p.recentPlacements.length === 0 ? (
            <p className="text-xs text-muted-foreground">No placements yet.</p>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Surface</TableHead>
                    <TableHead>Model</TableHead>
                    <TableHead>Rate</TableHead>
                    <TableHead>Priority</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {p.recentPlacements.slice(0, 5).map((pl) => (
                    <TableRow key={pl.id}>
                      <TableCell className="text-xs">{pl.surface}</TableCell>
                      <TableCell className="text-xs">{pl.commercialModel}</TableCell>
                      <TableCell className="text-xs">{fmtPence(pl.ratePence)}</TableCell>
                      <TableCell className="text-xs">{pl.priority}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ── Partners Tab ──

function PartnersTab({ authKey, selectedPartnerId, onSelectPartnerId }: {
  authKey: string;
  selectedPartnerId: number | null;
  onSelectPartnerId: (id: number | null) => void;
}) {
  const onSwitchToTab3 = (partnerId: number) => {
    // Will be called by parent to switch tab
    window.dispatchEvent(new CustomEvent('switch-to-placements', { detail: { partnerId } }));
  };

  const { data: partners = [], isLoading } = useQuery<Partner[]>({
    queryKey: ['/api/admin/partners', authKey],
    queryFn: async () => (await apiRequest('GET', `/api/admin/partners?key=${encodeURIComponent(authKey)}`)).json(),
    retry: false,
  });

  const selectedPartner = partners.find((p) => p.id === selectedPartnerId) ?? null;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="font-display text-lg font-semibold">Partners ({partners.length})</h2>
        <CreatePartnerDialog authKey={authKey} />
      </div>

      <Card className="overflow-hidden">
        {isLoading ? (
          <p className="p-6 text-sm text-muted-foreground">Loading…</p>
        ) : partners.length === 0 ? (
          <p className="p-6 text-sm text-muted-foreground">No partners yet. Convert an enquiry or create one directly.</p>
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Vertical</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Slug</TableHead>
                  <TableHead>Created</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {partners.map((p) => (
                  <TableRow
                    key={p.id}
                    data-testid={`partner-row-${p.id}`}
                    className={selectedPartnerId === p.id ? 'bg-muted/40' : 'cursor-pointer hover:bg-muted/20'}
                    onClick={() => onSelectPartnerId(selectedPartnerId === p.id ? null : p.id)}
                  >
                    <TableCell className="font-medium">{p.name}</TableCell>
                    <TableCell className="text-sm">{p.vertical}</TableCell>
                    <TableCell>{statusBadge(p.status)}</TableCell>
                    <TableCell className="text-xs text-muted-foreground">{p.slug}</TableCell>
                    <TableCell className="text-xs text-muted-foreground">{fmtDate(p.createdAt)}</TableCell>
                    <TableCell className="text-right" onClick={(e) => e.stopPropagation()}>
                      <div className="flex justify-end gap-1">
                        {selectedPartnerId === p.id
                          ? <Button size="sm" variant="ghost" onClick={() => onSelectPartnerId(null)}><ChevronUp className="h-4 w-4" /></Button>
                          : <Button size="sm" variant="ghost" onClick={() => onSelectPartnerId(p.id)}><ChevronDown className="h-4 w-4" /></Button>
                        }
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </Card>

      {selectedPartner && (
        <PartnerDetailPanel
          partner={selectedPartner}
          authKey={authKey}
          onClose={() => onSelectPartnerId(null)}
          onSwitchToTab3={onSwitchToTab3}
        />
      )}
    </div>
  );
}

// ── Add Placement dialog ──

function AddPlacementDialog({ partnerId, authKey, placementToEdit, onSaved, trigger }: {
  partnerId: number;
  authKey: string;
  placementToEdit?: PartnerPlacement;
  onSaved: () => void;
  trigger?: React.ReactNode;
}) {
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const isEdit = !!placementToEdit;

  const [surface, setSurface] = useState(placementToEdit?.surface ?? '');
  const [model, setModel] = useState(placementToEdit?.commercialModel ?? '');
  const [ratePence, setRatePence] = useState(placementToEdit ? String(placementToEdit.ratePence) : '');
  const [priority, setPriority] = useState(placementToEdit ? String(placementToEdit.priority) : '100');
  const [activeFrom, setActiveFrom] = useState(
    placementToEdit ? new Date(placementToEdit.activeFrom).toISOString().slice(0, 10) : new Date().toISOString().slice(0, 10),
  );
  const [activeTo, setActiveTo] = useState(
    placementToEdit?.activeTo ? new Date(placementToEdit.activeTo).toISOString().slice(0, 10) : '',
  );
  const [creativeUrl, setCreativeUrl] = useState(placementToEdit?.creativeUrl ?? '');
  const [busy, setBusy] = useState(false);

  const reset = () => {
    setSurface(''); setModel(''); setRatePence(''); setPriority('100');
    setActiveFrom(new Date().toISOString().slice(0, 10)); setActiveTo(''); setCreativeUrl('');
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      const body: Record<string, unknown> = {
        surface, commercialModel: model,
        ratePence: Number(ratePence),
        priority: Number(priority),
        activeFrom: new Date(activeFrom).getTime(),
        activeTo: activeTo ? new Date(activeTo).getTime() : null,
        creativeUrl: creativeUrl || null,
      };
      if (isEdit && placementToEdit) {
        await apiRequest('PATCH', `/api/admin/placements/${placementToEdit.id}?key=${encodeURIComponent(authKey)}`, body);
        toast({ title: 'Placement updated' });
      } else {
        await apiRequest('POST', `/api/admin/partners/${partnerId}/placements?key=${encodeURIComponent(authKey)}`, body);
        toast({ title: 'Placement created' });
      }
      onSaved();
      setOpen(false);
      if (!isEdit) reset();
    } catch (err: any) {
      toast({ title: err?.message ?? 'Save failed', variant: 'destructive' });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(v) => { setOpen(v); if (!v && !isEdit) reset(); }}>
      <DialogTrigger asChild>
        {trigger ?? <Button size="sm" data-testid="add-placement-button">Add placement</Button>}
      </DialogTrigger>
      <DialogContent className="max-w-lg">
        <DialogHeader><DialogTitle>{isEdit ? 'Edit placement' : 'Add placement'}</DialogTitle></DialogHeader>
        <form onSubmit={submit} className="space-y-3 pt-2">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>Surface</Label>
              <Select value={surface} onValueChange={setSurface} required>
                <SelectTrigger><SelectValue placeholder="Select surface" /></SelectTrigger>
                <SelectContent>
                  {PARTNER_SURFACES.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Commercial model</Label>
              <Select value={model} onValueChange={setModel} required>
                <SelectTrigger><SelectValue placeholder="Select model" /></SelectTrigger>
                <SelectContent>
                  {PARTNER_COMMERCIAL_MODELS.map((m) => <SelectItem key={m} value={m}>{m}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>Rate (pence)</Label>
              <Input value={ratePence} onChange={(e) => setRatePence(e.target.value)} type="number" min="0" required />
            </div>
            <div>
              <Label>Priority</Label>
              <Input value={priority} onChange={(e) => setPriority(e.target.value)} type="number" min="1" />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>Active from</Label>
              <Input value={activeFrom} onChange={(e) => setActiveFrom(e.target.value)} type="date" required />
            </div>
            <div>
              <Label>Active to (optional)</Label>
              <Input value={activeTo} onChange={(e) => setActiveTo(e.target.value)} type="date" />
            </div>
          </div>
          <div>
            <Label>Creative URL</Label>
            <Input value={creativeUrl} onChange={(e) => setCreativeUrl(e.target.value)} type="url" placeholder="https://…" />
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
            <Button type="submit" disabled={busy || !surface || !model}>Save</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

// ── Placements Tab ──

function PlacementsTab({ authKey, filterPartnerId }: { authKey: string; filterPartnerId: number | null }) {
  const { toast } = useToast();
  const [partnerIdFilter, setPartnerIdFilter] = useState<number | null>(filterPartnerId);

  // sync from parent when a "Manage placements" link is clicked
  useMemo(() => {
    if (filterPartnerId !== null) setPartnerIdFilter(filterPartnerId);
  }, [filterPartnerId]);

  const { data: partners = [] } = useQuery<Partner[]>({
    queryKey: ['/api/admin/partners', authKey],
    queryFn: async () => (await apiRequest('GET', `/api/admin/partners?key=${encodeURIComponent(authKey)}`)).json(),
    retry: false,
  });

  const { data: placements = [], isLoading, refetch } = useQuery<PartnerPlacement[]>({
    queryKey: ['/api/admin/placements', authKey, partnerIdFilter],
    queryFn: async () => {
      if (partnerIdFilter) {
        return (await apiRequest('GET', `/api/admin/partners/${partnerIdFilter}/placements?key=${encodeURIComponent(authKey)}`)).json();
      }
      // Fetch for all partners and flatten
      const results = await Promise.all(
        partners.map((p) => apiRequest('GET', `/api/admin/partners/${p.id}/placements?key=${encodeURIComponent(authKey)}`).then((r) => r.json())),
      );
      return (results as PartnerPlacement[][]).flat().sort((a, b) => b.createdAt - a.createdAt);
    },
    enabled: partnerIdFilter !== null || partners.length > 0,
    retry: false,
  });

  const deletePlacement = async (id: number) => {
    if (!confirm('Delete this placement?')) return;
    try {
      await apiRequest('DELETE', `/api/admin/placements/${id}?key=${encodeURIComponent(authKey)}`);
      toast({ title: 'Placement deleted' });
      refetch();
    } catch (err: any) {
      toast({ title: err?.message ?? 'Delete failed', variant: 'destructive' });
    }
  };

  const partnerName = (id: number) => partners.find((p) => p.id === id)?.name ?? `#${id}`;

  // Default partnerId for "Add placement" button
  const addPartnerId = partnerIdFilter ?? (partners[0]?.id ?? 0);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="font-display text-lg font-semibold">Placements</h2>
        <div className="flex items-center gap-2">
          <Select
            value={partnerIdFilter ? String(partnerIdFilter) : 'all'}
            onValueChange={(v) => setPartnerIdFilter(v === 'all' ? null : Number(v))}
          >
            <SelectTrigger className="w-48"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All partners</SelectItem>
              {partners.map((p) => <SelectItem key={p.id} value={String(p.id)}>{p.name}</SelectItem>)}
            </SelectContent>
          </Select>
          {addPartnerId > 0 && (
            <AddPlacementDialog
              partnerId={partnerIdFilter ?? addPartnerId}
              authKey={authKey}
              onSaved={() => refetch()}
            />
          )}
        </div>
      </div>

      <Card className="overflow-hidden">
        {isLoading ? (
          <p className="p-6 text-sm text-muted-foreground">Loading…</p>
        ) : placements.length === 0 ? (
          <p className="p-6 text-sm text-muted-foreground">No placements found.</p>
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Partner</TableHead>
                  <TableHead>Surface</TableHead>
                  <TableHead>Model</TableHead>
                  <TableHead>Rate</TableHead>
                  <TableHead>Priority</TableHead>
                  <TableHead>Active</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {placements.map((pl) => (
                  <TableRow key={pl.id} data-testid={`placement-row-${pl.id}`}>
                    <TableCell className="text-sm">{partnerName(pl.partnerId)}</TableCell>
                    <TableCell className="text-xs">{pl.surface}</TableCell>
                    <TableCell className="text-xs">{pl.commercialModel}</TableCell>
                    <TableCell className="text-xs">{fmtPence(pl.ratePence)}</TableCell>
                    <TableCell className="text-xs">{pl.priority}</TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {fmtDate(pl.activeFrom)}{pl.activeTo ? ` → ${fmtDate(pl.activeTo)}` : ' (open)'}
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex justify-end gap-1">
                        <AddPlacementDialog
                          partnerId={pl.partnerId}
                          authKey={authKey}
                          placementToEdit={pl}
                          onSaved={() => refetch()}
                          trigger={<Button size="sm" variant="outline" data-testid={`edit-placement-${pl.id}`}>Edit</Button>}
                        />
                        <Button
                          size="sm" variant="ghost" className="text-destructive"
                          onClick={() => deletePlacement(pl.id)}
                          data-testid={`delete-placement-${pl.id}`}
                        >
                          Delete
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </Card>
    </div>
  );
}

// ── Main page ──

export default function AdminPartners() {
  const [key, setKey] = useState(getInitialKey());
  const [authKey, setAuthKey] = useState(getInitialKey());
  const [activeTab, setActiveTab] = useState('enquiries');
  const [selectedPartnerId, setSelectedPartnerId] = useState<number | null>(null);
  const [placementsFilterId, setPlacementsFilterId] = useState<number | null>(null);
  const [statsPartnerId, setStatsPartnerId] = useState<number | null>(null);

  // Probe the admin endpoint to validate the key (also used as the partners list for StatsTab)
  const { data: partnersList = [], isError } = useQuery<Partner[]>({
    queryKey: ['/api/admin/partners', authKey, '_probe'],
    queryFn: async () => (await apiRequest('GET', `/api/admin/partners?key=${encodeURIComponent(authKey)}`)).json(),
    enabled: !!authKey,
    retry: false,
  });

  // Listen for switch-to-placements events from the detail panel
  useMemo(() => {
    const handler = (e: Event) => {
      const id = (e as CustomEvent<{ partnerId: number }>).detail.partnerId;
      setPlacementsFilterId(id);
      setActiveTab('placements');
    };
    window.addEventListener('switch-to-placements', handler);
    return () => window.removeEventListener('switch-to-placements', handler);
  }, []);

  if (!authKey || isError) {
    return (
      <AuthGate onUnlock={(k) => { setKey(k); setAuthKey(k); }} />
    );
  }

  return (
    <Layout>
      <div className="border-b border-border bg-navy">
        <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <Building2 className="h-6 w-6 text-white/70" />
              <div>
                <h1 className="font-display text-xl font-bold text-white">Partner Programme</h1>
                <p className="text-sm text-white/60">Enquiries, partners, and placements</p>
              </div>
            </div>
            <Link href={`/admin?key=${encodeURIComponent(authKey)}`}>
              <Button variant="outline" size="sm" className="text-white border-white/30 hover:bg-white/10">
                <ArrowLeft className="mr-1 h-4 w-4" /> Admin
              </Button>
            </Link>
          </div>
        </div>
      </div>

      <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6">
        <Tabs value={activeTab} onValueChange={setActiveTab}>
          <TabsList className="mb-6">
            <TabsTrigger value="enquiries" data-testid="tab-enquiries">Enquiries</TabsTrigger>
            <TabsTrigger value="partners" data-testid="tab-partners">Partners</TabsTrigger>
            <TabsTrigger value="placements" data-testid="tab-placements">Placements</TabsTrigger>
            <TabsTrigger value="stats" data-testid="tab-stats">Stats & Invoices</TabsTrigger>
          </TabsList>

          <TabsContent value="enquiries">
            <EnquiriesTab
              authKey={authKey}
              onConvert={() => setActiveTab('partners')}
            />
          </TabsContent>

          <TabsContent value="partners">
            <PartnersTab
              authKey={authKey}
              selectedPartnerId={selectedPartnerId}
              onSelectPartnerId={setSelectedPartnerId}
            />
          </TabsContent>

          <TabsContent value="placements">
            <PlacementsTab
              authKey={authKey}
              filterPartnerId={placementsFilterId}
            />
          </TabsContent>

          <TabsContent value="stats">
            <StatsTab
              authKey={authKey}
              partners={partnersList}
              selectedPartnerId={statsPartnerId}
              onSelectPartnerId={setStatsPartnerId}
            />
          </TabsContent>
        </Tabs>
      </div>
    </Layout>
  );
}
