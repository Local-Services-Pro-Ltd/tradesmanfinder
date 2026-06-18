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
} from "@/lib/api-types";
import {
  ShieldCheck, FileBadge2, Clock, CheckCircle2, XCircle, Upload, Info, Building2, Search, ArrowLeft,
} from "lucide-react";

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
  return "Company verification";
}

function KindIcon({ kind, className }: { kind: Verification["kind"]; className?: string }) {
  if (kind === "insurance") return <ShieldCheck className={className} />;
  if (kind === "qualification") return <FileBadge2 className={className} />;
  return <Building2 className={className} />;
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
          {v.kind === "companies_house" && v.evidenceData && (
            <span className="text-muted-foreground">
              · {v.evidenceData.company_name} ({v.evidenceData.company_number})
            </span>
          )}
        </div>
        <StatusBadge status={v.status} />
      </div>
      <div className="mt-1 flex flex-wrap gap-3 text-xs text-muted-foreground">
        <span>Submitted {new Date(v.submittedAt).toLocaleDateString("en-GB", { dateStyle: "medium" })}</span>
        {v.expiryDate && <span>Valid until {new Date(v.expiryDate).toLocaleDateString("en-GB", { dateStyle: "medium" })}</span>}
        {v.kind !== "companies_house" && v.fileSizeBytes != null && (
          <span>{formatBytes(v.fileSizeBytes)}</span>
        )}
        {v.kind === "companies_house" && v.evidenceData?.company_status && (
          <span className="capitalize">Status: {v.evidenceData.company_status}</span>
        )}
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

export function VerificationsTab({
  tradesmanId,
  insured,
  licensed,
  verified,
}: {
  tradesmanId: number;
  insured: boolean;
  licensed: boolean;
  verified: boolean;
}) {
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

  // Latest approved companies_house row → drives the status header subtitle.
  const approvedCompany = useMemo<CompaniesHouseEvidence | null>(() => {
    const approved = list
      .filter((v) => v.kind === "companies_house" && v.status === "approved" && v.evidenceData)
      .sort((a, b) => (b.verifiedAt ?? b.submittedAt) - (a.verifiedAt ?? a.submittedAt));
    return approved[0]?.evidenceData ?? null;
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
        <div className="mt-3 grid gap-3 sm:grid-cols-3">
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
        </div>
      </Card>

      {/* Submission forms */}
      <div className="grid gap-4 lg:grid-cols-2">
        <UploadForm kind="insurance" tradesmanId={tradesmanId} hasPending={hasPendingInsurance} />
        <UploadForm kind="qualification" tradesmanId={tradesmanId} hasPending={hasPendingQualification} />
      </div>
      <CompaniesHouseSubmissionForm tradesmanId={tradesmanId} hasPending={hasPendingCompaniesHouse} />

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
