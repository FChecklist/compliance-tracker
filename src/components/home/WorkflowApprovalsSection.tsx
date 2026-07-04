"use client";

// Wave 51 (shared Approval Workflow Engine): a second, distinct queue from
// ApprovalTab's existing single-step approvalRequests -- this shows
// multi-step workflow instances (e.g. ERP journal entries routed through
// an org-configured approval chain) that this user's role qualifies to
// act on. Kept as its own component/section rather than merged into
// ApprovalTab since the two are genuinely different data shapes (a step
// here can require a quorum of approvals, not just one decision).
import { useEffect, useState } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";

type PendingStep = {
  id: string;
  approverRole: string;
  requiredApprovals: number;
  approvalsReceived: number;
  instance: { entityType: string; entityId: string };
};

export function WorkflowApprovalsSection() {
  const [pending, setPending] = useState<PendingStep[]>([]);
  const [loading, setLoading] = useState(true);
  const [decidingId, setDecidingId] = useState<string | null>(null);

  const load = () => {
    fetch("/api/approval-workflows/pending").then((r) => r.json()).then((d) => { setPending(d.pending ?? []); setLoading(false); }).catch(() => setLoading(false));
  };
  useEffect(load, []);

  const decide = async (id: string, decision: "approved" | "rejected") => {
    const comment = decision === "rejected" ? window.prompt("Reason for rejection:") ?? undefined : undefined;
    setDecidingId(id);
    const res = await fetch(`/api/approval-workflows/steps/${id}/decide`, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ decision, comment }),
    });
    setDecidingId(null);
    if (!res.ok) { const d = await res.json().catch(() => ({})); toast.error(d.error ?? "Failed to record decision"); return; }
    toast.success(decision === "approved" ? "Approved" : "Rejected");
    load();
  };

  if (!loading && pending.length === 0) return null;

  return (
    <div>
      <h2 className="font-heading text-lg text-ct-navy mb-2">My Workflow Approvals</h2>
      <Card className="rounded-xl shadow-card bg-white">
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead><tr className="text-left text-ct-muted border-b border-ct-border">
              <th className="p-3 font-medium">Item</th><th className="p-3 font-medium">Requires</th><th className="p-3 font-medium">Progress</th><th className="p-3 font-medium"></th>
            </tr></thead>
            <tbody className="divide-y divide-ct-border">
              {loading ? <tr><td colSpan={4} className="p-6 text-center text-ct-muted">Loading…</td></tr>
                : pending.map((s) => (
                  <tr key={s.id} className="hover:bg-ct-row-hover">
                    <td className="p-3">{s.instance.entityType.replace(/_/g, " ")} <span className="text-ct-muted">#{s.instance.entityId.slice(0, 8)}</span></td>
                    <td className="p-3"><Badge className="bg-ct-cloud text-ct-muted capitalize">{s.approverRole.replace(/_/g, " ")}+</Badge></td>
                    <td className="p-3">{s.approvalsReceived}/{s.requiredApprovals} approvals</td>
                    <td className="p-3">
                      <div className="flex gap-2">
                        <Button size="sm" className="h-7 text-xs bg-ct-teal hover:bg-ct-teal-hover text-white" disabled={decidingId === s.id} onClick={() => decide(s.id, "approved")}>Approve</Button>
                        <Button size="sm" variant="outline" className="h-7 text-xs" disabled={decidingId === s.id} onClick={() => decide(s.id, "rejected")}>Reject</Button>
                      </div>
                    </td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}
