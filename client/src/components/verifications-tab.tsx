/**
 * VerificationsTab — Tradesman dashboard tab for verifications.
 *
 * Wire-up (file-based kinds — insurance, qualification):
 *   - GET  /api/tradesmen/:id/verifications  → list (status + metadata; no filePath)
 *   - POST /api/tradesmen/:id/verifications  → multipart-as-JSON+base64
 *
 * Wire-up (companies_house — API lookup, no file):
 *   - GET  /api/companies-house/search?q=&limit=
 *   - GET  /api/companies-house/company/:number
 *   - POST /api/tradesmen/:id/verifications/companies-house  { companyNumber }
 *
 * Why JSON+base64 (not multipart) for files: mirrors the server route — see
 * server/routes.ts and server/verifications-storage.ts. Keeps the surface
 * small and avoids adding a new dep.
 *
 * Copy is non-overclaiming on purpose: we say "submitted", "under review",
 * "on file" — never "verified by us". The public badge uses the same
 * factual phrasing.
 */
import { useState, useMemo } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import type {
  VerificationRecord,
  CompaniesHouseSearchItem,
  CompaniesHouseSearchResult,
  CompaniesHouseEvidence,
  GasSafeEvidence,
  GenericRegisterEvidence,
} from "@/lib/api-types";
import { asGenericRegisterEvidence } from "@/lib/api-types";
import { REGISTER_CONFIGS, type RegisterConfig } from "@shared/register-configs";
import { GENERIC_REGISTER_KINDS, type GenericRegisterKind } from "@shared/schema";
import {
  ShieldCheck, FileBadge2, Clock, CheckCircle2, XCircle, Upload, Info, Building2, Search, ArrowLeft, Flame, ExternalLink,
  Zap, Sun, ShieldCheck as ShieldCheckIcon, Snowflake, Wrench,
} from "lucide-react";

// Map the platform-free iconName strings in REGISTER_CONFIGS to Lucide
// components. Kept here (not in register-configs.ts) so that shared/ stays
// importable from the server without dragging in a UI library.
const REGISTER_ICONS: Record<RegisterConfig["iconName"], typeof Flame> = {
  Zap,
  Sun,
  Flame,
  ShieldCheck: ShieldCheckIcon,
  Snowflake,
  Wrench,
};

// Keep in sync with server/verifications-storage.ts (ALLOWED_MIME_TYPES, MAX_FILE_BYTES).
const ALLOWED_MIME = ["application/pdf", "image/jpeg", "image/png", "image/webp", "image/heic"];
const MAX_BYTES = 5 * 1024 * 1024;
const ACCEPT_ATTR = ".pdf,.jpg,.jpeg,.png,.webp,.heic,application/pdf,image/jpeg,image/png,image/webp,image/heic";

// Qualifications list — UK trade norm. "Other" lets the user free-text it.
const QUALIFICATION_OPTIONS = [
  "Gas Safe", "NICEIC", "NAPIT", "ELECSA", "Stroma",
  "18th Edition", "City & Guilds 2391", "City & Guilds 6189",
  "NVQ Plumbing", "WaterSafe", "OFTEC", "Other",
];

// Local row type — mirrors VerificationRecord but tightened for the dashboard
// (no filePath ever returned to the pro). The file* fields are nullable
// because companies_house rows carry no file.
type Verification = Omit<VerificationRecord, "filePath">;

function readFileAsBase64(file: File): Promise<{ base64: string; mime: string }> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("Could not read the selected file."));
    reader.onload = () => {
      const result = String(reader.result || "");
      // data:<mime>;base64,<payload>
      const idx = result.indexOf(",");
      if (idx < 0) return reject(new Error("Unexpected file encoding"));
      resolve({ base64: result.slice(idx + 1), mime: result.slice(5, result.indexOf(";")) });
    };
    reader.readAsDataURL(file);
  });
}

function StatusBadge({ status }: { status: Verification["status"] }) {
  if (status === "approved") {
    return (
      <Badge className="bg-trust/15 text-trust hover:bg-trust/20" data-testid="vstatus-approved">
        <CheckCircle2 className="mr-1 h-3 w-3" /> Approved
      </Badge>
    );
  }
  if (status === "rejected") {
    return (
      <Badge variant="destructive" data-testid="vstatus-rejected">
        <XCircle className="mr-1 h-3 w-3" /> Rejected
      </Badge>
    );
  }
  return (
    <Badge variant="secondary" data-testid="vstatus-pending">
      <Clock className="mr-1 h-3 w-3" /> Under review
    </Badge>
  );
}

function formatBytes(n: number) {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

function kindLabel(kind: Verification["kind"]): string {
  if (kind === "insurance") return "Insurance";
  if (kind === "qualification") return "Qualification";
  if (kind === "gas_safe") return "Gas Safe Register";
  if (kind === "companies_house") return "Company verification";
  const cfg = REGISTER_CONFIGS[kind as GenericRegisterKind];
  return cfg ? cfg.label : kind;
}

function KindIcon({ kind, className }: { kind: Verification["kind"]; className?: string }) {
  if (kind === "insurance") return <ShieldCheck className={className} />;
  if (kind === "qualification") return <FileBadge2 className={className} />;
  if (kind === "gas_safe") return <Flame className={className} />;
  if (kind === "companies_house") return <Building2 className={className} />;
  const cfg = REGISTER_CONFIGS[kind as GenericRegisterKind];
  if (cfg) {
    const Icon = REGISTER_ICONS[cfg.iconName];
    return <Icon className={className} />;
  }
  return <Building2 className={className} />;
}

// Type guard — evidenceData on a gas_safe row is GasSafeEvidence shape.
// Doesn't need to be exhaustive; only used for narrowing inside JSX.
function isGasSafeEvidence(
  ev: VerificationRecord["evidenceData"],
): ev is GasSafeEvidence {
  return !!ev && typeof ev === "object" && "gas_safe_number" in (ev as any);
}

function isCompaniesHouseEvidence(
  ev: VerificationRecord["evidenceData"],
): ev is CompaniesHouseEvidence {
  return !!ev && typeof ev === "object" && "company_number" in (ev as any);
}

function HistoryItem({ v }: { v: Verification }) {
  return (
    <div className="rounded-md border border-border p-3 text-sm" data-testid={`verification-${v.id}`}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <KindIcon kind={v.kind} className="h-4 w-4 text-primary" />
          <span className="font-medium text-foreground">{kindLabel(v.kind)}</span>
          {v.kind === "qualification" && v.qualificationType && (
            <span className="text-muted-foreground">· {v.qualificationType}</span>
          )}
          {v.kind === "insurance" && v.insuranceCoverGbp != null && (
            <span className="text-muted-foreground">
              · £{(v.insuranceCoverGbp / 1_000_000).toLocaleString("en-GB", { maximumFractionDigits: 1 })}m PL
            </span>
          )}
          {v.kind === "companies_house" && isCompaniesHouseEvidence(v.evidenceData) && (
            <span className="text-muted-foreground">
              · {v.evidenceData.company_name} ({v.evidenceData.company_number})
            </span>
          )}
          {v.kind === "gas_safe" && isGasSafeEvidence(v.evidenceData) && (
            <span className="text-muted-foreground">
              · {v.evidenceData.business_name} (#{v.evidenceData.gas_safe_number})
            </span>
          )}
          {(() => {
            const ge = asGenericRegisterEvidence(v.evidenceData ?? null);
            return ge ? (
              <span className="text-muted-foreground">
                · {ge.business_name} (#{ge.registration_number})
              </span>
            ) : null;
          })()}
        </div>
        <StatusBadge status={v.status} />
      </div>
      <div className="mt-1 flex flex-wrap gap-3 text-xs text-muted-foreground">
        <span>Submitted {new Date(v.submittedAt).toLocaleDateString("en-GB", { dateStyle: "medium" })}</span>
        {v.expiryDate && <span>Valid until {new Date(v.expiryDate).toLocaleDateString("en-GB", { dateStyle: "medium" })}</span>}
        {(v.kind === "insurance" || v.kind === "qualification") && v.fileSizeBytes != null && (
          <span>{formatBytes(v.fileSizeBytes)}</span>
        )}
        {v.kind === "companies_house" && isCompaniesHouseEvidence(v.evidenceData) && v.evidenceData.company_status && (
          <span className="capitalize">Status: {v.evidenceData.company_status}</span>
        )}
        {v.kind === "gas_safe" && isGasSafeEvidence(v.evidenceData) && (
          <span>Postcode: {v.evidenceData.postcode}</span>
        )}
        {(() => {
          const ge = asGenericRegisterEvidence(v.evidenceData ?? null);
          return ge?.postcode ? <span>Postcode: {ge.postcode}</span> : null;
        })()}
      </div>
      {v.status === "rejected" && v.reviewerNote && (
        <div className="mt-2 rounded-md bg-destructive/5 p-2 text-xs text-destructive">
          <span className="font-semibold">Reason:</span> {v.reviewerNote}
        </div>
      )}
    </div>
  );
}

function UploadForm({
  kind, tradesmanId, hasPending,
}: {
  kind: "insurance" | "qualification";
  tradesmanId: number;
  hasPending: boolean;
}) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [file, setFile] = useState<File | null>(null);
  const [expiryDate, setExpiryDate] = useState<string>("");
  const [insuranceCoverGbp, setInsuranceCoverGbp] = useState<string>("1000000");
  const [qualificationType, setQualificationType] = useState<string>(QUALIFICATION_OPTIONS[0]);
  const [qualificationOther, setQualificationOther] = useState<string>("");

  const upload = useMutation({
    mutationFn: async () => {
      if (!file) throw new Error("Please select a file to upload.");
      if (!ALLOWED_MIME.includes(file.type)) throw new Error("Unsupported file type. Use PDF, JPG, PNG, WEBP, or HEIC.");
      if (file.size > MAX_BYTES) throw new Error(`File is larger than 5 MB.`);

      const { base64, mime } = await readFileAsBase64(file);

      const body: Record<string, unknown> = {
        kind,
        fileBase64: base64,
        fileMimeType: mime || file.type,
        fileName: file.name,
      };
      if (expiryDate) body.expiryDate = expiryDate;
      if (kind === "insurance") {
        const n = Number(insuranceCoverGbp);
        if (Number.isFinite(n) && n > 0) body.insuranceCoverGbp = Math.round(n);
      }
      if (kind === "qualification") {
        const qt = qualificationType === "Other" ? qualificationOther.trim() : qualificationType;
        if (!qt) throw new Error("Please specify the qualification name.");
        body.qualificationType = qt;
      }

      const res = await apiRequest("POST", `/api/tradesmen/${tradesmanId}/verifications`, body);
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "Submitted for review", description: "We'll email you once it's been reviewed." });
      setFile(null);
      setExpiryDate("");
      if (kind === "qualification") setQualificationOther("");
      queryClient.invalidateQueries({ queryKey: ["/api/tradesmen", tradesmanId, "verifications"] });
    },
    onError: (e: any) => {
      toast({
        title: "Upload failed",
        description: e?.message || "Please try again.",
        variant: "destructive",
      });
    },
  });

  const title = kind === "insurance" ? "Insurance certificate" : "Qualification document";
  const hint = kind === "insurance"
    ? "Public liability certificate (PDF or photo). We accept up to 5 MB."
    : "Certificate or registration card (PDF or photo). We accept up to 5 MB.";

  return (
    <Card className="p-5">
      <div className="flex items-start gap-3">
        {kind === "insurance"
          ? <ShieldCheck className="mt-0.5 h-5 w-5 text-primary" />
          : <FileBadge2 className="mt-0.5 h-5 w-5 text-primary" />}
        <div className="min-w-0">
          <h3 className="font-display text-base font-semibold text-foreground">{title}</h3>
          <p className="mt-1 text-xs text-muted-foreground">{hint}</p>
        </div>
      </div>

      {hasPending && (
        <div className="mt-3 flex items-start gap-2 rounded-md border border-border bg-muted/30 p-3 text-xs text-muted-foreground">
          <Info className="mt-0.5 h-3.5 w-3.5 flex-shrink-0" />
          <span>You have a submission under review. You can submit another file to replace it — we'll review the most recent one.</span>
        </div>
      )}

      <div className="mt-4 space-y-3">
        <div>
          <Label htmlFor={`file-${kind}`} className="text-sm">File</Label>
          <Input
            id={`file-${kind}`}
            type="file"
            accept={ACCEPT_ATTR}
            onChange={(e) => setFile(e.target.files?.[0] ?? null)}
            data-testid={`input-file-${kind}`}
          />
          {file && (
            <p className="mt-1 text-xs text-muted-foreground">
              {file.name} · {formatBytes(file.size)}
            </p>
          )}
        </div>

        {kind === "insurance" && (
          <div>
            <Label htmlFor="cover" className="text-sm">Public liability cover (£)</Label>
            <Input
              id="cover"
              type="number"
              min={0}
              step={50_000}
              value={insuranceCoverGbp}
              onChange={(e) => setInsuranceCoverGbp(e.target.value)}
              data-testid="input-insurance-cover"
            />
            <p className="mt-1 text-xs text-muted-foreground">Industry standard is £1,000,000 minimum.</p>
          </div>
        )}

        {kind === "qualification" && (
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <Label className="text-sm">Qualification</Label>
              <Select value={qualificationType} onValueChange={setQualificationType}>
                <SelectTrigger data-testid="select-qualification-type">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {QUALIFICATION_OPTIONS.map((q) => (
                    <SelectItem key={q} value={q}>{q}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            {qualificationType === "Other" && (
              <div>
                <Label htmlFor="qual-other" className="text-sm">Specify</Label>
                <Input
                  id="qual-other"
                  value={qualificationOther}
                  onChange={(e) => setQualificationOther(e.target.value)}
                  maxLength={80}
                  placeholder="e.g. CSCS, JIB ECS"
                  data-testid="input-qualification-other"
                />
              </div>
            )}
          </div>
        )}

        <div>
          <Label htmlFor={`expiry-${kind}`} className="text-sm">Expiry date (optional)</Label>
          <Input
            id={`expiry-${kind}`}
            type="date"
            value={expiryDate}
            onChange={(e) => setExpiryDate(e.target.value)}
            data-testid={`input-expiry-${kind}`}
          />
        </div>

        <Button
          onClick={() => upload.mutate()}
          disabled={upload.isPending || !file}
          className="w-full sm:w-auto"
          data-testid={`button-upload-${kind}`}
        >
          <Upload className="mr-1 h-4 w-4" />
          {upload.isPending ? "Uploading…" : "Submit for review"}
        </Button>
      </div>
    </Card>
  );
}

/**
 * CompaniesHouseSubmissionForm — search → confirm → submit flow.
 *
 * No file upload: the user picks a real Companies House record, we lock it in
 * a confirmation panel showing the canonical company data, and then POST the
 * company number. The server re-fetches Companies House and persists the
 * trimmed evidence snapshot itself — the client never builds the evidence.
 *
 * Why two steps (search, then confirm): a UK pro can have a similar-sounding
 * company to an unrelated firm. The confirm panel prevents one-click mistakes
 * and gives them a chance to read company_status (e.g. "dissolved") before
 * submitting.
 */
function CompaniesHouseSubmissionForm({
  tradesmanId, hasPending,
}: {
  tradesmanId: number;
  hasPending: boolean;
}) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [query, setQuery] = useState("");
  const [submittedQuery, setSubmittedQuery] = useState("");
  const [selected, setSelected] = useState<CompaniesHouseSearchItem | null>(null);

  const search = useMutation<CompaniesHouseSearchResult, Error, string>({
    mutationFn: async (q: string) => {
      const trimmed = q.trim();
      if (trimmed.length < 2) throw new Error("Enter at least 2 characters to search.");
      const res = await apiRequest(
        "GET",
        `/api/companies-house/search?q=${encodeURIComponent(trimmed)}&limit=10`,
      );
      return res.json();
    },
    onError: (e: any) => {
      toast({
        title: "Search failed",
        description: e?.message || "Try again in a moment.",
        variant: "destructive",
      });
    },
  });

  const submit = useMutation({
    mutationFn: async () => {
      if (!selected) throw new Error("Pick a company from the results first.");
      const res = await apiRequest(
        "POST",
        `/api/tradesmen/${tradesmanId}/verifications/companies-house`,
        { companyNumber: selected.company_number },
      );
      return res.json();
    },
    onSuccess: () => {
      toast({
        title: "Submitted for review",
        description: "We'll match your account to Companies House and confirm shortly.",
      });
      setSelected(null);
      setQuery("");
      setSubmittedQuery("");
      queryClient.invalidateQueries({ queryKey: ["/api/tradesmen", tradesmanId, "verifications"] });
    },
    onError: (e: any) => {
      toast({
        title: "Couldn't submit",
        description: e?.message || "Please try again.",
        variant: "destructive",
      });
    },
  });

  const runSearch = () => {
    const q = query.trim();
    if (!q) return;
    setSubmittedQuery(q);
    setSelected(null);
    search.mutate(q);
  };

  const results = search.data?.items ?? [];

  return (
    <Card className="p-5">
      <div className="flex items-start gap-3">
        <Building2 className="mt-0.5 h-5 w-5 text-primary" />
        <div className="min-w-0">
          <h3 className="font-display text-base font-semibold text-foreground">Companies House lookup</h3>
          <p className="mt-1 text-xs text-muted-foreground">
            If you trade as a UK limited company, search by name or company number. We confirm the
            record directly with Companies House — no documents to upload.
          </p>
        </div>
      </div>

      {hasPending && (
        <div className="mt-3 flex items-start gap-2 rounded-md border border-border bg-muted/30 p-3 text-xs text-muted-foreground">
          <Info className="mt-0.5 h-3.5 w-3.5 flex-shrink-0" />
          <span>You have a company submission under review. You can submit another to replace it.</span>
        </div>
      )}

      {!selected && (
        <div className="mt-4 space-y-3">
          <div>
            <Label htmlFor="ch-search" className="text-sm">Company name or number</Label>
            <div className="mt-1 flex gap-2">
              <Input
                id="ch-search"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); runSearch(); } }}
                placeholder="e.g. Acme Plumbing Ltd or 12345678"
                maxLength={160}
                data-testid="input-ch-search"
              />
              <Button
                onClick={runSearch}
                disabled={search.isPending || query.trim().length < 2}
                data-testid="button-ch-search"
              >
                <Search className="mr-1 h-4 w-4" />
                {search.isPending ? "Searching…" : "Search"}
              </Button>
            </div>
          </div>

          {search.isPending && (
            <p className="text-xs text-muted-foreground">Looking up Companies House…</p>
          )}

          {!search.isPending && submittedQuery && results.length === 0 && !search.isError && (
            <p className="rounded-md border border-border bg-muted/30 p-3 text-xs text-muted-foreground">
              No companies matched "{submittedQuery}". Try the exact registered name or company number.
            </p>
          )}

          {results.length > 0 && (
            <div className="space-y-2" data-testid="ch-results">
              {results.map((item) => (
                <button
                  key={item.company_number}
                  type="button"
                  onClick={() => setSelected(item)}
                  className="w-full rounded-md border border-border bg-card p-3 text-left text-sm transition hover:border-primary hover:bg-muted/30"
                  data-testid={`ch-result-${item.company_number}`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-semibold text-foreground">{item.title}</span>
                    <Badge
                      variant={item.company_status === "active" ? "secondary" : "destructive"}
                      className="capitalize"
                    >
                      {item.company_status}
                    </Badge>
                  </div>
                  <div className="mt-1 flex flex-wrap gap-3 text-xs text-muted-foreground">
                    <span>#{item.company_number}</span>
                    {item.company_type && <span className="capitalize">{item.company_type.replace(/-/g, " ")}</span>}
                    {item.date_of_creation && <span>Incorporated {item.date_of_creation}</span>}
                  </div>
                  {item.address_snippet && (
                    <p className="mt-1 text-xs text-muted-foreground">{item.address_snippet}</p>
                  )}
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      {selected && (
        <div className="mt-4 space-y-3" data-testid="ch-confirm-panel">
          <div className="rounded-md border border-border bg-muted/30 p-3 text-sm">
            <div className="flex items-center justify-between gap-2">
              <span className="font-semibold text-foreground">{selected.title}</span>
              <Badge
                variant={selected.company_status === "active" ? "secondary" : "destructive"}
                className="capitalize"
              >
                {selected.company_status}
              </Badge>
            </div>
            <div className="mt-2 grid gap-1 text-xs text-muted-foreground sm:grid-cols-2">
              <span><span className="text-foreground">Number:</span> {selected.company_number}</span>
              {selected.company_type && (
                <span className="capitalize">
                  <span className="text-foreground not-italic">Type:</span> {selected.company_type.replace(/-/g, " ")}
                </span>
              )}
              {selected.date_of_creation && (
                <span><span className="text-foreground">Incorporated:</span> {selected.date_of_creation}</span>
              )}
              {selected.address_snippet && (
                <span className="sm:col-span-2"><span className="text-foreground">Address:</span> {selected.address_snippet}</span>
              )}
            </div>
            {selected.company_status !== "active" && (
              <div className="mt-2 rounded-md bg-destructive/5 p-2 text-xs text-destructive">
                <span className="font-semibold">Heads up:</span> this company is not active. You can still
                submit, but our reviewer will likely reject anything other than an active record.
              </div>
            )}
          </div>

          <div className="flex flex-wrap gap-2">
            <Button
              variant="ghost"
              onClick={() => setSelected(null)}
              disabled={submit.isPending}
              data-testid="button-ch-back"
            >
              <ArrowLeft className="mr-1 h-4 w-4" /> Back to results
            </Button>
            <Button
              onClick={() => submit.mutate()}
              disabled={submit.isPending}
              data-testid="button-ch-submit"
            >
              <Upload className="mr-1 h-4 w-4" />
              {submit.isPending ? "Submitting…" : "Submit this company"}
            </Button>
          </div>
        </div>
      )}
    </Card>
  );
}

/**
 * GasSafeSubmissionForm — single-step submission of a Gas Safe registration
 * number + business name + postcode.
 *
 * Why no auto-verify: the Gas Safe Register has no public API and blocks
 * datacenter IPs at the WAF layer (see server/gas-safe.ts). The pro
 * submits their claim; an admin clicks the gasSafeRegisterUrl deep-link
 * and confirms the match against the live register before approving.
 *
 * The form intentionally collects business_name + postcode (not just the
 * number) so the admin has corroborating data to spot fraudulent claims
 * before approving — e.g. number 967295 returns 'Keystone' at SW3 2DY;
 * if the pro entered a different business, the admin rejects.
 */
function GasSafeSubmissionForm({
  tradesmanId, hasPending,
}: {
  tradesmanId: number;
  hasPending: boolean;
}) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [gasSafeNumber, setGasSafeNumber] = useState("");
  const [businessName, setBusinessName] = useState("");
  const [postcode, setPostcode] = useState("");

  const numberOk = /^\d{4,8}$/.test(gasSafeNumber.trim());
  const businessOk = businessName.trim().length >= 2;
  const postcodeOk = postcode.trim().length >= 5;
  const canSubmit = numberOk && businessOk && postcodeOk;

  const submit = useMutation({
    mutationFn: async () => {
      const res = await apiRequest(
        "POST",
        `/api/tradesmen/${tradesmanId}/verifications/gas-safe`,
        {
          gasSafeNumber: gasSafeNumber.trim(),
          businessName: businessName.trim(),
          postcode: postcode.trim(),
        },
      );
      return res.json();
    },
    onSuccess: () => {
      toast({
        title: "Submitted for review",
        description: "We'll cross-check your registration against the Gas Safe Register and confirm shortly.",
      });
      setGasSafeNumber("");
      setBusinessName("");
      setPostcode("");
      queryClient.invalidateQueries({ queryKey: ["/api/tradesmen", tradesmanId, "verifications"] });
    },
    onError: (e: any) => {
      toast({
        title: "Couldn't submit",
        description: e?.message || "Please try again.",
        variant: "destructive",
      });
    },
  });

  return (
    <Card className="p-5">
      <div className="flex items-start gap-3">
        <Flame className="mt-0.5 h-5 w-5 text-primary" />
        <div className="min-w-0">
          <h3 className="font-display text-base font-semibold text-foreground">Gas Safe Register</h3>
          <p className="mt-1 text-xs text-muted-foreground">
            Required for any gas work in the UK. Enter your registration number,
            business name, and postcode — we cross-check against the public Gas
            Safe Register before approving.{" "}
            <a
              href="https://www.gassaferegister.co.uk/find-an-engineer-or-check-the-register/"
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-0.5 underline"
            >
              View the register <ExternalLink className="h-3 w-3" />
            </a>
          </p>
        </div>
      </div>

      {hasPending && (
        <div className="mt-3 flex items-start gap-2 rounded-md border border-border bg-muted/30 p-3 text-xs text-muted-foreground">
          <Info className="mt-0.5 h-3.5 w-3.5 flex-shrink-0" />
          <span>You have a Gas Safe submission under review. You can submit another to replace it.</span>
        </div>
      )}

      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        <div>
          <Label htmlFor="gs-number" className="text-sm">Gas Safe registration number</Label>
          <Input
            id="gs-number"
            value={gasSafeNumber}
            onChange={(e) => setGasSafeNumber(e.target.value.replace(/[^0-9]/g, ""))}
            placeholder="e.g. 967295"
            inputMode="numeric"
            maxLength={8}
            data-testid="input-gs-number"
          />
          {!numberOk && gasSafeNumber.length > 0 && (
            <p className="mt-1 text-xs text-destructive">Must be 4–8 digits.</p>
          )}
        </div>
        <div>
          <Label htmlFor="gs-postcode" className="text-sm">Business postcode</Label>
          <Input
            id="gs-postcode"
            value={postcode}
            onChange={(e) => setPostcode(e.target.value.toUpperCase())}
            placeholder="e.g. SW3 2DY"
            maxLength={10}
            data-testid="input-gs-postcode"
          />
        </div>
        <div className="sm:col-span-2">
          <Label htmlFor="gs-business" className="text-sm">Business name (as on the register)</Label>
          <Input
            id="gs-business"
            value={businessName}
            onChange={(e) => setBusinessName(e.target.value)}
            placeholder="e.g. Keystone London Ltd"
            maxLength={160}
            data-testid="input-gs-business"
          />
        </div>
      </div>

      <div className="mt-4">
        <Button
          onClick={() => submit.mutate()}
          disabled={submit.isPending || !canSubmit}
          data-testid="button-gs-submit"
        >
          <Upload className="mr-1 h-4 w-4" />
          {submit.isPending ? "Submitting…" : "Submit for review"}
        </Button>
      </div>
    </Card>
  );
}

/**
 * GenericRegisterSubmissionForm — single-step submission for one of the seven
 * generic UK trade registers (NICEIC, NAPIT, MCS, OFTEC, TrustMark, F-Gas/REFCOM,
 * CIPHE). The form's shape, labels, validation, and outbound deep-link all come
 * from REGISTER_CONFIGS[kind] — so adding the remaining registers in PR-H…M is
 * a one-line mount in VerificationsTab.
 *
 * Why no auto-verify: none of these registers expose a public API, and most
 * sit behind a WAF that blocks datacenter IPs. The pro submits a claim; an
 * admin opens the register_url deep-link in the review queue and confirms the
 * match before approving. Status is always "pending" until then.
 */
function GenericRegisterSubmissionForm({
  tradesmanId,
  kind,
  hasPending,
}: {
  tradesmanId: number;
  kind: GenericRegisterKind;
  hasPending: boolean;
}) {
  const cfg = REGISTER_CONFIGS[kind];
  const Icon = REGISTER_ICONS[cfg.iconName];
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [registrationNumber, setRegistrationNumber] = useState("");
  const [businessName, setBusinessName] = useState("");
  const [postcode, setPostcode] = useState("");

  // Client-side echo of the server validation so users see errors immediately.
  // The server re-validates with the same REGISTER_CONFIGS entry, so this is
  // belt-and-braces, not the trust boundary.
  const normalised = cfg.normaliseNumber(registrationNumber);
  const numberError = registrationNumber.length > 0 ? cfg.validateNumber(normalised) : null;
  const numberOk = registrationNumber.length > 0 && numberError === null;
  const businessOk = !cfg.collectsBusinessName || businessName.trim().length >= 2;
  const postcodeOk = !cfg.collectsPostcode || postcode.trim().length >= 5;
  const canSubmit = numberOk && businessOk && postcodeOk;

  const submit = useMutation({
    mutationFn: async () => {
      const res = await apiRequest(
        "POST",
        `/api/tradesmen/${tradesmanId}/verifications/${kind}`,
        {
          registrationNumber: normalised,
          businessName: businessName.trim(),
          postcode: postcode.trim(),
        },
      );
      return res.json();
    },
    onSuccess: () => {
      toast({
        title: "Submitted for review",
        description: `We'll cross-check your ${cfg.label} record before approving.`,
      });
      setRegistrationNumber("");
      setBusinessName("");
      setPostcode("");
      queryClient.invalidateQueries({ queryKey: ["/api/tradesmen", tradesmanId, "verifications"] });
    },
    onError: (e: any) => {
      toast({
        title: "Couldn't submit",
        description: e?.message || "Please try again.",
        variant: "destructive",
      });
    },
  });

  // Stable per-kind input ids so a single VerificationsTab can mount multiple
  // forms (NICEIC + NAPIT + …) without colliding label[for] / aria-describedby.
  const idNum = `reg-${kind}-number`;
  const idBiz = `reg-${kind}-business`;
  const idPc  = `reg-${kind}-postcode`;

  return (
    <Card className="p-5" data-testid={`form-register-${kind}`}>
      <div className="flex items-start gap-3">
        <Icon className="mt-0.5 h-5 w-5 text-primary" />
        <div className="min-w-0">
          <h3 className="font-display text-base font-semibold text-foreground">{cfg.label}</h3>
          <p className="mt-1 text-xs text-muted-foreground">{cfg.formDescription}</p>
        </div>
      </div>

      {hasPending && (
        <div className="mt-3 flex items-start gap-2 rounded-md border border-border bg-muted/30 p-3 text-xs text-muted-foreground">
          <Info className="mt-0.5 h-3.5 w-3.5 flex-shrink-0" />
          <span>You have a {cfg.label} submission under review. You can submit another to replace it.</span>
        </div>
      )}

      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        <div>
          <Label htmlFor={idNum} className="text-sm">{cfg.numberLabel}</Label>
          <Input
            id={idNum}
            value={registrationNumber}
            onChange={(e) => setRegistrationNumber(e.target.value)}
            placeholder={cfg.numberPlaceholder}
            maxLength={40}
            data-testid={`input-register-${kind}-number`}
          />
          {numberError && (
            <p className="mt-1 text-xs text-destructive">{numberError}</p>
          )}
        </div>
        {cfg.collectsPostcode && (
          <div>
            <Label htmlFor={idPc} className="text-sm">Business postcode</Label>
            <Input
              id={idPc}
              value={postcode}
              onChange={(e) => setPostcode(e.target.value.toUpperCase())}
              placeholder="e.g. SW3 2DY"
              maxLength={10}
              data-testid={`input-register-${kind}-postcode`}
            />
          </div>
        )}
        {cfg.collectsBusinessName && (
          <div className="sm:col-span-2">
            <Label htmlFor={idBiz} className="text-sm">Business name (as on the register)</Label>
            <Input
              id={idBiz}
              value={businessName}
              onChange={(e) => setBusinessName(e.target.value)}
              placeholder="e.g. Keystone London Ltd"
              maxLength={160}
              data-testid={`input-register-${kind}-business`}
            />
          </div>
        )}
      </div>

      <div className="mt-4">
        <Button
          onClick={() => submit.mutate()}
          disabled={submit.isPending || !canSubmit}
          data-testid={`button-register-${kind}-submit`}
        >
          <Upload className="mr-1 h-4 w-4" />
          {submit.isPending ? "Submitting…" : "Submit for review"}
        </Button>
      </div>
    </Card>
  );
}


export function VerificationsTab({
  tradesmanId,
  insured,
  licensed,
  verified,
  gasSafeVerified = false,
  niceicVerified = false,
  napitVerified = false,
  mcsVerified = false,
  oftecVerified = false,
  trustmarkVerified = false,
  fgasVerified = false,
  cipheVerified = false,
}: {
  tradesmanId: number;
  insured: boolean;
  licensed: boolean;
  verified: boolean;
  gasSafeVerified?: boolean;
  // PR-H: full set of generic-register booleans, populated from /api/me.
  // Each maps 1:1 to a kind in GENERIC_REGISTER_KINDS / REGISTER_CONFIGS.
  niceicVerified?: boolean;
  napitVerified?: boolean;
  mcsVerified?: boolean;
  oftecVerified?: boolean;
  trustmarkVerified?: boolean;
  fgasVerified?: boolean;
  cipheVerified?: boolean;
}) {
  // Per-kind verified flag lookup — drives the status row strip below.
  const verifiedByKind: Record<GenericRegisterKind, boolean> = {
    niceic: niceicVerified,
    napit: napitVerified,
    mcs: mcsVerified,
    oftec: oftecVerified,
    trustmark: trustmarkVerified,
    fgas: fgasVerified,
    ciphe: cipheVerified,
  };
  const { data, isLoading } = useQuery<Verification[]>({
    queryKey: ["/api/tradesmen", tradesmanId, "verifications"],
    queryFn: async () => {
      const res = await apiRequest("GET", `/api/tradesmen/${tradesmanId}/verifications`);
      return res.json();
    },
  });

  const list = data ?? [];
  const hasPendingInsurance = useMemo(
    () => list.some((v) => v.kind === "insurance" && v.status === "pending"),
    [list],
  );
  const hasPendingQualification = useMemo(
    () => list.some((v) => v.kind === "qualification" && v.status === "pending"),
    [list],
  );
  const hasPendingCompaniesHouse = useMemo(
    () => list.some((v) => v.kind === "companies_house" && v.status === "pending"),
    [list],
  );
  const hasPendingGasSafe = useMemo(
    () => list.some((v) => v.kind === "gas_safe" && v.status === "pending"),
    [list],
  );

  // PR-H: pending + latest-approved lookups for all seven generic register
  // kinds, derived in one pass through `list`. Avoids 14 separate useMemos.
  type RegisterAggregate = {
    pending: boolean;
    approved: GenericRegisterEvidence | null;
    approvedAt: number;
  };
  const registerAggregates = useMemo<Record<GenericRegisterKind, RegisterAggregate>>(() => {
    const acc: Record<GenericRegisterKind, RegisterAggregate> = {
      niceic:    { pending: false, approved: null, approvedAt: 0 },
      napit:     { pending: false, approved: null, approvedAt: 0 },
      mcs:       { pending: false, approved: null, approvedAt: 0 },
      oftec:     { pending: false, approved: null, approvedAt: 0 },
      trustmark: { pending: false, approved: null, approvedAt: 0 },
      fgas:      { pending: false, approved: null, approvedAt: 0 },
      ciphe:     { pending: false, approved: null, approvedAt: 0 },
    };
    for (const v of list) {
      const slot = acc[v.kind as GenericRegisterKind];
      if (!slot) continue; // not one of the seven generic kinds
      if (v.status === "pending") slot.pending = true;
      if (v.status === "approved") {
        const ts = v.verifiedAt ?? v.submittedAt;
        if (ts >= slot.approvedAt) {
          const ev = asGenericRegisterEvidence(v.evidenceData ?? null);
          if (ev) {
            slot.approved = ev;
            slot.approvedAt = ts;
          }
        }
      }
    }
    return acc;
  }, [list]);

  // Latest approved companies_house row → drives the status header subtitle.
  const approvedCompany = useMemo<CompaniesHouseEvidence | null>(() => {
    const approved = list
      .filter((v) => v.kind === "companies_house" && v.status === "approved" && isCompaniesHouseEvidence(v.evidenceData))
      .sort((a, b) => (b.verifiedAt ?? b.submittedAt) - (a.verifiedAt ?? a.submittedAt));
    return (approved[0]?.evidenceData as CompaniesHouseEvidence | undefined) ?? null;
  }, [list]);

  // Latest approved gas_safe row → drives the Gas Safe status header line.
  const approvedGasSafe = useMemo<GasSafeEvidence | null>(() => {
    const approved = list
      .filter((v) => v.kind === "gas_safe" && v.status === "approved" && isGasSafeEvidence(v.evidenceData))
      .sort((a, b) => (b.verifiedAt ?? b.submittedAt) - (a.verifiedAt ?? a.submittedAt));
    return (approved[0]?.evidenceData as GasSafeEvidence | undefined) ?? null;
  }, [list]);

  return (
    <div className="space-y-5">
      {/* Status header */}
      <Card className="p-5">
        <h3 className="font-display text-base font-semibold text-foreground">Verification status</h3>
        <p className="mt-1 text-sm text-muted-foreground">
          We display badges on your public profile only when something is on file and our team has approved it.
          We never claim to "vet" or guarantee your work — the badges describe what we hold.
        </p>
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          <div className="flex items-center gap-2 rounded-md border border-border bg-muted/30 p-3 text-sm">
            <ShieldCheck className={`h-4 w-4 ${insured ? "text-trust" : "text-muted-foreground"}`} />
            <span className="font-medium text-foreground">Insurance</span>
            <span className="ml-auto text-xs text-muted-foreground">
              {insured ? "On file" : "Not yet submitted"}
            </span>
          </div>
          <div className="flex items-center gap-2 rounded-md border border-border bg-muted/30 p-3 text-sm">
            <FileBadge2 className={`h-4 w-4 ${licensed ? "text-trust" : "text-muted-foreground"}`} />
            <span className="font-medium text-foreground">Qualification</span>
            <span className="ml-auto text-xs text-muted-foreground">
              {licensed ? "On file" : "Not yet submitted"}
            </span>
          </div>
          <div className="flex items-center gap-2 rounded-md border border-border bg-muted/30 p-3 text-sm">
            <Building2 className={`h-4 w-4 ${verified ? "text-trust" : "text-muted-foreground"}`} />
            <span className="font-medium text-foreground">Company verification</span>
            <span className="ml-auto text-xs text-muted-foreground" data-testid="ch-status-summary">
              {verified
                ? approvedCompany
                  ? `${approvedCompany.company_name} (${approvedCompany.company_number})`
                  : "On file"
                : "Not yet submitted"}
            </span>
          </div>
          <div className="flex items-center gap-2 rounded-md border border-border bg-muted/30 p-3 text-sm">
            <Flame className={`h-4 w-4 ${gasSafeVerified ? "text-trust" : "text-muted-foreground"}`} />
            <span className="font-medium text-foreground">Gas Safe</span>
            <span className="ml-auto text-xs text-muted-foreground" data-testid="gs-status-summary">
              {gasSafeVerified
                ? approvedGasSafe
                  ? `#${approvedGasSafe.gas_safe_number}`
                  : "On file"
                : "Not yet submitted"}
            </span>
          </div>
          {GENERIC_REGISTER_KINDS.map((kind) => {
            const cfg = REGISTER_CONFIGS[kind];
            const Icon = REGISTER_ICONS[cfg.iconName];
            const isVerified = verifiedByKind[kind];
            const approved = registerAggregates[kind].approved;
            return (
              <div
                key={kind}
                className="flex items-center gap-2 rounded-md border border-border bg-muted/30 p-3 text-sm"
              >
                <Icon className={`h-4 w-4 ${isVerified ? "text-trust" : "text-muted-foreground"}`} />
                <span className="font-medium text-foreground">{cfg.label}</span>
                <span
                  className="ml-auto text-xs text-muted-foreground"
                  data-testid={`${kind}-status-summary`}
                >
                  {isVerified
                    ? approved
                      ? `#${approved.registration_number}`
                      : "On file"
                    : "Not yet submitted"}
                </span>
              </div>
            );
          })}
        </div>
      </Card>

      {/* Submission forms */}
      <div className="grid gap-4 lg:grid-cols-2">
        <UploadForm kind="insurance" tradesmanId={tradesmanId} hasPending={hasPendingInsurance} />
        <UploadForm kind="qualification" tradesmanId={tradesmanId} hasPending={hasPendingQualification} />
      </div>
      <CompaniesHouseSubmissionForm tradesmanId={tradesmanId} hasPending={hasPendingCompaniesHouse} />
      <GasSafeSubmissionForm tradesmanId={tradesmanId} hasPending={hasPendingGasSafe} />
      {GENERIC_REGISTER_KINDS.map((kind) => (
        <GenericRegisterSubmissionForm
          key={kind}
          tradesmanId={tradesmanId}
          kind={kind}
          hasPending={registerAggregates[kind].pending}
        />
      ))}

      {/* History */}
      <Card className="p-5">
        <h3 className="font-display text-base font-semibold text-foreground">Submission history</h3>
        {isLoading ? (
          <p className="mt-3 text-sm text-muted-foreground">Loading…</p>
        ) : list.length === 0 ? (
          <p className="mt-3 text-sm text-muted-foreground">No submissions yet.</p>
        ) : (
          <div className="mt-3 space-y-2">
            {[...list].sort((a, b) => b.submittedAt - a.submittedAt).map((v) => (
              <HistoryItem key={v.id} v={v} />
            ))}
          </div>
        )}
      </Card>
    </div>
  );
}
