import { useRoute, Link } from "wouter";
import { PartnerPlacement } from "@/components/partner-placement";
import { useQuery } from "@tanstack/react-query";
import { Layout } from "@/components/layout";
import { TradesmanGrid } from "@/components/tradesman-grid";
import { CategoryIcon } from "@/components/brand";
import { Button } from "@/components/ui/button";
import type { Category, Area, Tradesman } from "@/lib/api-types";
import { parseJsonArray } from "@/lib/api-types";
import { ChevronRight } from "lucide-react";

export default function CategoryPage() {
  const [, params] = useRoute("/category/:slug");
  const slug = params?.slug;
  const { data: categories } = useQuery<Category[]>({ queryKey: ["/api/categories"] });
  const { data: areas } = useQuery<Area[]>({ queryKey: ["/api/areas"] });
  const { data: tradesmen, isLoading } = useQuery<Tradesman[]>({ queryKey: ["/api/tradesmen"] });

  const category = categories?.find((c) => c.slug === slug);
  const inCat = (tradesmen || []).filter((t) => category && parseJsonArray<number>(t.categories).includes(category.id));
  const topAreas = (areas || []).filter((a) => inCat.some((t) => t.areaId === a.id)).slice(0, 8);

  return (
    <Layout>
      <div className="border-b border-border bg-navy text-white">
        <div className="mx-auto max-w-7xl px-4 py-12 sm:px-6">
          <nav className="mb-3 flex items-center gap-1 text-sm text-white/60">
            <Link href="/" className="hover:text-white">Home</Link>
            <ChevronRight className="h-3.5 w-3.5" />
            <Link href="/categories" className="hover:text-white">Trades</Link>
            <ChevronRight className="h-3.5 w-3.5" />
            <span className="text-white/90">{category?.name || slug}</span>
          </nav>
          <div className="flex items-center gap-3">
            {category && <span className="flex h-12 w-12 items-center justify-center rounded-xl bg-primary text-primary-foreground"><CategoryIcon name={category.icon} className="h-6 w-6" /></span>}
            <h1 className="font-display text-2xl font-bold sm:text-3xl">{category ? `${category.name}s` : "Tradesmen"}</h1>
          </div>
          <p className="mt-3 max-w-2xl text-white/80">
            {category?.description} Compare verified {category?.name.toLowerCase()}s across the UK by rating, response time and reviews.
          </p>
        </div>
      </div>

      <div className="mx-auto max-w-7xl px-4 py-10 sm:px-6">
        <TradesmanGrid tradesmen={inCat} categories={categories} areas={areas} isLoading={isLoading} filterMode="area" />

        {topAreas.length > 0 && category && (
          <div className="mt-14 rounded-xl border border-border bg-accent/40 p-6">
            <h2 className="font-display text-base font-semibold text-foreground">{category.name}s by area</h2>
            <p className="mt-1 text-sm text-muted-foreground">Looking for a local pro? Jump straight to your area.</p>
            <div className="mt-4 flex flex-wrap gap-2">
              {topAreas.map((a) => (
                <Link key={a.id} href={`/category/${category.slug}/in/${a.slug}`}>
                  <Button variant="outline" size="sm" data-testid={`link-local-${a.slug}`}>{category.name}s in {a.name}</Button>
                </Link>
              ))}
            </div>
          </div>
        )}
      </div>
      <PartnerPlacement surface="category_footer" category={category?.id} className="mx-auto max-w-7xl px-4 pb-10 sm:px-6" />
    </Layout>
  );
}
