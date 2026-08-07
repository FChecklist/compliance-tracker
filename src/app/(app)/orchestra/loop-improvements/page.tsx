"use client";

export const dynamic = "force-dynamic";

// VERIDIAN Review Framework gap closure (Continuous Software Evolution,
// High, 2026-08-07): the first customer-facing surface for loopImprovements
// -- before this wave, every row was write-only (see loop-improvement-
// review-service.ts's own header for the full history). veridian_admin-
// gated at the API layer, same posture as /capability-improvements -- this
// page mirrors that one's shape deliberately (same review-queue pattern:
// filter -> card list -> approve/dismiss dialog with a required reason on
// the negative action).
import { useEffect, useState, useCallback } from "react";
import { toast } from "sonner";
import Link from "next/link";
import { ArrowLeft, RefreshCw, CheckCircle2, XCircle, Loader2 } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

type LoopImprovement = {
  id: string;
  loopId: string;
  improvementType: string;
  targetType: string;
  targetId: string | null;
  beforeState: Record<string, unknown> | null;
  afterState: Record<string, unknown> | null;
  improvementDelta: string | null;
  isDeployed: boolean;
  reviewDecision: "approved" | "dismissed" | null;
  reviewedBy: string | null;
  reviewedAt: string | null;
  reviewNotes: string | null;
  createdAt: string;
};

const FILTERS = ["pending", "approved", "dismissed", "all"] as const;

const DECISION_BADGE_VARIANT: Record<string, "default" | "secondary" | "outline"> = {
  approved: "default",
  dismissed: "outline",
};

function StateBlock({ label, state }: { label: string; state: Record<string, unknown> | null }) {
  if (!state || Object.keys(state).length === 0) return null;
  return (
    <div className="border border-ct-border rounded-lg p-2.5 bg-ct-row-hover">
      <p className="text-[11px] font-semibold text-ct-navy mb-1">{label}</p>
      <pre className="text-[11px] text-ct-muted whitespace-pre-wrap break-words">{JSON.stringify(state, null, 2)}</pre>
    </div>
  );
}

export default function LoopImprovementsPage() {
  const [filter, setFilter] = useState<(typeof FILTERS)[number]>("pending");
  const [improvements, setImprovements] = useState<LoopImprovement[]>([]);
  const [loading, setLoading] = useState(true);
  const [forbidden, setForbidden] = useState(false);

  const [actionTarget, setActionTarget] = useState<{ item: LoopImprovement; kind: "approve" | "dismiss" } | null>(null);
  const [notes, setNotes] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    const res = await fetch(`/api/orchestra/loop-improvements?filter=${filter}`);
    if (res.status === 403) { setForbidden(true); setLoading(false); return; }
    const data = await res.json();
    setImprovements(data.improvements ?? []);
    setLoading(false);
  }, [filter]);

  useEffect(() => { load(); }, [load]);

  function openAction(item: LoopImprovement, kind: "approve" | "dismiss") {
    setActionTarget({ item, kind });
    setNotes("");
  }

  async function submitAction() {
    if (!actionTarget) return;
    const { item, kind } = actionTarget;
    if (kind === "dismiss" && notes.trim().length < 10) { toast.error("A reason of at least 10 characters is required to dismiss"); return; }

    setSubmitting(true);
    const res = await fetch(`/api/orchestra/loop-improvements/${item.id}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: kind, notes: notes.trim() || undefined }),
    });
    setSubmitting(false);
    if (!res.ok) { toast.error((await res.json()).error ?? `Failed to ${kind} proposal`); return; }
    toast.success(kind === "approve" ? "Marked as worth acting on" : "Dismissed");
    setActionTarget(null);
    load();
  }

  if (forbidden) {
    return <p className="text-sm text-ct-muted">This page is only available to VERIDIAN platform admins.</p>;
  }

  return (
    <div className="space-y-4">
      <div>
        <Link href="/orchestra" className="text-xs text-ct-muted hover:text-ct-navy flex items-center gap-1 mb-2">
          <ArrowLeft className="size-3" /> Back to VERIDIAN AI Orchestra
        </Link>
        <div className="flex items-center gap-2">
          <RefreshCw className="size-5 text-ct-saffron" />
          <div>
            <h1 className="text-2xl font-heading text-ct-navy">Loop Improvement Review</h1>
            <p className="text-sm text-ct-muted mt-1">
              What the platform&apos;s self-improvement loops observed and proposed -- every row here was write-only until this queue existed. Approving records that a human agrees it&apos;s worth acting on; it does not auto-apply anything.
            </p>
          </div>
        </div>
      </div>

      <Select value={filter} onValueChange={(v) => setFilter(v as typeof filter)}>
        <SelectTrigger className="w-48"><SelectValue /></SelectTrigger>
        <SelectContent>
          {FILTERS.map((f) => <SelectItem key={f} value={f}>{f === "all" ? "All decisions" : f}</SelectItem>)}
        </SelectContent>
      </Select>

      {loading ? (
        <div className="text-center text-ct-muted p-10">Loading…</div>
      ) : improvements.length === 0 ? (
        <p className="text-sm text-ct-muted">Nothing in this filter.</p>
      ) : (
        <div className="space-y-3">
          {improvements.map((item) => (
            <Card key={item.id} className="rounded-xl shadow-card bg-white">
              <CardContent className="pt-5 space-y-3">
                <div className="flex items-center justify-between flex-wrap gap-2">
                  <div>
                    <p className="text-sm font-semibold text-ct-navy">{item.improvementType}</p>
                    <p className="text-xs text-ct-muted">
                      loop: {item.loopId} · target: {item.targetType}{item.targetId ? ` (${item.targetId})` : ""}
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    {item.improvementDelta !== null && <Badge variant="secondary" className="text-xs">Δ {item.improvementDelta}</Badge>}
                    {item.reviewDecision && <Badge variant={DECISION_BADGE_VARIANT[item.reviewDecision]} className="text-xs">{item.reviewDecision}</Badge>}
                    {item.isDeployed && <Badge className="text-xs">deployed</Badge>}
                  </div>
                </div>

                <div className="grid sm:grid-cols-2 gap-2">
                  <StateBlock label="Before" state={item.beforeState} />
                  <StateBlock label="After" state={item.afterState} />
                </div>

                {item.reviewDecision && (
                  <p className="text-xs text-ct-muted">
                    {item.reviewDecision === "approved" ? "Approved" : "Dismissed"} by {item.reviewedBy ?? "unknown"} on {item.reviewedAt ? new Date(item.reviewedAt).toLocaleString() : "?"}
                    {item.reviewNotes ? ` — ${item.reviewNotes}` : ""}
                  </p>
                )}

                {!item.reviewDecision && (
                  <div className="flex items-center gap-2 pt-1">
                    <Button size="sm" onClick={() => openAction(item, "approve")} className="bg-ct-teal hover:bg-ct-teal/90">
                      <CheckCircle2 className="size-4 mr-1" /> Approve (worth acting on)
                    </Button>
                    <Button size="sm" variant="outline" onClick={() => openAction(item, "dismiss")}>
                      <XCircle className="size-4 mr-1" /> Dismiss
                    </Button>
                  </div>
                )}
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <Dialog open={actionTarget !== null} onOpenChange={(open) => !open && setActionTarget(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{actionTarget?.kind === "approve" ? "Approve proposal" : "Dismiss proposal"}</DialogTitle>
          </DialogHeader>
          <div className="space-y-2">
            <Label>{actionTarget?.kind === "dismiss" ? "Reason (at least 10 characters)" : "Notes (optional)"}</Label>
            <Textarea rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder={actionTarget?.kind === "dismiss" ? "Why this isn't being acted on" : "Any context for the record"} />
          </div>
          <DialogFooter>
            <Button onClick={submitAction} disabled={submitting}>
              {submitting ? <Loader2 className="size-4 mr-2 animate-spin" /> : null}
              {actionTarget?.kind === "approve" ? "Approve" : "Dismiss"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
