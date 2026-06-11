import { useRoute, Link, useLocation } from "wouter";
import { useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { Layout } from "@/components/layout";
import { TradesmanCard, TradesmanCardSkeleton } from "@/components/tradesman-card";
import { CategoryIcon } from "@/components/brand";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import {
  Accordion, AccordionContent, AccordionItem, AccordionTrigger,
} from "@/components/ui/accordion";
import type { Category, Area, Tradesman } from "@/lib/api-types";
import { parseJsonArray } from "@/lib/api-types";
import {
  parseFlatHyperlocalSlug,
  buildFlatHyperlocalPath,
} from "@shared/hyperlocal-slug";
import { ChevronRight, CheckCircle2, MapPin } from "lucide-react";

// Common jobs by trade for local-flavoured content
const COMMON_JOBS: Record<string, string[]> = {
  builder: ["Single & double-storey extensions", "Loft & garage conversions", "Knock-throughs & structural work", "Full house renovations", "Garden walls & patios"],
  plumber: ["Leaking taps & burst pipes", "Bathroom & kitchen installs", "Blocked drains", "Boiler & radiator work", "Emergency callouts"],
  electrician: ["Full & partial rewires", "Consumer unit upgrades", "EICR certificates", "Downlights & sockets", "EV charger installs"],
  default: ["Repairs & maintenance", "New installations", "Emergency callouts", "Quotes & surveys", "General work"],
};

function jobsFor(slug?: string) { return COMMON_JOBS[slug || "default"] || COMMON_JOBS.default; }

/**
 * Resolve (catSlug, areaSlug) from either route pattern:
 *   - /{catSlug}-in-{areaSlug}            ← canonical (PR-#19-B onwards)
 *   - /category/{catSlug}/in/{areaSlug}   ← legacy, kept for backlinks
 */
function useHyperlocalParams(): { catSlug?: string; areaSlug?: string } {
  const [location] = useLocation();
  const [, legacyParams] = useRoute<{ catSlug: string; areaSlug: string }>("/category/:catSlug/in/:areaSlug");

  // Try the canonical flat URL first: /{cat}-in-{area}
  // (Single segment only — the router regex already enforces this shape.)
  if (location && !legacyParams) {
    const segment = location.split("?")[0].replace(/^\/+/, "").replace(/\/+$/, "");
    if (segment && !segment.includes("/")) {
      const parsed = parseFlatHyperlocalSlug(segment);
      if (parsed.catSlug && parsed.areaSlug) return parsed;
    }
  }
  return { catSlug: legacyParams?.catSlug, areaSlug: legacyParams?.areaSlug };
}

export default function Hyperlocal() {
  const { catSlug, areaSlug } = useHyperlocalParams();
  const { data: categories } = useQuery<Category[]>({ queryKey: ["/api/categories"] });
  const { data: areas } = useQuery<Area[]>({ queryKey: ["/api/areas"] });
  const { data: tradesmen, isLoading } = useQuery<Tradesman[]>({ queryKey: ["/api/tradesmen"] });

  const category = categories?.find((c) => c.slug === catSlug);
  const area = areas?.find((a) => a.slug === areaSlug);

  // relevant tradesmen: in category, preferring this area then nearby
  const inCat = (tradesmen || []).filter((t) => category && parseJsonArray<number>(t.categories).includes(category.id));
  const local = inCat.filter((t) => area && t.areaId === area.id);
  const relevant = local.length > 0 ? local : inCat.slice(0, 6);

  const h1 = category && area ? `${category.name}s in ${area.name}` : "Local tradesmen";

  // Manage <title> and <link rel="canonical"> so the legacy and canonical
  // URLs both advertise the SAME canonical (the flat /{cat}-in-{area}
  // form). Without this, the legacy URL would compete with the new one
  // for the same intent and dilute ranking signals.
  useEffect(() => {
    if (!category || !area) return;
    document.title = `${category.name}s in ${area.name} — Reviews & Quotes | TradesmanFinder`;

    const canonicalPath = buildFlatHyperlocalPath(category.slug, area.slug);
    const canonicalHref =
      typeof window !== "undefined"
        ? `${window.location.origin}${canonicalPath}`
        : canonicalPath;

    let link = document.querySelector<HTMLLinkElement>('link[rel="canonical"]');
    const created = !link;
    if (!link) {
      link = document.createElement("link");
      link.rel = "canonical";
      document.head.appendChild(link);
    }
    const previousHref = link.href;
    link.href = canonicalHref;

    return () => {
      document.title = "TradesmanFinder — Find a trusted local tradesman";
      // If we created the tag, remove it on unmount so other pages don't
      // inherit a stale canonical. If it was pre-existing (e.g. injected
      // by the server for a mini-site), restore the previous value.
      if (created) {
        link?.parentNode?.removeChild(link);
      } else if (link) {
        link.href = previousHref;
      }
    };
  }, [category, area]);

  const faqs = category && area ? [
    { q: `How much does a ${category.name.toLowerCase()} cost in ${area.name}?`, a: `Prices vary by job. Posting a job on TradesmanFinder is free and gets you up to three no-obligation quotes from verified ${category.name.toLowerCase()}s in ${area.name}, so you can compare fairly.` },
    { q: `Are the ${category.name.toLowerCase()}s in ${area.name} verified?`, a: `Tradesmen with a green Verified badge have had their identity, insurance and qualifications checked by our team. Always look for the badge and read the genuine reviews.` },
    { q: `How quickly can a ${category.name.toLowerCase()} come out in ${area.name}?`, a: `For emergencies, many local ${category.name.toLowerCase()}s respond within the hour. For planned work you'll usually get quotes the same day.` },
  ] : [];

  return (
    <Layout>
      {/* SEO HERO */}
      <div className="border-b border-border bg-navy text-white">
        <div className="mx-auto max-w-7xl px-4 py-12 sm:px-6">
          <nav className="mb-3 flex flex-wrap items-center gap-1 text-sm text-white/60">
            <Link href="/" className="hover:text-white">Home</Link>
            <ChevronRight className="h-3.5 w-3.5" />
            {category && <Link href={`/category/${category.slug}`} className="hover:text-white">{category.name}s</Link>}
            <ChevronRight className="h-3.5 w-3.5" />
            {area && <Link href={`/area/${area.slug}`} className="hover:text-white">{area.name}</Link>}
          </nav>
          <div className="flex items-center gap-3">
            {category && <span className="flex h-12 w-12 items-center justify-center rounded-xl bg-primary text-primary-foreground"><CategoryIcon name={category.icon} className="h-6 w-6" /></span>}
            <h1 className="font-display text-2xl font-bold sm:text-3xl" data-testid="text-h1">{h1}</h1>
          </div>
          <p className="mt-3 max-w-2xl text-white/80">
            {category && area
              ? `Looking for a trusted ${category.name.toLowerCase()} in ${area.name} (${area.region})? Compare ${relevant.length} verified local ${category.name.toLowerCase()}s, read genuine reviews and get free quotes — usually within hours.`
              : "Compare trusted local tradesmen near you."}
          </p>
          <div className="mt-6">
            <Link href="/post-a-job"><Button size="lg" data-testid="button-hero-postjob">Get free quotes →</Button></Link>
          </div>
        </div>
      </div>

      <div className="mx-auto max-w-7xl px-4 py-10 sm:px-6">
        <div className="grid gap-10 lg:grid-cols-3">
          {/* Listing */}
          <div className="lg:col-span-2">
            <h2 className="mb-5 font-display text-lg font-semibold text-foreground">
              {category && area ? `Top ${category.name.toLowerCase()}s in ${area.name}` : "Tradesmen"}
            </h2>
            <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
              {isLoading
                ? Array.from({ length: 4 }).map((_, i) => <TradesmanCardSkeleton key={i} />)
                : relevant.map((t) => <TradesmanCard key={t.id} tradesman={t} categories={categories} areas={areas} />)}
            </div>
          </div>

          {/* Sidebar: local copy + common jobs */}
          <aside className="space-y-6">
            <Card className="p-6">
              <h3 className="font-display text-base font-semibold text-foreground">
                {category && area ? `${category.name} work in ${area.name}` : "Common jobs"}
              </h3>
              <p className="mt-2 text-sm text-muted-foreground">
                {area && `${area.name} homeowners regularly use our network for:`}
              </p>
              <ul className="mt-3 space-y-2">
                {jobsFor(catSlug).map((j) => (
                  <li key={j} className="flex items-start gap-2 text-sm text-foreground">
                    <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-trust" /> {j}
                  </li>
                ))}
              </ul>
            </Card>

            <Card className="bg-accent/40 p-6">
              <h3 className="flex items-center gap-2 font-display text-base font-semibold text-foreground">
                <MapPin className="h-4 w-4 text-primary" /> Serving {area?.name}
              </h3>
              <p className="mt-2 text-sm text-muted-foreground">
                {area && `Covering ${area.region} and surrounding postcodes. Local trades who know the area, the housing stock and the building regs.`}
              </p>
              <Link href="/post-a-job"><Button className="mt-4 w-full" data-testid="button-sidebar-postjob">Post a Job — Free</Button></Link>
            </Card>
          </aside>
        </div>

        {/* FAQ */}
        {faqs.length > 0 && (
          <div className="mx-auto mt-16 max-w-3xl">
            <h2 className="font-display text-lg font-semibold text-foreground">{category?.name}s in {area?.name} — FAQs</h2>
            <Accordion type="single" collapsible className="mt-5">
              {faqs.map((f, i) => (
                <AccordionItem key={i} value={`f-${i}`} data-testid={`faq-${i}`}>
                  <AccordionTrigger className="text-left font-medium">{f.q}</AccordionTrigger>
                  <AccordionContent className="text-muted-foreground">{f.a}</AccordionContent>
                </AccordionItem>
              ))}
            </Accordion>
          </div>
        )}
      </div>
    </Layout>
  );
}
