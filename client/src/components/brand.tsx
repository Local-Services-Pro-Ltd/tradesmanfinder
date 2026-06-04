import { Link } from "wouter";
import * as Icons from "lucide-react";
import { Star, ShieldCheck, BadgeCheck, Award, Clock } from "lucide-react";
import { cn } from "@/lib/utils";

/* ───────── Logo (custom SVG word-mark) ─────────
   Geometric trade-tool inspired mark: a stylised plumb-bob / location pin
   formed from a triangle + bob, evoking "finding" + "trade tools". */
export function Logo({ className, showText = true }: { className?: string; showText?: boolean }) {
  return (
    <Link href="/" data-testid="link-logo" className={cn("flex items-center gap-2.5 group", className)}>
      <span className="inline-flex h-9 w-9 items-center justify-center rounded-lg bg-navy text-primary-foreground shadow-sm">
        <svg width="24" height="24" viewBox="0 0 32 32" fill="none" aria-label="TradesmanFinder mark">
          {/* roof / level triangle */}
          <path d="M16 3L28 11V13L16 7L4 13V11L16 3Z" fill="hsl(31 81% 51%)" />
          {/* plumb line */}
          <line x1="16" y1="9" x2="16" y2="22" stroke="hsl(31 81% 51%)" strokeWidth="2" strokeLinecap="round" />
          {/* plumb bob */}
          <path d="M16 21L19 25L16 29L13 25L16 21Z" fill="currentColor" stroke="hsl(31 81% 51%)" strokeWidth="1.2" />
        </svg>
      </span>
      {showText && (
        <span className="font-display font-bold text-lg leading-none tracking-tight text-foreground">
          Tradesman<span className="text-primary">Finder</span>
        </span>
      )}
    </Link>
  );
}

/* ───────── Category icon resolver ───────── */
export function CategoryIcon({ name, className }: { name: string; className?: string }) {
  const Comp = (Icons as any)[name] || Icons.Wrench;
  return <Comp className={className} />;
}

/* ───────── Star rating ───────── */
export function StarRating({ value, size = 16, className }: { value: number; size?: number; className?: string }) {
  const full = Math.floor(value);
  const hasHalf = value - full >= 0.25 && value - full < 0.75;
  const stars = [];
  for (let i = 0; i < 5; i++) {
    let fill = "none";
    if (i < full) fill = "full";
    else if (i === full && hasHalf) fill = "half";
    else if (i === full && value - full >= 0.75) fill = "full";
    stars.push(fill);
  }
  return (
    <span className={cn("inline-flex items-center gap-0.5", className)} aria-label={`${value} out of 5 stars`}>
      {stars.map((f, i) => (
        <span key={i} className="relative inline-block" style={{ width: size, height: size }}>
          <Star className="absolute inset-0 text-amber-400/30" style={{ width: size, height: size }} stroke="hsl(31 81% 51%)" fill="none" />
          {f === "full" && <Star className="absolute inset-0" style={{ width: size, height: size }} stroke="hsl(31 81% 45%)" fill="hsl(31 81% 51%)" />}
          {f === "half" && (
            <span className="absolute inset-0 overflow-hidden" style={{ width: size / 2 }}>
              <Star style={{ width: size, height: size }} stroke="hsl(31 81% 45%)" fill="hsl(31 81% 51%)" />
            </span>
          )}
        </span>
      ))}
    </span>
  );
}

/* ───────── Verification chips ───────── */
export function VerificationChips({ verified, insured, licensed, className }: { verified?: boolean; insured?: boolean; licensed?: boolean; className?: string }) {
  const chips: { label: string; icon: typeof ShieldCheck; on?: boolean }[] = [
    { label: "Verified", icon: BadgeCheck, on: verified },
    { label: "Insured", icon: ShieldCheck, on: insured },
    { label: "Licensed", icon: Award, on: licensed },
  ];
  return (
    <div className={cn("flex flex-wrap gap-1.5", className)}>
      {chips.filter((c) => c.on).map((c) => (
        <span
          key={c.label}
          data-testid={`chip-${c.label.toLowerCase()}`}
          className="inline-flex items-center gap-1 rounded-full bg-trust/10 px-2 py-0.5 text-xs font-medium text-trust"
        >
          <c.icon className="h-3 w-3" /> {c.label}
        </span>
      ))}
    </div>
  );
}

/* ───────── Response-time pill ───────── */
export function ResponseTimePill({ minutes, className }: { minutes: number; className?: string }) {
  const label = minutes < 60 ? `${minutes} min` : `${Math.round(minutes / 60)} hr`;
  return (
    <span className={cn("inline-flex items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground", className)}>
      <Clock className="h-3 w-3" /> Responds in ~{label}
    </span>
  );
}
