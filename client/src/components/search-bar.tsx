import { useState } from "react";
import { useLocation } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { AreaPicker, type AreaPickerSelection } from "@/components/area-picker";
import type { Category, Area } from "@/lib/api-types";
import { Search } from "lucide-react";

/**
 * Search bar — trade picker (fixed list of seeded categories) + area picker
 * (searchable, with unmatched-area waitlist fallback).
 *
 * Routing rules:
 *   - trade + seeded area  → /category/<cat>/in/<slug>
 *   - trade only           → /category/<cat>
 *   - seeded area only     → /area/<slug>
 *   - unmatched area       → /area/unavailable?q=<typed>
 *                            (waitlist page — captures demand signal)
 *   - nothing              → /categories
 */
export function SearchBar({ compact = false }: { compact?: boolean }) {
  const [, navigate] = useLocation();
  const { data: categories } = useQuery<Category[]>({ queryKey: ["/api/categories"] });
  const { data: areas } = useQuery<Area[]>({ queryKey: ["/api/areas"] });
  const [cat, setCat] = useState<string>("");
  // The picker state can either be a seeded area (we store its id) or an
  // unmatched typed string (we store the raw string). Exactly one is set.
  const [pickedAreaId, setPickedAreaId] = useState<number | undefined>(undefined);
  const [pickedRequested, setPickedRequested] = useState<string>("");

  const handleAreaSelection = (sel: AreaPickerSelection) => {
    if (sel.kind === "area") {
      setPickedAreaId(sel.area.id);
      setPickedRequested("");
    } else {
      setPickedAreaId(undefined);
      setPickedRequested(sel.requestedArea);
      // For unmatched selections, navigate immediately — the user has
      // already declared intent ("notify me about X") by tapping the CTA.
      // Holding them at the search bar for another click is pure friction.
      navigate(`/area/unavailable?q=${encodeURIComponent(sel.requestedArea)}`);
    }
  };

  const go = () => {
    const catObj = categories?.find((c) => String(c.id) === cat);
    const areaObj = areas?.find((a) => a.id === pickedAreaId);
    if (catObj && areaObj) navigate(`/category/${catObj.slug}/in/${areaObj.slug}`);
    else if (catObj) navigate(`/category/${catObj.slug}`);
    else if (areaObj) navigate(`/area/${areaObj.slug}`);
    else if (pickedRequested) navigate(`/area/unavailable?q=${encodeURIComponent(pickedRequested)}`);
    else navigate("/categories");
  };

  return (
    <div className="flex flex-col gap-2 rounded-xl bg-background p-2 shadow-lg sm:flex-row sm:items-center">
      <Select value={cat} onValueChange={setCat}>
        <SelectTrigger className="h-12 flex-1 border-0 bg-transparent text-base focus:ring-0" data-testid="select-trade">
          <SelectValue placeholder="What trade do you need?" />
        </SelectTrigger>
        <SelectContent className="max-h-[300px]">
          {(categories || []).map((c) => (
            <SelectItem key={c.id} value={String(c.id)} data-testid={`option-trade-${c.slug}`}>{c.name}</SelectItem>
          ))}
        </SelectContent>
      </Select>

      <div className="hidden h-8 w-px bg-border sm:block" />

      <AreaPicker
        areas={areas || []}
        selectedAreaId={pickedAreaId}
        onSelect={handleAreaSelection}
      />

      <Button size="lg" className="h-12 shrink-0 gap-2" onClick={go} data-testid="button-search">
        <Search className="h-4 w-4" /> Search
      </Button>
    </div>
  );
}
