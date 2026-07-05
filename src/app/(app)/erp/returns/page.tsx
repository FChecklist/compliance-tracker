"use client";

// force-dynamic: see src/app/(app)/knowledge-base/page.tsx for why this is
// required (prevents static prerendering + CDN-cache bypass of middleware).
export const dynamic = "force-dynamic";

// Wave 63 (RMA/Returns Workflow, ERP benchmark Tier 3 #11 remainder).
// 2 tabs: Sales Returns (customer RMA -> received back into stock),
// Purchase Returns (supplier RMA -> dispatched out of stock). Both post
// real FIFO stock movements on receive/dispatch via the same engine every
// other stock movement uses -- not a parallel valuation path.
import { useEffect, useState, useCallback } from "react";
import { toast } from "sonner";
import { Undo2, Plus, Loader2, Trash2, Link2 } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger,
} from "@/components/ui/dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";

type ReturnItem = { itemId: string; quantity: number; rate: number };
type SalesReturn = { id: string; customerId: string; warehouseId: string; status: string; reason: string | null; creditNoteId: string | null; items: ReturnItem[] };
type PurchaseReturn = { id: string; supplierId: string; warehouseId: string; status: string; reason: string | null; creditNoteId: string | null; items: ReturnItem[] };
type Customer = { id: string; customerName: string };
type Supplier = { id: string; supplierName: string };
type Item = { id: string; itemName: string };
type Warehouse = { id: string; warehouseName: string };
type CreditNote = { id: string; creditNoteNumber: number };

const STATUS_VARIANT: Record<string, "default" | "secondary" | "outline"> = {
  requested: "outline", approved: "secondary", received: "default", dispatched: "default", rejected: "secondary",
};

export default function ErpReturnsPage() {
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [items, setItems] = useState<Item[]>([]);
  const [warehouses, setWarehouses] = useState<Warehouse[]>([]);
  const [salesCreditNotes, setSalesCreditNotes] = useState<CreditNote[]>([]);
  const [purchaseCreditNotes, setPurchaseCreditNotes] = useState<CreditNote[]>([]);
  const [salesReturns, setSalesReturns] = useState<SalesReturn[]>([]);
  const [purchaseReturns, setPurchaseReturns] = useState<PurchaseReturn[]>([]);
  const [loading, setLoading] = useState(true);

  const [salesDialogOpen, setSalesDialogOpen] = useState(false);
  const [salesCustomerId, setSalesCustomerId] = useState("");
  const [salesWarehouseId, setSalesWarehouseId] = useState("");
  const [salesReason, setSalesReason] = useState("");
  const [salesItemId, setSalesItemId] = useState("");
  const [salesQty, setSalesQty] = useState("1");
  const [creatingSales, setCreatingSales] = useState(false);

  const [purchaseDialogOpen, setPurchaseDialogOpen] = useState(false);
  const [purchaseSupplierId, setPurchaseSupplierId] = useState("");
  const [purchaseWarehouseId, setPurchaseWarehouseId] = useState("");
  const [purchaseReason, setPurchaseReason] = useState("");
  const [purchaseItemId, setPurchaseItemId] = useState("");
  const [purchaseQty, setPurchaseQty] = useState("1");
  const [creatingPurchase, setCreatingPurchase] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    const [customersRes, suppliersRes, itemsRes, warehousesRes, salesCnRes, purchaseCnRes, salesRes, purchaseRes] = await Promise.all([
      fetch("/api/erp/selling/customers").catch(() => null),
      fetch("/api/erp/buying/suppliers").catch(() => null),
      fetch("/api/erp/stock/items").catch(() => null),
      fetch("/api/erp/stock/warehouses").catch(() => null),
      fetch("/api/erp/sales-credit-notes").catch(() => null),
      fetch("/api/erp/purchase-credit-notes").catch(() => null),
      fetch("/api/erp/returns/sales"),
      fetch("/api/erp/returns/purchase"),
    ]);
    setCustomers(customersRes ? (await customersRes.json()).customers ?? [] : []);
    setSuppliers(suppliersRes ? (await suppliersRes.json()).suppliers ?? [] : []);
    setItems(itemsRes ? (await itemsRes.json()).items ?? [] : []);
    setWarehouses(warehousesRes ? (await warehousesRes.json()).warehouses ?? [] : []);
    setSalesCreditNotes(salesCnRes ? (await salesCnRes.json()).creditNotes ?? [] : []);
    setPurchaseCreditNotes(purchaseCnRes ? (await purchaseCnRes.json()).creditNotes ?? [] : []);
    setSalesReturns((await salesRes.json()).returns ?? []);
    setPurchaseReturns((await purchaseRes.json()).returns ?? []);
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  const itemName = (id: string) => items.find((i) => i.id === id)?.itemName ?? id;
  const customerLabel = (id: string) => customers.find((c) => c.id === id)?.customerName ?? id;
  const supplierLabel = (id: string) => suppliers.find((s) => s.id === id)?.supplierName ?? id;

  const createSalesReturn = async () => {
    if (!salesCustomerId || !salesWarehouseId || !salesItemId) return;
    setCreatingSales(true);
    try {
      const res = await fetch("/api/erp/returns/sales", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          customerId: salesCustomerId, warehouseId: salesWarehouseId, reason: salesReason || undefined,
          items: [{ itemId: salesItemId, quantity: Number(salesQty) }],
        }),
      });
      if (!res.ok) throw new Error();
      toast.success("Sales return requested");
      setSalesDialogOpen(false); setSalesCustomerId(""); setSalesWarehouseId(""); setSalesReason(""); setSalesItemId(""); setSalesQty("1");
      load();
    } catch { toast.error("Failed to create sales return"); } finally { setCreatingSales(false); }
  };

  const createPurchaseReturn = async () => {
    if (!purchaseSupplierId || !purchaseWarehouseId || !purchaseItemId) return;
    setCreatingPurchase(true);
    try {
      const res = await fetch("/api/erp/returns/purchase", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          supplierId: purchaseSupplierId, warehouseId: purchaseWarehouseId, reason: purchaseReason || undefined,
          items: [{ itemId: purchaseItemId, quantity: Number(purchaseQty) }],
        }),
      });
      if (!res.ok) throw new Error();
      toast.success("Purchase return requested");
      setPurchaseDialogOpen(false); setPurchaseSupplierId(""); setPurchaseWarehouseId(""); setPurchaseReason(""); setPurchaseItemId(""); setPurchaseQty("1");
      load();
    } catch { toast.error("Failed to create purchase return"); } finally { setCreatingPurchase(false); }
  };

  const salesAction = async (id: string, action: "approve" | "reject" | "receive") => {
    try {
      const res = await fetch(`/api/erp/returns/sales/${id}/${action}`, { method: "POST" });
      if (!res.ok) { const data = await res.json(); throw new Error(data.error); }
      toast.success(`Return ${action === "receive" ? "received" : action + "d"}`);
      load();
    } catch (e) { toast.error(e instanceof Error ? e.message : `Failed to ${action} return`); }
  };

  const purchaseAction = async (id: string, action: "approve" | "reject" | "dispatch") => {
    try {
      const res = await fetch(`/api/erp/returns/purchase/${id}/${action}`, { method: "POST" });
      if (!res.ok) { const data = await res.json(); throw new Error(data.error); }
      toast.success(`Return ${action === "dispatch" ? "dispatched" : action + "d"}`);
      load();
    } catch (e) { toast.error(e instanceof Error ? e.message : `Failed to ${action} return`); }
  };

  const linkSalesCreditNote = async (id: string, creditNoteId: string) => {
    try {
      const res = await fetch(`/api/erp/returns/sales/${id}/credit-note`, {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ creditNoteId }),
      });
      if (!res.ok) throw new Error();
      toast.success("Credit note linked"); load();
    } catch { toast.error("Failed to link credit note"); }
  };

  const linkPurchaseCreditNote = async (id: string, creditNoteId: string) => {
    try {
      const res = await fetch(`/api/erp/returns/purchase/${id}/credit-note`, {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ creditNoteId }),
      });
      if (!res.ok) throw new Error();
      toast.success("Credit note linked"); load();
    } catch { toast.error("Failed to link credit note"); }
  };

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-heading text-ct-navy">Returns (RMA)</h1>
        <p className="text-sm text-ct-muted mt-1">Customer and supplier return requests, moving stock back through the FIFO engine on receive/dispatch.</p>
      </div>

      {loading ? <p className="text-sm text-ct-muted">Loading...</p> : (
        <Tabs defaultValue="sales">
          <TabsList>
            <TabsTrigger value="sales">Sales Returns</TabsTrigger>
            <TabsTrigger value="purchase">Purchase Returns</TabsTrigger>
          </TabsList>

          <TabsContent value="sales" className="space-y-3">
            <div className="flex justify-end">
              <Dialog open={salesDialogOpen} onOpenChange={setSalesDialogOpen}>
                <DialogTrigger asChild>
                  <Button className="bg-ct-saffron hover:bg-ct-saffron-hover text-white"><Plus className="size-4 mr-2" />New Sales Return</Button>
                </DialogTrigger>
                <DialogContent>
                  <DialogHeader><DialogTitle>New Sales Return</DialogTitle><DialogDescription>Customer returning goods -- received back into the chosen warehouse once approved.</DialogDescription></DialogHeader>
                  <div className="space-y-4 py-2">
                    <div className="space-y-1.5">
                      <Label className="text-xs font-semibold text-ct-muted uppercase">Customer</Label>
                      <Select value={salesCustomerId} onValueChange={setSalesCustomerId}>
                        <SelectTrigger><SelectValue placeholder="Select customer" /></SelectTrigger>
                        <SelectContent>{customers.map((c) => <SelectItem key={c.id} value={c.id}>{c.customerName}</SelectItem>)}</SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-1.5">
                      <Label className="text-xs font-semibold text-ct-muted uppercase">Warehouse</Label>
                      <Select value={salesWarehouseId} onValueChange={setSalesWarehouseId}>
                        <SelectTrigger><SelectValue placeholder="Select warehouse" /></SelectTrigger>
                        <SelectContent>{warehouses.map((w) => <SelectItem key={w.id} value={w.id}>{w.warehouseName}</SelectItem>)}</SelectContent>
                      </Select>
                    </div>
                    <div className="grid grid-cols-2 gap-3">
                      <div className="space-y-1.5">
                        <Label className="text-xs font-semibold text-ct-muted uppercase">Item</Label>
                        <Select value={salesItemId} onValueChange={setSalesItemId}>
                          <SelectTrigger><SelectValue placeholder="Select item" /></SelectTrigger>
                          <SelectContent>{items.map((i) => <SelectItem key={i.id} value={i.id}>{i.itemName}</SelectItem>)}</SelectContent>
                        </Select>
                      </div>
                      <div className="space-y-1.5">
                        <Label className="text-xs font-semibold text-ct-muted uppercase">Quantity</Label>
                        <Input type="number" value={salesQty} onChange={(e) => setSalesQty(e.target.value)} />
                      </div>
                    </div>
                    <div className="space-y-1.5"><Label className="text-xs font-semibold text-ct-muted uppercase">Reason</Label><Input value={salesReason} onChange={(e) => setSalesReason(e.target.value)} placeholder="Damaged in transit" /></div>
                  </div>
                  <DialogFooter><Button onClick={createSalesReturn} disabled={creatingSales || !salesCustomerId || !salesWarehouseId || !salesItemId} className="bg-ct-saffron hover:bg-ct-saffron-hover text-white">{creatingSales ? <Loader2 className="size-4 mr-2 animate-spin" /> : null}Request Return</Button></DialogFooter>
                </DialogContent>
              </Dialog>
            </div>
            {salesReturns.length === 0 ? (
              <Card className="rounded-xl shadow-card bg-white"><CardContent className="pt-10 pb-10 text-center space-y-2"><Undo2 className="size-10 text-ct-muted mx-auto" /><p className="text-sm text-ct-muted">No sales returns yet.</p></CardContent></Card>
            ) : (
              <div className="rounded-xl border border-ct-border bg-white divide-y divide-ct-border">
                {salesReturns.map((r) => (
                  <div key={r.id} className="px-4 py-3 flex items-center gap-3">
                    <Undo2 className="size-4 text-ct-teal shrink-0" />
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-ct-navy">{customerLabel(r.customerId)}</p>
                      <p className="text-xs text-ct-muted">{r.items.map((i) => `${itemName(i.itemId)} x${i.quantity}`).join(", ")}{r.reason ? ` -- ${r.reason}` : ""}</p>
                    </div>
                    <Badge variant={STATUS_VARIANT[r.status]} className="text-xs">{r.status}</Badge>
                    {r.status === "requested" && <Button size="sm" variant="ghost" onClick={() => salesAction(r.id, "approve")}>Approve</Button>}
                    {r.status === "requested" && <Button size="sm" variant="ghost" onClick={() => salesAction(r.id, "reject")}><Trash2 className="size-3.5 text-ct-error" /></Button>}
                    {r.status === "approved" && <Button size="sm" variant="ghost" onClick={() => salesAction(r.id, "receive")}>Receive into Stock</Button>}
                    {r.status === "received" && !r.creditNoteId && salesCreditNotes.length > 0 && (
                      <Select onValueChange={(v) => linkSalesCreditNote(r.id, v)}>
                        <SelectTrigger className="w-40 h-8"><Link2 className="size-3.5 mr-1" /><SelectValue placeholder="Link credit note" /></SelectTrigger>
                        <SelectContent>{salesCreditNotes.map((cn) => <SelectItem key={cn.id} value={cn.id}>CN #{cn.creditNoteNumber}</SelectItem>)}</SelectContent>
                      </Select>
                    )}
                    {r.creditNoteId && <Badge variant="outline" className="text-xs">Credited</Badge>}
                  </div>
                ))}
              </div>
            )}
          </TabsContent>

          <TabsContent value="purchase" className="space-y-3">
            <div className="flex justify-end">
              <Dialog open={purchaseDialogOpen} onOpenChange={setPurchaseDialogOpen}>
                <DialogTrigger asChild>
                  <Button className="bg-ct-saffron hover:bg-ct-saffron-hover text-white"><Plus className="size-4 mr-2" />New Purchase Return</Button>
                </DialogTrigger>
                <DialogContent>
                  <DialogHeader><DialogTitle>New Purchase Return</DialogTitle><DialogDescription>Returning goods to a supplier -- dispatched out of the chosen warehouse once approved.</DialogDescription></DialogHeader>
                  <div className="space-y-4 py-2">
                    <div className="space-y-1.5">
                      <Label className="text-xs font-semibold text-ct-muted uppercase">Supplier</Label>
                      <Select value={purchaseSupplierId} onValueChange={setPurchaseSupplierId}>
                        <SelectTrigger><SelectValue placeholder="Select supplier" /></SelectTrigger>
                        <SelectContent>{suppliers.map((s) => <SelectItem key={s.id} value={s.id}>{s.supplierName}</SelectItem>)}</SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-1.5">
                      <Label className="text-xs font-semibold text-ct-muted uppercase">Warehouse</Label>
                      <Select value={purchaseWarehouseId} onValueChange={setPurchaseWarehouseId}>
                        <SelectTrigger><SelectValue placeholder="Select warehouse" /></SelectTrigger>
                        <SelectContent>{warehouses.map((w) => <SelectItem key={w.id} value={w.id}>{w.warehouseName}</SelectItem>)}</SelectContent>
                      </Select>
                    </div>
                    <div className="grid grid-cols-2 gap-3">
                      <div className="space-y-1.5">
                        <Label className="text-xs font-semibold text-ct-muted uppercase">Item</Label>
                        <Select value={purchaseItemId} onValueChange={setPurchaseItemId}>
                          <SelectTrigger><SelectValue placeholder="Select item" /></SelectTrigger>
                          <SelectContent>{items.map((i) => <SelectItem key={i.id} value={i.id}>{i.itemName}</SelectItem>)}</SelectContent>
                        </Select>
                      </div>
                      <div className="space-y-1.5">
                        <Label className="text-xs font-semibold text-ct-muted uppercase">Quantity</Label>
                        <Input type="number" value={purchaseQty} onChange={(e) => setPurchaseQty(e.target.value)} />
                      </div>
                    </div>
                    <div className="space-y-1.5"><Label className="text-xs font-semibold text-ct-muted uppercase">Reason</Label><Input value={purchaseReason} onChange={(e) => setPurchaseReason(e.target.value)} placeholder="Quality issue" /></div>
                  </div>
                  <DialogFooter><Button onClick={createPurchaseReturn} disabled={creatingPurchase || !purchaseSupplierId || !purchaseWarehouseId || !purchaseItemId} className="bg-ct-saffron hover:bg-ct-saffron-hover text-white">{creatingPurchase ? <Loader2 className="size-4 mr-2 animate-spin" /> : null}Request Return</Button></DialogFooter>
                </DialogContent>
              </Dialog>
            </div>
            {purchaseReturns.length === 0 ? (
              <Card className="rounded-xl shadow-card bg-white"><CardContent className="pt-10 pb-10 text-center space-y-2"><Undo2 className="size-10 text-ct-muted mx-auto" /><p className="text-sm text-ct-muted">No purchase returns yet.</p></CardContent></Card>
            ) : (
              <div className="rounded-xl border border-ct-border bg-white divide-y divide-ct-border">
                {purchaseReturns.map((r) => (
                  <div key={r.id} className="px-4 py-3 flex items-center gap-3">
                    <Undo2 className="size-4 text-ct-teal shrink-0" />
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-ct-navy">{supplierLabel(r.supplierId)}</p>
                      <p className="text-xs text-ct-muted">{r.items.map((i) => `${itemName(i.itemId)} x${i.quantity}`).join(", ")}{r.reason ? ` -- ${r.reason}` : ""}</p>
                    </div>
                    <Badge variant={STATUS_VARIANT[r.status]} className="text-xs">{r.status}</Badge>
                    {r.status === "requested" && <Button size="sm" variant="ghost" onClick={() => purchaseAction(r.id, "approve")}>Approve</Button>}
                    {r.status === "requested" && <Button size="sm" variant="ghost" onClick={() => purchaseAction(r.id, "reject")}><Trash2 className="size-3.5 text-ct-error" /></Button>}
                    {r.status === "approved" && <Button size="sm" variant="ghost" onClick={() => purchaseAction(r.id, "dispatch")}>Dispatch to Supplier</Button>}
                    {r.status === "dispatched" && !r.creditNoteId && purchaseCreditNotes.length > 0 && (
                      <Select onValueChange={(v) => linkPurchaseCreditNote(r.id, v)}>
                        <SelectTrigger className="w-40 h-8"><Link2 className="size-3.5 mr-1" /><SelectValue placeholder="Link credit note" /></SelectTrigger>
                        <SelectContent>{purchaseCreditNotes.map((cn) => <SelectItem key={cn.id} value={cn.id}>CN #{cn.creditNoteNumber}</SelectItem>)}</SelectContent>
                      </Select>
                    )}
                    {r.creditNoteId && <Badge variant="outline" className="text-xs">Credited</Badge>}
                  </div>
                ))}
              </div>
            )}
          </TabsContent>
        </Tabs>
      )}
    </div>
  );
}
