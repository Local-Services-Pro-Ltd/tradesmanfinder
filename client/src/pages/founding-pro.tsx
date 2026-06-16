import { Link } from "wouter";
import { Layout } from "@/components/layout";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { Check, ShieldCheck, Sparkles, Clock, MapPin } from "lucide-react";

// Decide where the "Claim my spot" CTAs point. With a ?ref= present this is a
// real pilot invite, so route to the ref-aware claim page that pre-fills the
// profile. With no ref there's no invite to look up, so fall back to the
// generic interest form (PR #106).
function claimHref(): string {
  if (typeof window === "undefined") return "/founding-pro/interest";
  const params = new URLSearchParams(window.location.search);
  const ref = params.get("ref");
  return ref
    ? `/founding-pro/claim?ref=${encodeURIComponent(ref)}`
    : "/founding-pro/interest";
}

const INCLUDED = [
  { icon: Sparkles, title: "30 days of free unlocks", body: "Any job posted in your postcode and trade unlocks for you free — no credit purchase required." },
  { icon: ShieldCheck, title: "No card, no contract", body: "Nothing to pay up front. Cancel anytime. After 30 days you switch to standard pay-as-you-go pricing — only if you want to." },
  { icon: MapPin, title: "Verified, local jobs only", body: "Homeowners pick the tradesman themselves — no callbacks from five different companies, no auction." },
];

const STEPS = [
  { n: "1", title: "Reply to the email", body: "Or click the link in your invite. We've already pre-filled your profile from Companies House — name, trading area, registration." },
  { n: "2", title: "Review and publish", body: "Takes around 60 seconds. Add a short bio, photos, and the trades you cover. We mark you as a Founding Pro." },
  { n: "3", title: "Unlock leads free for 30 days", body: "When a homeowner posts a job in your postcode and trade, you see the full details and contact instantly — no credit cost." },
];

export default function FoundingPro() {
  return (
    <Layout>
      {/* Hero */}
      <section className="relative overflow-hidden bg-navy">
        <div className="absolute inset-0 opacity-[0.07]" style={{ backgroundImage: "radial-gradient(circle at 20% 30%, white 1px, transparent 1px)", backgroundSize: "28px 28px" }} />
        <div className="relative mx-auto max-w-7xl px-4 py-16 sm:py-24 sm:px-6">
          <div className="max-w-2xl">
            <Badge className="bg-primary text-primary-foreground hover:bg-primary">Founding Pro · Invite only</Badge>
            <h1 className="mt-4 font-display text-2xl font-bold leading-tight text-white sm:text-2xl" data-testid="heading-founding-pro">30 days of free leads in your postcode</h1>
            <p className="mt-4 text-lg text-white/70">We're inviting the first 10 verified tradesmen per postcode and trade to be Founding Pros on TradesmanFinder. Every job in your area unlocks free for 30 days. No card. No contract.</p>
            <div className="mt-7 flex flex-wrap gap-3">
              <Link href={claimHref()}>
                <Button size="lg" data-testid="button-claim-hero">Claim my Founding Pro spot</Button>
              </Link>
              <a href="#how" onClick={(e) => { e.preventDefault(); document.getElementById("how")?.scrollIntoView({ behavior: "smooth" }); }}>
                <Button size="lg" variant="outline" className="border-white/30 bg-transparent text-white hover:bg-white/10 hover:text-white" data-testid="button-how-it-works">How it works</Button>
              </a>
            </div>
            <div className="mt-8 flex flex-wrap gap-x-8 gap-y-2 text-sm text-white/60">
              <span className="flex items-center gap-1.5"><Check className="h-4 w-4 text-primary" /> No card required</span>
              <span className="flex items-center gap-1.5"><Check className="h-4 w-4 text-primary" /> Cancel anytime</span>
              <span className="flex items-center gap-1.5"><Check className="h-4 w-4 text-primary" /> Ltd companies only</span>
            </div>
          </div>
        </div>
      </section>

      {/* What's included */}
      <section className="mx-auto max-w-7xl px-4 py-16 sm:px-6">
        <div className="text-center">
          <h2 className="font-display text-xl font-bold text-foreground">What you get</h2>
          <p className="mx-auto mt-2 max-w-2xl text-muted-foreground">A real, time-boxed trial of the platform — with no obligation. If jobs come in during your 30 days, they're yours, free.</p>
        </div>
        <div className="mt-10 grid gap-6 md:grid-cols-3">
          {INCLUDED.map((s, i) => (
            <Card key={i} className="p-6" data-testid={`card-included-${i}`}>
              <span className="flex h-11 w-11 items-center justify-center rounded-lg bg-primary/10 text-primary"><s.icon className="h-6 w-6" /></span>
              <h3 className="mt-4 font-display text-lg font-semibold text-foreground">{s.title}</h3>
              <p className="mt-2 text-sm text-muted-foreground">{s.body}</p>
            </Card>
          ))}
        </div>
      </section>

      {/* Eligibility */}
      <section className="border-y border-border bg-muted/40">
        <div className="mx-auto max-w-3xl px-4 py-16 sm:px-6">
          <h2 className="text-center font-display text-xl font-bold text-foreground">Who can join</h2>
          <ul className="mx-auto mt-8 max-w-xl space-y-3 text-foreground">
            <li className="flex items-start gap-3"><Check className="mt-0.5 h-5 w-5 flex-none text-trust" /><span>UK Limited companies registered at Companies House (active status).</span></li>
            <li className="flex items-start gap-3"><Check className="mt-0.5 h-5 w-5 flex-none text-trust" /><span>One of our launch trades: plumber or electrician (more trades opening soon).</span></li>
            <li className="flex items-start gap-3"><Check className="mt-0.5 h-5 w-5 flex-none text-trust" /><span>Working in one of our pilot London areas: Wandsworth, Richmond, Kensington &amp; Chelsea, or Dulwich.</span></li>
            <li className="flex items-start gap-3"><Clock className="mt-0.5 h-5 w-5 flex-none text-primary" /><span>First 10 verified businesses per postcode + trade. Once a slot's gone, it's gone.</span></li>
          </ul>
        </div>
      </section>

      {/* How it works */}
      <section id="how" className="mx-auto max-w-7xl px-4 py-16 sm:px-6">
        <h2 className="text-center font-display text-xl font-bold text-foreground">How it works</h2>
        <div className="mt-10 grid gap-6 md:grid-cols-3">
          {STEPS.map((s, i) => (
            <Card key={i} className="p-6" data-testid={`card-step-${i}`}>
              <span className="flex h-11 w-11 items-center justify-center rounded-lg bg-primary text-primary-foreground font-display text-lg font-bold">{s.n}</span>
              <h3 className="mt-4 font-display text-lg font-semibold text-foreground">{s.title}</h3>
              <p className="mt-2 text-sm text-muted-foreground">{s.body}</p>
            </Card>
          ))}
        </div>
      </section>

      {/* FAQ */}
      <section className="border-t border-border bg-muted/40">
        <div className="mx-auto max-w-3xl px-4 py-16 sm:px-6">
          <h2 className="text-center font-display text-xl font-bold text-foreground">Questions, answered</h2>
          <Accordion type="single" collapsible className="mt-8">
            {[
              { q: "Are you guaranteeing me leads?", a: "No. We can't promise jobs will be posted in your postcode — that depends on homeowner demand. What we promise is that if a job comes in during your 30 days, you unlock it free, no credit purchase needed." },
              { q: "What happens after 30 days?", a: "You switch to standard pay-as-you-go pricing. One credit per lead unlock, packs from £25. No subscription, no auto-renewal — credits only if you choose to buy them." },
              { q: "Do I need to enter card details?", a: "No. Founding Pro is genuinely card-free. You only ever add payment details if and when you decide to buy credits after the 30 days." },
              { q: "Why only Limited companies?", a: "For the pilot we're verifying every business via Companies House to keep quality high. Sole traders will open up in a later phase." },
              { q: "Can I cancel?", a: "Anytime, with one click. Your profile comes down, no further unlocks, no charges. We'll never invoice you for the trial." },
            ].map((f, i) => (
              <AccordionItem key={i} value={`item-${i}`} data-testid={`faq-${i}`}>
                <AccordionTrigger className="text-left">{f.q}</AccordionTrigger>
                <AccordionContent className="text-muted-foreground">{f.a}</AccordionContent>
              </AccordionItem>
            ))}
          </Accordion>
          <div className="mt-10 text-center">
            <Link href={claimHref()}>
              <Button size="lg" data-testid="button-claim-footer">Claim my Founding Pro spot</Button>
            </Link>
            <p className="mt-3 text-sm text-muted-foreground">Or reply to your invite email — we'll set you up.</p>
          </div>
        </div>
      </section>
    </Layout>
  );
}
