"use client";

// force-dynamic: see src/app/(app)/knowledge-base/page.tsx for why this is
// required (prevents static prerendering + CDN-cache bypass of middleware).
export const dynamic = "force-dynamic";

// Wave 64 (Vendor Scorecarding, ERP benchmark Tier 4 #19 partial). A
// read-time aggregation over existing purchase order/receipt/return data --
// no new schema, matching Wave 50/51's financial-report and Wave 28's
// budget-actuals convention of never duplicating a ledger. Landed cost and
// barcode/QR generation (the other two items bundled under Tier 4 #19) are
// deliberately out of scope for this pass -- each needs its own separate
// design decision (an allocation methodology; a new `bwip-js` dependency).
import { useEffect, useState, useCallback } from "react";
import { Building2 } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

type Supplier = { id: string; supplierName: string };
type Scorecard = { supplierId: string; totalOrders: number; totalSpend: number; onTimeDeliveryRate: number | null; returnRate: number | null };

function formatPercent(rate: number | null): string {
  if (rate === null) return "--";
  return `${Math.round(rate * 100)}%`;
}

function onTimeBadgeVariant(rate: number | null): "default" | "secondary" | "outline" {
  if (rate === null) return "outline";
  if (rate >= 0.9) return "default";
  return "secondary";
}

export default function ErpSuppliersPage() {
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [scorecards, setScorecards] = useState<Scorecard[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(() => {
    return Promise.all([
      fetch("/api/erp/buying/suppliers").then((res) => res.json()),
      fetch("/api/erp/buying/suppliers/scorecards").then((res) => res.json()),
    ]).then(([suppliersData, scorecardsData]) => {
      setSuppliers(suppliersData.suppliers ?? []);
      setScorecards(scorecardsData.scorecards ?? []);
      setLoading(false);
    });
  }, []);

  useEffect(() => { load(); }, [load]);

  const scorecardFor = (supplierId: string) => scorecards.find((s) => s.supplierId === supplierId);

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-heading text-ct-navy">Suppliers</h1>
        <p className="text-sm text-ct-muted mt-1">Vendor scorecard: on-time delivery rate and return rate, computed live from purchase orders, receipts, and returns.</p>
      </div>

      {loading ? <p className="text-sm text-ct-muted">Loading...</p> : suppliers.length === 0 ? (
        <Card className="rounded-xl shadow-card bg-white"><CardContent className="pt-10 pb-10 text-center space-y-2"><Building2 className="size-10 text-ct-muted mx-auto" /><p className="text-sm text-ct-muted">No suppliers yet.</p></CardContent></Card>
      ) : (
        <div className="rounded-xl border border-ct-border bg-white divide-y divide-ct-border">
          {suppliers.map((s) => {
            const sc = scorecardFor(s.id);
            return (
              <div key={s.id} className="px-4 py-3 flex items-center gap-3">
                <Building2 className="size-4 text-ct-teal shrink-0" />
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-ct-navy">{s.supplierName}</p>
                  <p className="text-xs text-ct-muted">{sc ? `${sc.totalOrders} orders -- total spend ${sc.totalSpend.toLocaleString()}` : ""}</p>
                </div>
                <Badge variant={onTimeBadgeVariant(sc?.onTimeDeliveryRate ?? null)} className="text-xs">On-time: {formatPercent(sc?.onTimeDeliveryRate ?? null)}</Badge>
                <Badge variant="outline" className="text-xs">Returns: {formatPercent(sc?.returnRate ?? null)}</Badge>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
