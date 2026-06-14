/**
 * VerificationProofCard — Pure presentational component.
 * Renders ONLY the redacted verification fields shared with a homeowner
 * after the tradesman has approved the access request.
 *
 * Never renders filePath or raw certificate images — only the sanitised
 * fields from the server's proof object.
 */
import { Card } from "@/components/ui/card";
import { ShieldCheck, BadgeCheck, Clock } from "lucide-react";

interface InsuranceProof {
  coverGbp: number;
  expiryDate: string;   // YYYY-MM-DD
  verifiedAt: string;   // YYYY-MM-DD
}

interface QualificationProof {
  qualificationType: string;
  expiryDate: string;   // YYYY-MM-DD
  verifiedAt: string;   // YYYY-MM-DD
}

export interface VerificationProof {
  insurance?: InsuranceProof;
  qualification?: QualificationProof;
}

interface Props {
  proof: VerificationProof;
  expiresAt?: number; // unix ms — when the homeowner's access grant expires
}

function formatDate(iso: string): string {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleDateString("en-GB", { dateStyle: "medium" });
  } catch {
    return iso;
  }
}

function formatGrantExpiry(ms: number): string {
  try {
    return new Date(ms).toLocaleDateString("en-GB", { dateStyle: "medium" });
  } catch {
    return "—";
  }
}

export function VerificationProofCard({ proof, expiresAt }: Props) {
  const hasInsurance = Boolean(proof.insurance);
  const hasQualification = Boolean(proof.qualification);

  return (
    <Card className="p-5" data-testid="verification-proof-card">
      {/* Header */}
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="font-display text-base font-semibold text-foreground">
            Verification proofs shared with you
          </p>
          {expiresAt && (
            <p className="mt-0.5 flex items-center gap-1 text-xs text-muted-foreground">
              <Clock className="h-3.5 w-3.5" />
              Access expires {formatGrantExpiry(expiresAt)}
            </p>
          )}
        </div>
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-trust/10 text-trust">
          <ShieldCheck className="h-5 w-5" />
        </span>
      </div>

      <div className="mt-4 space-y-3">
        {/* Insurance */}
        {hasInsurance && proof.insurance && (
          <div
            className="rounded-md border border-border bg-muted/30 p-3"
            data-testid="proof-insurance"
          >
            <div className="flex items-start gap-2">
              <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-trust" />
              <div className="min-w-0">
                <p className="text-sm font-medium text-foreground">
                  Insured ·{" "}
                  <span className="text-foreground">
                    £{proof.insurance.coverGbp.toLocaleString("en-GB")} cover
                  </span>
                  {" · "}
                  <span className="text-muted-foreground">
                    expires {formatDate(proof.insurance.expiryDate)}
                  </span>
                </p>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  verified {formatDate(proof.insurance.verifiedAt)}
                </p>
              </div>
            </div>
          </div>
        )}

        {/* Qualification */}
        {hasQualification && proof.qualification && (
          <div
            className="rounded-md border border-border bg-muted/30 p-3"
            data-testid="proof-qualification"
          >
            <div className="flex items-start gap-2">
              <BadgeCheck className="mt-0.5 h-4 w-4 shrink-0 text-trust" />
              <div className="min-w-0">
                <p className="text-sm font-medium text-foreground">
                  {proof.qualification.qualificationType}
                  {" · "}
                  <span className="text-muted-foreground">
                    expires {formatDate(proof.qualification.expiryDate)}
                  </span>
                </p>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  verified {formatDate(proof.qualification.verifiedAt)}
                </p>
              </div>
            </div>
          </div>
        )}

        {/* Empty state */}
        {!hasInsurance && !hasQualification && (
          <p className="text-sm text-muted-foreground">
            No verification proofs are available for this tradesman.
          </p>
        )}
      </div>

      <p className="mt-4 text-xs text-muted-foreground">
        These details were verified by our team. Raw documents are not shared.
      </p>
    </Card>
  );
}
