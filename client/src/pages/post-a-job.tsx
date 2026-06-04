import { useState } from "react";
import { Link } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { Layout } from "@/components/layout";
import { StarRating } from "@/components/brand";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import type { Category, Area } from "@/lib/api-types";
import { Check, ChevronRight, ChevronLeft, CheckCircle2, ClipboardList, MapPin, FileText, User } from "lucide-react";

const URGENCIES = [
  { value: "emergency", label: "Emergency — ASAP" },
  { value: "this_week", label: "Within a few days" },
  { value: "this_month", label: "This month" },
  { value: "flexible", label: "I'm flexible" },
];

const STEPS = [
  { n: 1, label: "Trade", icon: ClipboardList },
  { n: 2, label: "Location", icon: MapPin },
  { n: 3, label: "Details", icon: FileText },
  { n: 4, label: "Contact", icon: User },
];

interface Matched { id: number; businessName: string; slug: string; ratingAverage: number; responseTimeMinutes: number }

export default function PostAJob() {
  const { toast } = useToast();
  const { data: categories } = useQuery<Category[]>({ queryKey: ["/api/categories"] });
  const { data: areas } = useQuery<Area[]>({ queryKey: ["/api/areas"] });

  const [step, setStep] = useState(1);
  const [submitting, setSubmitting] = useState(false);
  const [matched, setMatched] = useState<Matched[] | null>(null);
  const [form, setForm] = useState({
    categoryId: "", areaId: "", postcode: "", title: "", description: "",
    urgency: "this_week", budgetRange: "", customerName: "", customerEmail: "", customerPhone: "",
  });

  const set = (k: string, v: string) => setForm((f) => ({ ...f, [k]: v }));

  const canNext = () => {
    if (step === 1) return !!form.categoryId;
    if (step === 2) return !!form.areaId && !!form.postcode;
    if (step === 3) return !!form.title && !!form.description;
    return true;
  };

  const submit = async () => {
    if (!form.customerName || !form.customerEmail) {
      toast({ title: "Almost there", description: "Please add your name and email.", variant: "destructive" });
      return;
    }
    setSubmitting(true);
    try {
      const res = await apiRequest("POST", "/api/jobs", {
        customerName: form.customerName, customerEmail: form.customerEmail, customerPhone: form.customerPhone || "N/A",
        postcode: form.postcode, categoryId: Number(form.categoryId), areaId: form.areaId ? Number(form.areaId) : null,
        title: form.title, description: form.description, urgency: form.urgency, budgetRange: form.budgetRange,
      });
      const data = await res.json();
      queryClient.invalidateQueries({ queryKey: ["/api/jobs"] });
      setMatched(data.matched || []);
    } catch {
      toast({ title: "Something went wrong", description: "Please try again.", variant: "destructive" });
    } finally {
      setSubmitting(false);
    }
  };

  if (matched) {
    const cat = categories?.find((c) => c.id === Number(form.categoryId));
    return (
      <Layout>
        <div className="mx-auto max-w-2xl px-4 py-16 sm:py-20">
          <div className="text-center">
            <span className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-trust/10"><CheckCircle2 className="h-9 w-9 text-trust" /></span>
            <h1 className="mt-5 font-display text-2xl font-bold text-foreground" data-testid="text-job-success">Your job has been posted</h1>
            <p className="mt-2 text-muted-foreground">
              We've matched you with {matched.length} trusted {cat?.name.toLowerCase() || "tradesmen"}{matched.length === 1 ? "" : "s"}. They'll be in touch shortly with a quote.
            </p>
          </div>
          <div className="mt-8 space-y-3">
            {matched.map((m) => (
              <Card key={m.id} className="flex items-center justify-between p-4" data-testid={`card-matched-${m.id}`}>
                <div>
                  <p className="font-semibold text-foreground">{m.businessName}</p>
                  <div className="mt-1 flex items-center gap-2 text-sm text-muted-foreground">
                    <StarRating value={m.ratingAverage} size={13} /> {m.ratingAverage.toFixed(1)}
                    <span>· Responds in ~{m.responseTimeMinutes < 60 ? `${m.responseTimeMinutes} min` : `${Math.round(m.responseTimeMinutes / 60)} hr`}</span>
                  </div>
                </div>
                <Link href={`/tradesman/${m.slug}`}><Button variant="outline" size="sm" data-testid={`button-view-${m.id}`}>View</Button></Link>
              </Card>
            ))}
            {matched.length === 0 && (
              <Card className="p-5 text-center text-muted-foreground">No exact matches yet — our team will review your job and connect you manually.</Card>
            )}
          </div>
          <div className="mt-8 flex flex-wrap justify-center gap-3">
            <Link href="/"><Button variant="outline" data-testid="button-home">Back to home</Button></Link>
            <Link href="/categories"><Button data-testid="button-browse">Browse more trades</Button></Link>
          </div>
        </div>
      </Layout>
    );
  }

  return (
    <Layout>
      <div className="border-b border-border bg-navy">
        <div className="mx-auto max-w-3xl px-4 py-10 text-center">
          <h1 className="font-display text-2xl font-bold text-white">Post your job — get free quotes</h1>
          <p className="mt-2 text-white/70">Tell us what you need and we'll connect you with up to 3 trusted local pros.</p>
        </div>
      </div>

      <div className="mx-auto max-w-3xl px-4 py-10">
        {/* Stepper */}
        <div className="mb-8 flex items-center justify-between">
          {STEPS.map((s, i) => (
            <div key={s.n} className="flex flex-1 items-center last:flex-none">
              <div className="flex flex-col items-center gap-1">
                <span className={`flex h-10 w-10 items-center justify-center rounded-full border-2 text-sm font-semibold transition-colors ${step > s.n ? "border-trust bg-trust text-white" : step === s.n ? "border-primary bg-primary text-primary-foreground" : "border-border bg-background text-muted-foreground"}`}>
                  {step > s.n ? <Check className="h-5 w-5" /> : <s.icon className="h-5 w-5" />}
                </span>
                <span className={`text-xs font-medium ${step >= s.n ? "text-foreground" : "text-muted-foreground"}`}>{s.label}</span>
              </div>
              {i < STEPS.length - 1 && <div className={`mx-2 h-0.5 flex-1 ${step > s.n ? "bg-trust" : "bg-border"}`} />}
            </div>
          ))}
        </div>

        <Card className="p-6 sm:p-8">
          {step === 1 && (
            <div className="space-y-4">
              <h2 className="font-display text-lg font-semibold text-foreground">What trade do you need?</h2>
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                {(categories || []).map((c) => (
                  <button
                    key={c.id} type="button" data-testid={`option-category-${c.slug}`}
                    onClick={() => set("categoryId", String(c.id))}
                    className={`rounded-lg border p-3 text-left text-sm transition-colors ${form.categoryId === String(c.id) ? "border-primary bg-primary/5 font-medium text-foreground" : "border-border hover:border-primary/50"}`}
                  >
                    {c.name}
                  </button>
                ))}
              </div>
            </div>
          )}

          {step === 2 && (
            <div className="space-y-4">
              <h2 className="font-display text-lg font-semibold text-foreground">Where is the job?</h2>
              <div>
                <Label>Area</Label>
                <Select value={form.areaId} onValueChange={(v) => set("areaId", v)}>
                  <SelectTrigger data-testid="select-area"><SelectValue placeholder="Choose your area" /></SelectTrigger>
                  <SelectContent>
                    {(areas || []).map((a) => <SelectItem key={a.id} value={String(a.id)}>{a.name}, {a.region}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label htmlFor="pc">Postcode</Label>
                <Input id="pc" placeholder="e.g. SE2 9XY" value={form.postcode} onChange={(e) => set("postcode", e.target.value)} data-testid="input-postcode" />
              </div>
            </div>
          )}

          {step === 3 && (
            <div className="space-y-4">
              <h2 className="font-display text-lg font-semibold text-foreground">Describe the work</h2>
              <div>
                <Label htmlFor="title">Job title</Label>
                <Input id="title" placeholder="e.g. Replace leaking kitchen tap" value={form.title} onChange={(e) => set("title", e.target.value)} data-testid="input-title" />
              </div>
              <div>
                <Label htmlFor="desc">Details</Label>
                <Textarea id="desc" rows={4} placeholder="The more detail you give, the more accurate your quotes." value={form.description} onChange={(e) => set("description", e.target.value)} data-testid="input-description" />
              </div>
              <div className="grid gap-4 sm:grid-cols-2">
                <div>
                  <Label>Urgency</Label>
                  <Select value={form.urgency} onValueChange={(v) => set("urgency", v)}>
                    <SelectTrigger data-testid="select-urgency"><SelectValue /></SelectTrigger>
                    <SelectContent>{URGENCIES.map((u) => <SelectItem key={u.value} value={u.value}>{u.label}</SelectItem>)}</SelectContent>
                  </Select>
                </div>
                <div>
                  <Label htmlFor="budget">Budget (optional)</Label>
                  <Input id="budget" placeholder="e.g. £100 – £300" value={form.budgetRange} onChange={(e) => set("budgetRange", e.target.value)} data-testid="input-budget" />
                </div>
              </div>
              <div className="rounded-lg border border-dashed border-border p-4 text-sm text-muted-foreground">
                Photo upload coming soon — for now, describe the job in detail and your tradesman can request photos directly.
              </div>
            </div>
          )}

          {step === 4 && (
            <div className="space-y-4">
              <h2 className="font-display text-lg font-semibold text-foreground">How can tradesmen reach you?</h2>
              <div>
                <Label htmlFor="cn">Your name</Label>
                <Input id="cn" value={form.customerName} onChange={(e) => set("customerName", e.target.value)} data-testid="input-name" />
              </div>
              <div>
                <Label htmlFor="ce">Email</Label>
                <Input id="ce" type="email" value={form.customerEmail} onChange={(e) => set("customerEmail", e.target.value)} data-testid="input-email" />
              </div>
              <div>
                <Label htmlFor="cp">Phone (optional)</Label>
                <Input id="cp" value={form.customerPhone} onChange={(e) => set("customerPhone", e.target.value)} data-testid="input-phone" />
              </div>
              <p className="text-xs text-muted-foreground">By posting, you agree to our terms. We never share your details with anyone outside your matched tradesmen.</p>
            </div>
          )}

          {/* Nav buttons */}
          <div className="mt-8 flex items-center justify-between">
            <Button variant="ghost" onClick={() => setStep((s) => Math.max(1, s - 1))} disabled={step === 1} data-testid="button-back">
              <ChevronLeft className="mr-1 h-4 w-4" /> Back
            </Button>
            {step < 4 ? (
              <Button onClick={() => setStep((s) => s + 1)} disabled={!canNext()} data-testid="button-next">
                Continue <ChevronRight className="ml-1 h-4 w-4" />
              </Button>
            ) : (
              <Button onClick={submit} disabled={submitting} data-testid="button-submit-job">
                {submitting ? "Posting…" : "Post job & get quotes"}
              </Button>
            )}
          </div>
        </Card>
      </div>
    </Layout>
  );
}
