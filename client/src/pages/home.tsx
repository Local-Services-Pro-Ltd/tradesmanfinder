import { Link } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { Layout } from "@/components/layout";
import { SearchBar } from "@/components/search-bar";
import { TradesmanCard, TradesmanCardSkeleton } from "@/components/tradesman-card";
import { CategoryIcon, StarRating } from "@/components/brand";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import {
  Accordion, AccordionContent, AccordionItem, AccordionTrigger,
} from "@/components/ui/accordion";
import type { Category, Area, Tradesman, Stats, Review } from "@/lib/api-types";
import {
  ShieldCheck, Users, Clock, Star, FileText, MessageSquare, CheckCircle2, ArrowRight, MapPin, Quote as QuoteIcon,
} from "lucide-react";
import heroImg from "@assets/hero-builder.png";

const FAQS = [
  { q: "Is TradesmanFinder free to use?", a: "Yes — posting a job and getting quotes is completely free for homeowners. You only deal directly with the tradesmen who quote you." },
  { q: "How are tradesmen vetted?", a: "Verified tradesmen have had their identity, insurance and (where relevant) trade qualifications checked by our team. Look for the green Verified badge." },
  { q: "How quickly will I hear back?", a: "Most jobs are matched to available local tradesmen within minutes, and you'll typically receive your first quotes within a few hours." },
  { q: "What if I'm not happy with a tradesman?", a: "Every tradesman has genuine customer reviews. We encourage you to read reviews, compare quotes and never feel pressured to accept." },
  { q: "Do you cover my area?", a: "We cover London, the South East and major UK cities, and we're expanding fast. Search your postcode to see local tradesmen." },
];

function TrustStat({ icon: Icon, value, label }: { icon: typeof Users; value: string; label: string }) {
  return (
    <div className="flex items-center gap-3" data-testid={`stat-${label.toLowerCase().replace(/\s/g, "-")}`}>
      <span className="flex h-11 w-11 items-center justify-center rounded-lg bg-primary/15 text-primary"><Icon className="h-5 w-5" /></span>
      <div>
        <p className="font-display text-lg font-bold leading-none text-foreground">{value}</p>
        <p className="text-sm text-muted-foreground">{label}</p>
      </div>
    </div>
  );
}

export default function Home() {
  const { data: categories } = useQuery<Category[]>({ queryKey: ["/api/categories"] });
  const { data: areas } = useQuery<Area[]>({ queryKey: ["/api/areas"] });
  const { data: tradesmen, isLoading } = useQuery<Tradesman[]>({ queryKey: ["/api/tradesmen"] });
  const { data: stats } = useQuery<Stats>({ queryKey: ["/api/stats"] });
  const { data: reviews } = useQuery<Review[]>({ queryKey: ["/api/reviews"] });

  // Sort featured pros so paid/recent features (with a featured_until set)
  // rank above unscheduled seed/demo rows, then by id ascending.
  // Why: real paying Featured Pros must always outrank seed data on the
  // homepage — otherwise a brand-new paying customer can be invisible.
  const featured = (tradesmen || [])
    .filter((t) => t.featured)
    .sort((a, b) => {
      const aUntil = a.featuredUntil ?? -1;
      const bUntil = b.featuredUntil ?? -1;
      if (aUntil !== bUntil) return bUntil - aUntil;
      return a.id - b.id;
    })
    .slice(0, 8);
  const topCats = (categories || []).slice(0, 10);
  const countByCat = (catId: number) =>
    (tradesmen || []).filter((t) => { try { return (JSON.parse(t.categories) as number[]).includes(catId); } catch { return false; } }).length;
  const topReviews = (reviews || []).filter((r) => r.rating === 5 && r.body.length > 60).slice(0, 3);

  return (
    <Layout>
      {/* HERO */}
      <section className="relative overflow-hidden bg-navy text-white">
        <div className="absolute inset-0">
          <img src={heroImg} alt="" className="h-full w-full object-cover opacity-25" />
          <div className="absolute inset-0 bg-gradient-to-r from-navy via-navy/90 to-navy/40" />
        </div>
        <div className="relative mx-auto max-w-7xl px-4 py-20 sm:px-6 sm:py-28">
          <div className="max-w-2xl">
            <span className="inline-flex items-center gap-2 rounded-full bg-white/10 px-3 py-1 text-sm font-medium text-white/90">
              <ShieldCheck className="h-4 w-4 text-primary" /> Trusted, vetted local trades
            </span>
            <h1 className="mt-5 font-display text-3xl font-extrabold leading-[1.1] tracking-tight sm:text-4xl md:text-5xl">
              Find a trusted local tradesman
            </h1>
            <p className="mt-4 max-w-xl text-base text-white/80 sm:text-lg">
              Post your job for free and get quotes from verified builders, plumbers, electricians and more in your area — usually within hours.
            </p>
            <div className="mt-8">
              <SearchBar />
            </div>
            <div className="mt-5 flex flex-wrap items-center gap-x-6 gap-y-2 text-sm text-white/70">
              <span className="flex items-center gap-1.5"><CheckCircle2 className="h-4 w-4 text-primary" /> Free to post</span>
              <span className="flex items-center gap-1.5"><CheckCircle2 className="h-4 w-4 text-primary" /> No obligation</span>
              <span className="flex items-center gap-1.5"><CheckCircle2 className="h-4 w-4 text-primary" /> Verified reviews</span>
            </div>
          </div>
        </div>
      </section>

      {/* TRUST STRIP */}
      <section className="border-b border-border bg-background">
        <div className="mx-auto grid max-w-7xl grid-cols-2 gap-6 px-4 py-8 sm:px-6 lg:grid-cols-4">
          <TrustStat icon={ShieldCheck} value={stats ? `${stats.verified}` : "—"} label="Verified tradesmen" />
          <TrustStat icon={FileText} value={stats ? `${stats.jobs}+` : "—"} label="Jobs posted" />
          <TrustStat icon={Clock} value={stats ? `~${Math.round(stats.avgResponseMinutes)} min` : "—"} label="Avg. response time" />
          <TrustStat icon={Star} value={stats ? `${stats.reviews}` : "—"} label="Customer reviews" />
        </div>
      </section>

      {/* CATEGORY GRID */}
      <section className="mx-auto max-w-7xl px-4 py-16 sm:px-6">
        <div className="mb-8 flex items-end justify-between">
          <div>
            <h2 className="font-display text-xl font-bold text-foreground">Browse by trade</h2>
            <p className="mt-1 text-muted-foreground">Whatever the job, we'll connect you with the right local pro.</p>
          </div>
          <Link href="/categories" className="hidden sm:block">
            <Button variant="ghost" className="gap-1">All trades <ArrowRight className="h-4 w-4" /></Button>
          </Link>
        </div>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
          {topCats.map((c) => (
            <Link key={c.id} href={`/category/${c.slug}`} data-testid={`tile-category-${c.slug}`}>
              <Card className="flex h-full flex-col items-start gap-2 p-4 hover-elevate">
                <span className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/15 text-primary">
                  <CategoryIcon name={c.icon} className="h-5 w-5" />
                </span>
                <p className="font-medium text-foreground">{c.name}</p>
                <p className="text-xs text-muted-foreground">{countByCat(c.id)} local pros</p>
              </Card>
            </Link>
          ))}
        </div>
      </section>

      {/* HOW IT WORKS */}
      <section className="bg-accent/40">
        <div className="mx-auto max-w-7xl px-4 py-16 sm:px-6">
          <h2 className="text-center font-display text-xl font-bold text-foreground">How it works</h2>
          <p className="mx-auto mt-1 max-w-lg text-center text-muted-foreground">Three simple steps to get your job done by someone you can trust.</p>
          <div className="mt-10 grid gap-6 md:grid-cols-3">
            {[
              { icon: FileText, title: "1. Post your job", body: "Tell us what you need doing and where. Takes two minutes — it's free with no obligation." },
              { icon: MessageSquare, title: "2. Compare quotes", body: "We match you with up to 3 verified local tradesmen who'll get in touch with their quotes." },
              { icon: CheckCircle2, title: "3. Hire with confidence", body: "Read genuine reviews, pick your favourite and get the job done. Then leave a review of your own." },
            ].map((s) => (
              <Card key={s.title} className="p-6">
                <span className="flex h-12 w-12 items-center justify-center rounded-xl bg-primary text-primary-foreground"><s.icon className="h-6 w-6" /></span>
                <h3 className="mt-4 font-display text-base font-semibold text-foreground">{s.title}</h3>
                <p className="mt-2 text-sm text-muted-foreground">{s.body}</p>
              </Card>
            ))}
          </div>
        </div>
      </section>

      {/* FEATURED TRADESMEN */}
      <section className="mx-auto max-w-7xl px-4 py-16 sm:px-6">
        <div className="mb-8 flex items-end justify-between">
          <div>
            <h2 className="font-display text-xl font-bold text-foreground">Featured tradesmen</h2>
            <p className="mt-1 text-muted-foreground">Top-rated, verified professionals in our network.</p>
          </div>
        </div>
        <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-4">
          {isLoading
            ? Array.from({ length: 4 }).map((_, i) => <TradesmanCardSkeleton key={i} />)
            : featured.map((t) => <TradesmanCard key={t.id} tradesman={t} categories={categories} areas={areas} />)}
        </div>
      </section>

      {/* POPULAR AREAS */}
      <section className="bg-accent/40">
        <div className="mx-auto max-w-7xl px-4 py-16 sm:px-6">
          <h2 className="font-display text-xl font-bold text-foreground">Popular areas</h2>
          <p className="mt-1 text-muted-foreground">Find trusted trades near you.</p>
          <div className="mt-8 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
            {(areas || []).slice(0, 15).map((a) => (
              <Link key={a.id} href={`/area/${a.slug}`} data-testid={`tile-area-${a.slug}`}>
                <Card className="flex items-center gap-2 p-3 hover-elevate">
                  <MapPin className="h-4 w-4 shrink-0 text-primary" />
                  <div className="min-w-0">
                    <p className="truncate font-medium text-foreground">{a.name}</p>
                    <p className="truncate text-xs text-muted-foreground">{a.region}</p>
                  </div>
                </Card>
              </Link>
            ))}
          </div>
        </div>
      </section>

      {/* TESTIMONIALS */}
      {topReviews.length > 0 && (
        <section className="mx-auto max-w-7xl px-4 py-16 sm:px-6">
          <h2 className="font-display text-xl font-bold text-foreground">What homeowners say</h2>
          <div className="mt-8 grid gap-5 md:grid-cols-3">
            {topReviews.map((r) => (
              <Card key={r.id} className="flex flex-col p-6">
                <QuoteIcon className="h-7 w-7 text-primary/30" />
                <StarRating value={r.rating} size={16} className="mt-3" />
                <p className="mt-3 flex-1 text-sm text-foreground">"{r.body}"</p>
                <p className="mt-4 text-sm font-semibold text-foreground">{r.customerName}</p>
              </Card>
            ))}
          </div>
        </section>
      )}

      {/* RECRUITMENT CTA */}
      <section className="mx-auto max-w-7xl px-4 pb-16 sm:px-6">
        <Card className="overflow-hidden border-0 bg-navy text-white">
          <div className="grid items-center gap-6 p-8 sm:p-10 md:grid-cols-2">
            <div>
              <h2 className="font-display text-xl font-bold sm:text-2xl">Are you a tradesman?</h2>
              <p className="mt-3 max-w-md text-white/80">
                Join thousands of trusted UK trades winning new work. Free profile, pay only for the leads you want, and grow your reputation with verified reviews.
              </p>
              <div className="mt-6 flex flex-wrap gap-3">
                <Link href="/for-tradesmen"><Button size="lg" data-testid="button-cta-fortradesmen">How it works</Button></Link>
                <Link href="/join"><Button size="lg" variant="outline" className="border-white/30 bg-transparent text-white hover:bg-white/10" data-testid="button-cta-join">Join free</Button></Link>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              {[
                { v: "Free", l: "to create a profile" },
                { v: "£25", l: "for 5 lead credits" },
                { v: "Verified", l: "reviews build trust" },
                { v: "Local", l: "leads in your area" },
              ].map((s) => (
                <div key={s.l} className="rounded-lg bg-white/10 p-4">
                  <p className="font-display text-lg font-bold">{s.v}</p>
                  <p className="text-sm text-white/70">{s.l}</p>
                </div>
              ))}
            </div>
          </div>
        </Card>
      </section>

      {/* FAQ */}
      <section className="mx-auto max-w-3xl px-4 pb-20 sm:px-6">
        <h2 className="text-center font-display text-xl font-bold text-foreground">Frequently asked questions</h2>
        <Accordion type="single" collapsible className="mt-8">
          {FAQS.map((f, i) => (
            <AccordionItem key={i} value={`faq-${i}`} data-testid={`faq-${i}`}>
              <AccordionTrigger className="text-left font-medium">{f.q}</AccordionTrigger>
              <AccordionContent className="text-muted-foreground">{f.a}</AccordionContent>
            </AccordionItem>
          ))}
        </Accordion>
      </section>
    </Layout>
  );
}
