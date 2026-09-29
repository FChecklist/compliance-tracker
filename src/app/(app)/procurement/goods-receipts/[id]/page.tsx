"use client";

// force-dynamic: see src/app/(app)/knowledge-base/page.tsx for why this is
// required (prevents static prerendering + CDN-cache bypass of middleware).
export const dynamic = "force-dynamic";

// PROJEXA server-merge (ai-os/PROJEXA_SERVER_MERGE_PLAN.md): port of
// PROJEXA's own GoodsReceiptObjectClient.tsx. Reads/writes the SAME
// GET /api/v1/projexa/procurement/goods-receipts/{id} + POST .../submit
// routes this app's backend already serves (getPurchaseReceipt/
// submitPurchaseReceipt in erp-goods-receipt-service.ts). Submit posts real
// FIFO stock (recordStockReceipt) for every line and rolls the parent PO's
// status up to partially_received/completed.
//
// No generic Edit/Delete -- no updateGoodsReceipt() exists upstream
// (updatePutawayLocation()/markPutawayComplete() do, but putaway management
// is a separate depth wave this port does not build, same disclosed scope
// cut as the RFQ detail page's scoring/negotiation/auctions).
//
// Rebuilt on this repo's own Card/Table (matching
// src/app/(app)/purchase-orders/[id]/page.tsx), not PROJEXA's
// @fchecklist/veridian-ui-kit ObjectScreen.
import { useCallback, useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { toast } from "sonner";
import { ArrowLeft, Loader2, PackageCheck } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";

type GoodsReceipt = {
  id: string; receiptNumber: number; status: string; postingDate: string; supplierId: string; purchaseOrderId: string | null;
  items: { id: string; itemId: string | null; quantity: string; warehouseId: string }[];
};
type Vendor = { id: string; vendorName: string };
type ItemRow = { id: string; itemName: string };
type WarehouseRow = { id: string; warehouseName: string };

const STATUS_VARIANT: Record<string, "default" | "secondary" | "outline" | "destructive"> = {
  draft: "outline", submitted: "default",
};

export default function GoodsReceiptDetailPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const receiptId = params.id;

  const [receipt, setReceipt] = useState<GoodsReceipt | null>(null);
  const [vendors, setVendors] = useState<Vendor[]>([]);
  const [items, setItems] = useState<ItemRow[]>([]);
  const [warehouses, setWarehouses] = useState<WarehouseRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [recRes, vendorRes, itemRes, whRes] = await Promise.all([
        fetch(`/api/v1/projexa/procurement/goods-receipts/${encodeURIComponent(receiptId)}`),
        fetch("/api/v1/projexa/vendors").catch(() => null),
        fetch("/api/v1/projexa/inventory/items").catch(() => null),
        fetch("/api/v1/projexa/inventory/warehouses").catch(() => null),
      ]);
      const recBody = await recRes.json().catch(() => null);
      if (!recRes.ok) throw new Error(recBody?.error ?? "Couldn't load this goods receipt");
      setReceipt(recBody as GoodsReceipt);
      if (vendorRes && vendorRes.ok) setVendors((await vendorRes.json().catch(() => ({}))).vendors ?? []);
      if (itemRes && itemRes.ok) setItems((await itemRes.json().catch(() => ({}))).items ?? []);
      if (whRes && whRes.ok) setWarehouses((await whRes.json().catch(() => ({}))).warehouses ?? []);
      setLoadError(null);
    } catch (err) {
      setReceipt(null);
      setLoadError(err instanceof Error ? err.message : "Couldn't load this goods receipt");
    } finally {
      setLoading(false);
    }
  }, [receiptId]);

  useEffect(() => { void load(); }, [load]);

  async function submit() {
    setSubmitting(true);
    try {
      const res = await fetch(`/api/v1/projexa/procurement/goods-receipts/${encodeURIComponent(receiptId)}/submit`, { method: "POST" });
      const body = await res.json().catch(() => null);
      if (!res.ok) throw new Error(body?.error ?? "Failed to submit goods receipt");
      toast.success("Goods receipt posted to stock");
      await load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Couldn't submit goods receipt");
    } finally {
      setSubmitting(false);
    }
  }

  const vendorName = vendors.find((v) => v.id === receipt?.supplierId)?.vendorName ?? receipt?.supplierId ?? "—";
  const itemName = (id: string | null) => (id && items.find((i) => i.id === id)?.itemName) || "—";
  const warehouseName = (id: string) => warehouses.find((w) => w.id === id)?.warehouseName ?? id;

  if (loading) {
    return <div className="grid h-40 place-items-center"><Loader2 className="size-5 animate-spin text-ct-muted" /></div>;
  }

  if (loadError || !receipt) {
    return (
      <div className="space-y-3">
        <Link href="/procurement" className="inline-flex items-center gap-1 text-sm text-ct-muted hover:text-ct-navy transition">
          <ArrowLeft className="size-4" />Back to Procurement
        </Link>
        <p role="alert" className="text-sm text-red-600">{loadError ?? "Goods receipt not found."}</p>
        <Button variant="outline" size="sm" onClick={() => load()}>Retry</Button>
      </div>
    );
  }

  const isDraft = receipt.status === "draft";

  return (
    <div className="space-y-6">
      <div>
        <Button variant="ghost" size="sm" className="text-ct-muted -ml-2 mb-1" onClick={() => router.push("/procurement")}>
          <ArrowLeft className="size-3.5 mr-1" /> Back to Procurement
        </Button>
        <div className="flex items-center justify-between flex-wrap gap-3">
          <div className="flex items-center gap-2">
            <h1 className="text-2xl font-heading text-ct-navy">GRN-{receipt.receiptNumber}</h1>
            <Badge variant={STATUS_VARIANT[receipt.status] ?? "outline"}>{receipt.status.replace(/_/g, " ")}</Badge>
          </div>
          {isDraft && (
            <Button size="sm" disabled={submitting} className="bg-ct-saffron hover:bg-ct-saffron-hover text-white" onClick={submit}>
              {submitting ? <Loader2 className="size-3.5 mr-1 animate-spin" /> : <PackageCheck className="size-3.5 mr-1" />}
              {submitting ? "Posting..." : "Post to Stock"}
            </Button>
          )}
        </div>
        <p className="text-sm text-ct-muted mt-1">
          Vendor: {vendorName} &middot; Posting Date: {receipt.postingDate}
        </p>
      </div>

      <Card className="rounded-xl shadow-card bg-white">
        <CardHeader><CardTitle className="text-base text-ct-navy">Received Items</CardTitle></CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow><TableHead>Item</TableHead><TableHead>Warehouse</TableHead><TableHead className="text-right">Quantity</TableHead></TableRow>
            </TableHeader>
            <TableBody>
              {receipt.items.map((i) => (
                <TableRow key={i.id}>
                  <TableCell className="font-medium">{itemName(i.itemId)}</TableCell>
                  <TableCell>{warehouseName(i.warehouseId)}</TableCell>
                  <TableCell className="text-right">{i.quantity}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
