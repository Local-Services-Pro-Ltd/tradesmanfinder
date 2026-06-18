// /admin/verifications — moderation queue for tradesman insurance and
// qualification document submissions (PR C of the verification feature).
//
// Same admin-key gate as /admin and /admin/moderation (URL: #/admin/verifications?key=...).
//
// Flow:
//   1. List pending submissions (oldest first → reviewer FIFO).
//   2. Click a row → fetch a short-lived signed URL and open the file in a
//      new tab (5-minute TTL minted server-side; the page does not handle
//      the file bytes itself).
//   3. Approve (no note required) or Reject (note required, min 5 chars).
//   4. On approval, the server flips the matching tradesmen.insured /
//      tradesmen.licensed boolean. On rejection it does not.
import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "wouter";
import { Layout } from "@/components/layout";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import type { VerificationRecord } from "@/lib/api-types";
import {
  ArrowLeft, ShieldCheck, FileBadge2, Building2, CheckCircle2, XCircle, ExternalLink, Inbox, Lock,
} from "lucide-react";

function kindIcon(kind: VerificationRecord["kind"], className = "h-4 w-4 text-primary") {
  if (kind === "insurance") return <ShieldCheck className={className} />;
  if (kind === "qualification") return <FileBadge2 className={className} />;
  return <Building2 className={className} />;
}

function kindLabel(kind: VerificationRecord["kind"]): string {
  if (kind === "insurance") return "Insurance";
  if (kind === "qualification") return "Qualification";
  return "Companies House";
}

function getInitialKey(): string {
  const hash = window.location.hash;
  const qIdx = hash.indexOf("?");
  if (qIdx === -1) return "";
  return new URLSearchParams(hash.slice(qIdx + 1)).get("key") || "";
}

function fmtBytes(n: number) {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

function fmtDate(ms: number) {
  return new Date(ms).toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short" });
}

function fmtCover(gbp: number | null): string {
  if (gbp == null) return "—";
  if (gbp >= 1_000_000) return `£${(gbp / 1_000_000).toLocaleString("en-GB", { maximumFractionDigits: 1 })}m PL`;
  if (gbp >= 1_000) return `£${Math.round(gbp / 1_000)}k PL`;
  return `£${gbp} PL`;
}

export default function AdminVerifications() {
  const [authKey, setAuthKey] = useState(getInitialKey());
  const [keyInput, setKeyInput] = useState(getInitialKey());
  const [rejectingId, setRejectingId] = useState<number | null>(null);
  const [rejectNote, setRejectNote] = useState("");
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const queueQ = useQuery<VerificationRecord[]>({
    queryKey: ["/api/admin/verifications/pending", authKey],
    queryFn: async () =>
      (await apiRequest("GET", `/api/admin/verifications/pending?key=${encodeURIComponent(authKey)}`)).json(),
    enabled: !!authKey,
    retry: false,
  });

  const openFile = async (id: number) => {
    try {
      const res = await apiRequest("GET", `/api/admin/verifications/${id}/file-url?key=${encodeURIComponent(authKey)}`);
      const body = await res.json();
      if (!body?.url) throw new Error("No signed URL returned");
      window.open(body.url, "_blank", "noopener,noreferrer");
    } catch (e: any) {
      toast({
        title: "Couldn't open file",
        description: e?.message || "Try again.",
        variant: "destructive",
      });
    }
  };

  const decide = useMutation({
    mutationFn: async (args: { id: number; status: "approved" | "rejected"; reviewerNote?: string }) => {
      const res = await apiRequest(
        "POST",
        `/api/admin/verifications/${args.id}/decide?key=${encodeURIComponent(authKey)}`,
        { status: args.status, reviewerNote: args.reviewerNote },
      );
      return res.json();
    },
    onSuccess: (_, vars) => {
      toast({
        title: vars.status === "approved" ? "Approved" : "Rejected",
        description: vars.status === "approved"
          ? "Tradesman badge updated."
          : "Reviewer note recorded.",
      });
      setRejectingId(null);
      setRejectNote("");
      queryClient.invalidateQueries({ queryKey: ["/api/admin/verifications/pending", authKey] });
    },
    onError: (e: any) => {
      toast({
        title: "Couldn't save decision",
        description: e?.message || "Try again.",
        variant: "destructive",
      });
    },
  });

  const items = queueQ.data ?? [];
  const counts = useMemo(() => ({
    insurance: items.filter((v) => v.kind === "insurance").length,
    qualification: items.filter((v) => v.kind === "qualification").length,
    companiesHouse: items.filter((v) => v.kind === "companies_house").length,
  }), [items]);

  // Key-gate
  if (!authKey) {
    return (
      <Layout>
        <div className="mx-auto max-w-md py-12">
          <Card className="p-6">
            <Lock className="h-6 w-6 text-muted-foreground" />
            <h1 className="mt-3 font-display text-xl font-semibold text-foreground">Admin verification queue</h1>
            <p className="mt-1 text-sm text-muted-foreground">Enter the admin key to continue.</p>
            <div className="mt-4 space-y-2">
              <Label htmlFor="admin-key">Admin key</Label>
              <Input
                id="admin-key"
                type="password"
                value={keyInput}
                onChange={(e) => setKeyInput(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") setAuthKey(keyInput); }}
                data-testid="input-admin-key"
              />
              <Button onClick={() => setAuthKey(keyInput)} className="w-full" data-testid="button-unlock">
                Unlock
              </Button>
            </div>
          </Card>
        </div>
      </Layout>
    );
  }

  return (
    <Layout>
      <div className="mx-auto max-w-5xl py-8">
        <div className="flex items-center justify-between">
          <Link href={`/admin?key=${encodeURIComponent(authKey)}`}>
            <Button variant="ghost" size="sm"><ArrowLeft className="mr-1 h-4 w-4" />Admin home</Button>
          </Link>
          <h1 className="font-display text-2xl font-semibold text-foreground">Verifications</h1>
        </div>

        <Card className="mt-4 p-5">
          <div className="flex items-center gap-4 text-sm">
            <Inbox className="h-5 w-5 text-primary" />
            <span><strong>{items.length}</strong> pending</span>
            <span className="text-muted-foreground">·</span>
            <span><ShieldCheck className="mr-1 inline h-3.5 w-3.5 text-primary" />Insurance: <strong>{counts.insurance}</strong></span>
            <span className="text-muted-foreground">·</span>
            <span><FileBadge2 className="mr-1 inline h-3.5 w-3.5 text-primary" />Qualification: <strong>{counts.qualification}</strong></span>
            <span className="text-muted-foreground">·</span>
            <span><Building2 className="mr-1 inline h-3.5 w-3.5 text-primary" />Companies House: <strong>{counts.companiesHouse}</strong></span>
          </div>
        </Card>

        {queueQ.isLoading && <p className="mt-4 text-sm text-muted-foreground">Loading queue…</p>}
        {queueQ.isError && (
          <Card className="mt-4 p-5 text-sm text-destructive">
            Couldn't load queue. The admin key may be invalid.
            <Button variant="ghost" size="sm" className="ml-2 h-auto p-0 text-destructive underline" onClick={() => { setAuthKey(""); setKeyInput(""); }}>
              Re-enter key
            </Button>
          </Card>
        )}

        {!queueQ.isLoading && !queueQ.isError && items.length === 0 && (
          <Card className="mt-4 p-8 text-center text-sm text-muted-foreground">
            Queue is empty — nothing pending. 🎉
          </Card>
        )}

        <div className="mt-4 space-y-3">
          {items.map((v) => {
            const isRejecting = rejectingId === v.id;
            return (
              <Card key={v.id} className="p-5" data-testid={`pending-${v.id}`}>
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      {kindIcon(v.kind)}
                      <span className="font-semibold text-foreground">{kindLabel(v.kind)}</span>
                      <Badge variant="secondary">Tradesman #{v.tradesmanId}</Badge>
                      {v.source && v.source !== "pro_submission" && (
                        <Badge variant="outline" className="capitalize">{v.source.replace(/_/g, " ")}</Badge>
                      )}
                    </div>
                    <div className="mt-1 flex flex-wrap gap-3 text-xs text-muted-foreground">
                      <span>Submitted {fmtDate(v.submittedAt)}</span>
                      {v.kind !== "companies_house" && v.fileMimeType && v.fileSizeBytes != null && (
                        <span>{v.fileMimeType} · {fmtBytes(v.fileSizeBytes)}</span>
                      )}
                      {v.expiryDate && <span>Expires {v.expiryDate}</span>}
                    </div>
                    {v.kind === "insurance" && (
                      <p className="mt-1 text-sm text-foreground">Cover: <strong>{fmtCover(v.insuranceCoverGbp)}</strong></p>
                    )}
                    {v.kind === "qualification" && v.qualificationType && (
                      <p className="mt-1 text-sm text-foreground">Qualification: <strong>{v.qualificationType}</strong></p>
                    )}
                    {v.kind === "companies_house" && (
                      <div className="mt-2 rounded-md border border-border bg-muted/30 p-3 text-sm">
                        {v.evidenceData ? (
                          <>
                            <div className="flex items-center justify-between gap-2">
                              <span className="font-semibold text-foreground">{v.evidenceData.company_name}</span>
                              <Badge
                                variant={v.evidenceData.company_status === "active" ? "secondary" : "destructive"}
                                className="capitalize"
                              >
                                {v.evidenceData.company_status}
                              </Badge>
                            </div>
                            <div className="mt-1 grid gap-1 text-xs text-muted-foreground sm:grid-cols-2">
                              <span><span className="text-foreground">Number:</span> {v.evidenceData.company_number}</span>
                              {v.evidenceData.type && (
                                <span className="capitalize">
                                  <span className="text-foreground">Type:</span> {v.evidenceData.type.replace(/-/g, " ")}
                                </span>
                              )}
                              {v.evidenceData.date_of_creation && (
                                <span><span className="text-foreground">Incorporated:</span> {v.evidenceData.date_of_creation}</span>
                              )}
                              {v.evidenceData.date_of_cessation && (
                                <span><span className="text-foreground">Ceased:</span> {v.evidenceData.date_of_cessation}</span>
                              )}
                              {v.evidenceData.jurisdiction && (
                                <span className="capitalize">
                                  <span className="text-foreground">Jurisdiction:</span> {v.evidenceData.jurisdiction.replace(/-/g, " ")}
                                </span>
                              )}
                              {v.evidenceData.registered_office_address && (
                                <span className="sm:col-span-2">
                                  <span className="text-foreground">Address:</span>{" "}
                                  {[
                                    v.evidenceData.registered_office_address.address_line_1,
                                    v.evidenceData.registered_office_address.address_line_2,
                                    v.evidenceData.registered_office_address.locality,
                                    v.evidenceData.registered_office_address.region,
                                    v.evidenceData.registered_office_address.postal_code,
                                    v.evidenceData.registered_office_address.country,
                                  ].filter(Boolean).join(", ")}
                                </span>
                              )}
                            </div>
                            {v.evidenceData.fetched_at && (
                              <p className="mt-2 text-[11px] text-muted-foreground">
                                Fetched from Companies House at {fmtDate(new Date(v.evidenceData.fetched_at).getTime())}
                              </p>
                            )}
                          </>
                        ) : v.companyNumber ? (
                          <p className="text-sm text-foreground">Company #{v.companyNumber}</p>
                        ) : (
                          <p className="text-sm text-muted-foreground">No evidence captured.</p>
                        )}
                      </div>
                    )}
                  </div>

                  <div className="flex flex-wrap gap-2">
                    {v.kind !== "companies_house" && (
                      <Button variant="outline" size="sm" onClick={() => openFile(v.id)} data-testid={`button-open-${v.id}`}>
                        <ExternalLink className="mr-1 h-4 w-4" />Open file
                      </Button>
                    )}
                    <Button
                      size="sm"
                      onClick={() => decide.mutate({ id: v.id, status: "approved" })}
                      disabled={decide.isPending}
                      data-testid={`button-approve-${v.id}`}
                    >
                      <CheckCircle2 className="mr-1 h-4 w-4" />Approve
                    </Button>
                    <Button
                      variant="destructive"
                      size="sm"
                      onClick={() => { setRejectingId(v.id); setRejectNote(""); }}
                      data-testid={`button-reject-${v.id}`}
                    >
                      <XCircle className="mr-1 h-4 w-4" />Reject
                    </Button>
                  </div>
                </div>

                {isRejecting && (
                  <div className="mt-4 space-y-2 rounded-md border border-border bg-muted/30 p-3">
                    <Label htmlFor={`note-${v.id}`} className="text-sm">
                      Reason (visible to the tradesman, min 5 chars)
                    </Label>
                    <Textarea
                      id={`note-${v.id}`}
                      value={rejectNote}
                      onChange={(e) => setRejectNote(e.target.value)}
                      placeholder="e.g. Document is illegible — please re-upload a clearer scan."
                      rows={3}
                      maxLength={1000}
                      data-testid={`textarea-reject-note-${v.id}`}
                    />
                    <div className="flex gap-2">
                      <Button
                        size="sm"
                        variant="destructive"
                        disabled={decide.isPending || rejectNote.trim().length < 5}
                        onClick={() => decide.mutate({ id: v.id, status: "rejected", reviewerNote: rejectNote.trim() })}
                        data-testid={`button-confirm-reject-${v.id}`}
                      >
                        Confirm rejection
                      </Button>
                      <Button size="sm" variant="ghost" onClick={() => { setRejectingId(null); setRejectNote(""); }}>
                        Cancel
                      </Button>
                    </div>
                  </div>
                )}
              </Card>
            );
          })}
        </div>

        <p className="mt-6 text-xs text-muted-foreground">
          Signed file URLs expire after 5 minutes. Approving an insurance submission flips
          <code className="mx-1 rounded bg-muted px-1 text-[11px]">tradesmen.insured</code>
          to true; approving a qualification submission flips
          <code className="mx-1 rounded bg-muted px-1 text-[11px]">tradesmen.licensed</code>;
          approving a Companies House submission flips
          <code className="mx-1 rounded bg-muted px-1 text-[11px]">tradesmen.verified</code>
          to true.
        </p>
      </div>
    </Layout>
  );
}
