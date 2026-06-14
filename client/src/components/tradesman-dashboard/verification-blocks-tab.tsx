/**
 * VerificationBlocksTab — Manage permanently-blocked homeowner emails.
 *
 * Blocks are loaded from the server on mount and survive page reloads.
 *
 * Endpoints used:
 *   GET    /api/tradesmen/:id/verification-blocks            → { blocks: Block[] }
 *   POST   /api/tradesmen/:id/verification-blocks            body: { email, reason? }
 *   DELETE /api/tradesmen/:id/verification-blocks/:blockId
 */
import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import { Ban, Trash2, Info } from "lucide-react";

interface Block {
  id: number;
  tradesmanId: number;
  homeownerEmail: string;
  createdAt: number;
  reason: string | null;
}

interface Props {
  tradesmanId: number;
  /** Optional pre-filled email (e.g. from "Also block this email" in requests tab) */
  defaultEmail?: string;
}

export function VerificationBlocksTab({ tradesmanId, defaultEmail }: Props) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const queryKey = ["/api/tradesmen", tradesmanId, "verification-blocks"];

  const { data, isLoading, isError } = useQuery<Block[]>({
    queryKey,
    queryFn: async () => {
      const res = await apiRequest(
        "GET",
        `/api/tradesmen/${tradesmanId}/verification-blocks`,
      );
      const body = (await res.json()) as { blocks: Block[] };
      return body.blocks ?? [];
    },
  });

  const blocks = data ?? [];

  const [email, setEmail] = useState(defaultEmail ?? "");
  const [reason, setReason] = useState("");

  // Keep email input in sync if the parent passes a new defaultEmail
  // (e.g. operator clicks "Also block this email" from the requests tab).
  useEffect(() => {
    if (defaultEmail) setEmail(defaultEmail);
  }, [defaultEmail]);

  const addBlock = useMutation({
    mutationFn: async () => {
      const body: Record<string, unknown> = { email: email.trim().toLowerCase() };
      if (reason.trim()) body.reason = reason.trim();
      const res = await apiRequest(
        "POST",
        `/api/tradesmen/${tradesmanId}/verification-blocks`,
        body,
      );
      return res.json() as Promise<Block>;
    },
    onSuccess: (block) => {
      // Optimistically prepend, then invalidate to re-sync from server
      queryClient.setQueryData<Block[]>(queryKey, (prev) => {
        const existing = prev ?? [];
        // Avoid dupes if the server normalised the email to one already in the list
        if (existing.some((b) => b.id === block.id)) return existing;
        return [block, ...existing];
      });
      queryClient.invalidateQueries({ queryKey });
      toast({
        title: "Email blocked",
        description: `${block.homeownerEmail} will no longer be able to request your verification details.`,
      });
      setEmail("");
      setReason("");
    },
    onError: (e: any) => {
      let msg = "Could not block email. Please try again.";
      // Try to surface field error from server
      if (e?.message?.startsWith("4")) {
        msg = "Please enter a valid email address.";
      }
      toast({ title: "Block failed", description: msg, variant: "destructive" });
    },
  });

  const removeBlock = useMutation({
    mutationFn: async (blockId: number) => {
      await apiRequest(
        "DELETE",
        `/api/tradesmen/${tradesmanId}/verification-blocks/${blockId}`,
      );
      return blockId;
    },
    onSuccess: (blockId) => {
      queryClient.setQueryData<Block[]>(queryKey, (prev) =>
        (prev ?? []).filter((b) => b.id !== blockId),
      );
      queryClient.invalidateQueries({ queryKey });
      toast({ title: "Block removed" });
    },
    onError: () => {
      toast({ title: "Could not remove block. Please try again.", variant: "destructive" });
    },
  });

  return (
    <div className="space-y-5">
      {/* Add block form */}
      <Card className="p-5">
        <h3 className="font-display text-base font-semibold text-foreground">
          Block an email
        </h3>
        <p className="mt-1 text-sm text-muted-foreground">
          Blocked emails cannot send verification requests and any active access
          is revoked immediately. This is permanent until you remove the block.
        </p>

        <div className="mt-4 space-y-3">
          <div>
            <Label htmlFor="block-email" className="text-sm">Email address</Label>
            <Input
              id="block-email"
              type="email"
              placeholder="homeowner@example.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              disabled={addBlock.isPending}
              className="mt-1.5"
              data-testid="input-block-email"
            />
          </div>
          <div>
            <Label htmlFor="block-reason" className="text-sm">
              Reason <span className="font-normal text-muted-foreground">(optional, private)</span>
            </Label>
            <Input
              id="block-reason"
              type="text"
              placeholder="e.g. Repeated unsolicited requests"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              disabled={addBlock.isPending}
              maxLength={500}
              className="mt-1.5"
              data-testid="input-block-reason"
            />
          </div>
          <Button
            onClick={() => addBlock.mutate()}
            disabled={addBlock.isPending || !email.trim()}
            variant="destructive"
            size="sm"
            data-testid="button-add-block"
          >
            <Ban className="mr-1.5 h-4 w-4" />
            {addBlock.isPending ? "Blocking…" : "Block email"}
          </Button>
        </div>
      </Card>

      {/* List */}
      <Card className="p-5">
        <h3 className="font-display text-base font-semibold text-foreground">
          Blocked emails
          {blocks.length > 0 && (
            <Badge variant="secondary" className="ml-2">
              {blocks.length}
            </Badge>
          )}
        </h3>

        {isLoading ? (
          <p className="mt-4 text-sm text-muted-foreground" data-testid="blocks-loading">
            Loading…
          </p>
        ) : isError ? (
          <div
            className="mt-4 flex items-start gap-2 rounded-md border border-dashed border-destructive/40 bg-destructive/5 p-4 text-sm text-destructive"
            data-testid="blocks-error"
          >
            <Info className="mt-0.5 h-4 w-4 shrink-0" />
            <span>
              Could not load your blocked emails. Refresh the page to try again.
            </span>
          </div>
        ) : blocks.length === 0 ? (
          <div className="mt-4 flex items-start gap-2 rounded-md border border-dashed border-border bg-muted/20 p-4 text-sm text-muted-foreground">
            <Info className="mt-0.5 h-4 w-4 shrink-0" />
            <span>
              No emails blocked yet. Blocks you add above will appear here.
            </span>
          </div>
        ) : (
          <div className="mt-3 space-y-2">
            {blocks.map((block) => (
              <div
                key={block.id}
                className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-border p-3 text-sm"
                data-testid={`block-row-${block.id}`}
              >
                <div className="min-w-0">
                  <p className="break-all font-medium text-foreground">
                    {block.homeownerEmail}
                  </p>
                  {block.reason && (
                    <p className="mt-0.5 text-xs text-muted-foreground">
                      {block.reason}
                    </p>
                  )}
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    Blocked {new Date(block.createdAt).toLocaleDateString("en-GB", { dateStyle: "medium" })}
                  </p>
                </div>
                <Button
                  size="sm"
                  variant="ghost"
                  className="text-destructive hover:text-destructive"
                  onClick={() => removeBlock.mutate(block.id)}
                  disabled={removeBlock.isPending}
                  data-testid={`button-unblock-${block.id}`}
                >
                  <Trash2 className="mr-1 h-3.5 w-3.5" />
                  Unblock
                </Button>
              </div>
            ))}
          </div>
        )}
      </Card>
    </div>
  );
}
