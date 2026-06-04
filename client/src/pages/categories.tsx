import { Link } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { Layout } from "@/components/layout";
import { CategoryIcon } from "@/components/brand";
import { Card } from "@/components/ui/card";
import type { Category, Tradesman } from "@/lib/api-types";
import { parseJsonArray } from "@/lib/api-types";

export default function Categories() {
  const { data: categories, isLoading } = useQuery<Category[]>({ queryKey: ["/api/categories"] });
  const { data: tradesmen } = useQuery<Tradesman[]>({ queryKey: ["/api/tradesmen"] });
  const count = (id: number) => (tradesmen || []).filter((t) => parseJsonArray<number>(t.categories).includes(id)).length;

  return (
    <Layout>
      <div className="border-b border-border bg-accent/40">
        <div className="mx-auto max-w-7xl px-4 py-12 sm:px-6">
          <h1 className="font-display text-2xl font-bold text-foreground">All trades</h1>
          <p className="mt-2 max-w-xl text-muted-foreground">Browse every trade in the TradesmanFinder network and find vetted local professionals.</p>
        </div>
      </div>
      <div className="mx-auto max-w-7xl px-4 py-12 sm:px-6">
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
          {(isLoading ? Array.from({ length: 20 }) : categories || []).map((c: any, i: number) =>
            c ? (
              <Link key={c.id} href={`/category/${c.slug}`} data-testid={`tile-category-${c.slug}`}>
                <Card className="flex h-full flex-col gap-2 p-5 hover-elevate">
                  <span className="flex h-11 w-11 items-center justify-center rounded-lg bg-primary/15 text-primary">
                    <CategoryIcon name={c.icon} className="h-5 w-5" />
                  </span>
                  <p className="font-display font-semibold text-foreground">{c.name}</p>
                  <p className="line-clamp-2 text-xs text-muted-foreground">{c.description}</p>
                  <p className="mt-auto pt-2 text-xs font-medium text-primary">{count(c.id)} local pros →</p>
                </Card>
              </Link>
            ) : (
              <Card key={i} className="h-36 animate-pulse bg-muted" />
            )
          )}
        </div>
      </div>
    </Layout>
  );
}
