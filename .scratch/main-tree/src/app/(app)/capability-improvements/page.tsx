"use client";

export const dynamic = "force-dynamic";

// Priority 12 (OPEN-07 point 5): the first customer-facing surface for
// capability_improvement_proposals -- before this wave, closeImprovementLoop()
// (capability-audit-service.ts) was the ONLY way a proposal ever got closed,
// and it was manual/human-only with no UI or API to even see an open
// proposal, read the Auditor's findings, or act on them. veridian_admin-
// gated at the API layer (same posture as /prompt-eval, /sales-hq) -- this
// page is reachable by any signed-in user but every action 403s for a
// non-admin.
//
// dispatchOutput: a separate, not-yet-merged parallel PR's column (per this
// wave's own tracker note) -- confirmed via direct DB inspection that its
// migration was already applied live to the shared Supabase project before
// this schema.ts change landed, so schema.ts declares it now (Drizzle's
// query API only selects declared columns) even though no migration file
// for it exists in this branch's own drizzle/ history yet -- see schema.ts's
// own comment on capabilityImprovementProposals.dispatchOutput. Still
// rendered defensively here (`{p.dispatchOutput &&  ...}`) since most rows
// predate that PR and will have it null.
import { useEffect, useState, useCallback } from "react";
import { toast } from "sonner";
import { Wrench, Loader2, CheckCircle2, XCircle, Link2 } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

type Proposal = {
  id: string;
  capabilityId: string;
  capabilityVersion: number;
  findings: Record<string, string>;
  existingAssetMatch: { assetId: string; name: string; sourceTable: string; sourceId: string; assetType: string } | null;
  occurrenceCount: number;
  status: "open" | "dispatched" | "resolved" | "rejected";
  dispatchedToRole: string | null;
  dispatchedAt: string | null;
  prUrl: string | null;
  rejectionReason: string | null;
  dispatchOutput?: string | null; // optional -- see module header
  createdAt: string;
  updatedAt: string;
  capability: { capabilityKey: string; modePill: string | null; pathKeys: unknown } | null;
};

const STATUS_FILTERS = ["all", "open", "dispatched", "resolved", "rejected"] as const;

const STATUS_BADGE_VARIANT: Record<Proposal["status"], "default" | "secondary" | "outline"> = {
  open: "outline",
  dispatched: "secondary",
  resolved: "default",
  rejected: "outline",
};

export default function CapabilityImprovementsPage() {
  const [statusFilter, setStatusFilter] = useState<(typeof STATUS_FILTERS)[number]>("open");
  const [proposals, setProposals] = useState<Proposal[]>([]);
  const [loading, setLoading] = useState(true);
  const [forbidden, setForbidden] = useState(false);

  const [actionTarget, setActionTarget] = useState<{ proposal: Proposal; kind: "close" | "reject" } | null>(null);
  const [prUrl, setPrUrl] = useState("");
  const [reason, setReason] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    const qs = statusFilter === "all" ? "" : `?status=${statusFilter}`;
    const res = await fetch(`/api/ai/team/capability-improvements${qs}`);
    if (res.status === 403) { setForbidden(true); setLoading(false); return; }
    const data = await res.json();
    setProposals(data.proposals ?? []);
    setLoading(false);
  }, [statusFilter]);

  useEffect(() => { load(); }, [load]);

  function openAction(proposal: Proposal, kind: "close" | "reject") {
    setActionTarget({ proposal, kind });
    setPrUrl("");
    setReason("");
  }

  async function submitAction() {
    if (!actionTarget) return;
    const { proposal, kind } = actionTarget;
    if (kind === "close" && !prUrl.trim()) { toast.error("A PR URL is required to close a proposal"); return; }
    if (kind === "reject" && reason.trim().length < 10) { toast.error("A reason of at least 10 characters is required"); return; }

    setSubmitting(true);
    const res = await fetch(`/api/ai/team/capability-improvements/${proposal.id}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(kind === "close" ? { action: "close", prUrl: prUrl.trim() } : { action: "reject", reason: reason.trim() }),
    });
    setSubmitting(false);
    if (!res.ok) { toast.error((await res.json()).error ?? `Failed to ${kind} proposal`); return; }
    toast.success(kind === "close" ? "Proposal resolved" : "Proposal rejected");
    setActionTarget(null);
    load();
  }

  if (forbidden) {
    return <p className="text-sm text-ct-muted">This page is only available to VERIDIAN platform admins.</p>;
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <Wrench className="size-5 text-ct-saffron" />
        <div>
          <h1 className="text-2xl font-heading text-ct-navy">Capability Improvements</h1>
          <p className="text-sm text-ct-muted mt-1">
            What the Auditor -&gt; Higher AI loop found and did about it -- every real capability-coverage gap the platform has flagged, dispatched, resolved, or rejected. Nothing here is auto-closed; every resolution is a human decision.
          </p>
        </div>
      </div>

      <Select value={statusFilter} onValueChange={(v) => setStatusFilter(v as typeof statusFilter)}>
        <SelectTrigger className="w-56"><SelectValue /></SelectTrigger>
        <SelectContent>
          {STATUS_FILTERS.map((s) => <SelectItem key={s} value={s}>{s === "all" ? "All statuses" : s}</SelectItem>)}
        </SelectContent>
      </Select>

      {loading ? (
        <div className="text-center text-ct-muted p-10">Loading…</div>
      ) : proposals.length === 0 ? (
        <p className="text-sm text-ct-muted">No proposals in this status.</p>
      ) : (
        <div className="space-y-3">
          {proposals.map((p) => (
            <Card key={p.id} className="rounded-xl shadow-card bg-white">
              <CardContent className="pt-5 space-y-3">
                <div className="flex items-center justify-between flex-wrap gap-2">
                  <div>
                    <p className="text-sm font-semibold text-ct-navy">
                      {p.capability?.capabilityKey ?? p.capabilityId} <span className="text-ct-muted font-normal">v{p.capabilityVersion}</span>
                    </p>
                    {p.capability?.modePill && <p className="text-xs text-ct-muted">Mode pill: {p.capability.modePill}</p>}
                  </div>
                  <div className="flex items-center gap-2">
                    <Badge variant="secondary" className="text-xs">{p.occurrenceCount}x occurrence</Badge>
                    <Badge variant={STATUS_BADGE_VARIANT[p.status]} className="text-xs">{p.status}</Badge>
                  </div>
                </div>

                <div className="space-y-1">
                  {Object.entries(p.findings ?? {}).map(([key, value]) => (
                    <p key={key} className="text-xs text-ct-navy"><span className="font-semibold">{key}:</span> {value}</p>
                  ))}
                </div>

                {p.existingAssetMatch && (
                  <p className="text-xs text-ct-muted flex items-center gap-1">
                    <Link2 className="size-3" /> Possibly already exists: {p.existingAssetMatch.name} ({p.existingAssetMatch.assetType})
                  </p>
                )}

                {p.dispatchOutput && (
                  <div className="border border-ct-border rounded-lg p-3 bg-ct-row-hover">
                    <p className="text-xs font-semibold text-ct-navy mb-1">Dispatch output</p>
                    <p className="text-xs text-ct-muted whitespace-pre-wrap">{p.dispatchOutput}</p>
                  </div>
                )}

                {p.status === "resolved" && p.prUrl && (
                  <p className="text-xs text-ct-muted">Resolved via <a href={p.prUrl} target="_blank" rel="noopener noreferrer" className="underline">{p.prUrl}</a></p>
                )}
                {p.status === "rejected" && p.rejectionReason && (
                  <p className="text-xs text-ct-muted">Rejected: {p.rejectionReason}</p>
                )}

                {(p.status === "open" || p.status === "dispatched") && (
                  <div className="flex items-center gap-2 pt-1">
                    <Button size="sm" onClick={() => openAction(p, "close")} className="bg-ct-teal hover:bg-ct-teal/90">
                      <CheckCircle2 className="size-4 mr-1" /> Close (resolved)
                    </Button>
                    <Button size="sm" variant="outline" onClick={() => openAction(p, "reject")}>
                      <XCircle className="size-4 mr-1" /> Reject
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
            <DialogTitle>{actionTarget?.kind === "close" ? "Close proposal as resolved" : "Reject proposal"}</DialogTitle>
          </DialogHeader>
          {actionTarget?.kind === "close" ? (
            <div className="space-y-2">
              <Label>PR URL</Label>
              <Input value={prUrl} onChange={(e) => setPrUrl(e.target.value)} placeholder="https://github.com/FChecklist/compliance-tracker/pull/..." />
            </div>
          ) : (
            <div className="space-y-2">
              <Label>Reason (at least 10 characters)</Label>
              <Textarea rows={3} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Why this finding isn't being acted on" />
            </div>
          )}
          <DialogFooter>
            <Button onClick={submitAction} disabled={submitting}>
              {submitting ? <Loader2 className="size-4 mr-2 animate-spin" /> : null}
              {actionTarget?.kind === "close" ? "Close" : "Reject"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
