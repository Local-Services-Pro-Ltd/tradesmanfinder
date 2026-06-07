import { useState } from "react";
import { PartnerPlacement } from "@/components/partner-placement";
import { Layout } from "@/components/layout";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import { Check, Handshake, Target, TrendingUp, Megaphone, MapPin, Layers, CheckCircle2 } from "lucide-react";

/* ─────────────────────────────────────────────
   /partners — Inbound marketing page for the
   Partner Programme (issue #22 / PR-P2).

   Tone: scrappy/founder-led. We're early; we want
   to talk to humans, not run a polished B2B funnel.
   Pricing here is "stakes in the ground", not
   contractual — partners get a bespoke proposal
   after the discovery call (PR-P3 admin tooling).
   ───────────────────────────────────────────── */

const VERTICALS: { value: string; label: string }[] = [
  { value: "builders_merchant", label: "Builders' merchant" },
  { value: "epc", label: "EPC / energy assessor" },
  { value: "finance", label: "Home-improvement finance" },
  { value: "insurance", label: "Insurance" },
  { value: "solicitor", label: "Solicitor / conveyancer" },
  { value: "other", label: "Something else" },
];

const PLACEMENTS = [
  { icon: Megaphone, title: "Category sponsorship", body: "Branded banner on a category page (e.g. \"Boilers\"). Exclusive to one partner per category." },
  { icon: MapPin, title: "Area sponsorship", body: "Featured slot on a specific town or postcode page. Great for local merchants." },
  { icon: Target, title: "Qualified lead handoff", body: "We pass on relevant homeowner enquiries with consent. You pay per lead, not per click." },
  { icon: CheckCircle2, title: "Booked-lead pricing", body: "Pay only when a homeowner actually books a job through your funnel. Higher rate, zero waste." },
  { icon: TrendingUp, title: "Revenue share", body: "For long-cycle products (finance, insurance) — we take a small % of completed sales, capped per lead." },
  { icon: Layers, title: "Bundle", body: "Mix sponsorship + leads. Most partners start here. We tune the mix together over the first 60 days." },
];

const STAKES = [
  { label: "Category sponsorship", price: "£200 / month", note: "Exclusive to one partner" },
  { label: "Area sponsorship", price: "£100 / month", note: "Per town / postcode group" },
  { label: "Qualified lead", price: "£15 / lead", note: "Real homeowner, opted in" },
  { label: "Booked lead", price: "£40 / lead", note: "Pay only when job is booked" },
  { label: "Revenue share", price: "10%", note: "Capped at £30 / lead" },
];

type FormState = {
  companyName: string;
  contactName: string;
  email: string;
  phone: string;
  vertical: string;
  monthlyBudget: string;
  message: string;
  // honeypot — must stay empty; server's publicFormGuard rejects if filled
  company_website: string;
};

const EMPTY: FormState = {
  companyName: "",
  contactName: "",
  email: "",
  phone: "",
  vertical: "",
  monthlyBudget: "",
  message: "",
  company_website: "",
};

export default function Partners() {
  const { toast } = useToast();
  const [form, setForm] = useState<FormState>(EMPTY);
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const set = <K extends keyof FormState>(k: K, v: FormState[K]) => setForm((f) => ({ ...f, [k]: v }));

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (submitting) return;

    // Lightweight client-side validation — server is the source of truth.
    if (!form.companyName.trim() || !form.contactName.trim() || !form.email.trim() || !form.vertical || !form.message.trim()) {
      toast({ title: "Almost there", description: "Please fill in company, your name, email, vertical and a short message.", variant: "destructive" });
      return;
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email.trim())) {
      toast({ title: "Check your email", description: "That doesn't look like a valid email address.", variant: "destructive" });
      return;
    }

    setSubmitting(true);
    try {
      // Server accepts only insertPartnerEnquirySchema fields + honeypot.
      const payload: Record<string, unknown> = {
        companyName: form.companyName.trim(),
        contactName: form.contactName.trim(),
        email: form.email.trim(),
        vertical: form.vertical,
        message: form.message.trim(),
        company_website: form.company_website, // honeypot — submitted intentionally
      };
      if (form.phone.trim()) payload.phone = form.phone.trim();
      if (form.monthlyBudget.trim()) payload.monthlyBudget = form.monthlyBudget.trim();

      // apiRequest throws on non-2xx via throwIfResNotOk, caught below.
      await apiRequest("POST", "/api/partner-enquiries", payload);
      setSubmitted(true);
      setForm(EMPTY);
      toast({ title: "Thanks — we'll be in touch", description: "We read every enquiry and reply within 1-2 working days." });
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Please try again in a moment.";
      toast({ title: "Something went wrong", description: msg, variant: "destructive" });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Layout>
      {/* Hero */}
      <section className="relative overflow-hidden bg-navy">
        <div className="absolute inset-0 opacity-[0.07]" style={{ backgroundImage: "radial-gradient(circle at 70% 30%, white 1px, transparent 1px)", backgroundSize: "28px 28px" }} />
        <div className="relative mx-auto max-w-7xl px-4 py-16 sm:py-24 sm:px-6">
          <div className="max-w-2xl">
            <Badge className="bg-primary text-primary-foreground hover:bg-primary">Partner Programme</Badge>
            <h1 className="mt-4 font-display text-2xl font-bold leading-tight text-white sm:text-2xl">Reach homeowners at the moment they're ready to spend</h1>
            <p className="mt-4 text-lg text-white/70">
              We're building TradesmanFinder — a UK home-services marketplace with real reviews, vetted tradesmen and high-intent homeowner traffic. We're opening up a handful of partner slots and would love to talk if you sell to homeowners mid-project.
            </p>
            <div className="mt-7 flex flex-wrap gap-3">
              <a href="#enquire" onClick={(e) => { e.preventDefault(); document.getElementById("enquire")?.scrollIntoView({ behavior: "smooth" }); }}>
                <Button size="lg" data-testid="button-enquire-hero">Talk to us</Button>
              </a>
              <a href="#how" onClick={(e) => { e.preventDefault(); document.getElementById("how")?.scrollIntoView({ behavior: "smooth" }); }}>
                <Button size="lg" variant="outline" className="border-white/30 bg-transparent text-white hover:bg-white/10 hover:text-white" data-testid="button-how-it-works">How it works</Button>
              </a>
            </div>
            <div className="mt-8 flex flex-wrap gap-x-8 gap-y-2 text-sm text-white/60">
              <span className="flex items-center gap-1.5"><Check className="h-4 w-4 text-primary" /> No long contracts</span>
              <span className="flex items-center gap-1.5"><Check className="h-4 w-4 text-primary" /> Performance-priced options</span>
              <span className="flex items-center gap-1.5"><Check className="h-4 w-4 text-primary" /> Founder-led conversations</span>
            </div>
          </div>
        </div>
      </section>

      {/* Why partner */}
      <section className="mx-auto max-w-7xl px-4 py-16 sm:px-6">
        <div className="grid gap-8 md:grid-cols-3">
          <Card className="p-6">
            <span className="flex h-11 w-11 items-center justify-center rounded-lg bg-primary/10 text-primary"><Handshake className="h-6 w-6" /></span>
            <h3 className="mt-4 font-display text-lg font-semibold text-foreground">High-intent audience</h3>
            <p className="mt-2 text-sm text-muted-foreground">Our homeowners arrive ready to hire someone — kitchen, boiler, roof, extension. They're not browsers, they're buyers.</p>
          </Card>
          <Card className="p-6">
            <span className="flex h-11 w-11 items-center justify-center rounded-lg bg-primary/10 text-primary"><Target className="h-6 w-6" /></span>
            <h3 className="mt-4 font-display text-lg font-semibold text-foreground">Pricing that fits your model</h3>
            <p className="mt-2 text-sm text-muted-foreground">Sponsor a category, pay per lead, pay per booked job, or share revenue. We pick what aligns to your unit economics — not ours.</p>
          </Card>
          <Card className="p-6">
            <span className="flex h-11 w-11 items-center justify-center rounded-lg bg-primary/10 text-primary"><TrendingUp className="h-6 w-6" /></span>
            <h3 className="mt-4 font-display text-lg font-semibold text-foreground">Grow with us</h3>
            <p className="mt-2 text-sm text-muted-foreground">We're early. First partners get exclusivity in their vertical, founder-level support, and a real seat at the roadmap table.</p>
          </Card>
        </div>
      </section>

      {/* Placement types */}
      <section id="how" className="border-y border-border bg-muted/40">
        <div className="mx-auto max-w-7xl px-4 py-16 sm:px-6">
          <div className="text-center">
            <h2 className="font-display text-xl font-bold text-foreground">Six ways to partner</h2>
            <p className="mt-2 text-muted-foreground">Pick one or stack them. Most partners start with sponsorship + qualified leads.</p>
          </div>
          <div className="mt-10 grid gap-6 md:grid-cols-2 lg:grid-cols-3">
            {PLACEMENTS.map((p) => (
              <Card key={p.title} className="p-6">
                <span className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10 text-primary"><p.icon className="h-5 w-5" /></span>
                <h3 className="mt-4 font-display text-base font-semibold text-foreground">{p.title}</h3>
                <p className="mt-2 text-sm text-muted-foreground">{p.body}</p>
              </Card>
            ))}
          </div>
        </div>
      </section>

      {/* Pricing stakes in the ground */}
      <section className="mx-auto max-w-7xl px-4 py-16 sm:px-6">
        <div className="text-center">
          <h2 className="font-display text-xl font-bold text-foreground">Pricing — stakes in the ground</h2>
          <p className="mt-2 mx-auto max-w-2xl text-muted-foreground">
            These are our starting numbers for v1. Real proposals are bespoke — based on your vertical, the volumes we can realistically drive, and what's fair while we're still proving the channel.
          </p>
        </div>
        <div className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
          {STAKES.map((s) => (
            <Card key={s.label} className="p-5">
              <p className="text-sm font-medium text-muted-foreground">{s.label}</p>
              <p className="mt-2 font-display text-xl font-bold text-foreground">{s.price}</p>
              <p className="mt-1 text-xs text-muted-foreground">{s.note}</p>
            </Card>
          ))}
        </div>
        <p className="mt-6 text-center text-xs text-muted-foreground">No setup fees. Monthly rolling. Cancel with 30 days' notice.</p>
      </section>

      {/* Enquiry form */}
      <section id="enquire" className="border-t border-border bg-muted/40">
        <div className="mx-auto max-w-3xl px-4 py-16 sm:px-6">
          <div className="text-center">
            <h2 className="font-display text-xl font-bold text-foreground">Tell us about your business</h2>
            <p className="mt-2 text-muted-foreground">A short note is enough. We'll reply within 1-2 working days to set up a 20-minute call.</p>
          </div>

          {submitted ? (
            <Card className="mt-10 p-8 text-center" data-testid="card-partner-thanks">
              <CheckCircle2 className="mx-auto h-12 w-12 text-trust" />
              <h3 className="mt-4 font-display text-lg font-semibold text-foreground">Thanks — we've got your enquiry</h3>
              <p className="mt-2 text-sm text-muted-foreground">We read every one personally and will be in touch within 1-2 working days. If it's urgent, drop us a note at <a href="mailto:partners@tradesmanfinder.com" className="text-primary underline">partners@tradesmanfinder.com</a>.</p>
              <Button className="mt-6" variant="outline" onClick={() => setSubmitted(false)} data-testid="button-submit-another">Submit another</Button>
            </Card>
          ) : (
            <Card className="mt-10 p-6 sm:p-8">
              <form onSubmit={onSubmit} className="grid gap-5" data-testid="form-partner-enquiry">
                {/* Honeypot — hidden from real users, tempting to bots. publicFormGuard rejects any request where this field is non-empty. */}
                <div aria-hidden="true" style={{ position: "absolute", left: "-10000px", top: "auto", width: "1px", height: "1px", overflow: "hidden" }}>
                  <label htmlFor="company_website">Company website (leave blank)</label>
                  <input
                    id="company_website"
                    name="company_website"
                    type="text"
                    tabIndex={-1}
                    autoComplete="off"
                    value={form.company_website}
                    onChange={(e) => set("company_website", e.target.value)}
                  />
                </div>

                <div className="grid gap-4 sm:grid-cols-2">
                  <div>
                    <Label htmlFor="companyName">Company name *</Label>
                    <Input id="companyName" value={form.companyName} onChange={(e) => set("companyName", e.target.value)} data-testid="input-company-name" />
                  </div>
                  <div>
                    <Label htmlFor="contactName">Your name *</Label>
                    <Input id="contactName" value={form.contactName} onChange={(e) => set("contactName", e.target.value)} data-testid="input-contact-name" />
                  </div>
                </div>

                <div className="grid gap-4 sm:grid-cols-2">
                  <div>
                    <Label htmlFor="email">Email *</Label>
                    <Input id="email" type="email" value={form.email} onChange={(e) => set("email", e.target.value)} data-testid="input-email" />
                  </div>
                  <div>
                    <Label htmlFor="phone">Phone (optional)</Label>
                    <Input id="phone" value={form.phone} onChange={(e) => set("phone", e.target.value)} data-testid="input-phone" />
                  </div>
                </div>

                <div className="grid gap-4 sm:grid-cols-2">
                  <div>
                    <Label htmlFor="vertical">Vertical *</Label>
                    <Select value={form.vertical} onValueChange={(v) => set("vertical", v)}>
                      <SelectTrigger id="vertical" data-testid="select-vertical"><SelectValue placeholder="Choose one" /></SelectTrigger>
                      <SelectContent>
                        {VERTICALS.map((v) => <SelectItem key={v.value} value={v.value}>{v.label}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </div>
                  <div>
                    <Label htmlFor="monthlyBudget">Rough monthly budget (optional)</Label>
                    <Input id="monthlyBudget" placeholder="e.g. £500-2k, or TBC" value={form.monthlyBudget} onChange={(e) => set("monthlyBudget", e.target.value)} data-testid="input-budget" />
                  </div>
                </div>

                <div>
                  <Label htmlFor="message">What are you hoping to achieve? *</Label>
                  <Textarea id="message" rows={5} placeholder="A few lines about your business, where you operate, and the kind of homeowners you'd love to reach." value={form.message} onChange={(e) => set("message", e.target.value)} data-testid="input-message" />
                </div>

                <p className="text-xs text-muted-foreground">
                  By submitting you agree we may contact you about partnership opportunities. We won't share your details. See our <a href="/privacy" className="text-primary underline">privacy notice</a>.
                </p>

                <Button type="submit" size="lg" disabled={submitting} data-testid="button-submit-enquiry">
                  {submitting ? "Sending…" : "Send enquiry"}
                </Button>
              </form>
            </Card>
          )}
        </div>
      </section>
      <PartnerPlacement surface="partners_page" className="mx-auto max-w-3xl px-4 pb-12 sm:px-6" />
    </Layout>
  );
}
