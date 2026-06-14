/**
 * VerificationRequestsTab — Tradesman-side queue for homeowner verification
 * access requests.
 *
 * Two sections:
 *   1. Pending    — Approve / Deny with optional note / "Also block this email"
 *   2. Recent     — Status badge + Revoke for granted rows
 *
 * Endpoints:
 *   GET  /api/tradesmen/:id/verification-requests  → list (requireSelf)
 *   POST /api/tradesmen/:id/verification-requests/:reqId/decide
 *        body: { decision: 'granted'|'denied'|'revoked', notes? }
 */
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import { timeAgo } from "@/lib/api-types";
import { CheckCircle2, XCircle, Clock, ShieldOff, Info } from "lucide-react";

// Mirror the DB shape from shared/schema.ts VerificationAccessRequest
interface AccessRequest {
  id: number;
  homeownerEmail: string;
  tradesmanId: number;
  status: "pending" | "granted" | "denied" | "revoked";
  requestedAt: number;
  decidedAt: number | null;
  grantedUntil: number | null;
  revokedAt: number | null;
  notes: string | null;
}

function StatusBadge({ status }: { status: AccessRequest["status"] }) {
  switch (status) {
    case "granted":
      return (
        <Badge className="bg-trust/15 text-trust hover:bg-trust/20">
          <CheckCircle2 className="mr-1 h-3 w-3" /> Granted
        </Badge>
      );
    case "denied":
      return (
        <Badge variant="destructive">
          <XCircle className="mr-1 h-3 w-3" /> Denied
        </Badge>
      );
    case "revoked":
      return (
        <Badge variant="secondary">
          <ShieldOff className="mr-1 h-3 w-3" /> Revoked
        </Badge>
      );
    default:
      return (
        <Badge variant="secondary">
          <Clock className="mr-1 h-3 w-3" /> Pending
        </Badge>
      );
  }
}

function PendingRow({
  req,
  tradesmanId,
  onBlock,
}: {
  req: AccessRequest;
  tradesmanId: number;
  onBlock: (email: string) => void;
}) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [denyOpen, setDenyOpen] = useState(false);
  const [notes, setNotes] = useState("");

  const decide = useMutation({
    mutationFn: async ({
      decision,
      noteText,
    }: {
      decision: "granted" | "denied";
      noteText?: string;
    }) => {
      const body: Record<string, unknown> = { decision };
      if (noteText) body.notes = noteText;
      const res = await apiRequest(
        "POST",
        `/api/tradesmen/${tradesmanId}/verification-requests/${req.id}/decide`,
        body,
      );
      return res.json();
    },
    onSuccess: (_, { decision }) => {
      toast({
        title: decision === "granted" ? "Access granted" : "Request denied",
        description:
          decision === "granted"
            ? `${req.homeownerEmail} can now view your verification details for 7 days.`
            : `${req.homeownerEmail} has been notified.`,
      });
      queryClient.invalidateQueries({
        queryKey: ["/api/tradesmen", tradesmanId, "verification-requests"],
      });
      setDenyOpen(false);
      setNotes("");
    },
    onError: () => {
      toast({
        title: "Action failed",
        description: "Please try again.",
        variant: "destructive",
      });
    },
  });

  return (
    <div
      className="rounded-md border border-border p-4"
      data-testid={`request-pending-${req.id}`}
    >
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="break-all text-sm font-medium text-foreground">
            {req.homeownerEmail}
          </p>
          <p className="mt-0.5 text-xs text-muted-foreground">
            Requested {timeAgo(req.requestedAt)}
          </p>
        </div>
        <StatusBadge status={req.status} />
      </div>

      {/* Action row */}
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <Button
          size="sm"
          onClick={() => decide.mutate({ decision: "granted" })}
          disabled={decide.isPending}
          data-testid={`button-approve-${req.id}`}
        >
          <CheckCircle2 className="mr-1 h-3.5 w-3.5" />
          {decide.isPending ? "Approving…" : "Approve"}
        </Button>

        {!denyOpen ? (
          <Button
            size="sm"
            variant="outline"
            onClick={() => setDenyOpen(true)}
            disabled={decide.isPending}
            data-testid={`button-deny-${req.id}`}
          >
            <XCircle className="mr-1 h-3.5 w-3.5" /> Deny
          </Button>
        ) : (
          <div className="w-full space-y-2 pt-1">
            <Textarea
              rows={2}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Optional note to homeowner (visible to them)"
              className="text-sm"
              data-testid={`textarea-deny-notes-${req.id}`}
            />
            <div className="flex gap-2">
              <Button
                size="sm"
                variant="destructive"
                onClick={() => decide.mutate({ decision: "denied", noteText: notes.trim() || undefined })}
                disabled={decide.isPending}
                data-testid={`button-confirm-deny-${req.id}`}
              >
                {decide.isPending ? "Denying…" : "Confirm deny"}
              </Button>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => { setDenyOpen(false); setNotes(""); }}
                disabled={decide.isPending}
              >
                Cancel
              </Button>
            </div>
          </div>
        )}

        <button
          type="button"
          onClick={() => onBlock(req.homeownerEmail)}
          className="ml-auto text-xs text-muted-foreground underline underline-offset-2 hover:text-destructive"
          data-testid={`link-block-email-${req.id}`}
        >
          Also block this email
        </button>
      </div>
    </div>
  );
}

function RecentRow({
  req,
  tradesmanId,
}: {
  req: AccessRequest;
  tradesmanId: number;
}) {
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const isActiveGrant =
    req.status === "granted" &&
    req.grantedUntil != null &&
    req.grantedUntil > Date.now();

  const revoke = useMutation({
    mutationFn: async () => {
      const res = await apiRequest(
        "POST",
        `/api/tradesmen/${tradesmanId}/verification-requests/${req.id}/decide`,
        { decision: "revoked" },
      );
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "Access revoked", description: `${req.homeownerEmail}'s access has been removed.` });
      queryClient.invalidateQueries({
        queryKey: ["/api/tradesmen", tradesmanId, "verification-requests"],
      });
    },
    onError: () => {
      toast({ title: "Revoke failed", description: "Please try again.", variant: "destructive" });
    },
  });

  return (
    <div
      className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-border p-3 text-sm"
      data-testid={`request-recent-${req.id}`}
    >
      <div className="min-w-0">
        <p className="break-all font-medium text-foreground">{req.homeownerEmail}</p>
        <p className="mt-0.5 text-xs text-muted-foreground">
          {req.decidedAt ? `Decided ${timeAgo(req.decidedAt)}` : `Requested ${timeAgo(req.requestedAt)}`}
          {isActiveGrant && req.grantedUntil && (
            <span className="ml-2 text-trust">
              · access until {new Date(req.grantedUntil).toLocaleDateString("en-GB", { dateStyle: "medium" })}
            </span>
          )}
        </p>
        {req.notes && (
          <p className="mt-1 text-xs text-muted-foreground italic">Note: {req.notes}</p>
        )}
      </div>
      <div className="flex items-center gap-2">
        <StatusBadge status={req.status} />
        {isActiveGrant && (
          <Button
            size="sm"
            variant="outline"
            onClick={() => revoke.mutate()}
            disabled={revoke.isPending}
            data-testid={`button-revoke-${req.id}`}
          >
            {revoke.isPending ? "Revoking…" : "Revoke"}
          </Button>
        )}
      </div>
    </div>
  );
}

interface Props {
  tradesmanId: number;
  /** Called when "Also block this email" is clicked — parent shows blocks tab */
  onBlockRequest?: (email: string) => void;
}

export function VerificationRequestsTab({ tradesmanId, onBlockRequest }: Props) {
  const { data, isLoading } = useQuery<AccessRequest[]>({
    queryKey: ["/api/tradesmen", tradesmanId, "verification-requests"],
    queryFn: async () => {
      const res = await apiRequest(
        "GET",
        `/api/tradesmen/${tradesmanId}/verification-requests`,
      );
      return res.json();
    },
  });

  const list = data ?? [];
  const pending = list.filter((r) => r.status === "pending");
  const recent = list.filter((r) => r.status !== "pending");

  if (isLoading) {
    return (
      <Card className="p-5">
        <p className="text-sm text-muted-foreground">Loading…</p>
      </Card>
    );
  }

  return (
    <div className="space-y-5">
      {/* Pending */}
      <Card className="p-5">
        <h3 className="font-display text-base font-semibold text-foreground">
          Pending requests
          {pending.length > 0 && (
            <span className="ml-2 rounded-full bg-primary/10 px-2 py-0.5 text-xs text-primary">
              {pending.length}
            </span>
          )}
        </h3>
        <p className="mt-1 text-sm text-muted-foreground">
          Homeowners asking to see your insurance and qualification details.
          You decide who sees what — approvals last 7 days.
        </p>

        {pending.length === 0 ? (
          <div className="mt-4 flex items-start gap-2 rounded-md border border-dashed border-border bg-muted/20 p-4 text-sm text-muted-foreground">
            <Info className="mt-0.5 h-4 w-4 shrink-0" />
            <span>No pending requests.</span>
          </div>
        ) : (
          <div className="mt-3 space-y-3">
            {pending.map((req) => (
              <PendingRow
                key={req.id}
                req={req}
                tradesmanId={tradesmanId}
                onBlock={(email) => onBlockRequest?.(email)}
              />
            ))}
          </div>
        )}
      </Card>

      {/* Recent decisions */}
      <Card className="p-5">
        <h3 className="font-display text-base font-semibold text-foreground">
          Recent decisions
        </h3>
        {recent.length === 0 ? (
          <p className="mt-3 text-sm text-muted-foreground">No decisions yet.</p>
        ) : (
          <div className="mt-3 space-y-2">
            {recent.map((req) => (
              <RecentRow key={req.id} req={req} tradesmanId={tradesmanId} />
            ))}
          </div>
        )}
      </Card>
    </div>
  );
}
