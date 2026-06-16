import { Link } from "wouter";
import * as Icons from "lucide-react";
import { Star, ShieldCheck, BadgeCheck, Award, Clock } from "lucide-react";
import { cn } from "@/lib/utils";

/* ───────── Logo (TF monogram badge) ─────────
   Navy rounded-square badge with white "TF" lockup where the wrench-shaped
   crossbar of the T doubles as the top arm of the F (one shape, two jobs),
   plus an orange accent dot. Wordmark kept beside the mark.

   `variant` switches the badge asset for contrast:
     - "dark"  (default) — navy badge, white letters; for use on light pages
     - "light"            — white badge, navy letters; for use on the navy footer or other dark surfaces

   Source PNGs: client/public/logo.png, client/public/logo-light.png */
export function Logo({
  className,
  showText = true,
  variant = "dark",
}: {
  className?: string;
  showText?: boolean;
  variant?: "dark" | "light";
}) {
  const src = variant === "light" ? "/logo-light.png" : "/logo.png";
  return (
    <Link href="/" data-testid="link-logo" className={cn("flex items-center gap-2.5 group", className)}>
      <img
        src={src}
        width={36}
        height={36}
        alt="TradesmanFinder"
        className="h-9 w-9 shrink-0"
        loading="eager"
        decoding="async"
      />
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
// Optional `verificationSummary` (from PR-VC) enriches the Insured / Licensed
// chips with the *factual* approved-document detail: PL cover amount, expiry
// date, qualification name. Phrasing is deliberately non-overclaiming:
//   "Insurance certificate on file (£1m PL, valid until 14 Jun 2027)"
//   "Qualification on file: Gas Safe (valid until 14 Jun 2027)"
// Never "Verified by us".
type VerificationSummary = {
  insurance: { coverGbp: number | null; expiryDate: string | null } | null;
  qualification: { qualificationType: string | null; expiryDate: string | null } | null;
};

function formatGbpCover(gbp: number | null): string | null {
  if (gbp == null || gbp <= 0) return null;
  if (gbp >= 1_000_000) {
    const m = gbp / 1_000_000;
    return `£${m.toLocaleString("en-GB", { maximumFractionDigits: 1 })}m`;
  }
  if (gbp >= 1_000) return `£${Math.round(gbp / 1_000)}k`;
  return `£${gbp}`;
}

function formatIsoDate(iso: string | null): string | null {
  if (!iso) return null;
  const d = new Date(`${iso}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });
}

export function VerificationChips({
  verified, insured, licensed, verificationSummary, className,
}: {
  verified?: boolean;
  insured?: boolean;
  licensed?: boolean;
  verificationSummary?: VerificationSummary;
  className?: string;
}) {
  const ins = verificationSummary?.insurance ?? null;
  const qual = verificationSummary?.qualification ?? null;

  const insuranceTitle = ins
    ? `Insurance certificate on file${ins.coverGbp ? ` (${formatGbpCover(ins.coverGbp)} PL` : ""}${ins.expiryDate ? `${ins.coverGbp ? ", " : " ("}valid until ${formatIsoDate(ins.expiryDate)})` : ins.coverGbp ? ")" : ""}`
    : undefined;

  const qualLabel = qual?.qualificationType
    ? `${qual.qualificationType}`
    : "Licensed";
  const qualTitle = qual
    ? `Qualification on file: ${qual.qualificationType ?? "—"}${qual.expiryDate ? ` (valid until ${formatIsoDate(qual.expiryDate)})` : ""}`
    : undefined;

  const chips: { label: string; icon: typeof ShieldCheck; on?: boolean; title?: string; testId: string }[] = [
    { label: "Verified", icon: BadgeCheck, on: verified, testId: "verified" },
    {
      label: ins?.coverGbp ? `Insured · ${formatGbpCover(ins.coverGbp)} PL` : "Insured",
      icon: ShieldCheck,
      on: insured,
      title: insuranceTitle,
      testId: "insured",
    },
    {
      label: qualLabel,
      icon: Award,
      on: licensed,
      title: qualTitle,
      testId: "licensed",
    },
  ];
  return (
    <div className={cn("flex flex-wrap gap-1.5", className)}>
      {chips.filter((c) => c.on).map((c) => (
        <span
          key={c.testId}
          data-testid={`chip-${c.testId}`}
          title={c.title}
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
