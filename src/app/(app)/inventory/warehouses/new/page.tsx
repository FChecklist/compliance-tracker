"use client";

// force-dynamic: see src/app/(app)/knowledge-base/page.tsx for why this is
// required (prevents static prerendering + CDN-cache bypass of middleware).
export const dynamic = "force-dynamic";

// PROJEXA server-merge (ai-os/PROJEXA_SERVER_MERGE_PLAN.md): port of
// PROJEXA's own WarehouseCreateClient.tsx. POSTs to the already-native POST
// /api/v1/projexa/inventory/warehouses route (createWarehouse in
// erp-stock-service.ts) -- zero new backend route.
//
// No Object Page / Edit for a single warehouse, matching PROJEXA's own
// honest scope cut: erp-stock-service.ts only exports listWarehouses/
// createWarehouse, no getWarehouse()/updateWarehouse() (confirmed by
// reading that file before writing this page) -- a real, pre-existing
// backend gap, not something introduced here.
//
// Rebuilt on this repo's own Card/Input/Select (matching
// src/app/(app)/purchase-orders/new/page.tsx), not PROJEXA's
// @fchecklist/veridian-ui-kit ObjectScreen.
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

type WarehouseRow = { id: string; warehouseName: string };

const NO_PARENT = "__none__";

export default function WarehouseNewPage() {
  const router = useRouter();
  const [warehouseName, setWarehouseName] = useState("");
  const [parentWarehouseId, setParentWarehouseId] = useState(NO_PARENT);
  const [warehouses, setWarehouses] = useState<WarehouseRow[]>([]);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    fetch("/api/v1/projexa/inventory/warehouses").then((r) => r.json()).then((d) => setWarehouses(d.warehouses ?? [])).catch(() => {});
  }, []);

  async function createWarehouse() {
    if (!warehouseName.trim()) {
      toast.error("Warehouse name is required");
      return;
    }
    setSubmitting(true);
    try {
      const res = await fetch("/api/v1/projexa/inventory/warehouses", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          warehouseName: warehouseName.trim(),
          parentWarehouseId: parentWarehouseId === NO_PARENT ? undefined : parentWarehouseId,
        }),
      });
      const body = await res.json().catch(() => null);
      if (!res.ok) throw new Error(body?.error ?? "Couldn't add warehouse");
      toast.success("Warehouse added");
      router.push("/inventory?tab=warehouses");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Couldn't add warehouse");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="space-y-4 max-w-2xl">
      <div>
        <h1 className="text-2xl font-heading text-ct-navy">New Warehouse</h1>
        <p className="text-sm text-ct-muted mt-1">Inventory / New Warehouse</p>
      </div>

      <Card className="rounded-xl shadow-card bg-white">
        <CardHeader><CardTitle className="text-base text-ct-navy">Warehouse Details</CardTitle></CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-1.5">
            <Label className="text-xs font-semibold text-ct-muted uppercase">Warehouse Name</Label>
            <Input value={warehouseName} onChange={(e) => setWarehouseName(e.target.value)} placeholder="e.g. Site Store - Block A" />
          </div>
          {warehouses.length > 0 && (
            <div className="space-y-1.5">
              <Label className="text-xs font-semibold text-ct-muted uppercase">Parent Warehouse (optional)</Label>
              <Select value={parentWarehouseId} onValueChange={setParentWarehouseId}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value={NO_PARENT}>None (top-level)</SelectItem>
                  {warehouses.map((w) => <SelectItem key={w.id} value={w.id}>{w.warehouseName}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          )}
        </CardContent>
      </Card>

      <div className="flex justify-end gap-2">
        <Button variant="outline" onClick={() => router.push("/inventory?tab=warehouses")} disabled={submitting}>Cancel</Button>
        <Button
          className="bg-ct-saffron hover:bg-ct-saffron-hover text-white shadow-saffron"
          onClick={createWarehouse}
          disabled={submitting || !warehouseName.trim()}
        >
          {submitting ? <Loader2 className="size-4 mr-2 animate-spin" /> : null}
          {submitting ? "Adding..." : "Create Warehouse"}
        </Button>
      </div>
    </div>
  );
}
