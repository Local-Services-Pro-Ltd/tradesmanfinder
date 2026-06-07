/**
 * PR-P5 — PartnerPlacement
 *
 * Renders partner placement cards for a given surface.
 * When the feature flag is off (PARTNER_PLACEMENTS_ENABLED != true/1),
 * the API returns {placements:[]} and this component renders null —
 * no layout shift, no skeleton, no empty state.
 *
 * Click tracking (event_id) is wired in PR-P6; here we just attach
 * data-event-id to the link so PR-P6 can pick it up without re-touching
 * every surface.
 */

import { useQuery } from "@tanstack/react-query";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

// ── Types ─────────────────────────────────────────────────────────────────

interface PlacementCreative {
  headline: string;
  body?: string;
  cta?: string;
  image_url?: string;
}

interface Placement {
  id: number;
  partner_id: number;
  surface: string;
  creative: PlacementCreative;
  target_url: string;
  weight: number;
  event_id: string | null;
}

interface PlacementsResponse {
  placements: Placement[];
}

// ── Props ─────────────────────────────────────────────────────────────────

export interface PartnerPlacementProps {
  surface: string;
  category?: number;
  area?: number;
  limit?: number;
  className?: string;
}

// ── Component ─────────────────────────────────────────────────────────────

export function PartnerPlacement({
  surface,
  category,
  area,
  limit = 1,
  className,
}: PartnerPlacementProps) {
  // Build the query key including all relevant params so we cache per-surface
  const params = new URLSearchParams({ surface, limit: String(limit) });
  if (category != null) params.set("category", String(category));
  if (area != null) params.set("area", String(area));
  const url = `/api/placements?${params.toString()}`;

  const { data } = useQuery<PlacementsResponse>({
    queryKey: ["partner-placements", surface, category ?? null, area ?? null, limit],
    queryFn: async () => {
      const res = await fetch(url);
      if (!res.ok) return { placements: [] };
      return res.json();
    },
    staleTime: 60_000,
    refetchOnMount: false,
  });

  const placements = data?.placements ?? [];
  if (placements.length === 0) return null;

  return (
    <div className={cn("space-y-3", className)} data-testid="partner-placement-root">
      {placements.map((p) => (
        <PlacementCard key={p.id} placement={p} />
      ))}
    </div>
  );
}

// ── PlacementCard ─────────────────────────────────────────────────────────

function PlacementCard({ placement }: { placement: Placement }) {
  const { creative, target_url, event_id } = placement;
  const ctaText = creative.cta || "Learn more";

  return (
    <Card className="relative overflow-hidden p-4">
      {/* Sponsored label — top-right, small + muted */}
      <span
        className="absolute right-3 top-2.5 text-[10px] font-medium text-muted-foreground"
        aria-label="Sponsored content"
      >
        Sponsored
      </span>

      <div className="flex gap-3">
        {creative.image_url && (
          <div className="flex-shrink-0">
            <img
              src={creative.image_url}
              alt=""
              aria-hidden="true"
              className="h-16 w-16 rounded-lg object-cover"
            />
          </div>
        )}

        <div className="min-w-0 flex-1 pr-12">
          <p className="font-semibold text-foreground leading-snug">
            {creative.headline}
          </p>
          {creative.body && (
            <p className="mt-1 text-sm text-muted-foreground line-clamp-2">
              {creative.body}
            </p>
          )}
          <a
            href={target_url}
            target="_blank"
            rel="sponsored noopener"
            data-event-id={event_id ?? undefined}
            className="mt-2 inline-block"
          >
            <Button variant="outline" size="sm">
              {ctaText}
            </Button>
          </a>
        </div>
      </div>
    </Card>
  );
}
