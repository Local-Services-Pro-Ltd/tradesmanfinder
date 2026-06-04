import { Link } from "wouter";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { StarRating, VerificationChips, ResponseTimePill, CategoryIcon } from "./brand";
import { CardBadge } from "./card-badge";
import type { Tradesman, Category, Area } from "@/lib/api-types";
import { parseJsonArray } from "@/lib/api-types";
import { MapPin } from "lucide-react";

export function TradesmanCard({
  tradesman, categories, areas,
}: { tradesman: Tradesman; categories?: Category[]; areas?: Area[] }) {
  const catIds = parseJsonArray<number>(tradesman.categories);
  const primaryCat = categories?.find((c) => c.id === catIds[0]);
  const area = areas?.find((a) => a.id === tradesman.areaId);

  return (
    <Card className="group flex flex-col overflow-hidden hover-elevate" data-testid={`card-tradesman-${tradesman.id}`}>
      <div className="relative aspect-[4/3] overflow-hidden bg-muted">
        <img
          src={tradesman.heroImageUrl}
          alt={tradesman.businessName}
          loading="lazy"
          className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-105"
        />
        {tradesman.featured && !tradesman.cardSummary?.isFeaturedRevoked && (
          <Badge className="absolute left-3 top-3 bg-navy text-white hover:bg-navy" data-testid={`badge-featured-${tradesman.id}`}>
            Featured
          </Badge>
        )}
        {tradesman.cardSummary?.publicBadge && (
          <div className="absolute right-3 top-3">
            <CardBadge summary={tradesman.cardSummary} size="sm" />
          </div>
        )}
        {primaryCat && (
          <span className="absolute bottom-3 left-3 inline-flex items-center gap-1.5 rounded-full bg-background/95 px-2.5 py-1 text-xs font-medium shadow-sm">
            <CategoryIcon name={primaryCat.icon} className="h-3.5 w-3.5 text-primary" /> {primaryCat.name}
          </span>
        )}
      </div>

      <div className="flex flex-1 flex-col p-4">
        <Link href={`/tradesman/${tradesman.slug}`}>
          <h3 className="font-display text-base font-semibold leading-snug text-foreground hover:text-primary" data-testid={`text-business-${tradesman.id}`}>
            {tradesman.businessName}
          </h3>
        </Link>

        {area && (
          <p className="mt-1 flex items-center gap-1 text-sm text-muted-foreground">
            <MapPin className="h-3.5 w-3.5" /> {area.name}, {area.region}
          </p>
        )}

        <div className="mt-2 flex items-center gap-2">
          <StarRating value={tradesman.ratingAverage} size={15} />
          <span className="text-sm font-semibold text-foreground">{tradesman.ratingAverage.toFixed(1)}</span>
          <span className="text-sm text-muted-foreground">({tradesman.ratingCount})</span>
        </div>

        <div className="mt-3">
          <VerificationChips verified={tradesman.verified} insured={tradesman.insured} licensed={tradesman.licensed} />
        </div>

        <div className="mt-3">
          <ResponseTimePill minutes={tradesman.responseTimeMinutes} />
        </div>

        <div className="mt-4 flex-1" />
        <div className="flex gap-2">
          <Link href={`/tradesman/${tradesman.slug}`} className="flex-1">
            <Button variant="outline" className="w-full" size="sm" data-testid={`button-profile-${tradesman.id}`}>View Profile</Button>
          </Link>
          <Link href={`/tradesman/${tradesman.slug}#quote`} className="flex-1">
            <Button className="w-full" size="sm" data-testid={`button-quote-${tradesman.id}`}>Get a Quote</Button>
          </Link>
        </div>
      </div>
    </Card>
  );
}

export function TradesmanCardSkeleton() {
  return (
    <Card className="overflow-hidden">
      <div className="aspect-[4/3] animate-pulse bg-muted" />
      <div className="space-y-3 p-4">
        <div className="h-5 w-3/4 animate-pulse rounded bg-muted" />
        <div className="h-4 w-1/2 animate-pulse rounded bg-muted" />
        <div className="h-4 w-2/3 animate-pulse rounded bg-muted" />
        <div className="h-9 w-full animate-pulse rounded bg-muted" />
      </div>
    </Card>
  );
}
