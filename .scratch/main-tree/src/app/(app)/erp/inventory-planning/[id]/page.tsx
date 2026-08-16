"use client";

export const dynamic = "force-dynamic";

// Wave 87: physical count entry + variance posting. Adjustments post
// through the same FIFO stock engine every other inventory movement uses.
import { useEffect, useState, useCallback, use as usePromise } from "react";
import { toast } from "sonner";
import Link from "next/link";
import { ArrowLeft, Loader2 } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";

type CountLine = { id: string; itemId: string; systemQty: string; countedQty: string | null; status: string; item: { itemName: string } | null };
type CountPlan = { id: string; name: string; status: string; lines: CountLine[]; warehouse: { warehouseName: string } | null };

export default function CycleCountPlanDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = usePromise(params);
  const [plan, setPlan] = useState<CountPlan | null>(null);
  const [loading, setLoading] = useState(true);
  const [countedValues, setCountedValues] = useState<Record<string, string>>({});
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(async () => {
    const res = await fetch(`/api/erp/inventory/cycle-count-plans/${id}`);
    const data = await res.json();
    setPlan(data);
    setLoading(false);
  }, [id]);

  useEffect(() => { load(); }, [load]);

  const submitCount = async (lineId: string) => {
    const countedQty = countedValues[lineId];
    if (!countedQty) return;
    setBusyId(lineId);
    const res = await fetch(`/api/erp/inventory/cycle-count-lines/${lineId}/count`, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ countedQty: Number(countedQty) }),
    });
    setBusyId(null);
    if (!res.ok) { toast.error("Failed to record count"); return; }
    toast.success("Count recorded");
    load();
  };

  const postAdjustment = async (lineId: string) => {
    setBusyId(lineId);
    const res = await fetch(`/api/erp/inventory/cycle-count-lines/${lineId}/adjust`, { method: "POST" });
    setBusyId(null);
    if (!res.ok) { const d = await res.json().catch(() => ({})); toast.error(d.error ?? "Failed to post adjustment"); return; }
    toast.success("Variance posted to stock ledger");
    load();
  };

  if (loading) return <p className="text-sm text-ct-muted">Loading...</p>;
  if (!plan) return <p className="text-sm text-ct-muted">Cycle count plan not found.</p>;

  return (
    <div className="space-y-4">
      <div>
        <Link href="/erp/inventory-planning" className="text-xs text-ct-muted hover:text-ct-navy flex items-center gap-1 mb-2">
          <ArrowLeft className="size-3" /> Back to Inventory Planning
        </Link>
        <h1 className="text-2xl font-heading text-ct-navy">{plan.name}</h1>
        <p className="text-sm text-ct-muted">{plan.warehouse?.warehouseName ?? "—"}</p>
      </div>

      <Card className="rounded-xl shadow-card bg-white">
        <CardContent className="p-0">
          <table className="w-full text-xs">
            <thead><tr className="text-left text-ct-muted border-b border-ct-border"><th className="p-3 font-medium">Item</th><th className="p-3 font-medium text-right">System Qty</th><th className="p-3 font-medium">Counted Qty</th><th className="p-3 font-medium">Variance</th><th className="p-3 font-medium">Status</th><th className="p-3 font-medium"></th></tr></thead>
            <tbody className="divide-y divide-ct-border">
              {plan.lines.map((l) => {
                const variance = l.countedQty != null ? Number(l.countedQty) - Number(l.systemQty) : null;
                return (
                  <tr key={l.id} className="hover:bg-ct-row-hover">
                    <td className="p-3">{l.item?.itemName ?? l.itemId}</td>
                    <td className="p-3 text-right">{l.systemQty}</td>
                    <td className="p-3">
                      {l.status === "pending" ? (
                        <Input className="w-24 h-8 text-xs" type="number" value={countedValues[l.id] ?? ""} onChange={(e) => setCountedValues((prev) => ({ ...prev, [l.id]: e.target.value }))} />
                      ) : l.countedQty}
                    </td>
                    <td className="p-3">{variance !== null ? (variance === 0 ? "0" : variance > 0 ? `+${variance}` : variance) : "—"}</td>
                    <td className="p-3"><Badge variant="outline">{l.status}</Badge></td>
                    <td className="p-3">
                      {l.status === "pending" && (
                        <Button size="sm" className="h-7 text-xs bg-ct-teal hover:bg-ct-teal-hover text-white" onClick={() => submitCount(l.id)} disabled={busyId === l.id || !countedValues[l.id]}>
                          {busyId === l.id && <Loader2 className="w-3 h-3 mr-1 animate-spin" />}Record
                        </Button>
                      )}
                      {l.status === "counted" && variance !== 0 && (
                        <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => postAdjustment(l.id)} disabled={busyId === l.id}>
                          {busyId === l.id && <Loader2 className="w-3 h-3 mr-1 animate-spin" />}Post Adjustment
                        </Button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </CardContent>
      </Card>
    </div>
  );
}
