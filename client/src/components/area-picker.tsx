/**
 * AreaPicker — searchable, free-text area picker that replaces the fixed
 * 79-row dropdown.
 *
 * Behaviour:
 *   - Type to filter seeded areas by name / region / outward postcode
 *     (e.g. "SE13" matches "London SE13" → Lewisham).
 *   - Pick a seeded area → calls onSelect({ kind: "area", area }).
 *   - Type something we don't recognise (≥ 3 chars, clean string),
 *     then click the "Notify me about <X>" CTA → calls
 *     onSelect({ kind: "unmatched", requestedArea: <text> }).
 *
 * The picker doesn't navigate or POST; it just tells the parent what
 * the user picked. SearchBar wires the two outcomes to the right
 * destinations:
 *   - kind: "area"     → /area/<slug> or /category/<cat>/in/<slug>
 *   - kind: "unmatched"→ /area/unavailable?q=<text>  (waitlist page)
 *
 * The resolver runs client-side over the same `/api/areas` list the
 * page already loads. We don't hit /api/areas/resolve from here —
 * that endpoint exists for non-React callers (mini-sites, future
 * mobile app). Keeping the picker offline-friendly + zero-latency.
 */
import { useMemo, useRef, useState } from "react";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Button } from "@/components/ui/button";
import { Bell, ChevronsUpDown, MapPin } from "lucide-react";
import { cn } from "@/lib/utils";
import type { Area } from "@/lib/api-types";

export type AreaPickerSelection =
  | { kind: "area"; area: Area }
  | { kind: "unmatched"; requestedArea: string };

interface AreaPickerProps {
  areas: Area[];
  /** Currently-selected seeded area, if any (for the trigger label). */
  selectedAreaId?: number;
  onSelect: (selection: AreaPickerSelection) => void;
  placeholder?: string;
  className?: string;
}

// Mirror of server/area-resolver.ts but lean — we only need ranking, not
// the score/rule metadata. If you change the rules here, mirror the change
// in server/area-resolver.ts so /api/areas/resolve stays in sync.
function extractOutward(raw: string): string | null {
  const m = raw.toUpperCase().match(/\b([A-Z]{1,2}\d[A-Z\d]?)(?:\s*\d[A-Z]{2})?\b/);
  return m ? m[1] : null;
}

function rankAreas(query: string, areas: Area[]): Area[] {
  const q = query.trim().toLowerCase();
  if (q.length < 2) return [];
  const outward = extractOutward(query);
  const outwardLower = outward?.toLowerCase() ?? null;

  type Scored = { area: Area; score: number };
  const scored: Scored[] = [];

  for (const a of areas) {
    const slug = a.slug.toLowerCase();
    const name = a.name.toLowerCase();
    const region = a.region.toLowerCase();
    const tokens = region.split(/\s+/);

    let score = 0;
    if (slug === q) score = Math.max(score, 100);
    else if (name === q) score = Math.max(score, 95);
    else if (name.startsWith(q)) score = Math.max(score, 70);
    else if (name.includes(q)) score = Math.max(score, 60);
    else if (region.includes(q)) score = Math.max(score, 40);
    if (outwardLower && tokens.includes(outwardLower)) score = Math.max(score, 90);

    if (score > 0) scored.push({ area: a, score });
  }

  scored.sort((a, b) => b.score - a.score || a.area.name.localeCompare(b.area.name));
  return scored.slice(0, 8).map((s) => s.area);
}

// Same validator as the server-side schema. Keeps the "Notify me about <X>"
// CTA from offering to submit garbage like "asdfg!@#".
const REQUESTED_AREA_OK = /^[A-Za-z0-9 \-]+$/;
function isUnmatchedSubmittable(q: string): boolean {
  const trimmed = q.trim();
  return trimmed.length >= 3 && trimmed.length <= 80 && REQUESTED_AREA_OK.test(trimmed);
}

export function AreaPicker({
  areas,
  selectedAreaId,
  onSelect,
  placeholder = "Postcode or area",
  className,
}: AreaPickerProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  const selected = useMemo(
    () => areas.find((a) => a.id === selectedAreaId),
    [areas, selectedAreaId],
  );

  const matches = useMemo(() => rankAreas(query, areas), [query, areas]);
  const showUnmatchedCta = query.trim().length >= 2 && matches.length === 0;
  const canSubmitUnmatched = isUnmatchedSubmittable(query);

  const handleSelectArea = (area: Area) => {
    setOpen(false);
    setQuery("");
    onSelect({ kind: "area", area });
  };

  const handleSelectUnmatched = () => {
    if (!canSubmitUnmatched) return;
    setOpen(false);
    const requested = query.trim();
    setQuery("");
    onSelect({ kind: "unmatched", requestedArea: requested });
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          role="combobox"
          aria-expanded={open}
          className={cn(
            "h-12 flex-1 justify-between border-0 bg-transparent text-base font-normal hover:bg-transparent",
            !selected && "text-muted-foreground",
            className,
          )}
          data-testid="area-picker-trigger"
        >
          <span className="flex items-center gap-2 truncate">
            <MapPin className="h-4 w-4 shrink-0 opacity-60" />
            <span className="truncate">
              {selected ? `${selected.name} — ${selected.region}` : placeholder}
            </span>
          </span>
          <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent
        className="w-[min(420px,calc(100vw-2rem))] p-0"
        align="start"
        sideOffset={6}
      >
        <Command shouldFilter={false}>
          <CommandInput
            ref={inputRef}
            value={query}
            onValueChange={setQuery}
            placeholder="Type an area or postcode (e.g. Lewisham, SE13)"
            data-testid="area-picker-input"
          />
          <CommandList>
            {/*
              CommandEmpty only shows when matches.length is 0. We still
              want a useful CTA in that case, so we render the unmatched
              prompt inside CommandEmpty.
            */}
            {showUnmatchedCta && (
              <CommandEmpty>
                {canSubmitUnmatched ? (
                  <button
                    type="button"
                    onClick={handleSelectUnmatched}
                    className="flex w-full items-start gap-2 rounded-md px-3 py-3 text-left text-sm hover:bg-accent"
                    data-testid="area-picker-unmatched-cta"
                  >
                    <Bell className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
                    <span>
                      We're not in <strong>{query.trim()}</strong> yet — tap to get notified
                      when we launch there.
                    </span>
                  </button>
                ) : (
                  <p className="px-3 py-4 text-sm text-muted-foreground">
                    Try a borough name or a UK outward postcode (e.g. SE13).
                  </p>
                )}
              </CommandEmpty>
            )}
            {matches.length > 0 && (
              <CommandGroup heading="Areas we cover">
                {matches.map((a) => (
                  <CommandItem
                    key={a.id}
                    value={`${a.slug}-${a.id}`}
                    onSelect={() => handleSelectArea(a)}
                    data-testid={`area-picker-option-${a.slug}`}
                  >
                    <MapPin className="mr-2 h-4 w-4 opacity-60" />
                    <span>
                      {a.name} <span className="text-muted-foreground">— {a.region}</span>
                    </span>
                  </CommandItem>
                ))}
              </CommandGroup>
            )}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
