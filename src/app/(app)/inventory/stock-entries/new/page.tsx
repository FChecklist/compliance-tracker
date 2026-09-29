"use client";

// force-dynamic: see src/app/(app)/knowledge-base/page.tsx for why this is
// required (prevents static prerendering + CDN-cache bypass of middleware).
export const dynamic = "force-dynamic";

// PROJEXA server-merge (ai-os/PROJEXA_SERVER_MERGE_PLAN.md): port of
// PROJEXA's own StockEntryCreateClient.tsx. POSTs to the already-native POST
// /api/v1/projexa/inventory/stock-entries route (recordStockReceipt/
// recordStockIssue in erp-inventory-service.ts, dispatched by a `type`
// discriminator) -- zero new backend route, same real FIFO valuation engine
// every other stock movement in this codebase already posts through.
//
// No Object Page: a stock ledger entry is a write-once transaction record,
// not an editable object -- same honest scope cut PROJEXA's own reference
// page makes.
//
// Rebuilt on this repo's own Card/Input/Select (matching
// src/app/(app)/purchase-orders/new/page.tsx), not PROJEXA's
// @fchecklist/veridian-ui-kit ObjectScreen.
//
// Two deliberate adaptations from PROJEXA's own reference page:
//  1. Sole-warehouse auto-select (PROJEXA's own R80 GAP-8 comment: most
//     construction orgs run one store, so pre-selecting it rather than
//     making a storekeeper open a dropdown for the only answer there is)
//     is reproduced inline here rather than importing PROJEXA's private
//     lib/reference-lookups helper, which has no equivalent in this repo.
//  2. A real gap in PROJEXA's own screen is fixed rather than ported as-is:
//     recordStockReceipt() throws "This item requires a batch number" for
//     any item with hasBatchNo=true (erp-inventory-service.ts), but
//     PROJEXA's own StockEntryCreateClient never collects one -- every
//     receipt against a batch-tracked item fails there. Batch Number
//     (required) + Expiry Date (optional) fields are shown here whenever
//     the selected item is batch-tracked and the movement is a receipt,
//     using hasBatchNo off the same GET /api/v1/projexa/inventory/items
//     list this screen already loads.
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

type ItemRow = { id: string; itemCode: string; itemName: string; hasBatchNo: boolean };
type WarehouseRow = { id: string; warehouseName: string };

export default function StockEntryNewPage() {
  const router = useRouter();
  const [items, setItems] = useState<ItemRow[]>([]);
  const [warehouses, setWarehouses] = useState<WarehouseRow[]>([]);
  const [entryType, setEntryType] = useState<"receipt" | "issue">("receipt");
  const [itemId, setItemId] = useState("");
  const [warehouseId, setWarehouseId] = useState("");
  const [quantity, setQuantity] = useState("");
  const [rate, setRate] = useState("");
  const [batchNumber, setBatchNumber] = useState("");
  const [expiryDate, setExpiryDate] = useState("");
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    fetch("/api/v1/projexa/inventory/items").then((r) => r.json()).then((d) => setItems(d.items ?? [])).catch(() => {});
    fetch("/api/v1/projexa/inventory/warehouses")
      .then((r) => r.json())
      .then((d) => {
        const rows = d.warehouses ?? [];
        setWarehouses(rows);
        // Most construction orgs run ONE store -- see this file's header
        // comment (adaptation 1). Seeded through the updater so a pick made
        // while the list was still in flight wins.
        if (rows.length === 1) setWarehouseId((prev) => prev || rows[0].id);
      })
      .catch(() => {});
  }, []);

  const selectedItem = items.find((i) => i.id === itemId);
  const needsBatchNumber = entryType === "receipt" && !!selectedItem?.hasBatchNo;

  async function recordEntry() {
    if (!itemId || !warehouseId || !quantity) {
      toast.error("Item, warehouse, and quantity are required");
      return;
    }
    if (needsBatchNumber && !batchNumber.trim()) {
      toast.error("This item requires a batch number");
      return;
    }
    setSubmitting(true);
    try {
      const res = await fetch("/api/v1/projexa/inventory/stock-entries", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          type: entryType, itemId, warehouseId, quantity: Number(quantity),
          rate: entryType === "receipt" && rate ? Number(rate) : undefined,
          postingDate: new Date().toISOString().slice(0, 10),
          batchNumber: needsBatchNumber ? batchNumber.trim() : undefined,
          expiryDate: needsBatchNumber && expiryDate ? expiryDate : undefined,
        }),
      });
      const body = await res.json().catch(() => null);
      if (!res.ok) throw new Error(body?.error ?? "Couldn't record stock entry");
      toast.success(entryType === "receipt" ? "Stock receipt recorded" : "Stock issue recorded");
      router.push("/inventory?tab=balances");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Couldn't record stock entry");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="space-y-4 max-w-2xl">
      <div>
        <h1 className="text-2xl font-heading text-ct-navy">Record Stock Movement</h1>
        <p className="text-sm text-ct-muted mt-1">Inventory / Record Stock Movement</p>
      </div>

      <Card className="rounded-xl shadow-card bg-white">
        <CardHeader><CardTitle className="text-base text-ct-navy">Movement Details</CardTitle></CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-1.5">
            <Label className="text-xs font-semibold text-ct-muted uppercase">Movement Type</Label>
            <Select value={entryType} onValueChange={(v) => setEntryType(v as "receipt" | "issue")}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="receipt">Receipt (stock in)</SelectItem>
                <SelectItem value="issue">Issue (stock out)</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs font-semibold text-ct-muted uppercase">Item</Label>
            <Select value={itemId} onValueChange={setItemId}>
              <SelectTrigger><SelectValue placeholder={items.length ? "Select item" : "No items found"} /></SelectTrigger>
              <SelectContent>{items.map((i) => <SelectItem key={i.id} value={i.id}>{i.itemName} ({i.itemCode})</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs font-semibold text-ct-muted uppercase">Warehouse</Label>
            <Select value={warehouseId} onValueChange={setWarehouseId}>
              <SelectTrigger><SelectValue placeholder={warehouses.length ? "Select warehouse" : "No warehouses found"} /></SelectTrigger>
              <SelectContent>{warehouses.map((w) => <SelectItem key={w.id} value={w.id}>{w.warehouseName}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label className="text-xs font-semibold text-ct-muted uppercase">Quantity</Label>
              <Input type="number" value={quantity} onChange={(e) => setQuantity(e.target.value)} />
            </div>
            {entryType === "receipt" && (
              <div className="space-y-1.5">
                <Label className="text-xs font-semibold text-ct-muted uppercase">Rate (optional)</Label>
                <Input type="number" value={rate} onChange={(e) => setRate(e.target.value)} />
              </div>
            )}
          </div>
          {needsBatchNumber && (
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label className="text-xs font-semibold text-ct-muted uppercase">Batch Number</Label>
                <Input value={batchNumber} onChange={(e) => setBatchNumber(e.target.value)} placeholder="This item is batch tracked" />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs font-semibold text-ct-muted uppercase">Expiry Date (optional)</Label>
                <Input type="date" value={expiryDate} onChange={(e) => setExpiryDate(e.target.value)} />
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      <div className="flex justify-end gap-2">
        <Button variant="outline" onClick={() => router.push("/inventory?tab=balances")} disabled={submitting}>Cancel</Button>
        <Button
          className="bg-ct-saffron hover:bg-ct-saffron-hover text-white shadow-saffron"
          onClick={recordEntry}
          disabled={submitting || !itemId || !warehouseId || !quantity}
        >
          {submitting ? <Loader2 className="size-4 mr-2 animate-spin" /> : null}
          {submitting ? "Recording..." : "Record Movement"}
        </Button>
      </div>
    </div>
  );
}
