"use client";

export const dynamic = "force-dynamic";

// Wave 97: per-cycle certification list. Confirming/revoking each user's
// access is a real, one-time decision (409 if already decided) -- revoking
// flips users.isActive=false server-side, which requireAuth() enforces.
import { useEffect, useState, useCallback } from "react";
import { toast } from "sonner";
import { ArrowLeft, Check, Ban } from "lucide-react";
import Link from "next/link";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";

type Certification = {
  id: string; userId: string; userName: string; userEmail: string | null;
  reviewedRole: string; decision: string;
};
type CycleDetail = { id: string; name: string; status: string; certifications: Certification[] };

const DECISION_VARIANT: Record<string, "default" | "secondary" | "outline"> = { pending: "secondary", confirmed: "default", revoked: "outline" };

export default function AccessReviewCycleDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const [id, setId] = useState<string | null>(null);
  const [cycle, setCycle] = useState<CycleDetail | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => { params.then((p) => setId(p.id)); }, [params]);

  const load = useCallback(async () => {
    if (!id) return;
    const res = await fetch(`/api/access-review/cycles/${id}`);
    setCycle(res.ok ? await res.json() : null);
    setLoading(false);
  }, [id]);

  useEffect(() => { load(); }, [load]);

  async function decide(certId: string, decision: "confirmed" | "revoked") {
    if (!id) return;
    const res = await fetch(`/api/access-review/cycles/${id}/certifications/${certId}`, {
      method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ decision }),
    });
    if (!res.ok) { toast.error((await res.json()).error ?? "Failed to record decision"); return; }
    toast.success(decision === "confirmed" ? "Access confirmed" : "Access revoked");
    load();
  }

  if (loading) return <p className="text-sm text-ct-muted">Loading...</p>;
  if (!cycle) return <p className="text-sm text-ct-muted">Access review cycle not found.</p>;

  const pendingCount = cycle.certifications.filter((c) => c.decision === "pending").length;

  return (
    <div className="space-y-4">
      <div>
        <Link href="/access-review" className="text-xs text-ct-muted hover:text-ct-navy flex items-center gap-1 mb-2">
          <ArrowLeft className="size-3" /> Back to Access Review
        </Link>
        <h1 className="text-2xl font-heading text-ct-navy">{cycle.name}</h1>
        <p className="text-sm text-ct-muted">
          <Badge variant={cycle.status === "completed" ? "outline" : "secondary"}>{cycle.status}</Badge>
          {" "}· {pendingCount} of {cycle.certifications.length} pending
        </p>
      </div>

      <Card className="rounded-xl shadow-card bg-white">
        <CardContent className="p-0">
          <table className="w-full text-xs">
            <thead><tr className="text-left text-ct-muted border-b border-ct-border"><th className="p-3 font-medium">User</th><th className="p-3 font-medium">Role at Review</th><th className="p-3 font-medium">Decision</th><th className="p-3 font-medium">Action</th></tr></thead>
            <tbody className="divide-y divide-ct-border">
              {cycle.certifications.map((c) => (
                <tr key={c.id} className="hover:bg-ct-row-hover">
                  <td className="p-3">{c.userName}{c.userEmail ? <span className="text-ct-muted"> ({c.userEmail})</span> : null}</td>
                  <td className="p-3">{c.reviewedRole}</td>
                  <td className="p-3"><Badge variant={DECISION_VARIANT[c.decision] ?? "outline"}>{c.decision}</Badge></td>
                  <td className="p-3">
                    {c.decision === "pending" && (
                      <div className="flex gap-2">
                        <Button size="sm" variant="outline" onClick={() => decide(c.id, "confirmed")}><Check className="w-3 h-3 mr-1" />Confirm</Button>
                        <Button size="sm" variant="outline" className="text-ct-error hover:text-ct-error" onClick={() => decide(c.id, "revoked")}><Ban className="w-3 h-3 mr-1" />Revoke</Button>
                      </div>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </CardContent>
      </Card>
    </div>
  );
}
