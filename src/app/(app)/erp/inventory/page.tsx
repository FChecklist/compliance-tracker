"use client";

export const dynamic = "force-dynamic";

// Wave 53 (VERI ERP gap-fill, Tier 1 #4): FIFO inventory valuation --
// items/warehouses (Wave 49 schema, no UI until now), stock receipts/
// issues that actually compute a real FIFO cost (see erp-inventory-service.ts).
import { useEffect, useState, useCallback } from "react";
import { toast } from "sonner";
import { Loader2, Plus } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";

type Item = { id: string; itemCode: string; itemName: string; uom: string | null };
type Warehouse = { id: string; warehouseName: string };
type LedgerEntry = { id: string; postingDate: string; voucherType: string; quantityChange: string; valuationRate: string; balanceQty: string; balanceValue: string };

export default function ErpInventoryPage() {
  const [items, setItems] = useState<Item[]>([]);
  const [warehouses, setWarehouses] = useState<Warehouse[]>([]);
  const [ledger, setLedger] = useState<LedgerEntry[]>([]);
  const [loading, setLoading] = useState(true);

  const [itemOpen, setItemOpen] = useState(false);
  const [itemCode, setItemCode] = useState("");
  const [itemName, setItemName] = useState("");
  const [itemUom, setItemUom] = useState("");
  const [creatingItem, setCreatingItem] = useState(false);

  const [whOpen, setWhOpen] = useState(false);
  const [whName, setWhName] = useState("");
  const [creatingWh, setCreatingWh] = useState(false);

  const [opOpen, setOpOpen] = useState(false);
  const [opType, setOpType] = useState<"receipt" | "issue">("receipt");
  const [opItemId, setOpItemId] = useState("");
  const [opWarehouseId, setOpWarehouseId] = useState("");
  const [opQty, setOpQty] = useState("");
  const [opRate, setOpRate] = useState("");
  const [opDate, setOpDate] = useState(new Date().toISOString().slice(0, 10));
  const [posting, setPosting] = useState(false);

  const [valuation, setValuation] = useState<{ qty: number; value: number; averageCost: number } | null>(null);

  const load = useCallback(() => {
    Promise.all([fetch("/api/erp/stock/items"), fetch("/api/erp/stock/warehouses"), fetch("/api/erp/inventory/ledger")])
      .then(([iRes, wRes, lRes]) => Promise.all([iRes.json(), wRes.json(), lRes.json()]))
      .then(([iData, wData, lData]) => {
        setItems(iData.items ?? []);
        setWarehouses(wData.warehouses ?? []);
        setLedger(lData.entries ?? []);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, []);

  useEffect(load, [load]);

  const createItem = async () => {
    if (!itemCode.trim() || !itemName.trim()) return;
    setCreatingItem(true);
    const res = await fetch("/api/erp/stock/items", {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ itemCode, itemName, uom: itemUom || undefined }),
    });
    setCreatingItem(false);
    if (!res.ok) { const d = await res.json().catch(() => ({})); toast.error(d.error ?? "Failed to create item"); return; }
    setItemOpen(false); setItemCode(""); setItemName(""); setItemUom("");
    toast.success("Item created");
    load();
  };

  const createWarehouse = async () => {
    if (!whName.trim()) return;
    setCreatingWh(true);
    const res = await fetch("/api/erp/stock/warehouses", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ warehouseName: whName }) });
    setCreatingWh(false);
    if (!res.ok) { const d = await res.json().catch(() => ({})); toast.error(d.error ?? "Failed to create warehouse"); return; }
    setWhOpen(false); setWhName("");
    toast.success("Warehouse created");
    load();
  };

  const checkValuation = useCallback(() => {
    Promise.resolve().then(() => {
      if (!opItemId || !opWarehouseId) { setValuation(null); return undefined; }
      return fetch(`/api/erp/inventory/valuation?itemId=${opItemId}&warehouseId=${opWarehouseId}`).then((r) => r.json()).then(setValuation);
    }).catch(() => setValuation(null));
  }, [opItemId, opWarehouseId]);
  useEffect(checkValuation, [checkValuation]);

  const postOperation = async () => {
    setPosting(true);
    const endpoint = opType === "receipt" ? "/api/erp/inventory/receipts" : "/api/erp/inventory/issues";
    const body = opType === "receipt"
      ? { itemId: opItemId, warehouseId: opWarehouseId, quantity: Number(opQty) || 0, rate: Number(opRate) || 0, postingDate: opDate }
      : { itemId: opItemId, warehouseId: opWarehouseId, quantity: Number(opQty) || 0, postingDate: opDate };
    const res = await fetch(endpoint, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    setPosting(false);
    if (!res.ok) { const d = await res.json().catch(() => ({})); toast.error(d.error ?? "Failed to post"); return; }
    setOpOpen(false); setOpQty(""); setOpRate("");
    toast.success(opType === "receipt" ? "Stock receipt posted" : "Stock issue posted (FIFO cost computed)");
    load();
  };

  return (
    <div className="space-y-4">
      <div>
        <h1 className="font-heading text-2xl md:text-3xl text-ct-navy">Inventory</h1>
        <p className="text-sm text-ct-muted mt-1">Items, warehouses, and FIFO-valued stock movements — VERI ERP AI</p>
      </div>

      <Tabs defaultValue="ledger">
        <TabsList>
          <TabsTrigger value="ledger">Stock Ledger</TabsTrigger>
          <TabsTrigger value="items">Items</TabsTrigger>
          <TabsTrigger value="warehouses">Warehouses</TabsTrigger>
        </TabsList>

        <TabsContent value="ledger" className="space-y-3">
          <div className="flex justify-end">
            <Dialog open={opOpen} onOpenChange={setOpOpen}>
              <DialogTrigger asChild><Button className="bg-ct-teal hover:bg-ct-teal-hover text-white"><Plus className="w-4 h-4 mr-1" />Receipt / Issue</Button></DialogTrigger>
              <DialogContent>
                <DialogHeader><DialogTitle>Stock Movement</DialogTitle></DialogHeader>
                <div className="space-y-3">
                  <div><Label>Type</Label>
                    <Select value={opType} onValueChange={(v) => setOpType(v as "receipt" | "issue")}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent><SelectItem value="receipt">Receipt (stock in)</SelectItem><SelectItem value="issue">Issue (stock out, FIFO cost)</SelectItem></SelectContent>
                    </Select>
                  </div>
                  <div><Label>Item</Label>
                    <Select value={opItemId} onValueChange={setOpItemId}>
                      <SelectTrigger><SelectValue placeholder="Select item" /></SelectTrigger>
                      <SelectContent>{items.map((i) => <SelectItem key={i.id} value={i.id}>{i.itemCode} — {i.itemName}</SelectItem>)}</SelectContent>
                    </Select>
                  </div>
                  <div><Label>Warehouse</Label>
                    <Select value={opWarehouseId} onValueChange={setOpWarehouseId}>
                      <SelectTrigger><SelectValue placeholder="Select warehouse" /></SelectTrigger>
                      <SelectContent>{warehouses.map((w) => <SelectItem key={w.id} value={w.id}>{w.warehouseName}</SelectItem>)}</SelectContent>
                    </Select>
                  </div>
                  {valuation && <p className="text-xs text-ct-muted">On hand: {valuation.qty} @ avg cost {valuation.averageCost.toFixed(2)} (value {valuation.value.toFixed(2)})</p>}
                  <div className="grid grid-cols-2 gap-3">
                    <div><Label>Quantity</Label><Input type="number" value={opQty} onChange={(e) => setOpQty(e.target.value)} /></div>
                    {opType === "receipt" && <div><Label>Rate</Label><Input type="number" value={opRate} onChange={(e) => setOpRate(e.target.value)} /></div>}
                  </div>
                  <div><Label>Date</Label><Input type="date" value={opDate} onChange={(e) => setOpDate(e.target.value)} /></div>
                </div>
                <DialogFooter><Button onClick={postOperation} disabled={posting || !opItemId || !opWarehouseId || !opQty} className="bg-ct-teal hover:bg-ct-teal-hover text-white">{posting && <Loader2 className="w-4 h-4 mr-1 animate-spin" />}Post</Button></DialogFooter>
              </DialogContent>
            </Dialog>
          </div>
          <Card className="rounded-xl shadow-card bg-white">
            <CardContent className="p-0">
              <table className="w-full text-xs">
                <thead><tr className="text-left text-ct-muted border-b border-ct-border"><th className="p-3 font-medium">Date</th><th className="p-3 font-medium">Type</th><th className="p-3 font-medium text-right">Qty Change</th><th className="p-3 font-medium text-right">Rate</th><th className="p-3 font-medium text-right">Balance Qty</th><th className="p-3 font-medium text-right">Balance Value</th></tr></thead>
                <tbody className="divide-y divide-ct-border">
                  {loading ? <tr><td colSpan={6} className="p-6 text-center text-ct-muted">Loading…</td></tr>
                    : ledger.length === 0 ? <tr><td colSpan={6} className="p-6 text-center text-ct-muted">No stock movements yet.</td></tr>
                    : ledger.map((e) => (
                      <tr key={e.id} className="hover:bg-ct-row-hover">
                        <td className="p-3">{e.postingDate}</td><td className="p-3">{e.voucherType}</td>
                        <td className="p-3 text-right">{Number(e.quantityChange) > 0 ? "+" : ""}{Number(e.quantityChange).toFixed(2)}</td>
                        <td className="p-3 text-right">{Number(e.valuationRate).toFixed(2)}</td>
                        <td className="p-3 text-right">{Number(e.balanceQty).toFixed(2)}</td>
                        <td className="p-3 text-right">{Number(e.balanceValue).toFixed(2)}</td>
                      </tr>
                    ))}
                </tbody>
              </table>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="items" className="space-y-3">
          <div className="flex justify-end">
            <Dialog open={itemOpen} onOpenChange={setItemOpen}>
              <DialogTrigger asChild><Button className="bg-ct-teal hover:bg-ct-teal-hover text-white"><Plus className="w-4 h-4 mr-1" />New Item</Button></DialogTrigger>
              <DialogContent>
                <DialogHeader><DialogTitle>New Item</DialogTitle></DialogHeader>
                <div className="space-y-3">
                  <div><Label>Item Code</Label><Input value={itemCode} onChange={(e) => setItemCode(e.target.value)} /></div>
                  <div><Label>Item Name</Label><Input value={itemName} onChange={(e) => setItemName(e.target.value)} /></div>
                  <div><Label>UOM (optional)</Label><Input value={itemUom} onChange={(e) => setItemUom(e.target.value)} placeholder="e.g. Nos, Kg, Box" /></div>
                </div>
                <DialogFooter><Button onClick={createItem} disabled={creatingItem} className="bg-ct-teal hover:bg-ct-teal-hover text-white">{creatingItem && <Loader2 className="w-4 h-4 mr-1 animate-spin" />}Create</Button></DialogFooter>
              </DialogContent>
            </Dialog>
          </div>
          <Card className="rounded-xl shadow-card bg-white">
            <CardContent className="p-0">
              <table className="w-full text-xs">
                <thead><tr className="text-left text-ct-muted border-b border-ct-border"><th className="p-3 font-medium">Code</th><th className="p-3 font-medium">Name</th><th className="p-3 font-medium">UOM</th></tr></thead>
                <tbody className="divide-y divide-ct-border">
                  {items.length === 0 ? <tr><td colSpan={3} className="p-6 text-center text-ct-muted">No items yet.</td></tr>
                    : items.map((i) => <tr key={i.id} className="hover:bg-ct-row-hover"><td className="p-3">{i.itemCode}</td><td className="p-3">{i.itemName}</td><td className="p-3">{i.uom ?? "—"}</td></tr>)}
                </tbody>
              </table>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="warehouses" className="space-y-3">
          <div className="flex justify-end">
            <Dialog open={whOpen} onOpenChange={setWhOpen}>
              <DialogTrigger asChild><Button className="bg-ct-teal hover:bg-ct-teal-hover text-white"><Plus className="w-4 h-4 mr-1" />New Warehouse</Button></DialogTrigger>
              <DialogContent>
                <DialogHeader><DialogTitle>New Warehouse</DialogTitle></DialogHeader>
                <div><Label>Name</Label><Input value={whName} onChange={(e) => setWhName(e.target.value)} /></div>
                <DialogFooter><Button onClick={createWarehouse} disabled={creatingWh} className="bg-ct-teal hover:bg-ct-teal-hover text-white">{creatingWh && <Loader2 className="w-4 h-4 mr-1 animate-spin" />}Create</Button></DialogFooter>
              </DialogContent>
            </Dialog>
          </div>
          <Card className="rounded-xl shadow-card bg-white">
            <CardContent className="p-0">
              <table className="w-full text-xs">
                <thead><tr className="text-left text-ct-muted border-b border-ct-border"><th className="p-3 font-medium">Name</th></tr></thead>
                <tbody className="divide-y divide-ct-border">
                  {warehouses.length === 0 ? <tr><td className="p-6 text-center text-ct-muted">No warehouses yet.</td></tr>
                    : warehouses.map((w) => <tr key={w.id} className="hover:bg-ct-row-hover"><td className="p-3">{w.warehouseName}</td></tr>)}
                </tbody>
              </table>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
