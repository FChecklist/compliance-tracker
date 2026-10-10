"use client";

// force-dynamic: see src/app/(app)/knowledge-base/page.tsx for why this is
// required (prevents static prerendering + CDN-cache bypass of middleware).
export const dynamic = "force-dynamic";

// PROJEXA server-merge (ai-os/PROJEXA_SERVER_MERGE_PLAN.md): port of
// PROJEXA's own ItemCreateClient.tsx. Same fields PROJEXA's create screen
// collects (item code, name, UOM, HSN/SAC code, standard buying/selling
// rate, batch/serial tracked). POSTs to the already-native POST
// /api/v1/projexa/inventory/items route (createItem in
// erp-stock-service.ts) -- zero new backend route.
//
// Rebuilt on this repo's own Card/Input/Checkbox (matching
// src/app/(app)/purchase-orders/new/page.tsx), not PROJEXA's
// @fchecklist/veridian-ui-kit ObjectScreen.
import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";

export default function ItemNewPage() {
  const router = useRouter();
  const [itemCode, setItemCode] = useState("");
  const [itemName, setItemName] = useState("");
  const [uom, setUom] = useState("");
  const [standardBuyingRate, setStandardBuyingRate] = useState("");
  const [standardSellingRate, setStandardSellingRate] = useState("");
  const [hsnSacCode, setHsnSacCode] = useState("");
  const [hasBatchNo, setHasBatchNo] = useState(false);
  const [hasSerialNo, setHasSerialNo] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  async function createItem() {
    if (!itemCode.trim() || !itemName.trim()) {
      toast.error("Item code and name are required");
      return;
    }
    setSubmitting(true);
    try {
      const res = await fetch("/api/v1/projexa/inventory/items", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          itemCode: itemCode.trim(), itemName: itemName.trim(), uom: uom || undefined,
          standardBuyingRate: standardBuyingRate ? Number(standardBuyingRate) : undefined,
          standardSellingRate: standardSellingRate ? Number(standardSellingRate) : undefined,
          hsnSacCode: hsnSacCode || undefined, hasBatchNo, hasSerialNo,
        }),
      });
      const body = await res.json().catch(() => null);
      if (!res.ok) throw new Error(body?.error ?? "Couldn't add item");
      toast.success("Item added");
      router.push(`/inventory/items/${body.id}`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Couldn't add item");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="space-y-4 max-w-2xl">
      <div>
        <h1 className="text-2xl font-heading text-ct-navy">New Stock Item</h1>
        <p className="text-sm text-ct-muted mt-1">Inventory / New Item</p>
      </div>

      <Card className="rounded-xl shadow-card bg-white">
        <CardHeader><CardTitle className="text-base text-ct-navy">Item Details</CardTitle></CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label className="text-xs font-semibold text-ct-muted uppercase">Item Code</Label>
              <Input value={itemCode} onChange={(e) => setItemCode(e.target.value)} placeholder="e.g. CEM-OPC53" />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs font-semibold text-ct-muted uppercase">Item Name</Label>
              <Input value={itemName} onChange={(e) => setItemName(e.target.value)} placeholder="e.g. OPC 53 Grade Cement" />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label className="text-xs font-semibold text-ct-muted uppercase">Unit of Measure (optional)</Label>
              <Input value={uom} onChange={(e) => setUom(e.target.value)} placeholder="e.g. Bag, Kg, Nos" />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs font-semibold text-ct-muted uppercase">HSN/SAC Code (optional)</Label>
              <Input value={hsnSacCode} onChange={(e) => setHsnSacCode(e.target.value)} />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label className="text-xs font-semibold text-ct-muted uppercase">Standard Buying Rate (optional)</Label>
              <Input type="number" value={standardBuyingRate} onChange={(e) => setStandardBuyingRate(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs font-semibold text-ct-muted uppercase">Standard Selling Rate (optional)</Label>
              <Input type="number" value={standardSellingRate} onChange={(e) => setStandardSellingRate(e.target.value)} />
            </div>
          </div>
          <div className="flex gap-6 text-sm">
            <div className="flex items-center gap-1.5">
              <Checkbox checked={hasBatchNo} onCheckedChange={(v) => setHasBatchNo(!!v)} />
              <Label className="font-normal">Batch tracked</Label>
            </div>
            <div className="flex items-center gap-1.5">
              <Checkbox checked={hasSerialNo} onCheckedChange={(v) => setHasSerialNo(!!v)} />
              <Label className="font-normal">Serial tracked</Label>
            </div>
          </div>
        </CardContent>
      </Card>

      <div className="flex justify-end gap-2">
        <Button variant="outline" onClick={() => router.push("/inventory?tab=items")} disabled={submitting}>Cancel</Button>
        <Button
          className="bg-ct-saffron hover:bg-ct-saffron-hover text-white shadow-saffron"
          onClick={createItem}
          disabled={submitting || !itemCode.trim() || !itemName.trim()}
        >
          {submitting ? <Loader2 className="size-4 mr-2 animate-spin" /> : null}
          {submitting ? "Adding..." : "Create Item"}
        </Button>
      </div>
    </div>
  );
}
