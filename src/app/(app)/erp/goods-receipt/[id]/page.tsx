"use client";

export const dynamic = "force-dynamic";

// Wave 85: landed-cost allocation + putaway confirmation on a submitted
// goods receipt. Bins are leaf nodes in the existing erp_warehouses tree --
// re-binning a received line is just re-picking its warehouse here.
import { useEffect, useState, useCallback, use as usePromise } from "react";
import { toast } from "sonner";
import Link from "next/link";
import { ArrowLeft, Loader2, Plus, Trash2, PackageCheck } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";

type Warehouse = { id: string; warehouseName: string };
type ReceiptItem = { id: string; description: string | null; itemId: string | null; quantity: string; warehouseId: string | null; rate: string | null };
type Receipt = { id: string; receiptNumber: number; postingDate: string; status: string; putawayStatus: string; purchaseOrderId: string | null; supplier: { supplierName: string } | null; items: ReceiptItem[] };
type Charge = { id: string; expenseType: string; amount: string; description: string | null };
type Voucher = { id: string; postingDate: string; createdAt: string; charges: Charge[]; allocations: { receiptItemId: string; allocatedAmount: string }[] };

export default function GoodsReceiptDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = usePromise(params);

  const [receipt, setReceipt] = useState<Receipt | null>(null);
  const [warehouses, setWarehouses] = useState<Warehouse[]>([]);
  const [vouchers, setVouchers] = useState<Voucher[]>([]);
  const [loading, setLoading] = useState(true);
  const [savingBinId, setSavingBinId] = useState<string | null>(null);
  const [completingPutaway, setCompletingPutaway] = useState(false);

  const [lcOpen, setLcOpen] = useState(false);
  const [lcDate, setLcDate] = useState(new Date().toISOString().slice(0, 10));
  const [lcCharges, setLcCharges] = useState<{ expenseType: string; amount: string; description: string }[]>([{ expenseType: "freight", amount: "", description: "" }]);
  const [savingLc, setSavingLc] = useState(false);

  const load = useCallback(async () => {
    const [rRes, wRes, vRes] = await Promise.all([
      fetch(`/api/erp/buying/goods-receipts/${id}`),
      fetch("/api/erp/stock/warehouses"),
      fetch(`/api/erp/buying/goods-receipts/${id}/landed-costs`),
    ]);
    const rData = await rRes.json();
    const wData = await wRes.json();
    const vData = await vRes.json();
    setReceipt(rData);
    setWarehouses(wData.warehouses ?? []);
    setVouchers(vData.vouchers ?? []);
    setLoading(false);
  }, [id]);

  useEffect(() => { load(); }, [load]);

  const updateBin = async (itemId: string, warehouseId: string) => {
    setSavingBinId(itemId);
    const res = await fetch(`/api/erp/buying/goods-receipts/items/${itemId}/putaway`, {
      method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ warehouseId }),
    });
    setSavingBinId(null);
    if (!res.ok) { toast.error("Failed to update bin"); return; }
    toast.success("Bin updated");
    load();
  };

  const completePutaway = async () => {
    setCompletingPutaway(true);
    const res = await fetch(`/api/erp/buying/goods-receipts/${id}/putaway`, { method: "POST" });
    setCompletingPutaway(false);
    if (!res.ok) { const d = await res.json().catch(() => ({})); toast.error(d.error ?? "Failed to complete putaway"); return; }
    toast.success("Putaway marked complete");
    load();
  };

  const createLandedCostVoucher = async () => {
    setSavingLc(true);
    const res = await fetch(`/api/erp/buying/goods-receipts/${id}/landed-costs`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        postingDate: lcDate,
        charges: lcCharges.filter((c) => c.amount).map((c) => ({ expenseType: c.expenseType, amount: Number(c.amount), description: c.description || undefined })),
      }),
    });
    setSavingLc(false);
    if (!res.ok) { const d = await res.json().catch(() => ({})); toast.error(d.error ?? "Failed to allocate landed cost"); return; }
    setLcOpen(false); setLcCharges([{ expenseType: "freight", amount: "", description: "" }]);
    toast.success("Landed cost allocated -- valuation layers updated");
    load();
  };

  if (loading) return <p className="text-sm text-ct-muted">Loading...</p>;
  if (!receipt) return <p className="text-sm text-ct-muted">Goods receipt not found.</p>;

  return (
    <div className="space-y-4">
      <div>
        <Link href="/erp/goods-receipt" className="text-xs text-ct-muted hover:text-ct-navy flex items-center gap-1 mb-2">
          <ArrowLeft className="size-3" /> Back to Goods Receipt
        </Link>
        <div className="flex items-center gap-2 flex-wrap">
          <h1 className="text-2xl font-heading text-ct-navy">Receipt #{receipt.receiptNumber}</h1>
          <Badge className={receipt.status === "submitted" ? "bg-green-100 text-green-700 border-0" : "bg-ct-cloud text-ct-muted border-0"}>{receipt.status}</Badge>
          <Badge variant="outline" className="text-xs">Putaway: {receipt.putawayStatus}</Badge>
        </div>
        <p className="text-sm text-ct-muted mt-1">{receipt.supplier?.supplierName ?? "—"} · {receipt.postingDate}</p>
        {receipt.purchaseOrderId && (
          <Link href={`/erp/goods-receipt/three-way-match/${receipt.purchaseOrderId}`} className="text-xs text-ct-teal hover:underline">View three-way match →</Link>
        )}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Putaway */}
        <Card className="rounded-xl shadow-card bg-white">
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-base text-ct-navy flex items-center gap-2"><PackageCheck className="size-4 text-ct-teal" /> Putaway</CardTitle>
            {receipt.status === "submitted" && receipt.putawayStatus === "pending" && (
              <Button size="sm" onClick={completePutaway} disabled={completingPutaway} className="bg-ct-teal hover:bg-ct-teal-hover text-white">
                {completingPutaway && <Loader2 className="size-3.5 mr-1 animate-spin" />} Mark Complete
              </Button>
            )}
          </CardHeader>
          <CardContent className="space-y-2">
            {receipt.items.map((it) => (
              <div key={it.id} className="text-sm border border-ct-border rounded-lg px-3 py-2 flex items-center justify-between gap-2">
                <span className="flex-1">{it.description ?? it.itemId}</span>
                <span className="text-xs text-ct-muted">{it.quantity}</span>
                <Select value={it.warehouseId ?? ""} onValueChange={(v) => updateBin(it.id, v)} disabled={savingBinId === it.id}>
                  <SelectTrigger className="w-36 h-8 text-xs"><SelectValue placeholder="Bin/Warehouse" /></SelectTrigger>
                  <SelectContent>{warehouses.map((w) => <SelectItem key={w.id} value={w.id}>{w.warehouseName}</SelectItem>)}</SelectContent>
                </Select>
              </div>
            ))}
          </CardContent>
        </Card>

        {/* Landed Cost */}
        <Card className="rounded-xl shadow-card bg-white">
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-base text-ct-navy">Landed Cost Allocation</CardTitle>
            {receipt.status === "submitted" && (
              <Dialog open={lcOpen} onOpenChange={setLcOpen}>
                <DialogTrigger asChild><Button size="sm" variant="outline"><Plus className="size-3.5 mr-1" /> Add</Button></DialogTrigger>
                <DialogContent>
                  <DialogHeader><DialogTitle>Allocate Landed Cost</DialogTitle></DialogHeader>
                  <p className="text-xs text-ct-muted -mt-2">Allocated across this receipt's lines by received value, and folded into each line's FIFO valuation rate for future stock issues.</p>
                  <div className="space-y-3 py-2">
                    <div><Label>Posting Date</Label><Input type="date" value={lcDate} onChange={(e) => setLcDate(e.target.value)} /></div>
                    <div className="space-y-2">
                      {lcCharges.map((c, i) => (
                        <div key={i} className="flex gap-2 items-center">
                          <Select value={c.expenseType} onValueChange={(v) => setLcCharges((prev) => prev.map((p, idx) => idx === i ? { ...p, expenseType: v } : p))}>
                            <SelectTrigger className="w-32"><SelectValue /></SelectTrigger>
                            <SelectContent>
                              <SelectItem value="freight">Freight</SelectItem>
                              <SelectItem value="customs">Customs</SelectItem>
                              <SelectItem value="insurance">Insurance</SelectItem>
                              <SelectItem value="handling">Handling</SelectItem>
                              <SelectItem value="other">Other</SelectItem>
                            </SelectContent>
                          </Select>
                          <Input className="w-28" type="number" placeholder="Amount" value={c.amount} onChange={(e) => setLcCharges((prev) => prev.map((p, idx) => idx === i ? { ...p, amount: e.target.value } : p))} />
                          <Input className="flex-1" placeholder="Description (optional)" value={c.description} onChange={(e) => setLcCharges((prev) => prev.map((p, idx) => idx === i ? { ...p, description: e.target.value } : p))} />
                          <Button size="sm" variant="ghost" onClick={() => setLcCharges((prev) => prev.filter((_, idx) => idx !== i))} disabled={lcCharges.length <= 1}><Trash2 className="w-4 h-4" /></Button>
                        </div>
                      ))}
                      <Button size="sm" variant="outline" onClick={() => setLcCharges((prev) => [...prev, { expenseType: "freight", amount: "", description: "" }])}><Plus className="w-3 h-3 mr-1" />Add charge</Button>
                    </div>
                  </div>
                  <DialogFooter><Button onClick={createLandedCostVoucher} disabled={savingLc} className="bg-ct-teal hover:bg-ct-teal-hover text-white">{savingLc && <Loader2 className="size-4 mr-1.5 animate-spin" />}Allocate</Button></DialogFooter>
                </DialogContent>
              </Dialog>
            )}
          </CardHeader>
          <CardContent className="space-y-2">
            {vouchers.length === 0 ? <p className="text-xs text-ct-muted">No landed costs allocated yet.</p> : vouchers.map((v) => (
              <div key={v.id} className="text-sm border border-ct-border rounded-lg px-3 py-2">
                <p className="text-xs text-ct-muted">{v.postingDate}</p>
                {v.charges.map((c) => (
                  <p key={c.id} className="text-xs">{c.expenseType}: {Number(c.amount).toFixed(2)}{c.description ? ` -- ${c.description}` : ""}</p>
                ))}
              </div>
            ))}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
