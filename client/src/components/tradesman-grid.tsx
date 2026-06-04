import { useState } from "react";
import { TradesmanCard, TradesmanCardSkeleton } from "./tradesman-card";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { Link } from "wouter";
import type { Tradesman, Category, Area } from "@/lib/api-types";
import { parseJsonArray } from "@/lib/api-types";
import { SearchX } from "lucide-react";

type SortKey = "rating" | "response" | "featured";

export function TradesmanGrid({
  tradesmen, categories, areas, isLoading,
  filterMode = "area", // "area" | "category" | "none"
}: {
  tradesmen: Tradesman[];
  categories?: Category[];
  areas?: Area[];
  isLoading?: boolean;
  filterMode?: "area" | "category" | "none";
}) {
  const [filter, setFilter] = useState<string>("all");
  const [sort, setSort] = useState<SortKey>("featured");

  let list = [...tradesmen];
  if (filter !== "all") {
    if (filterMode === "area") list = list.filter((t) => t.areaId === Number(filter));
    if (filterMode === "category") list = list.filter((t) => parseJsonArray<number>(t.categories).includes(Number(filter)));
  }
  list.sort((a, b) => {
    if (sort === "featured") return Number(b.featured) - Number(a.featured) || b.ratingAverage - a.ratingAverage;
    if (sort === "rating") return b.ratingAverage - a.ratingAverage;
    return a.responseTimeMinutes - b.responseTimeMinutes;
  });

  return (
    <div>
      <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-sm text-muted-foreground" data-testid="text-result-count">
          {isLoading ? "Loading…" : `${list.length} tradesm${list.length === 1 ? "an" : "en"} found`}
        </p>
        <div className="flex flex-wrap gap-2">
          {filterMode !== "none" && (
            <Select value={filter} onValueChange={setFilter}>
              <SelectTrigger className="w-[180px]" data-testid="select-filter">
                <SelectValue placeholder={filterMode === "area" ? "All areas" : "All trades"} />
              </SelectTrigger>
              <SelectContent className="max-h-[300px]">
                <SelectItem value="all">{filterMode === "area" ? "All areas" : "All trades"}</SelectItem>
                {filterMode === "area"
                  ? (areas || []).map((a) => <SelectItem key={a.id} value={String(a.id)}>{a.name}</SelectItem>)
                  : (categories || []).map((c) => <SelectItem key={c.id} value={String(c.id)}>{c.name}</SelectItem>)}
              </SelectContent>
            </Select>
          )}
          <Select value={sort} onValueChange={(v) => setSort(v as SortKey)}>
            <SelectTrigger className="w-[180px]" data-testid="select-sort">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="featured">Featured first</SelectItem>
              <SelectItem value="rating">Highest rated</SelectItem>
              <SelectItem value="response">Fastest response</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      {isLoading ? (
        <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 6 }).map((_, i) => <TradesmanCardSkeleton key={i} />)}
        </div>
      ) : list.length === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-border py-20 text-center" data-testid="empty-state">
          <SearchX className="h-10 w-10 text-muted-foreground" />
          <h3 className="mt-4 font-display text-base font-semibold">No tradesmen found here yet</h3>
          <p className="mt-1 max-w-sm text-sm text-muted-foreground">
            We're growing fast. Post your job and we'll notify trades as they join your area.
          </p>
          <Link href="/post-a-job"><Button className="mt-5" data-testid="button-empty-postjob">Post a Job</Button></Link>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {list.map((t) => <TradesmanCard key={t.id} tradesman={t} categories={categories} areas={areas} />)}
        </div>
      )}
    </div>
  );
}
