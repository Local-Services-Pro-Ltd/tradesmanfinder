// Admin dialog for issuing a Warning / Yellow / Red card to a tradesman.
// Supports auto-escalation (football rule) and the gross-misconduct instant-Red toggle.
import { useState } from "react";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Checkbox } from "@/components/ui/checkbox";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { AlertTriangle, Square, Ban, Wand2 } from "lucide-react";
import type { Tradesman } from "@/lib/api-types";

type CardType = "auto" | "warning" | "yellow" | "red";

interface Props {
  tradesman: Pick<Tradesman, "id" | "businessName">;
  adminKey: string;
  trigger?: React.ReactNode;        // optional custom trigger button
  onIssued?: () => void;
}

export function IssueCardDialog({ tradesman, adminKey, trigger, onIssued }: Props) {
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [cardType, setCardType] = useState<CardType>("auto");
  const [reason, setReason] = useState("");
  const [grossMisconduct, setGrossMisconduct] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const submit = async () => {
    if (reason.trim().length < 5) {
      toast({ title: "Reason required", description: "Please give a reason of at least 5 characters.", variant: "destructive" });
      return;
    }
    setSubmitting(true);
    try {
      const res = await apiRequest(
        "POST",
        `/api/admin/tradesmen/${tradesman.id}/cards?key=${encodeURIComponent(adminKey)}`,
        { cardType: grossMisconduct ? "red" : cardType, reason: reason.trim(), grossMisconduct },
      );
      const data = await res.json();
      const issuedType = data.card?.cardType ?? cardType;
      toast({
        title: grossMisconduct
          ? `Red card issued (gross misconduct)`
          : `${issuedType === "red" ? "Red" : issuedType === "yellow" ? "Yellow" : "Warning"} card issued`,
        description: `${tradesman.businessName} has been carded. Logged with reason.`,
      });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/overview"] });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/moderation/overview"] });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/moderation/log"] });
      queryClient.invalidateQueries({ queryKey: ["/api/tradesmen"] });
      queryClient.invalidateQueries({ queryKey: ["/api/tradesmen/by-slug"] });
      setOpen(false);
      setReason("");
      setCardType("auto");
      setGrossMisconduct(false);
      onIssued?.();
    } catch (e: any) {
      let msg = "Action failed";
      try { msg = (await e?.response?.json?.())?.message || msg; } catch {}
      toast({ title: msg, variant: "destructive" });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        {trigger ?? (
          <Button size="sm" variant="outline" data-testid={`button-issue-card-${tradesman.id}`}>
            <AlertTriangle className="mr-1 h-4 w-4" /> Issue card
          </Button>
        )}
      </DialogTrigger>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Issue card to {tradesman.businessName}</DialogTitle>
          <DialogDescription>
            Issue a card only for a <strong>substantiated customer complaint</strong> or a
            verified negative review. The action is logged and the badge appears on the public
            profile (Name &amp; Shame). The written reason is private to admin and the
            tradesman — customers only see the badge colour.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-5 py-2">
          <div>
            <Label className="text-sm font-semibold">Card type</Label>
            <RadioGroup
              value={grossMisconduct ? "red" : cardType}
              onValueChange={(v) => setCardType(v as CardType)}
              disabled={grossMisconduct}
              className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-2"
            >
              <Label htmlFor="ct-auto" className="flex cursor-pointer items-start gap-3 rounded-md border border-border p-3 has-[:checked]:border-primary has-[:checked]:bg-primary/5">
                <RadioGroupItem id="ct-auto" value="auto" data-testid="radio-card-auto" />
                <div>
                  <div className="flex items-center gap-1.5 font-medium"><Wand2 className="h-4 w-4" /> Auto-escalate</div>
                  <p className="text-xs text-muted-foreground">3-strike rule: 1st = Warning, 2nd = Yellow, 3rd = Red (strike-off).</p>
                </div>
              </Label>
              <Label htmlFor="ct-warning" className="flex cursor-pointer items-start gap-3 rounded-md border border-border p-3 has-[:checked]:border-primary has-[:checked]:bg-primary/5">
                <RadioGroupItem id="ct-warning" value="warning" data-testid="radio-card-warning" />
                <div>
                  <div className="flex items-center gap-1.5 font-medium"><AlertTriangle className="h-4 w-4 text-amber-600" /> Warning</div>
                  <p className="text-xs text-muted-foreground">Badge only. Expires 6 months.</p>
                </div>
              </Label>
              <Label htmlFor="ct-yellow" className="flex cursor-pointer items-start gap-3 rounded-md border border-border p-3 has-[:checked]:border-primary has-[:checked]:bg-primary/5">
                <RadioGroupItem id="ct-yellow" value="yellow" data-testid="radio-card-yellow" />
                <div>
                  <div className="flex items-center gap-1.5 font-medium"><Square className="h-4 w-4 fill-yellow-400 text-yellow-500" /> Yellow</div>
                  <p className="text-xs text-muted-foreground">7-day match suspension &amp; Featured revoked. Expires 12 months.</p>
                </div>
              </Label>
              <Label htmlFor="ct-red" className="flex cursor-pointer items-start gap-3 rounded-md border border-border p-3 has-[:checked]:border-destructive has-[:checked]:bg-destructive/5">
                <RadioGroupItem id="ct-red" value="red" data-testid="radio-card-red" />
                <div>
                  <div className="flex items-center gap-1.5 font-medium text-destructive"><Ban className="h-4 w-4" /> Red</div>
                  <p className="text-xs text-muted-foreground">Permanent ban. Profile hidden, login blocked.</p>
                </div>
              </Label>
            </RadioGroup>
          </div>

          <Label className="flex cursor-pointer items-start gap-3 rounded-md border border-destructive/40 bg-destructive/5 p-3">
            <Checkbox
              checked={grossMisconduct}
              onCheckedChange={(v) => { setGrossMisconduct(!!v); if (v) setCardType("red"); }}
              data-testid="checkbox-gross-misconduct"
            />
            <div>
              <div className="font-medium text-destructive">Gross misconduct \u2014 instant Red</div>
              <p className="text-xs text-muted-foreground">
                Skip Warning/Yellow and ban immediately. Use only for fraud, abuse, safety issues, or fake reviews.
              </p>
            </div>
          </Label>

          <div>
            <Label htmlFor="card-reason" className="text-sm font-semibold">Reason (required, private)</Label>
            <Textarea
              id="card-reason"
              rows={3}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="e.g. No-show on 2 confirmed jobs in Abbey Wood; customer SD-204 + SD-217."
              data-testid="textarea-card-reason"
              className="mt-1.5"
            />
            <p className="mt-1 text-xs text-muted-foreground">Visible to: admins &amp; the tradesman. Not shown publicly.</p>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)} disabled={submitting}>Cancel</Button>
          <Button
            onClick={submit}
            disabled={submitting || reason.trim().length < 5}
            className={grossMisconduct || cardType === "red" ? "bg-destructive hover:bg-destructive/90" : ""}
            data-testid="button-confirm-issue-card"
          >
            {submitting ? "Issuing\u2026" : grossMisconduct ? "Confirm permanent ban" : "Issue card"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// Rescind dialog
export function RescindCardDialog({
  cardId, cardLabel, adminKey, trigger,
}: { cardId: number; cardLabel: string; adminKey: string; trigger?: React.ReactNode }) {
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const submit = async () => {
    if (reason.trim().length < 5) {
      toast({ title: "Reason required", description: "Please explain why this card is being rescinded.", variant: "destructive" });
      return;
    }
    setSubmitting(true);
    try {
      await apiRequest("POST", `/api/admin/cards/${cardId}/rescind?key=${encodeURIComponent(adminKey)}`, { reason: reason.trim() });
      toast({ title: "Card rescinded", description: "The card is no longer in effect." });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/moderation/overview"] });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/moderation/log"] });
      queryClient.invalidateQueries({ queryKey: ["/api/tradesmen"] });
      setOpen(false);
      setReason("");
    } catch {
      toast({ title: "Action failed", variant: "destructive" });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        {trigger ?? <Button size="sm" variant="ghost">Rescind</Button>}
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Rescind {cardLabel}</DialogTitle>
          <DialogDescription>
            This card will no longer be active. The audit log will record the rescind action with the reason below.
          </DialogDescription>
        </DialogHeader>
        <div className="py-2">
          <Label htmlFor="rescind-reason" className="text-sm font-semibold">Reason for rescind</Label>
          <Textarea
            id="rescind-reason"
            rows={3}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="e.g. Appeal upheld \u2014 customer SD-204 confirmed they cancelled the job."
            data-testid="textarea-rescind-reason"
            className="mt-1.5"
          />
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)} disabled={submitting}>Cancel</Button>
          <Button onClick={submit} disabled={submitting || reason.trim().length < 5} data-testid="button-confirm-rescind">
            {submitting ? "Rescinding\u2026" : "Confirm rescind"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
