// Public-facing Name & Shame badge for tradesmen.
// Renders a coloured badge with hover tooltip; never exposes the private reason.
import { Badge } from "@/components/ui/badge";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { AlertTriangle, Square, Ban } from "lucide-react";
import type { CardSummary } from "@/lib/api-types";
import { cn } from "@/lib/utils";

export function CardBadge({ summary, size = "default" }: { summary?: CardSummary | null; size?: "default" | "sm" }) {
  if (!summary || !summary.publicBadge) return null;
  const { label, tone, tooltip } = summary.publicBadge;
  const Icon = tone === "red" ? Ban : tone === "yellow" ? Square : AlertTriangle;

  const toneClasses: Record<typeof tone, string> = {
    warning: "bg-amber-100 text-amber-900 border border-amber-300 hover:bg-amber-100 dark:bg-amber-950/40 dark:text-amber-200 dark:border-amber-800",
    yellow:  "bg-yellow-300 text-yellow-950 border border-yellow-500 hover:bg-yellow-300 dark:bg-yellow-500/30 dark:text-yellow-100 dark:border-yellow-600",
    red:     "bg-red-600 text-white border border-red-700 hover:bg-red-600 dark:bg-red-700 dark:border-red-800",
  };

  const sizeClasses = size === "sm" ? "text-[10px] px-1.5 py-0.5 gap-1" : "text-xs px-2 py-1 gap-1.5";
  const iconSize = size === "sm" ? "h-2.5 w-2.5" : "h-3.5 w-3.5";
  // For yellow: render a filled square (looks like a yellow card). For warning: triangle.
  const isFilledIcon = tone === "yellow";

  const badge = (
    <Badge
      data-testid={`card-badge-${tone}`}
      className={cn("inline-flex items-center font-semibold uppercase tracking-wide", toneClasses[tone], sizeClasses)}
    >
      <Icon className={cn(iconSize, isFilledIcon && "fill-current")} />
      {label}
    </Badge>
  );

  return (
    <Tooltip>
      <TooltipTrigger asChild>{badge}</TooltipTrigger>
      <TooltipContent side="top" className="max-w-xs text-xs">
        {tooltip}
        {summary.suspendedUntil && summary.suspendedUntil > Date.now() && (
          <div className="mt-1 text-muted-foreground">
            Suspension ends {new Date(summary.suspendedUntil).toLocaleDateString("en-GB", { day: "numeric", month: "short" })}
          </div>
        )}
      </TooltipContent>
    </Tooltip>
  );
}
