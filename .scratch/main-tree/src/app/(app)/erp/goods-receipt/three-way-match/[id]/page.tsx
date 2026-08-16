"use client";

export const dynamic = "force-dynamic";

// Wave 85: reads three genuinely independent documents (PO/GRN/Invoice) --
// never a duplicated reconciliation ledger, see getThreeWayMatchReport.
import { useEffect, useState, useCallback, use as usePromise } from "react";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

type MatchLine = {
  purchaseOrderItemId: string; description: string; orderedQty: number; orderedRate: number;
  receivedQty: number; invoicedQty: number; invoicedRateAvg: number | null;
  qtyVariance: "matched" | "under_received" | "over_received" | "over_invoiced";
  rateVariance: "matched" | "rate_mismatch";
};

const QTY_COLORS: Record<string, string> = {
  matched: "bg-green-100 text-green-700", under_received: "bg-amber-100 text-amber-700",
  over_received: "bg-red-100 text-red-700", over_invoiced: "bg-red-100 text-red-700",
};

export default function ThreeWayMatchPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = usePromise(params);
  const [lines, setLines] = useState<MatchLine[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const res = await fetch(`/api/erp/buying/purchase-orders/${id}/three-way-match`);
    if (!res.ok) { const d = await res.json().catch(() => ({})); setError(d.error ?? "Failed to load"); return; }
    const d = await res.json();
    setLines(d.lines ?? []);
  }, [id]);

  useEffect(() => { load(); }, [load]);

  return (
    <div className="space-y-4">
      <div>
        <Link href="/erp/goods-receipt" className="text-xs text-ct-muted hover:text-ct-navy flex items-center gap-1 mb-2">
          <ArrowLeft className="size-3" /> Back to Goods Receipt
        </Link>
        <h1 className="font-heading text-2xl text-ct-navy">Three-Way Match</h1>
        <p className="text-sm text-ct-muted mt-1">Purchase Order vs Goods Receipt vs Invoice, per line</p>
      </div>

      {error ? <p className="text-sm text-ct-muted">{error}</p> : (
        <Card className="rounded-xl shadow-card bg-white">
          <CardContent className="p-0">
            <table className="w-full text-xs">
              <thead>
                <tr className="text-left text-ct-muted border-b border-ct-border">
                  <th className="p-3 font-medium">Description</th>
                  <th className="p-3 font-medium text-right">Ordered</th>
                  <th className="p-3 font-medium text-right">Received</th>
                  <th className="p-3 font-medium text-right">Invoiced</th>
                  <th className="p-3 font-medium text-right">PO Rate</th>
                  <th className="p-3 font-medium text-right">Invoiced Rate (avg)</th>
                  <th className="p-3 font-medium">Qty Match</th>
                  <th className="p-3 font-medium">Rate Match</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-ct-border">
                {lines === null ? <tr><td colSpan={8} className="p-6 text-center text-ct-muted">Loading…</td></tr>
                  : lines.length === 0 ? <tr><td colSpan={8} className="p-6 text-center text-ct-muted">No line items on this purchase order.</td></tr>
                  : lines.map((l) => (
                    <tr key={l.purchaseOrderItemId} className="hover:bg-ct-row-hover">
                      <td className="p-3">{l.description}</td>
                      <td className="p-3 text-right">{l.orderedQty}</td>
                      <td className="p-3 text-right">{l.receivedQty}</td>
                      <td className="p-3 text-right">{l.invoicedQty}</td>
                      <td className="p-3 text-right">{l.orderedRate.toFixed(2)}</td>
                      <td className="p-3 text-right">{l.invoicedRateAvg !== null ? l.invoicedRateAvg.toFixed(2) : "—"}</td>
                      <td className="p-3"><Badge className={QTY_COLORS[l.qtyVariance] ?? ""}>{l.qtyVariance.replace("_", " ")}</Badge></td>
                      <td className="p-3"><Badge className={l.rateVariance === "matched" ? "bg-green-100 text-green-700" : "bg-red-100 text-red-700"}>{l.rateVariance.replace("_", " ")}</Badge></td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
