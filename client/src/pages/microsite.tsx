/**
 * Mini-site landing page — renders for any of the 78 servable hosts
 * (excluding the 3 redirect-kind brand-piggybacks, which 301 server-side).
 *
 * Discovery: server-side middleware resolves `req.hostname` and injects
 * `window.__MICROSITE__` into the SPA bootstrap (see server/microsite-seo.ts).
 * We read that global on mount and branch render mode off `microsite.kind`.
 *
 * Radius fallback: when a geo-trade host has zero tradesmen with a matching
 * `areaId`, we fall back to tradesmen within MICROSITE_FALLBACK_RADIUS_MILES
 * of the area centroid (haversine). The hero copy is updated to be honest
 * about this ("…in Abingdon (and Oxfordshire)") so users aren't surprised.
 */

import { useEffect, useMemo } from 'react';
import { Link } from 'wouter';
import { useQuery } from '@tanstack/react-query';
import { Layout } from '@/components/layout';
import { TradesmanCard, TradesmanCardSkeleton } from '@/components/tradesman-card';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import {
  Accordion, AccordionContent, AccordionItem, AccordionTrigger,
} from '@/components/ui/accordion';
import type { Category, Area, Tradesman } from '@/lib/api-types';
import { parseJsonArray } from '@/lib/api-types';
import { MapPin, CheckCircle2 } from 'lucide-react';
import {
  haversineMiles,
  MICROSITE_FALLBACK_RADIUS_MILES,
} from '@shared/geo';
import type { Microsite } from '@shared/microsites';

declare global {
  interface Window {
    /** Injected by server/microsite-seo.ts during SSR-like HTML rewrite. */
    __MICROSITE__?: Microsite;
  }
}

const COMMON_JOBS: Record<string, string[]> = {
  builder: ['Single & double-storey extensions', 'Loft & garage conversions', 'Knock-throughs & structural work', 'Full house renovations', 'Garden walls & patios'],
  plumber: ['Leaking taps & burst pipes', 'Bathroom & kitchen installs', 'Blocked drains', 'Boiler & radiator work', 'Emergency callouts'],
  electrician: ['Full & partial rewires', 'Consumer unit upgrades', 'EICR certificates', 'Downlights & sockets', 'EV charger installs'],
  carpenter: ['Bespoke fitted wardrobes', 'Doors & skirting', 'Decking & garden carpentry', 'Kitchen carpentry', 'Repairs & finishes'],
  'painter-decorator': ['Full interior repaints', 'Exterior masonry painting', 'Wallpaper hanging', 'Feature walls', 'Pre-sale touch-ups'],
  cleaner: ['End-of-tenancy cleans', 'Deep cleans', 'Regular weekly cleans', 'Move-in/out cleans', 'Window cleaning'],
  handyman: ['Flat-pack assembly', 'Shelf & TV mounting', 'Small repairs', 'Picture & curtain hanging', 'Odd jobs'],
  default: ['Repairs & maintenance', 'New installations', 'Emergency callouts', 'Quotes & surveys', 'General work'],
};

function jobsFor(slug?: string): string[] {
  return COMMON_JOBS[slug ?? 'default'] ?? COMMON_JOBS.default;
}

export default function MicrositePage() {
  // Read the server-injected payload. If it's missing (someone hits
  // /#/microsite on the main domain by mistake) we still render gracefully.
  const microsite = typeof window !== 'undefined' ? window.__MICROSITE__ : undefined;

  const { data: categories } = useQuery<Category[]>({ queryKey: ['/api/categories'] });
  const { data: areas } = useQuery<Area[]>({ queryKey: ['/api/areas'] });
  const { data: tradesmen, isLoading } = useQuery<Tradesman[]>({ queryKey: ['/api/tradesmen'] });

  const category = useMemo(
    () => (microsite?.trade ? categories?.find((c) => c.slug === microsite.trade) : undefined),
    [microsite?.trade, categories],
  );
  const area = useMemo(
    () => (microsite?.area ? areas?.find((a) => a.slug === microsite.area) : undefined),
    [microsite?.area, areas],
  );

  // Build the candidate list. We compute `inArea` (exact areaId match) and
  // `nearby` (within radius). Show inArea if any; otherwise fall back.
  const { displayList, usedRadiusFallback } = useMemo(() => {
    if (!tradesmen) return { displayList: [] as Tradesman[], usedRadiusFallback: false };

    const inCat = category
      ? tradesmen.filter((t) => parseJsonArray<number>(t.categories).includes(category.id))
      : tradesmen;

    // Generic-directory + vertical: show top picks ordered by featured+rating.
    if (!area) {
      const ranked = [...inCat].sort(
        (a, b) => Number(b.featured) - Number(a.featured) || b.ratingAverage - a.ratingAverage,
      );
      return { displayList: ranked.slice(0, 9), usedRadiusFallback: false };
    }

    const inArea = inCat.filter((t) => t.areaId === area.id);
    if (inArea.length > 0) {
      return { displayList: inArea.slice(0, 9), usedRadiusFallback: false };
    }

    // Radius fallback: rank by distance, then by featured/rating.
    if (!areas) return { displayList: [] as Tradesman[], usedRadiusFallback: false };
    const areaById = new Map(areas.map((a) => [a.id, a]));
    const withDist = inCat
      .map((t) => {
        const ta = areaById.get(t.areaId);
        if (!ta) return null;
        const d = haversineMiles(area.latitude, area.longitude, ta.latitude, ta.longitude);
        return { t, d };
      })
      .filter((x): x is { t: Tradesman; d: number } => x !== null)
      .filter((x) => x.d <= MICROSITE_FALLBACK_RADIUS_MILES)
      .sort((a, b) => a.d - b.d || Number(b.t.featured) - Number(a.t.featured) || b.t.ratingAverage - a.t.ratingAverage);

    return {
      displayList: withDist.map((x) => x.t).slice(0, 9),
      usedRadiusFallback: withDist.length > 0,
    };
  }, [tradesmen, areas, category, area]);

  // Set <title> client-side too, in case the SPA navigates between pages
  // within the same host (won't happen on mini-sites today, but cheap).
  useEffect(() => {
    if (!microsite) return;
    const t = window.__MICROSITE__;
    if (t && document.title === '') document.title = `${t.host}`;
  }, [microsite]);

  const h1 = useMemo(() => {
    if (!microsite) return 'Local tradesmen near you';
    if (microsite.kind === 'geo-trade') {
      const trade = category?.name ?? 'Tradesman';
      const where = area?.name ?? '';
      return where ? `${trade}s in ${where}` : `${trade}s near you`;
    }
    if (microsite.kind === 'generic-directory') {
      const trade = category?.name ?? 'Tradesman';
      return `Find a local ${trade.toLowerCase()}`;
    }
    if (microsite.kind === 'vertical') {
      return microsite.title ?? 'Specialist UK tradesmen';
    }
    return 'TradesmanFinder';
  }, [microsite, category, area]);

  const subhead = useMemo(() => {
    if (!microsite) return 'Compare verified local tradesmen across the UK.';
    if (microsite.kind === 'geo-trade' && category && area) {
      const trade = category.name.toLowerCase();
      const tail = usedRadiusFallback
        ? ` and across ${area.region}`
        : '';
      return `Looking for a trusted ${trade} in ${area.name}${tail}? Compare verified local ${trade}s, read reviews and get free quotes — usually within hours.`;
    }
    if (microsite.kind === 'generic-directory' && category) {
      const trade = category.name.toLowerCase();
      return `Compare verified UK ${trade}s near you. Reviews, prices, free quotes.`;
    }
    if (microsite.kind === 'vertical') {
      return 'Compare specialist UK tradesmen, read reviews and get free no-obligation quotes.';
    }
    return 'Compare trusted local tradesmen near you.';
  }, [microsite, category, area, usedRadiusFallback]);

  const faqs = useMemo(() => {
    if (microsite?.kind === 'geo-trade' && category && area) {
      const trade = category.name.toLowerCase();
      return [
        { q: `How much does a ${trade} cost in ${area.name}?`, a: `Prices vary by job. Posting a job on TradesmanFinder is free and gets you up to three no-obligation quotes from verified ${trade}s serving ${area.name}, so you can compare fairly.` },
        { q: `Are the ${trade}s in ${area.name} verified?`, a: `Tradesmen with a green Verified badge have had their identity, insurance and qualifications checked by our team. Always look for the badge and read the genuine reviews.` },
        { q: `How quickly can a ${trade} come out in ${area.name}?`, a: `For emergencies, many local ${trade}s respond within the hour. For planned work you'll usually get quotes the same day.` },
      ];
    }
    return [];
  }, [microsite, category, area]);

  // For the "Get free quotes" CTA: pre-select trade + postcode hint via query.
  const postJobHref = useMemo(() => {
    const params = new URLSearchParams();
    if (microsite?.trade) params.set('trade', microsite.trade);
    if (microsite?.area) params.set('area', microsite.area);
    const q = params.toString();
    return q ? `/post-a-job?${q}` : '/post-a-job';
  }, [microsite]);

  return (
    <Layout>
      <div className="border-b border-border bg-navy text-white">
        <div className="mx-auto max-w-7xl px-4 py-12 sm:px-6">
          <h1 className="font-display text-2xl font-bold sm:text-3xl" data-testid="text-microsite-h1">{h1}</h1>
          <p className="mt-3 max-w-2xl text-white/80">{subhead}</p>
          {usedRadiusFallback && area && (
            <p className="mt-2 text-sm text-white/60" data-testid="text-radius-fallback">
              Showing tradesmen within {MICROSITE_FALLBACK_RADIUS_MILES} miles of {area.name}.
            </p>
          )}
          <div className="mt-6">
            <Link href={postJobHref}>
              <Button size="lg" data-testid="button-microsite-cta">Get free quotes →</Button>
            </Link>
          </div>
        </div>
      </div>

      <div className="mx-auto max-w-7xl px-4 py-10 sm:px-6">
        <div className="grid gap-10 lg:grid-cols-3">
          <div className="lg:col-span-2">
            <h2 className="mb-5 font-display text-lg font-semibold text-foreground">
              {category && area ? `Top ${category.name.toLowerCase()}s near ${area.name}` : (category ? `Top ${category.name.toLowerCase()}s` : 'Featured tradesmen')}
            </h2>
            <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
              {isLoading
                ? Array.from({ length: 4 }).map((_, i) => <TradesmanCardSkeleton key={i} />)
                : displayList.length > 0
                  ? displayList.map((t) => <TradesmanCard key={t.id} tradesman={t} categories={categories} areas={areas} />)
                  : (
                    <p className="text-muted-foreground" data-testid="text-empty-state">
                      No tradesmen listed yet — post a job and we'll match you with verified local pros within the hour.
                    </p>
                  )}
            </div>
          </div>

          <aside className="space-y-6">
            <Card className="p-6">
              <h3 className="font-display text-base font-semibold text-foreground">
                {category ? `Common ${category.name.toLowerCase()} jobs` : 'Common jobs'}
              </h3>
              <ul className="mt-3 space-y-2">
                {jobsFor(microsite?.trade ?? category?.slug).map((j) => (
                  <li key={j} className="flex items-start gap-2 text-sm text-foreground">
                    <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-trust" /> {j}
                  </li>
                ))}
              </ul>
            </Card>

            {area && (
              <Card className="bg-accent/40 p-6">
                <h3 className="flex items-center gap-2 font-display text-base font-semibold text-foreground">
                  <MapPin className="h-4 w-4 text-primary" /> Serving {area.name}
                </h3>
                <p className="mt-2 text-sm text-muted-foreground">
                  Covering {area.region} and surrounding postcodes.
                </p>
                <Link href={postJobHref}>
                  <Button className="mt-4 w-full" data-testid="button-microsite-sidebar-cta">Post a Job — Free</Button>
                </Link>
              </Card>
            )}
          </aside>
        </div>

        {faqs.length > 0 && (
          <div className="mx-auto mt-16 max-w-3xl">
            <h2 className="font-display text-lg font-semibold text-foreground">FAQs</h2>
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
