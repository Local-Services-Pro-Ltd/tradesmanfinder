import { useRoute, Link } from "wouter";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Layout } from "@/components/layout";
import { StarRating, VerificationChips, ResponseTimePill, CategoryIcon } from "@/components/brand";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import type { Tradesman, Category, Area, Review } from "@/lib/api-types";
import { parseJsonArray, timeAgo } from "@/lib/api-types";
import { ChevronRight, MapPin, Phone, Mail, Calendar, CheckCircle2, Star } from "lucide-react";

function RatingHistogram({ reviews }: { reviews: Review[] }) {
  const total = reviews.length || 1;
  const counts = [5, 4, 3, 2, 1].map((star) => ({ star, n: reviews.filter((r) => r.rating === star).length }));
  return (
    <div className="space-y-1.5">
      {counts.map(({ star, n }) => (
        <div key={star} className="flex items-center gap-2 text-sm">
          <span className="flex w-6 items-center gap-0.5 text-muted-foreground">{star}<Star className="h-3 w-3 fill-primary text-primary" /></span>
          <div className="h-2 flex-1 overflow-hidden rounded-full bg-muted">
            <div className="h-full rounded-full bg-primary" style={{ width: `${(n / total) * 100}%` }} />
          </div>
          <span className="w-8 text-right text-muted-foreground">{n}</span>
        </div>
      ))}
    </div>
  );
}

export default function TradesmanProfile() {
  const [, params] = useRoute("/tradesman/:slug");
  const slug = params?.slug;
  const { toast } = useToast();
  const { data: categories } = useQuery<Category[]>({ queryKey: ["/api/categories"] });
  const { data: areas } = useQuery<Area[]>({ queryKey: ["/api/areas"] });
  const { data: tradesman, isLoading } = useQuery<Tradesman>({ queryKey: ["/api/tradesmen/by-slug", slug], queryFn: async () => (await apiRequest("GET", `/api/tradesmen/by-slug/${slug}`)).json(), enabled: !!slug });
  const { data: reviews } = useQuery<Review[]>({ queryKey: ["/api/reviews", tradesman?.id], queryFn: async () => (await apiRequest("GET", `/api/reviews?tradesman=${tradesman!.id}`)).json(), enabled: !!tradesman });

  const [submitted, setSubmitted] = useState(false);
  const [revealed, setRevealed] = useState(false);
  const [form, setForm] = useState({ name: "", email: "", phone: "", message: "" });

  if (isLoading) return <Layout><div className="mx-auto max-w-7xl px-4 py-20"><div className="h-64 animate-pulse rounded-xl bg-muted" /></div></Layout>;
  if (!tradesman) return <Layout><div className="mx-auto max-w-3xl px-4 py-24 text-center"><h1 className="font-display text-xl font-bold">Tradesman not found</h1><Link href="/categories"><Button className="mt-4">Browse trades</Button></Link></div></Layout>;

  const catIds = parseJsonArray<number>(tradesman.categories);
  const cats = (categories || []).filter((c) => catIds.includes(c.id));
  const area = areas?.find((a) => a.id === tradesman.areaId);
  const gallery = parseJsonArray<string>(tradesman.gallery);

  const submitQuote = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.name || !form.email || !form.message) {
      toast({ title: "Please complete the form", description: "Name, email and a short message are required.", variant: "destructive" });
      return;
    }
    try {
      // create a lightweight job for this tradesman, then a quote placeholder
      const jobRes = await apiRequest("POST", "/api/jobs", {
        customerName: form.name, customerEmail: form.email, customerPhone: form.phone || "N/A",
        postcode: area?.region.split(" ").pop() || "", categoryId: catIds[0], areaId: tradesman.areaId,
        title: `Quote request for ${tradesman.businessName}`, description: form.message,
        urgency: "flexible", budgetRange: "",
      });
      const data = await jobRes.json();
      await apiRequest("POST", "/api/quotes", { jobId: data.job.id, tradesmanId: tradesman.id, priceEstimate: "", message: form.message, status: "sent" });
      queryClient.invalidateQueries({ queryKey: ["/api/jobs"] });
      setSubmitted(true);
      setRevealed(true);
      toast({ title: "Quote request sent!", description: `${tradesman.businessName} will be in touch shortly.` });
    } catch {
      toast({ title: "Something went wrong", description: "Please try again.", variant: "destructive" });
    }
  };

  return (
    <Layout>
      {/* Hero */}
      <div className="relative h-56 overflow-hidden bg-navy sm:h-72">
        <img src={tradesman.heroImageUrl} alt={tradesman.businessName} className="h-full w-full object-cover opacity-60" />
        <div className="absolute inset-0 bg-gradient-to-t from-navy to-transparent" />
      </div>

      <div className="mx-auto max-w-7xl px-4 sm:px-6">
        <div className="relative -mt-16 grid gap-8 lg:grid-cols-3">
          {/* Main */}
          <div className="lg:col-span-2">
            <Card className="p-6">
              <nav className="mb-2 flex items-center gap-1 text-sm text-muted-foreground">
                <Link href="/" className="hover:text-primary">Home</Link><ChevronRight className="h-3.5 w-3.5" />
                {cats[0] && <Link href={`/category/${cats[0].slug}`} className="hover:text-primary">{cats[0].name}s</Link>}
              </nav>
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <h1 className="font-display text-2xl font-bold text-foreground" data-testid="text-business-name">{tradesman.businessName}</h1>
                  {area && <p className="mt-1 flex items-center gap-1 text-muted-foreground"><MapPin className="h-4 w-4" /> {area.name}, {area.region}</p>}
                </div>
                {tradesman.featured && <Badge className="bg-navy text-white hover:bg-navy">Featured</Badge>}
              </div>

              <div className="mt-4 flex flex-wrap items-center gap-4">
                <div className="flex items-center gap-2">
                  <StarRating value={tradesman.ratingAverage} size={18} />
                  <span className="font-semibold text-foreground">{tradesman.ratingAverage.toFixed(1)}</span>
                  <span className="text-muted-foreground">({tradesman.ratingCount} reviews)</span>
                </div>
                <ResponseTimePill minutes={tradesman.responseTimeMinutes} />
                <span className="flex items-center gap-1 text-sm text-muted-foreground"><Calendar className="h-4 w-4" /> {tradesman.yearsExperience} yrs experience</span>
              </div>

              <div className="mt-4"><VerificationChips verified={tradesman.verified} insured={tradesman.insured} licensed={tradesman.licensed} /></div>

              <div className="mt-4 flex flex-wrap gap-2">
                {cats.map((c) => (
                  <Link key={c.id} href={`/category/${c.slug}`}>
                    <Badge variant="secondary" className="gap-1.5"><CategoryIcon name={c.icon} className="h-3.5 w-3.5" /> {c.name}</Badge>
                  </Link>
                ))}
              </div>
            </Card>

            {/* About */}
            <Card className="mt-6 p-6">
              <h2 className="font-display text-lg font-semibold text-foreground">About {tradesman.businessName}</h2>
              <p className="mt-3 text-muted-foreground">{tradesman.bio}</p>
              <p className="mt-2 text-muted-foreground">Run by {tradesman.ownerName}.</p>
            </Card>

            {/* Gallery */}
            {gallery.length > 0 && (
              <Card className="mt-6 p-6">
                <h2 className="font-display text-lg font-semibold text-foreground">Recent work</h2>
                <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3">
                  {gallery.map((g, i) => (
                    <div key={i} className="aspect-[4/3] overflow-hidden rounded-lg bg-muted">
                      <img src={g} alt={`Work sample ${i + 1}`} loading="lazy" className="h-full w-full object-cover" />
                    </div>
                  ))}
                </div>
              </Card>
            )}

            {/* Area indicator (stylised, no maps API) */}
            <Card className="mt-6 p-6">
              <h2 className="font-display text-lg font-semibold text-foreground">Areas served</h2>
              <div className="mt-4 flex items-center gap-4 rounded-lg bg-accent/50 p-5">
                <span className="flex h-14 w-14 items-center justify-center rounded-full bg-primary/15 text-primary"><MapPin className="h-7 w-7" /></span>
                <div>
                  <p className="font-medium text-foreground">{area?.name} &amp; surrounding areas</p>
                  <p className="text-sm text-muted-foreground">{area?.region} — typically within a 10-mile radius.</p>
                </div>
              </div>
            </Card>

            {/* Reviews */}
            <Card className="mt-6 p-6" id="reviews">
              <h2 className="font-display text-lg font-semibold text-foreground">Customer reviews</h2>
              <div className="mt-5 grid gap-6 sm:grid-cols-[200px_1fr]">
                <div className="text-center sm:text-left">
                  <p className="font-display text-4xl font-bold text-foreground">{tradesman.ratingAverage.toFixed(1)}</p>
                  <StarRating value={tradesman.ratingAverage} size={18} className="mt-1 justify-center sm:justify-start" />
                  <p className="mt-1 text-sm text-muted-foreground">{tradesman.ratingCount} reviews</p>
                  <div className="mt-4"><RatingHistogram reviews={reviews || []} /></div>
                </div>
                <div className="space-y-4">
                  {(reviews || []).slice(0, 10).map((r) => (
                    <div key={r.id} className="border-b border-border pb-4 last:border-0" data-testid={`review-${r.id}`}>
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <span className="flex h-9 w-9 items-center justify-center rounded-full bg-navy text-sm font-semibold text-white">{r.customerName.charAt(0)}</span>
                          <div>
                            <p className="text-sm font-semibold text-foreground">{r.customerName}</p>
                            <p className="text-xs text-muted-foreground">{timeAgo(r.createdAt)}{r.verified ? " · Verified" : ""}</p>
                          </div>
                        </div>
                        <StarRating value={r.rating} size={14} />
                      </div>
                      {r.title && <p className="mt-2 text-sm font-medium text-foreground">{r.title}</p>}
                      <p className="mt-1 text-sm text-muted-foreground">{r.body}</p>
                    </div>
                  ))}
                  {(reviews || []).length === 0 && <p className="text-sm text-muted-foreground">No reviews yet.</p>}
                </div>
              </div>
            </Card>
          </div>

          {/* Sidebar — quote form */}
          <aside className="lg:col-span-1">
            <div className="lg:sticky lg:top-20">
              <Card className="p-6" id="quote">
                {!submitted ? (
                  <>
                    <h2 className="font-display text-lg font-semibold text-foreground">Get a free quote</h2>
                    <p className="mt-1 text-sm text-muted-foreground">No obligation. Usually replies in ~{tradesman.responseTimeMinutes < 60 ? `${tradesman.responseTimeMinutes} min` : `${Math.round(tradesman.responseTimeMinutes / 60)} hr`}.</p>
                    <form className="mt-4 space-y-3" onSubmit={submitQuote}>
                      <div><Label htmlFor="q-name">Your name</Label><Input id="q-name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} data-testid="input-quote-name" /></div>
                      <div><Label htmlFor="q-email">Email</Label><Input id="q-email" type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} data-testid="input-quote-email" /></div>
                      <div><Label htmlFor="q-phone">Phone (optional)</Label><Input id="q-phone" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} data-testid="input-quote-phone" /></div>
                      <div><Label htmlFor="q-msg">What do you need?</Label><Textarea id="q-msg" rows={3} value={form.message} onChange={(e) => setForm({ ...form, message: e.target.value })} data-testid="input-quote-message" /></div>
                      <Button type="submit" className="w-full" data-testid="button-submit-quote">Request quote</Button>
                    </form>
                  </>
                ) : (
                  <div className="text-center">
                    <CheckCircle2 className="mx-auto h-12 w-12 text-trust" />
                    <h2 className="mt-3 font-display text-lg font-semibold text-foreground">Quote requested!</h2>
                    <p className="mt-1 text-sm text-muted-foreground">{tradesman.businessName} has been notified and will be in touch.</p>
                  </div>
                )}

                {revealed && (
                  <div className="mt-5 space-y-2 rounded-lg bg-accent/50 p-4" data-testid="contact-reveal">
                    <p className="text-sm font-semibold text-foreground">Contact details</p>
                    <a href={`tel:${tradesman.phone}`} className="flex items-center gap-2 text-sm text-foreground hover:text-primary"><Phone className="h-4 w-4 text-primary" /> {tradesman.phone}</a>
                    <a href={`mailto:${tradesman.email}`} className="flex items-center gap-2 text-sm text-foreground hover:text-primary"><Mail className="h-4 w-4 text-primary" /> {tradesman.email}</a>
                  </div>
                )}
              </Card>
            </div>
          </aside>
        </div>
        <div className="h-16" />
      </div>
    </Layout>
  );
}
