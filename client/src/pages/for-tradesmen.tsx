import { Link } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { Layout } from "@/components/layout";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import type { Stats } from "@/lib/api-types";
import { Check, Star, TrendingUp, Users, Zap, Quote } from "lucide-react";

const PACKS = [
  { name: "Starter", price: "£25", credits: 5, per: "£5.00 / lead", popular: false },
  { name: "Pro", price: "£45", credits: 10, per: "£4.50 / lead", popular: true },
  { name: "Power", price: "£80", credits: 20, per: "£4.00 / lead", popular: false },
];

const STEPS = [
  { icon: Users, title: "Create your free profile", body: "Showcase your work, reviews and credentials. Listing is always free." },
  { icon: Zap, title: "Get matched to local jobs", body: "We send you leads that match your trade and area in real time." },
  { icon: TrendingUp, title: "Win work & grow", body: "Buy credits only when you want to respond. No subscriptions, no tie-ins." },
];

export default function ForTradesmen() {
  const { data: stats } = useQuery<Stats>({ queryKey: ["/api/stats"] });

  return (
    <Layout>
      {/* Hero */}
      <section className="relative overflow-hidden bg-navy">
        <div className="absolute inset-0 opacity-[0.07]" style={{ backgroundImage: "radial-gradient(circle at 20% 30%, white 1px, transparent 1px)", backgroundSize: "28px 28px" }} />
        <div className="relative mx-auto max-w-7xl px-4 py-16 sm:py-24 sm:px-6">
          <div className="max-w-2xl">
            <Badge className="bg-primary text-primary-foreground hover:bg-primary">For tradesmen</Badge>
            <h1 className="mt-4 font-display text-2xl font-bold leading-tight text-white sm:text-2xl">Grow your trade business with quality local leads</h1>
            <p className="mt-4 text-lg text-white/70">Join {stats?.tradesmen ?? "thousands of"} tradesmen winning work across the UK. Free profile, pay only for the leads you want.</p>
            <div className="mt-7 flex flex-wrap gap-3">
              <Link href="/join"><Button size="lg" data-testid="button-join-hero">Create free profile</Button></Link>
              <a href="#pricing" onClick={(e) => { e.preventDefault(); document.getElementById("pricing")?.scrollIntoView({ behavior: "smooth" }); }}>
                <Button size="lg" variant="outline" className="border-white/30 bg-transparent text-white hover:bg-white/10 hover:text-white" data-testid="button-see-pricing">See pricing</Button>
              </a>
            </div>
            <div className="mt-8 flex flex-wrap gap-x-8 gap-y-2 text-sm text-white/60">
              <span className="flex items-center gap-1.5"><Check className="h-4 w-4 text-primary" /> No subscription required</span>
              <span className="flex items-center gap-1.5"><Check className="h-4 w-4 text-primary" /> Cancel anytime</span>
              <span className="flex items-center gap-1.5"><Check className="h-4 w-4 text-primary" /> Verified leads only</span>
            </div>
          </div>
        </div>
      </section>

      {/* How it works */}
      <section className="mx-auto max-w-7xl px-4 py-16 sm:px-6">
        <h2 className="text-center font-display text-xl font-bold text-foreground">How it works</h2>
        <div className="mt-10 grid gap-6 md:grid-cols-3">
          {STEPS.map((s, i) => (
            <Card key={i} className="p-6">
              <span className="flex h-11 w-11 items-center justify-center rounded-lg bg-primary/10 text-primary"><s.icon className="h-6 w-6" /></span>
              <h3 className="mt-4 font-display text-lg font-semibold text-foreground">{s.title}</h3>
              <p className="mt-2 text-sm text-muted-foreground">{s.body}</p>
            </Card>
          ))}
        </div>
      </section>

      {/* Pricing */}
      <section id="pricing" className="border-y border-border bg-muted/40">
        <div className="mx-auto max-w-7xl px-4 py-16 sm:px-6">
          <div className="text-center">
            <h2 className="font-display text-xl font-bold text-foreground">Simple, pay-as-you-go pricing</h2>
            <p className="mt-2 text-muted-foreground">Buy lead credits in packs. One credit = one lead response. Credits never expire.</p>
          </div>
          <div className="mt-10 grid gap-6 md:grid-cols-3">
            {PACKS.map((p) => (
              <Card key={p.name} className={`relative p-6 ${p.popular ? "border-primary shadow-lg ring-1 ring-primary" : ""}`} data-testid={`card-pack-${p.name.toLowerCase()}`}>
                {p.popular && <Badge className="absolute -top-3 left-1/2 -translate-x-1/2 bg-primary text-primary-foreground hover:bg-primary">Most popular</Badge>}
                <h3 className="font-display text-lg font-semibold text-foreground">{p.name}</h3>
                <div className="mt-3 flex items-baseline gap-1">
                  <span className="font-display text-2xl font-bold text-foreground">{p.price}</span>
                  <span className="text-muted-foreground">/ {p.credits} credits</span>
                </div>
                <p className="mt-1 text-sm text-muted-foreground">{p.per}</p>
                <ul className="mt-5 space-y-2 text-sm">
                  {[`${p.credits} lead credits`, "Credits never expire", "Full lead details", "Customer contact reveal"].map((f) => (
                    <li key={f} className="flex items-center gap-2 text-foreground"><Check className="h-4 w-4 text-trust" /> {f}</li>
                  ))}
                </ul>
                <Link href="/join"><Button className="mt-6 w-full" variant={p.popular ? "default" : "outline"} data-testid={`button-buy-${p.name.toLowerCase()}`}>Get started</Button></Link>
              </Card>
            ))}
          </div>

          {/* Featured upgrade */}
          <Card className="mt-6 flex flex-col items-start justify-between gap-4 border-navy/20 bg-navy p-6 text-white sm:flex-row sm:items-center">
            <div className="flex items-start gap-4">
              <span className="flex h-11 w-11 items-center justify-center rounded-lg bg-primary text-primary-foreground"><Star className="h-6 w-6 fill-current" /></span>
              <div>
                <h3 className="font-display text-lg font-semibold">Featured listing — £29/mo</h3>
                <p className="mt-1 text-sm text-white/70">Jump to the top of search results in your area, get a featured badge, and win up to 3× more leads.</p>
              </div>
            </div>
            <Link href="/join"><Button data-testid="button-featured">Go Featured</Button></Link>
          </Card>
        </div>
      </section>

      {/* Testimonial */}
      <section className="mx-auto max-w-3xl px-4 py-16 text-center sm:px-6">
        <Quote className="mx-auto h-10 w-10 text-primary/30" />
        <p className="mt-4 font-display text-xl font-medium text-foreground">"I picked up four new jobs in my first month. The leads are local and genuine — far better value than the big directories."</p>
        <p className="mt-4 text-sm text-muted-foreground">— James O., Electrician, Greenwich</p>
      </section>

      {/* FAQ */}
      <section className="border-t border-border bg-muted/40">
        <div className="mx-auto max-w-3xl px-4 py-16 sm:px-6">
          <h2 className="text-center font-display text-xl font-bold text-foreground">Questions, answered</h2>
          <Accordion type="single" collapsible className="mt-8">
            {[
              { q: "Is creating a profile really free?", a: "Yes. Your profile, reviews and gallery are completely free, forever. You only pay when you choose to respond to a lead." },
              { q: "How do credits work?", a: "Each lead costs one credit to unlock. You see the job details and decide whether it's worth responding to. Credits never expire." },
              { q: "What's the difference with Featured?", a: "Featured listings appear at the top of search and category pages with a badge, typically driving 3× more enquiries. It's an optional £29/month upgrade." },
              { q: "Can I cancel any time?", a: "Absolutely. There are no contracts. Pause or stop buying credits whenever you like — your free profile stays live." },
            ].map((f, i) => (
              <AccordionItem key={i} value={`item-${i}`} data-testid={`faq-${i}`}>
                <AccordionTrigger className="text-left">{f.q}</AccordionTrigger>
                <AccordionContent className="text-muted-foreground">{f.a}</AccordionContent>
              </AccordionItem>
            ))}
          </Accordion>
          <div className="mt-10 text-center">
            <Link href="/join"><Button size="lg" data-testid="button-join-footer">Create your free profile</Button></Link>
          </div>
        </div>
      </section>
    </Layout>
  );
}
