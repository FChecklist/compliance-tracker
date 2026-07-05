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
//
// Wave 68: adds a Tax Withholding Category assignment per supplier -- the
// opt-in switch for vendor-payment TDS auto-computation at purchase-
// invoice-submit time (see erp-invoicing-service.ts's computeVendorTds).
import { useEffect, useState, useCallback } from "react";
import { toast } from "sonner";
import Link from "next/link";
import { Building2, Loader2, Plus } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";

type Supplier = { id: string; supplierName: string; taxWithholdingCategoryId: string | null };
type Scorecard = { supplierId: string; totalOrders: number; totalSpend: number; onTimeDeliveryRate: number | null; returnRate: number | null };
type TwCategory = { id: string; categoryName: string; taxDeductionBasis: string; rates: { fromDate: string; rate: string }[] };

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
  const [categories, setCategories] = useState<TwCategory[]>([]);
  const [loading, setLoading] = useState(true);
  const [assigningId, setAssigningId] = useState<string | null>(null);

  const [catOpen, setCatOpen] = useState(false);
  const [catName, setCatName] = useState("");
  const [catBasis, setCatBasis] = useState<"gross_total" | "net_total">("net_total");
  const [catFromDate, setCatFromDate] = useState(new Date().toISOString().slice(0, 10));
  const [catRate, setCatRate] = useState("");
  const [catSingleThreshold, setCatSingleThreshold] = useState("");
  const [catCumulativeThreshold, setCatCumulativeThreshold] = useState("");
  const [creatingCat, setCreatingCat] = useState(false);

  const load = useCallback(() => {
    return Promise.all([
      fetch("/api/erp/buying/suppliers").then((res) => res.json()),
      fetch("/api/erp/buying/suppliers/scorecards").then((res) => res.json()),
      fetch("/api/erp/tax-withholding-categories").then((res) => res.json()),
    ]).then(([suppliersData, scorecardsData, catData]) => {
      setSuppliers(suppliersData.suppliers ?? []);
      setScorecards(scorecardsData.scorecards ?? []);
      setCategories(catData.categories ?? []);
      setLoading(false);
    });
  }, []);

  useEffect(() => { load(); }, [load]);

  const scorecardFor = (supplierId: string) => scorecards.find((s) => s.supplierId === supplierId);

  const assignCategory = async (supplierId: string, categoryId: string) => {
    setAssigningId(supplierId);
    const res = await fetch(`/api/erp/buying/suppliers/${supplierId}/tax-withholding`, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ categoryId: categoryId || undefined }),
    });
    setAssigningId(null);
    if (!res.ok) { const d = await res.json().catch(() => ({})); toast.error(d.error ?? "Failed to update TDS category"); return; }
    toast.success("TDS category updated");
    load();
  };

  const createCategory = async () => {
    setCreatingCat(true);
    const res = await fetch("/api/erp/tax-withholding-categories", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        categoryName: catName, taxDeductionBasis: catBasis,
        rates: [{ fromDate: catFromDate, rate: Number(catRate) || 0, singleThreshold: catSingleThreshold ? Number(catSingleThreshold) : undefined, cumulativeThreshold: catCumulativeThreshold ? Number(catCumulativeThreshold) : undefined }],
      }),
    });
    setCreatingCat(false);
    if (!res.ok) { const d = await res.json().catch(() => ({})); toast.error(d.error ?? "Failed to create TDS category"); return; }
    setCatOpen(false); setCatName(""); setCatRate(""); setCatSingleThreshold(""); setCatCumulativeThreshold("");
    toast.success("Tax withholding category saved");
    load();
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-heading text-ct-navy">Suppliers</h1>
          <p className="text-sm text-ct-muted mt-1">Vendor scorecard, plus TDS (tax withholding) category assignment -- VERI ERP AI</p>
        </div>
        <Dialog open={catOpen} onOpenChange={setCatOpen}>
          <DialogTrigger asChild><Button className="bg-ct-teal hover:bg-ct-teal-hover text-white"><Plus className="w-4 h-4 mr-1" />New TDS Category</Button></DialogTrigger>
          <DialogContent>
            <DialogHeader><DialogTitle>New Tax Withholding Category</DialogTitle></DialogHeader>
            <div className="space-y-3">
              <div><Label>Category Name</Label><Input value={catName} onChange={(e) => setCatName(e.target.value)} placeholder="e.g. Contractors 194C" /></div>
              <div><Label>Deduction Basis</Label>
                <Select value={catBasis} onValueChange={(v) => setCatBasis(v as typeof catBasis)}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent><SelectItem value="net_total">Net Total (subtotal, before tax)</SelectItem><SelectItem value="gross_total">Gross Total (incl. tax)</SelectItem></SelectContent>
                </Select>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div><Label>Effective From</Label><Input type="date" value={catFromDate} onChange={(e) => setCatFromDate(e.target.value)} /></div>
                <div><Label>Rate %</Label><Input type="number" value={catRate} onChange={(e) => setCatRate(e.target.value)} placeholder="e.g. 2" /></div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div><Label>Single-Invoice Threshold (optional)</Label><Input type="number" value={catSingleThreshold} onChange={(e) => setCatSingleThreshold(e.target.value)} placeholder="e.g. 30000" /></div>
                <div><Label>Cumulative-Annual Threshold (optional)</Label><Input type="number" value={catCumulativeThreshold} onChange={(e) => setCatCumulativeThreshold(e.target.value)} placeholder="e.g. 100000" /></div>
              </div>
            </div>
            <DialogFooter><Button onClick={createCategory} disabled={creatingCat || !catName || !catRate} className="bg-ct-teal hover:bg-ct-teal-hover text-white">{creatingCat && <Loader2 className="w-4 h-4 mr-1 animate-spin" />}Save</Button></DialogFooter>
          </DialogContent>
        </Dialog>
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
                <Select value={s.taxWithholdingCategoryId ?? "__none__"} onValueChange={(v) => assignCategory(s.id, v === "__none__" ? "" : v)} disabled={assigningId === s.id}>
                  <SelectTrigger className="w-44 h-8 text-xs"><SelectValue placeholder="No TDS category" /></SelectTrigger>
                  <SelectContent><SelectItem value="__none__">No TDS category</SelectItem>{categories.map((c) => <SelectItem key={c.id} value={c.id}>{c.categoryName}</SelectItem>)}</SelectContent>
                </Select>
                <Link href={`/erp/suppliers/${s.id}`}>
                  <Button size="sm" variant="outline" className="h-8 text-xs">Manage</Button>
                </Link>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
