"use client";

import { useEffect, useState } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { StatusPill } from "@/components/SimpleModulePage";

type Approval = { id: string; requestType: string; description: string | null; status: string; requestedByName: string; createdAt: string };

// Shared by the standalone /approvals page and Home's Approval tab (Wave
// 15) so this list-rendering logic isn't duplicated -- both are the exact
// same maker-checker queue, just reached from two different places.
export function ApprovalTab({ showHeader = false }: { showHeader?: boolean }) {
  const [approvals, setApprovals] = useState<Approval[]>([]);
  const [loading, setLoading] = useState(true);

  const load = () => {
    fetch("/api/approvals").then((r) => r.json()).then((d) => { setApprovals(d.approvals ?? []); setLoading(false); }).catch(() => setLoading(false));
  };
  useEffect(load, []);

  const decide = async (id: string, decision: "approve" | "reject") => {
    const rejectionReason = decision === "reject" ? window.prompt("Reason for rejection:") : undefined;
    if (decision === "reject" && !rejectionReason?.trim()) return;
    const res = await fetch(`/api/approvals/${id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ decision, rejectionReason }) });
    if (!res.ok) {
      const d = await res.json().catch(() => ({}));
      alert(d.error ?? "Failed to process decision");
      return;
    }
    load();
  };

  return (
    <div className="space-y-4">
      {showHeader && (
        <div>
          <h1 className="font-heading text-2xl md:text-3xl text-ct-navy">Approval Queue</h1>
          <p className="text-sm text-ct-muted mt-1">Maker-checker — every request here only takes effect once approved</p>
        </div>
      )}

      <Card className="rounded-xl shadow-card bg-white">
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead><tr className="text-left text-ct-muted border-b border-ct-border">
              <th className="p-3 font-medium">Type</th><th className="p-3 font-medium">Description</th><th className="p-3 font-medium">Requested By</th><th className="p-3 font-medium">Status</th><th className="p-3 font-medium"></th>
            </tr></thead>
            <tbody className="divide-y divide-ct-border">
              {loading ? (
                <tr><td colSpan={5} className="p-6 text-center text-ct-muted">Loading…</td></tr>
              ) : approvals.length === 0 ? (
                <tr><td colSpan={5} className="p-6 text-center text-ct-muted">No approval requests.</td></tr>
              ) : approvals.map((a) => (
                <tr key={a.id} className="hover:bg-ct-row-hover">
                  <td className="p-3">{a.requestType.replace(/_/g, " ")}</td>
                  <td className="p-3">{a.description ?? "—"}</td>
                  <td className="p-3">{a.requestedByName}</td>
                  <td className="p-3"><StatusPill value={a.status} /></td>
                  <td className="p-3">
                    {a.status === "pending" && (
                      <div className="flex gap-2">
                        <Button size="sm" className="h-7 text-xs bg-ct-teal hover:bg-ct-teal-hover text-white" onClick={() => decide(a.id, "approve")}>Approve</Button>
                        <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => decide(a.id, "reject")}>Reject</Button>
                      </div>
                    )}
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
