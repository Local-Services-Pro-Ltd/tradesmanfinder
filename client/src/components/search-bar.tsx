import { useState } from "react";
import { useLocation } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import type { Category, Area } from "@/lib/api-types";
import { Search } from "lucide-react";

export function SearchBar({ compact = false }: { compact?: boolean }) {
  const [, navigate] = useLocation();
  const { data: categories } = useQuery<Category[]>({ queryKey: ["/api/categories"] });
  const { data: areas } = useQuery<Area[]>({ queryKey: ["/api/areas"] });
  const [cat, setCat] = useState<string>("");
  const [area, setArea] = useState<string>("");

  const go = () => {
    const catObj = categories?.find((c) => String(c.id) === cat);
    const areaObj = areas?.find((a) => String(a.id) === area);
    if (catObj && areaObj) navigate(`/category/${catObj.slug}/in/${areaObj.slug}`);
    else if (catObj) navigate(`/category/${catObj.slug}`);
    else if (areaObj) navigate(`/area/${areaObj.slug}`);
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

      <Select value={area} onValueChange={setArea}>
        <SelectTrigger className="h-12 flex-1 border-0 bg-transparent text-base focus:ring-0" data-testid="select-area">
          <SelectValue placeholder="Postcode or area" />
        </SelectTrigger>
        <SelectContent className="max-h-[300px]">
          {(areas || []).map((a) => (
            <SelectItem key={a.id} value={String(a.id)} data-testid={`option-area-${a.slug}`}>{a.name} — {a.region}</SelectItem>
          ))}
        </SelectContent>
      </Select>

      <Button size="lg" className="h-12 shrink-0 gap-2" onClick={go} data-testid="button-search">
        <Search className="h-4 w-4" /> Search
      </Button>
    </div>
  );
}
