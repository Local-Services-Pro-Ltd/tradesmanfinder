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
import { useEffect, useMemo, useRef, useState } from "react";
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
import { Bell, ChevronsUpDown, Loader2, MapPin } from "lucide-react";
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

// Cheap shape check — keeps the "Notify me about <X>" CTA from offering to
// submit garbage like "asdfg!@#". Real-world-place validation happens via
// the server's /api/areas/validate endpoint (see useAreaValidation below).
const REQUESTED_AREA_OK = /^[A-Za-z0-9 \-]+$/;
function passesShape(q: string): boolean {
  const trimmed = q.trim();
  return trimmed.length >= 3 && trimmed.length <= 80 && REQUESTED_AREA_OK.test(trimmed);
}

type ValidationState =
  | { kind: "unknown" }
  | { kind: "checking" }
  | { kind: "valid"; canonicalName: string }
  | { kind: "typo"; suggestion: { name: string; displayName: string } }
  | { kind: "invalid" };

/**
 * Debounced check against /api/areas/validate. Returns the current state
 * for the latest query. We deliberately don't use react-query here: the
 * cache-key surface is dead simple (q string), we want a short debounce,
 * and we want to skip the network for inputs that fail the shape check.
 */
function useAreaValidation(query: string): ValidationState {
  const [state, setState] = useState<ValidationState>({ kind: "unknown" });
  // Track the latest query at request-fire time so an out-of-order response
  // doesn't overwrite a fresh result. (User types fast → multiple in flight.)
  const latestQueryRef = useRef("");

  useEffect(() => {
    const trimmed = query.trim();
    if (!passesShape(trimmed)) {
      setState({ kind: "unknown" });
      return;
    }
    latestQueryRef.current = trimmed;
    setState({ kind: "checking" });
    const handle = window.setTimeout(async () => {
      try {
        const res = await fetch(
          `/api/areas/validate?q=${encodeURIComponent(trimmed)}`,
        );
        if (latestQueryRef.current !== trimmed) return; // stale
        if (!res.ok) {
          setState({ kind: "invalid" });
          return;
        }
        const body = await res.json();
        if (body.valid) {
          setState({ kind: "valid", canonicalName: body.canonicalName ?? trimmed });
        } else if (body.reason === "looks_like_typo" && body.suggestion) {
          setState({ kind: "typo", suggestion: body.suggestion });
        } else {
          setState({ kind: "invalid" });
        }
      } catch {
        if (latestQueryRef.current === trimmed) setState({ kind: "invalid" });
      }
    }, 350);
    return () => window.clearTimeout(handle);
  }, [query]);

  return state;
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
  // Only run the geocoder check when the local rank yields no seeded
  // matches — no point burning a network call for "Lewisham" when we
  // already cover Lewisham.
  const noLocalMatch = matches.length === 0;
  const validation = useAreaValidation(noLocalMatch ? query : "");
  const showUnmatchedCta = query.trim().length >= 2 && noLocalMatch;

  const handleSelectArea = (area: Area) => {
    setOpen(false);
    setQuery("");
    onSelect({ kind: "area", area });
  };

  const handleSelectUnmatched = () => {
    const requested = query.trim();
    if (!passesShape(requested)) return;
    setOpen(false);
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
                {!passesShape(query) ? (
                  <p
                    className="px-3 py-4 text-sm text-muted-foreground"
                    data-testid="area-picker-empty-hint"
                  >
                    Try a borough name or a UK outward postcode (e.g. SE13).
                  </p>
                ) : validation.kind === "checking" || validation.kind === "unknown" ? (
                  <p
                    className="flex items-center gap-2 px-3 py-4 text-sm text-muted-foreground"
                    data-testid="area-picker-checking"
                  >
                    <Loader2 className="h-4 w-4 animate-spin" />
                    Checking “{query.trim()}”…
                  </p>
                ) : validation.kind === "valid" ? (
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
                ) : validation.kind === "typo" ? (
                  <div className="px-3 py-3 text-sm" data-testid="area-picker-typo">
                    <p className="text-muted-foreground">
                      We couldn't find “{query.trim()}”. Did you mean:
                    </p>
                    <button
                      type="button"
                      onClick={() => setQuery(validation.suggestion.name)}
                      className="mt-2 inline-flex items-center gap-2 rounded-md border px-3 py-2 text-left text-sm hover:bg-accent"
                      data-testid="area-picker-typo-suggestion"
                    >
                      <MapPin className="h-4 w-4 opacity-60" />
                      <strong>{validation.suggestion.name}</strong>?
                    </button>
                  </div>
                ) : (
                  <p
                    className="px-3 py-4 text-sm text-muted-foreground"
                    data-testid="area-picker-invalid"
                  >
                    We couldn't find “{query.trim()}” as a real place. Try a borough
                    name or a UK postcode (e.g. SE13).
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
