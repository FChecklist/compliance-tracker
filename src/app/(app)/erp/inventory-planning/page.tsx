"use client";

export const dynamic = "force-dynamic";

// Wave 87 (Comparison CSV 2 gap analysis: REP001-004 "Replenishment" +
// CC001-006 "Inventory Control/Cycle Count/ABC"). Reorder suggestions and
// ABC classification are read-time computations against the existing FIFO
// stock ledger -- never a fabricated forecast. Cycle count adjustments post
// through the same FIFO engine as every other inventory movement.
import { useEffect, useState, useCallback } from "react";
import { toast } from "sonner";
import Link from "next/link";
import { Loader2, Plus, RefreshCw } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";

type Item = { id: string; itemName: string };
type Warehouse = { id: string; warehouseName: string };
type ReorderLevel = { id: string; itemId: string; warehouseId: string | null; reorderPoint: string; reorderQty: string; item: Item | null; warehouse: Warehouse | null };
type ReorderSuggestion = { reorderLevelId: string; itemId: string; itemName: string; warehouseId: string | null; currentQty: number; reorderPoint: number; suggestedQty: number };
type AbcRow = { id: string; itemId: string; classification: string; consumptionValue: string; item: Item | null };
type CountLine = { id: string; itemId: string; systemQty: string; countedQty: string | null; status: string; item: Item | null };
type CountPlan = { id: string; name: string; status: string; scheduledDate: string | null; lines: CountLine[]; warehouse: Warehouse | null };

const ABC_COLORS: Record<string, string> = { A: "bg-green-100 text-green-700", B: "bg-amber-100 text-amber-700", C: "bg-ct-cloud text-ct-muted" };

export default function InventoryPlanningPage() {
  const [items, setItems] = useState<Item[]>([]);
  const [warehouses, setWarehouses] = useState<Warehouse[]>([]);
  const [reorderLevels, setReorderLevels] = useState<ReorderLevel[]>([]);
  const [suggestions, setSuggestions] = useState<ReorderSuggestion[]>([]);
  const [abcRows, setAbcRows] = useState<AbcRow[]>([]);
  const [plans, setPlans] = useState<CountPlan[]>([]);
  const [loading, setLoading] = useState(true);
  const [computing, setComputing] = useState(false);

  const [rlOpen, setRlOpen] = useState(false);
  const [rlItemId, setRlItemId] = useState("");
  const [rlWarehouseId, setRlWarehouseId] = useState("");
  const [rlPoint, setRlPoint] = useState("");
  const [rlQty, setRlQty] = useState("");
  const [savingRl, setSavingRl] = useState(false);

  const [planOpen, setPlanOpen] = useState(false);
  const [planName, setPlanName] = useState("");
  const [planWarehouseId, setPlanWarehouseId] = useState("");
  const [planItemIds, setPlanItemIds] = useState<string[]>([]);
  const [creatingPlan, setCreatingPlan] = useState(false);

  const load = useCallback(() => {
    Promise.all([
      fetch("/api/erp/stock/items").catch(() => null),
      fetch("/api/erp/stock/warehouses").catch(() => null),
      fetch("/api/erp/inventory/reorder-levels"),
      fetch("/api/erp/inventory/reorder-suggestions"),
      fetch("/api/erp/inventory/abc-classification"),
      fetch("/api/erp/inventory/cycle-count-plans"),
    ])
      .then(([itemsRes, whRes, rlRes, sugRes, abcRes, planRes]) => Promise.all([
        itemsRes && itemsRes.ok ? itemsRes.json() : { items: [] },
        whRes && whRes.ok ? whRes.json() : { warehouses: [] },
        rlRes.json(), sugRes.json(), abcRes.json(), planRes.json(),
      ]))
      .then(([itemsData, whData, rlData, sugData, abcData, planData]) => {
        setItems(itemsData.items ?? []);
        setWarehouses(whData.warehouses ?? []);
        setReorderLevels(rlData.reorderLevels ?? []);
        setSuggestions(sugData.suggestions ?? []);
        setAbcRows(abcData.classifications ?? []);
        setPlans(planData.plans ?? []);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, []);

  useEffect(load, [load]);

  const saveReorderLevel = async () => {
    setSavingRl(true);
    const res = await fetch("/api/erp/inventory/reorder-levels", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ itemId: rlItemId, warehouseId: rlWarehouseId || undefined, reorderPoint: Number(rlPoint), reorderQty: Number(rlQty) }),
    });
    setSavingRl(false);
    if (!res.ok) { const d = await res.json().catch(() => ({})); toast.error(d.error ?? "Failed to save"); return; }
    setRlOpen(false); setRlItemId(""); setRlWarehouseId(""); setRlPoint(""); setRlQty("");
    toast.success("Reorder level saved");
    load();
  };

  const computeAbc = async () => {
    setComputing(true);
    const res = await fetch("/api/erp/inventory/abc-classification", { method: "POST" });
    setComputing(false);
    if (!res.ok) { toast.error("Failed to compute ABC classification"); return; }
    toast.success("ABC classification recomputed from real consumption history");
    load();
  };

  const createPlan = async () => {
    setCreatingPlan(true);
    const res = await fetch("/api/erp/inventory/cycle-count-plans", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: planName, warehouseId: planWarehouseId, itemIds: planItemIds }),
    });
    setCreatingPlan(false);
    if (!res.ok) { const d = await res.json().catch(() => ({})); toast.error(d.error ?? "Failed to create plan"); return; }
    setPlanOpen(false); setPlanName(""); setPlanWarehouseId(""); setPlanItemIds([]);
    toast.success("Cycle count plan created");
    load();
  };

  return (
    <div className="space-y-4">
      <div>
        <h1 className="font-heading text-2xl md:text-3xl text-ct-navy">Inventory Planning</h1>
        <p className="text-sm text-ct-muted mt-1">Reorder levels, ABC classification, cycle counting — VERI ERP AI</p>
      </div>

      <Tabs defaultValue="reorder">
        <TabsList>
          <TabsTrigger value="reorder">Replenishment</TabsTrigger>
          <TabsTrigger value="abc">ABC Classification</TabsTrigger>
          <TabsTrigger value="cyclecount">Cycle Count</TabsTrigger>
        </TabsList>

        <TabsContent value="reorder" className="space-y-3">
          {suggestions.length > 0 && (
            <Card className="rounded-xl shadow-card bg-white border-amber-200">
              <CardContent className="p-4 space-y-2">
                <h3 className="text-sm font-semibold text-ct-navy">Reorder Suggestions ({suggestions.length})</h3>
                {suggestions.map((s) => (
                  <div key={s.reorderLevelId} className="text-xs text-ct-muted flex items-center justify-between border-b border-ct-border py-1.5">
                    <span>{s.itemName} -- current: {s.currentQty}, reorder point: {s.reorderPoint}</span>
                    <Badge className="bg-amber-100 text-amber-700 border-0">Suggest ordering {s.suggestedQty}</Badge>
                  </div>
                ))}
              </CardContent>
            </Card>
          )}
          <div className="flex justify-end">
            <Dialog open={rlOpen} onOpenChange={setRlOpen}>
              <DialogTrigger asChild><Button className="bg-ct-teal hover:bg-ct-teal-hover text-white"><Plus className="w-4 h-4 mr-1" />Set Reorder Level</Button></DialogTrigger>
              <DialogContent>
                <DialogHeader><DialogTitle>Set Reorder Level</DialogTitle></DialogHeader>
                <div className="space-y-3">
                  <div><Label>Item</Label>
                    <Select value={rlItemId} onValueChange={setRlItemId}>
                      <SelectTrigger><SelectValue placeholder="Select item" /></SelectTrigger>
                      <SelectContent>{items.map((i) => <SelectItem key={i.id} value={i.id}>{i.itemName}</SelectItem>)}</SelectContent>
                    </Select>
                  </div>
                  <div><Label>Warehouse</Label>
                    <Select value={rlWarehouseId} onValueChange={setRlWarehouseId}>
                      <SelectTrigger><SelectValue placeholder="Select warehouse" /></SelectTrigger>
                      <SelectContent>{warehouses.map((w) => <SelectItem key={w.id} value={w.id}>{w.warehouseName}</SelectItem>)}</SelectContent>
                    </Select>
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div><Label>Reorder Point</Label><Input type="number" value={rlPoint} onChange={(e) => setRlPoint(e.target.value)} /></div>
                    <div><Label>Reorder Qty</Label><Input type="number" value={rlQty} onChange={(e) => setRlQty(e.target.value)} /></div>
                  </div>
                </div>
                <DialogFooter><Button onClick={saveReorderLevel} disabled={savingRl || !rlItemId || !rlPoint || !rlQty} className="bg-ct-teal hover:bg-ct-teal-hover text-white">{savingRl && <Loader2 className="w-4 h-4 mr-1 animate-spin" />}Save</Button></DialogFooter>
              </DialogContent>
            </Dialog>
          </div>
          <Card className="rounded-xl shadow-card bg-white">
            <CardContent className="p-0">
              <table className="w-full text-xs">
                <thead><tr className="text-left text-ct-muted border-b border-ct-border"><th className="p-3 font-medium">Item</th><th className="p-3 font-medium">Warehouse</th><th className="p-3 font-medium text-right">Reorder Point</th><th className="p-3 font-medium text-right">Reorder Qty</th></tr></thead>
                <tbody className="divide-y divide-ct-border">
                  {loading ? <tr><td colSpan={4} className="p-6 text-center text-ct-muted">Loading…</td></tr>
                    : reorderLevels.length === 0 ? <tr><td colSpan={4} className="p-6 text-center text-ct-muted">No reorder levels configured yet.</td></tr>
                    : reorderLevels.map((r) => (
                      <tr key={r.id} className="hover:bg-ct-row-hover">
                        <td className="p-3">{r.item?.itemName ?? r.itemId}</td>
                        <td className="p-3">{r.warehouse?.warehouseName ?? "All warehouses"}</td>
                        <td className="p-3 text-right">{r.reorderPoint}</td>
                        <td className="p-3 text-right">{r.reorderQty}</td>
                      </tr>
                    ))}
                </tbody>
              </table>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="abc" className="space-y-3">
          <div className="flex justify-end">
            <Button onClick={computeAbc} disabled={computing} variant="outline"><RefreshCw className={`w-4 h-4 mr-1 ${computing ? "animate-spin" : ""}`} />Recompute from Consumption History</Button>
          </div>
          <Card className="rounded-xl shadow-card bg-white">
            <CardContent className="p-0">
              <table className="w-full text-xs">
                <thead><tr className="text-left text-ct-muted border-b border-ct-border"><th className="p-3 font-medium">Item</th><th className="p-3 font-medium text-right">Consumption Value</th><th className="p-3 font-medium">Class</th></tr></thead>
                <tbody className="divide-y divide-ct-border">
                  {loading ? <tr><td colSpan={3} className="p-6 text-center text-ct-muted">Loading…</td></tr>
                    : abcRows.length === 0 ? <tr><td colSpan={3} className="p-6 text-center text-ct-muted">No classification yet -- click Recompute once stock issues exist.</td></tr>
                    : abcRows.map((r) => (
                      <tr key={r.id} className="hover:bg-ct-row-hover">
                        <td className="p-3">{r.item?.itemName ?? r.itemId}</td>
                        <td className="p-3 text-right">{Number(r.consumptionValue).toFixed(2)}</td>
                        <td className="p-3"><Badge className={`border-0 ${ABC_COLORS[r.classification] ?? ""}`}>{r.classification}</Badge></td>
                      </tr>
                    ))}
                </tbody>
              </table>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="cyclecount" className="space-y-3">
          <div className="flex justify-end">
            <Dialog open={planOpen} onOpenChange={setPlanOpen}>
              <DialogTrigger asChild><Button className="bg-ct-teal hover:bg-ct-teal-hover text-white"><Plus className="w-4 h-4 mr-1" />New Cycle Count Plan</Button></DialogTrigger>
              <DialogContent>
                <DialogHeader><DialogTitle>New Cycle Count Plan</DialogTitle></DialogHeader>
                <div className="space-y-3">
                  <div><Label>Plan Name</Label><Input value={planName} onChange={(e) => setPlanName(e.target.value)} /></div>
                  <div><Label>Warehouse</Label>
                    <Select value={planWarehouseId} onValueChange={setPlanWarehouseId}>
                      <SelectTrigger><SelectValue placeholder="Select warehouse" /></SelectTrigger>
                      <SelectContent>{warehouses.map((w) => <SelectItem key={w.id} value={w.id}>{w.warehouseName}</SelectItem>)}</SelectContent>
                    </Select>
                  </div>
                  <div>
                    <Label>Items to count</Label>
                    <div className="flex flex-wrap gap-2 mt-1 max-h-40 overflow-y-auto">
                      {items.map((i) => (
                        <Button key={i.id} size="sm" type="button" variant={planItemIds.includes(i.id) ? "default" : "outline"}
                          className={planItemIds.includes(i.id) ? "h-7 text-xs bg-ct-teal hover:bg-ct-teal-hover text-white" : "h-7 text-xs"}
                          onClick={() => setPlanItemIds((prev) => prev.includes(i.id) ? prev.filter((id) => id !== i.id) : [...prev, i.id])}>
                          {i.itemName}
                        </Button>
                      ))}
                    </div>
                  </div>
                </div>
                <DialogFooter><Button onClick={createPlan} disabled={creatingPlan || !planName || !planWarehouseId || planItemIds.length === 0} className="bg-ct-teal hover:bg-ct-teal-hover text-white">{creatingPlan && <Loader2 className="w-4 h-4 mr-1 animate-spin" />}Create</Button></DialogFooter>
              </DialogContent>
            </Dialog>
          </div>
          <Card className="rounded-xl shadow-card bg-white">
            <CardContent className="p-0">
              <table className="w-full text-xs">
                <thead><tr className="text-left text-ct-muted border-b border-ct-border"><th className="p-3 font-medium">Plan</th><th className="p-3 font-medium">Warehouse</th><th className="p-3 font-medium">Lines</th><th className="p-3 font-medium">Status</th><th className="p-3 font-medium"></th></tr></thead>
                <tbody className="divide-y divide-ct-border">
                  {loading ? <tr><td colSpan={5} className="p-6 text-center text-ct-muted">Loading…</td></tr>
                    : plans.length === 0 ? <tr><td colSpan={5} className="p-6 text-center text-ct-muted">No cycle count plans yet.</td></tr>
                    : plans.map((p) => (
                      <tr key={p.id} className="hover:bg-ct-row-hover">
                        <td className="p-3">{p.name}</td><td className="p-3">{p.warehouse?.warehouseName ?? "—"}</td><td className="p-3">{p.lines.length}</td>
                        <td className="p-3"><Badge variant="outline">{p.status}</Badge></td>
                        <td className="p-3"><Link href={`/erp/inventory-planning/${p.id}`}><Button size="sm" variant="outline" className="h-7 text-xs">Manage</Button></Link></td>
                      </tr>
                    ))}
                </tbody>
              </table>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
