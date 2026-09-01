"use client";

export const dynamic = "force-dynamic";

// R63/Sumeet-modules gap-closure (2026-08-29): the backend has existed
// since Wave 124 (/api/v1/projexa/materials, a thin alias over
// erp-inventory-service.ts's stock ledger) but no (app) page ever called
// it -- confirmed via a real local browser walkthrough (direct nav to
// /materials 404'd, no sidebar link existed) while testing Sumeet's 10
// required modules end-to-end. Read-only ledger view: this API has no
// create route of its own (real material receipts/issues are posted via
// the existing /api/v1/erp/inventory/{receipts,issues} routes per that
// route's own header comment -- not duplicated here).
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Package } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

type MaterialLedgerEntry = {
  id: string; materialId: string; itemCode: string | null; itemName: string | null; uom: string | null;
  warehouseId: string; warehouseName: string | null; postingDate: string;
  movementType: string; quantityChange: string | number; balanceQuantity: string | number; balanceValue: string | number;
};

export default function MaterialsPage() {
  const [entries, setEntries] = useState<MaterialLedgerEntry[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch("/api/v1/projexa/materials")
      .then((r) => r.json())
      .then((d) => setEntries(d.materials ?? []))
      .catch(() => toast.error("Failed to load material ledger"))
      .finally(() => setLoading(false));
  }, []);

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-heading text-ct-navy">Materials</h1>
        <p className="text-sm text-ct-muted mt-1">Site material stock ledger -- receipts and issues across all warehouses. Post new receipts/issues from Inventory.</p>
      </div>

      {loading ? (
        <p className="text-sm text-ct-muted">Loading...</p>
      ) : entries.length === 0 ? (
        <Card className="rounded-xl shadow-card bg-white">
          <CardContent className="pt-10 pb-10 text-center text-sm text-ct-muted flex flex-col items-center gap-2">
            <Package className="size-8 text-ct-muted/50" />
            No material movements recorded yet.
          </CardContent>
        </Card>
      ) : (
        <Card className="rounded-xl shadow-card bg-white">
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Material</TableHead><TableHead>Warehouse</TableHead><TableHead>Date</TableHead>
                  <TableHead>Movement</TableHead><TableHead className="text-right">Qty Change</TableHead>
                  <TableHead className="text-right">Balance Qty</TableHead><TableHead className="text-right">Balance Value</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {entries.map((e) => (
                  <TableRow key={e.id}>
                    <TableCell className="font-medium text-ct-navy">
                      {e.itemName ?? <span className="font-mono text-xs text-ct-muted">{e.materialId}</span>}
                      {e.itemCode ? <span className="ml-1.5 text-xs text-ct-muted">({e.itemCode})</span> : null}
                    </TableCell>
                    <TableCell className="text-ct-muted">{e.warehouseName ?? "--"}</TableCell>
                    <TableCell className="text-ct-muted">{new Date(e.postingDate).toLocaleDateString()}</TableCell>
                    <TableCell><Badge className="text-xs border-0 bg-ct-cloud text-ct-muted capitalize">{e.movementType}</Badge></TableCell>
                    <TableCell className={`text-right font-mono text-xs ${Number(e.quantityChange) < 0 ? "text-red-600" : "text-green-700"}`}>
                      {Number(e.quantityChange) > 0 ? "+" : ""}{e.quantityChange} {e.uom ?? ""}
                    </TableCell>
                    <TableCell className="text-right font-mono text-xs text-ct-muted">{e.balanceQuantity} {e.uom ?? ""}</TableCell>
                    <TableCell className="text-right font-mono text-xs text-ct-muted">{e.balanceValue}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
