"use client";

// force-dynamic: see src/app/(app)/knowledge-base/page.tsx for why this is
// required (prevents static prerendering + CDN-cache bypass of middleware).
export const dynamic = "force-dynamic";

// PROJEXA server-merge (ai-os/PROJEXA_SERVER_MERGE_PLAN.md): port of
// PROJEXA's own GoodsReceiptCreateClient.tsx. POSTs to the SAME
// POST /api/v1/projexa/procurement/goods-receipts this app's backend
// already serves (createPurchaseReceipt in erp-goods-receipt-service.ts),
// which requires every line to name a receiving warehouse.
//
// Accepts an optional ?poId= query param (read via useSearchParams, wrapped
// in its own Suspense boundary -- same pattern already used by this repo's
// src/app/(app)/budgets/new/page.tsx) to prefill from the Purchase Order
// Object Page's "Receive Goods" link. Seeds one editable row per PO line
// (ordered quantity, ordered stock item where the line names one, and the
// PO line's own description as a read-only caption) by reading the single-PO
// route (GET /api/v1/projexa/procurement/purchase-orders/{id}, whose
// getPurchaseOrder() returns `with: { items: true }`) -- same seeding logic
// as PROJEXA's own screen, including posting each seeded row's PO line id
// as `purchaseOrderItemId` (credits the order's receivedQuantity and gives
// the line its rate fallback at submit time -- see that route's own
// createPurchaseReceipt/submitPurchaseReceipt comments).
//
// Rebuilt on this repo's own Card/Input/Select (matching
// src/app/(app)/purchase-orders/new/page.tsx), not PROJEXA's
// @fchecklist/veridian-ui-kit ObjectScreen.
import { Suspense, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { toast } from "sonner";
import { Loader2, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

type PurchaseOrder = { id: string; poNumber: number; supplierId: string; status?: string };
type PurchaseOrderDetail = {
  id: string; supplierId: string;
  items?: { id: string; itemId: string | null; description: string; quantity: string }[];
};
type Vendor = { id: string; vendorName: string };
type ItemRow = { id: string; itemCode: string; itemName: string };
type WarehouseRow = { id: string; warehouseName: string };

/**
 * `poItemId` is the PO line this row was seeded from, posted as
 * `purchaseOrderItemId` -- empty on a hand-entered row. `poDescription` is
 * the PO line's own text, shown but never posted (erp_purchase_receipt_items
 * has no description column).
 */
type Line = { itemId: string; poItemId: string; quantity: string; warehouseId: string; poDescription: string };

const NO_PO = "__none__";

function blankLine(warehouseId = ""): Line {
  return { itemId: "", poItemId: "", quantity: "1", warehouseId, poDescription: "" };
}

function isPristine(lines: Line[]): boolean {
  return lines.length === 1 && !lines[0].itemId && !lines[0].poItemId && lines[0].quantity === "1";
}

function linesFromPurchaseOrder(po: PurchaseOrderDetail, warehouseId: string): Line[] {
  const items = po.items ?? [];
  if (!items.length) return [blankLine(warehouseId)];
  return items.map((i) => ({
    itemId: i.itemId ?? "",
    poItemId: i.id,
    quantity: String(Number(i.quantity) || 1),
    warehouseId,
    poDescription: i.description ?? "",
  }));
}

function GoodsReceiptNewInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const prefillPoId = searchParams.get("poId") ?? NO_PO;

  const [purchaseOrders, setPurchaseOrders] = useState<PurchaseOrder[]>([]);
  const [vendors, setVendors] = useState<Vendor[]>([]);
  const [items, setItems] = useState<ItemRow[]>([]);
  const [warehouses, setWarehouses] = useState<WarehouseRow[]>([]);
  const [poId, setPoId] = useState(prefillPoId);
  const [supplierId, setSupplierId] = useState("");
  const [postingDate, setPostingDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [lines, setLines] = useState<Line[]>([blankLine()]);
  const [seedingFromPo, setSeedingFromPo] = useState(prefillPoId !== NO_PO);
  const [submitting, setSubmitting] = useState(false);

  async function seedFromPurchaseOrder(id: string) {
    setSeedingFromPo(true);
    try {
      const res = await fetch(`/api/v1/projexa/procurement/purchase-orders/${encodeURIComponent(id)}`);
      const po = await res.json().catch(() => null);
      if (!res.ok) throw new Error(po?.error ?? "Couldn't read that purchase order");
      setSupplierId(po.supplierId);
      setLines((prev) => linesFromPurchaseOrder(po as PurchaseOrderDetail, prev[0]?.warehouseId ?? ""));
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Couldn't read that purchase order's lines — enter them by hand");
    } finally {
      setSeedingFromPo(false);
    }
  }

  useEffect(() => {
    fetch("/api/v1/projexa/procurement/purchase-orders").then((r) => r.json()).then((d) => setPurchaseOrders(d.purchaseOrders ?? [])).catch(() => {});
    fetch("/api/v1/projexa/vendors").then((r) => r.json()).then((d) => setVendors(d.vendors ?? [])).catch(() => {});
    fetch("/api/v1/projexa/inventory/items").then((r) => r.json()).then((d) => setItems(d.items ?? [])).catch(() => {});
    fetch("/api/v1/projexa/inventory/warehouses").then((r) => r.json()).then((d) => setWarehouses(d.warehouses ?? [])).catch(() => {});
    if (prefillPoId !== NO_PO) void seedFromPurchaseOrder(prefillPoId);
    // prefillPoId is read once from the URL on mount, matching PROJEXA's own
    // server-resolved-prop precedent -- fetches run once on mount
    // (react-hooks/exhaustive-deps is off repo-wide, see eslint.config.mjs).
  }, []);

  function updateLine(i: number, patch: Partial<Line>) {
    setLines((prev) => prev.map((l, idx) => (idx === i ? { ...l, ...patch } : l)));
  }

  const missing = [
    ...(supplierId ? [] : ["Vendor"]),
    ...(lines.every((l) => l.warehouseId) ? [] : ["A receiving warehouse on every line"]),
    ...(lines.every((l) => l.quantity) ? [] : ["A quantity on every line"]),
  ];

  async function create() {
    if (missing.length) { toast.error(missing.join(", ")); return; }
    setSubmitting(true);
    try {
      const res = await fetch("/api/v1/projexa/procurement/goods-receipts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          supplierId, purchaseOrderId: poId !== NO_PO ? poId : undefined,
          postingDate,
          items: lines.map((l) => ({
            purchaseOrderItemId: l.poItemId || undefined, itemId: l.itemId || undefined,
            quantity: Number(l.quantity) || 1, warehouseId: l.warehouseId,
          })),
        }),
      });
      const body = await res.json().catch(() => null);
      if (!res.ok) throw new Error(body?.error ?? "Couldn't record goods receipt");
      toast.success("Goods receipt recorded (draft)");
      router.push(`/procurement/goods-receipts/${body.id}`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Couldn't record goods receipt");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="space-y-4 max-w-2xl">
      <div>
        <h1 className="text-2xl font-heading text-ct-navy">Record Goods Receipt</h1>
        <p className="text-sm text-ct-muted mt-1">Procurement / New Goods Receipt</p>
      </div>

      <Card className="rounded-xl shadow-card bg-white">
        <CardHeader><CardTitle className="text-base text-ct-navy">Receipt Details</CardTitle></CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-1.5">
            <Label className="text-xs font-semibold text-ct-muted uppercase">Purchase Order (optional)</Label>
            <Select
              value={poId}
              onValueChange={(v) => {
                setPoId(v);
                if (v === NO_PO) return;
                if (!isPristine(lines) && !window.confirm("Replace the lines you've entered with this purchase order's lines?")) return;
                void seedFromPurchaseOrder(v);
              }}
            >
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value={NO_PO}>None</SelectItem>
                {purchaseOrders.filter((po) => po.status !== "cancelled" || po.id === poId).map((po) => (
                  <SelectItem key={po.id} value={po.id}>PO-{po.poNumber}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            {poId !== NO_PO && (
              <p className="text-xs text-ct-muted">
                {seedingFromPo
                  ? "Reading the order's lines…"
                  : lines.some((l) => l.poItemId)
                    ? "Lines below are the order's — edit the quantities to what actually arrived, or remove a line that did not."
                    : "Your own lines are kept, not the order's. They carry no ordered rate and won't count against the order's received quantities."}
              </p>
            )}
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs font-semibold text-ct-muted uppercase">Vendor</Label>
            <Select value={supplierId} onValueChange={setSupplierId}>
              <SelectTrigger><SelectValue placeholder={vendors.length ? "Select vendor" : "No vendors found"} /></SelectTrigger>
              <SelectContent>{vendors.map((v) => <SelectItem key={v.id} value={v.id}>{v.vendorName}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs font-semibold text-ct-muted uppercase">Posting Date</Label>
            <Input type="date" value={postingDate} onChange={(e) => setPostingDate(e.target.value)} />
          </div>

          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label className="text-xs font-semibold text-ct-muted uppercase">Received Lines</Label>
              <Button
                type="button" variant="outline" size="sm"
                onClick={() => setLines((prev) => [...prev, blankLine(prev[prev.length - 1]?.warehouseId ?? "")])}
              >
                <Plus className="size-3.5 mr-1" />Add Line
              </Button>
            </div>
            {lines.map((l, i) => (
              <div key={i} className="space-y-1">
                <div className="flex items-center gap-2">
                  <Select value={l.itemId || "__none__"} onValueChange={(v) => updateLine(i, { itemId: v === "__none__" ? "" : v })}>
                    <SelectTrigger className="flex-1"><SelectValue placeholder="Stock item (optional)" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="__none__">No stock item</SelectItem>
                      {items.map((it) => <SelectItem key={it.id} value={it.id}>{it.itemName} ({it.itemCode})</SelectItem>)}
                    </SelectContent>
                  </Select>
                  <Select value={l.warehouseId || "__none__"} onValueChange={(v) => updateLine(i, { warehouseId: v === "__none__" ? "" : v })}>
                    <SelectTrigger className="w-44"><SelectValue placeholder="Warehouse" /></SelectTrigger>
                    <SelectContent>{warehouses.map((w) => <SelectItem key={w.id} value={w.id}>{w.warehouseName}</SelectItem>)}</SelectContent>
                  </Select>
                  <Input placeholder="Qty" type="number" value={l.quantity} onChange={(e) => updateLine(i, { quantity: e.target.value })} className="w-20" />
                  <Button variant="ghost" size="icon" disabled={lines.length === 1} onClick={() => setLines((prev) => prev.filter((_, idx) => idx !== i))}>
                    <Trash2 className="size-4 text-red-500" />
                  </Button>
                </div>
                {l.poDescription && <p className="text-xs text-ct-muted">From the order: {l.poDescription}</p>}
              </div>
            ))}
            <p className="text-xs text-ct-muted">A line with no stock item posts no FIFO stock layer on submit — it is still recorded, and if it came from the purchase order it still counts towards that order line&apos;s received quantity.</p>
          </div>
        </CardContent>
      </Card>

      <div className="flex justify-end gap-2">
        <Button variant="outline" onClick={() => router.push("/procurement?tab=goods-receipts")} disabled={submitting}>Cancel</Button>
        <Button
          className="bg-ct-saffron hover:bg-ct-saffron-hover text-white shadow-saffron"
          onClick={create}
          disabled={submitting || seedingFromPo || missing.length > 0}
        >
          {submitting ? <Loader2 className="size-4 mr-2 animate-spin" /> : null}
          {submitting ? "Recording..." : "Record Goods Receipt"}
        </Button>
      </div>
    </div>
  );
}

export default function GoodsReceiptNewPage() {
  return (
    <Suspense fallback={<p className="text-sm text-ct-muted">Loading...</p>}>
      <GoodsReceiptNewInner />
    </Suspense>
  );
}
