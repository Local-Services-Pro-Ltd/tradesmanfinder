import { useRoute, Link } from "wouter";
import { PartnerPlacement } from "@/components/partner-placement";
import { useQuery } from "@tanstack/react-query";
import { Layout } from "@/components/layout";
import { TradesmanGrid } from "@/components/tradesman-grid";
import { CategoryIcon } from "@/components/brand";
import { Button } from "@/components/ui/button";
import type { Category, Area, Tradesman } from "@/lib/api-types";
import { parseJsonArray } from "@/lib/api-types";
import { ChevronRight, MapPin } from "lucide-react";

export default function AreaPage() {
  const [, params] = useRoute("/area/:slug");
  const slug = params?.slug;
  const { data: categories } = useQuery<Category[]>({ queryKey: ["/api/categories"] });
  const { data: areas } = useQuery<Area[]>({ queryKey: ["/api/areas"] });
  const { data: tradesmen, isLoading } = useQuery<Tradesman[]>({ queryKey: ["/api/tradesmen"] });

  const area = areas?.find((a) => a.slug === slug);
  const inArea = (tradesmen || []).filter((t) => area && t.areaId === area.id);
  const cats = (categories || []).filter((c) => inArea.some((t) => parseJsonArray<number>(t.categories).includes(c.id)));

  return (
    <Layout>
      <div className="border-b border-border bg-navy text-white">
        <div className="mx-auto max-w-7xl px-4 py-12 sm:px-6">
          <nav className="mb-3 flex items-center gap-1 text-sm text-white/60">
            <Link href="/" className="hover:text-white">Home</Link>
            <ChevronRight className="h-3.5 w-3.5" />
            <span className="text-white/90">{area?.name || slug}</span>
          </nav>
          <div className="flex items-center gap-3">
            <span className="flex h-12 w-12 items-center justify-center rounded-xl bg-primary text-primary-foreground"><MapPin className="h-6 w-6" /></span>
            <div>
              <h1 className="font-display text-2xl font-bold sm:text-3xl">Tradesmen in {area?.name || slug}</h1>
              {area && <p className="text-white/70">{area.region}</p>}
            </div>
          </div>
          <p className="mt-3 max-w-2xl text-white/80">
            Trusted, verified local tradesmen serving {area?.name}. Filter by trade and compare reviews, ratings and response times.
          </p>
        </div>
      </div>

      <div className="mx-auto max-w-7xl px-4 py-10 sm:px-6">
        <TradesmanGrid tradesmen={inArea} categories={categories} areas={areas} isLoading={isLoading} filterMode="category" />

        {cats.length > 0 && area && (
          <div className="mt-14 rounded-xl border border-border bg-accent/40 p-6">
            <h2 className="font-display text-base font-semibold text-foreground">Popular trades in {area.name}</h2>
            <div className="mt-4 flex flex-wrap gap-2">
              {cats.map((c) => (
                <Link key={c.id} href={`/category/${c.slug}/in/${area.slug}`}>
                  <Button variant="outline" size="sm" className="gap-1.5" data-testid={`link-local-${c.slug}`}>
                    <CategoryIcon name={c.icon} className="h-3.5 w-3.5 text-primary" /> {c.name}s in {area.name}
                  </Button>
                </Link>
              ))}
            </div>
          </div>
        )}
      </div>
      <PartnerPlacement surface="area_footer" area={area?.id} className="mx-auto max-w-7xl px-4 pb-10 sm:px-6" />
    </Layout>
  );
}
