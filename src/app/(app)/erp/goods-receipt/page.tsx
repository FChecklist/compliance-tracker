"use client";

export const dynamic = "force-dynamic";

// Wave 85 (COMPARISON_CSV_GAP_ANALYSIS.md backlog #6, final backlog item):
// erp_purchase_orders/erp_purchase_receipts have existed since Wave 49 with
// zero create/submit service consumer at all -- this is the first-ever UI
// for the PO -> GRN chain, which the three-way-match/landed-cost/putaway
// enhancements this wave targets need to attach to.
import { useEffect, useState, useCallback } from "react";
import { toast } from "sonner";
import Link from "next/link";
import { Loader2, Plus, Trash2 } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";

type Supplier = { id: string; supplierName: string };
type Warehouse = { id: string; warehouseName: string };
type PoItem = { id: string; description: string; quantity: string; rate: string; receivedQuantity: string; itemId: string | null };
type PurchaseOrder = { id: string; poNumber: number; orderDate: string; status: string; grandTotal: string; supplierId: string; items: PoItem[] };
type Receipt = { id: string; receiptNumber: number; postingDate: string; status: string; putawayStatus: string; purchaseOrderId: string | null; supplier: { supplierName: string } | null; items: unknown[] };
type LineItem = { description: string; quantity: string; rate: string };

const PO_STATUS_COLORS: Record<string, string> = {
  draft: "bg-ct-cloud text-ct-muted", submitted: "bg-amber-100 text-amber-700",
  partially_received: "bg-blue-100 text-blue-700", completed: "bg-green-100 text-green-700", cancelled: "bg-red-100 text-red-700",
};
const RECEIPT_STATUS_COLORS: Record<string, string> = { draft: "bg-ct-cloud text-ct-muted", submitted: "bg-green-100 text-green-700", cancelled: "bg-red-100 text-red-700" };

export default function ErpGoodsReceiptPage() {
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [warehouses, setWarehouses] = useState<Warehouse[]>([]);
  const [purchaseOrders, setPurchaseOrders] = useState<PurchaseOrder[]>([]);
  const [receipts, setReceipts] = useState<Receipt[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);

  const [poOpen, setPoOpen] = useState(false);
  const [poSupplierId, setPoSupplierId] = useState("");
  const [poDate, setPoDate] = useState(new Date().toISOString().slice(0, 10));
  const [poExpectedDate, setPoExpectedDate] = useState("");
  const [poItems, setPoItems] = useState<LineItem[]>([{ description: "", quantity: "1", rate: "" }]);
  const [creatingPo, setCreatingPo] = useState(false);

  const [grnOpen, setGrnOpen] = useState(false);
  const [grnPo, setGrnPo] = useState<PurchaseOrder | null>(null);
  const [grnDate, setGrnDate] = useState(new Date().toISOString().slice(0, 10));
  const [grnLines, setGrnLines] = useState<{ poItemId: string; itemId: string | null; description: string; rate: string; qty: string; warehouseId: string }[]>([]);
  const [creatingGrn, setCreatingGrn] = useState(false);

  const load = useCallback(() => {
    Promise.all([
      fetch("/api/erp/buying/suppliers").catch(() => null),
      fetch("/api/erp/stock/warehouses").catch(() => null),
      fetch("/api/erp/buying/purchase-orders"),
      fetch("/api/erp/buying/goods-receipts"),
    ])
      .then(([supRes, whRes, poRes, grnRes]) => Promise.all([
        supRes && supRes.ok ? supRes.json() : { suppliers: [] },
        whRes && whRes.ok ? whRes.json() : { warehouses: [] },
        poRes.json(), grnRes.json(),
      ]))
      .then(([supData, whData, poData, grnData]) => {
        setSuppliers(supData.suppliers ?? []);
        setWarehouses(whData.warehouses ?? []);
        setPurchaseOrders(poData.purchaseOrders ?? []);
        setReceipts(grnData.receipts ?? []);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, []);

  useEffect(load, [load]);

  const createPurchaseOrder = async () => {
    setCreatingPo(true);
    const res = await fetch("/api/erp/buying/purchase-orders", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        supplierId: poSupplierId, orderDate: poDate, expectedDeliveryDate: poExpectedDate || undefined,
        items: poItems.filter((i) => i.description).map((i) => ({ description: i.description, quantity: Number(i.quantity) || 1, rate: Number(i.rate) || 0 })),
      }),
    });
    setCreatingPo(false);
    if (!res.ok) { const d = await res.json().catch(() => ({})); toast.error(d.error ?? "Failed to create purchase order"); return; }
    setPoOpen(false); setPoSupplierId(""); setPoExpectedDate(""); setPoItems([{ description: "", quantity: "1", rate: "" }]);
    toast.success("Purchase order created as draft");
    load();
  };

  const submitPo = async (id: string) => {
    setBusyId(id);
    const res = await fetch(`/api/erp/buying/purchase-orders/${id}/submit`, { method: "POST" });
    setBusyId(null);
    if (!res.ok) { const d = await res.json().catch(() => ({})); toast.error(d.error ?? "Failed to submit"); return; }
    toast.success("Purchase order submitted");
    load();
  };

  const openGrnFor = (po: PurchaseOrder) => {
    setGrnPo(po);
    setGrnLines(
      po.items.filter((i) => Number(i.quantity) > Number(i.receivedQuantity)).map((i) => ({
        poItemId: i.id, itemId: i.itemId, description: i.description, rate: i.rate,
        qty: (Number(i.quantity) - Number(i.receivedQuantity)).toString(), warehouseId: "",
      }))
    );
    setGrnOpen(true);
  };

  const createGrn = async () => {
    if (!grnPo) return;
    setCreatingGrn(true);
    const res = await fetch("/api/erp/buying/goods-receipts", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        supplierId: grnPo.supplierId, purchaseOrderId: grnPo.id, postingDate: grnDate,
        items: grnLines.filter((l) => l.warehouseId && Number(l.qty) > 0).map((l) => ({
          purchaseOrderItemId: l.poItemId, itemId: l.itemId, quantity: Number(l.qty), warehouseId: l.warehouseId, rate: Number(l.rate),
        })),
      }),
    });
    setCreatingGrn(false);
    if (!res.ok) { const d = await res.json().catch(() => ({})); toast.error(d.error ?? "Failed to create goods receipt"); return; }
    setGrnOpen(false); setGrnPo(null);
    toast.success("Goods receipt created as draft");
    load();
  };

  const submitGrn = async (id: string) => {
    setBusyId(id);
    const res = await fetch(`/api/erp/buying/goods-receipts/${id}/submit`, { method: "POST" });
    setBusyId(null);
    if (!res.ok) { const d = await res.json().catch(() => ({})); toast.error(d.error ?? "Failed to submit"); return; }
    toast.success("Goods receipt submitted -- stock posted");
    load();
  };

  return (
    <div className="space-y-4">
      <div>
        <h1 className="font-heading text-2xl md:text-3xl text-ct-navy">Goods Receipt</h1>
        <p className="text-sm text-ct-muted mt-1">Purchase Order → GRN, with three-way-match, landed cost, and putaway — VERI ERP AI</p>
      </div>

      <Tabs defaultValue="orders">
        <TabsList>
          <TabsTrigger value="orders">Purchase Orders</TabsTrigger>
          <TabsTrigger value="receipts">Goods Receipts</TabsTrigger>
        </TabsList>

        <TabsContent value="orders" className="space-y-3">
          <div className="flex justify-end">
            <Dialog open={poOpen} onOpenChange={setPoOpen}>
              <DialogTrigger asChild><Button className="bg-ct-teal hover:bg-ct-teal-hover text-white"><Plus className="w-4 h-4 mr-1" />New Purchase Order</Button></DialogTrigger>
              <DialogContent className="max-w-xl">
                <DialogHeader><DialogTitle>New Purchase Order</DialogTitle></DialogHeader>
                <div className="space-y-3">
                  <div><Label>Supplier</Label>
                    <Select value={poSupplierId} onValueChange={setPoSupplierId}>
                      <SelectTrigger><SelectValue placeholder="Select supplier" /></SelectTrigger>
                      <SelectContent>{suppliers.map((s) => <SelectItem key={s.id} value={s.id}>{s.supplierName}</SelectItem>)}</SelectContent>
                    </Select>
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div><Label>Order Date</Label><Input type="date" value={poDate} onChange={(e) => setPoDate(e.target.value)} /></div>
                    <div><Label>Expected Delivery (optional)</Label><Input type="date" value={poExpectedDate} onChange={(e) => setPoExpectedDate(e.target.value)} /></div>
                  </div>
                  <div className="space-y-2">
                    {poItems.map((it, i) => (
                      <div key={i} className="flex gap-2 items-center">
                        <Input className="flex-1" placeholder="Description" value={it.description} onChange={(e) => setPoItems((prev) => prev.map((p, idx) => idx === i ? { ...p, description: e.target.value } : p))} />
                        <Input className="w-20" type="number" placeholder="Qty" value={it.quantity} onChange={(e) => setPoItems((prev) => prev.map((p, idx) => idx === i ? { ...p, quantity: e.target.value } : p))} />
                        <Input className="w-28" type="number" placeholder="Rate" value={it.rate} onChange={(e) => setPoItems((prev) => prev.map((p, idx) => idx === i ? { ...p, rate: e.target.value } : p))} />
                        <Button size="sm" variant="ghost" onClick={() => setPoItems((prev) => prev.filter((_, idx) => idx !== i))} disabled={poItems.length <= 1}><Trash2 className="w-4 h-4" /></Button>
                      </div>
                    ))}
                    <Button size="sm" variant="outline" onClick={() => setPoItems((prev) => [...prev, { description: "", quantity: "1", rate: "" }])}><Plus className="w-3 h-3 mr-1" />Add line</Button>
                  </div>
                </div>
                <DialogFooter><Button onClick={createPurchaseOrder} disabled={creatingPo || !poSupplierId} className="bg-ct-teal hover:bg-ct-teal-hover text-white">{creatingPo && <Loader2 className="w-4 h-4 mr-1 animate-spin" />}Save as Draft</Button></DialogFooter>
              </DialogContent>
            </Dialog>
          </div>
          <Card className="rounded-xl shadow-card bg-white">
            <CardContent className="p-0">
              <table className="w-full text-xs">
                <thead><tr className="text-left text-ct-muted border-b border-ct-border"><th className="p-3 font-medium">PO #</th><th className="p-3 font-medium">Order Date</th><th className="p-3 font-medium">Lines</th><th className="p-3 font-medium text-right">Total</th><th className="p-3 font-medium">Status</th><th className="p-3 font-medium"></th></tr></thead>
                <tbody className="divide-y divide-ct-border">
                  {loading ? <tr><td colSpan={6} className="p-6 text-center text-ct-muted">Loading…</td></tr>
                    : purchaseOrders.length === 0 ? <tr><td colSpan={6} className="p-6 text-center text-ct-muted">No purchase orders yet.</td></tr>
                    : purchaseOrders.map((po) => (
                      <tr key={po.id} className="hover:bg-ct-row-hover">
                        <td className="p-3">{po.poNumber}</td><td className="p-3">{po.orderDate}</td><td className="p-3">{po.items.length}</td>
                        <td className="p-3 text-right font-medium">{Number(po.grandTotal).toFixed(2)}</td>
                        <td className="p-3"><Badge className={PO_STATUS_COLORS[po.status] ?? ""}>{po.status.replace("_", " ")}</Badge></td>
                        <td className="p-3 flex gap-2">
                          {po.status === "draft" && <Button size="sm" className="h-7 text-xs bg-ct-teal hover:bg-ct-teal-hover text-white" onClick={() => submitPo(po.id)} disabled={busyId === po.id}>{busyId === po.id && <Loader2 className="w-3 h-3 mr-1 animate-spin" />}Submit</Button>}
                          {(po.status === "submitted" || po.status === "partially_received") && <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => openGrnFor(po)}>Receive</Button>}
                          <Link href={`/erp/goods-receipt/three-way-match/${po.id}`}><Button size="sm" variant="ghost" className="h-7 text-xs">3-Way Match</Button></Link>
                        </td>
                      </tr>
                    ))}
                </tbody>
              </table>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="receipts" className="space-y-3">
          <Card className="rounded-xl shadow-card bg-white">
            <CardContent className="p-0">
              <table className="w-full text-xs">
                <thead><tr className="text-left text-ct-muted border-b border-ct-border"><th className="p-3 font-medium">Receipt #</th><th className="p-3 font-medium">Supplier</th><th className="p-3 font-medium">Date</th><th className="p-3 font-medium">Status</th><th className="p-3 font-medium">Putaway</th><th className="p-3 font-medium"></th></tr></thead>
                <tbody className="divide-y divide-ct-border">
                  {loading ? <tr><td colSpan={6} className="p-6 text-center text-ct-muted">Loading…</td></tr>
                    : receipts.length === 0 ? <tr><td colSpan={6} className="p-6 text-center text-ct-muted">No goods receipts yet.</td></tr>
                    : receipts.map((r) => (
                      <tr key={r.id} className="hover:bg-ct-row-hover">
                        <td className="p-3">{r.receiptNumber}</td><td className="p-3">{r.supplier?.supplierName ?? "—"}</td><td className="p-3">{r.postingDate}</td>
                        <td className="p-3"><Badge className={RECEIPT_STATUS_COLORS[r.status] ?? ""}>{r.status}</Badge></td>
                        <td className="p-3"><Badge variant="outline">{r.putawayStatus}</Badge></td>
                        <td className="p-3 flex gap-2">
                          {r.status === "draft" && <Button size="sm" className="h-7 text-xs bg-ct-teal hover:bg-ct-teal-hover text-white" onClick={() => submitGrn(r.id)} disabled={busyId === r.id}>{busyId === r.id && <Loader2 className="w-3 h-3 mr-1 animate-spin" />}Submit</Button>}
                          <Link href={`/erp/goods-receipt/${r.id}`}><Button size="sm" variant="outline" className="h-7 text-xs">Manage</Button></Link>
                        </td>
                      </tr>
                    ))}
                </tbody>
              </table>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      <Dialog open={grnOpen} onOpenChange={setGrnOpen}>
        <DialogContent className="max-w-2xl">
          <DialogHeader><DialogTitle>Receive Goods {grnPo ? `-- PO #${grnPo.poNumber}` : ""}</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div><Label>Posting Date</Label><Input type="date" value={grnDate} onChange={(e) => setGrnDate(e.target.value)} /></div>
            <div className="space-y-2">
              {grnLines.length === 0 ? <p className="text-xs text-ct-muted">All ordered lines have already been fully received.</p> : grnLines.map((l, i) => (
                <div key={l.poItemId} className="flex gap-2 items-center">
                  <span className="flex-1 text-xs">{l.description}</span>
                  <Input className="w-20" type="number" placeholder="Qty" value={l.qty} onChange={(e) => setGrnLines((prev) => prev.map((p, idx) => idx === i ? { ...p, qty: e.target.value } : p))} />
                  <Select value={l.warehouseId} onValueChange={(v) => setGrnLines((prev) => prev.map((p, idx) => idx === i ? { ...p, warehouseId: v } : p))}>
                    <SelectTrigger className="w-40"><SelectValue placeholder="Warehouse" /></SelectTrigger>
                    <SelectContent>{warehouses.map((w) => <SelectItem key={w.id} value={w.id}>{w.warehouseName}</SelectItem>)}</SelectContent>
                  </Select>
                </div>
              ))}
            </div>
          </div>
          <DialogFooter><Button onClick={createGrn} disabled={creatingGrn || grnLines.length === 0} className="bg-ct-teal hover:bg-ct-teal-hover text-white">{creatingGrn && <Loader2 className="w-4 h-4 mr-1 animate-spin" />}Save as Draft</Button></DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
