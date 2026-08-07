"use client";

// force-dynamic: see src/app/(app)/knowledge-base/page.tsx for why this is
// required (prevents static prerendering + CDN-cache bypass of middleware).
export const dynamic = "force-dynamic";

// Wave 6 batch 2 (compliance-tracker/PROJEXA merge, module-mapping report
// finding GAP-CONSTR): Furniture, Fixtures & Equipment specification +
// procurement-margin report per project. Backend (interior-design-
// service.ts, Wave 142) fully built -- unitCost (trade/wholesale, never
// shown to the client in PROJEXA's own UI either) vs unitPrice
// (client-billed) live on the same line item, margin computed at read time
// via GET .../ffe/margin-summary. Ported from PROJEXA's own FfeClient.tsx
// (stat cards + create dialog with width/depth/height fields for a future
// floor-plan placement + status-advance table) onto this repo's own
// ProjectPicker shell.
import { useEffect, useState, useCallback } from "react";
import { toast } from "sonner";
import { Loader2, Plus } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger,
} from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ProjectPicker, NoProjectsCard, type PickerProject } from "@/components/ProjectPicker";
import { currencyLabel, useCurrencies } from "@/lib/currency-format";

type FfeItem = {
  id: string; itemName: string; roomOrArea: string | null; category: string; quantity: number;
  unitCost: string; unitPrice: string; status: string;
};
type MarginSummary = { totalCost: number; totalPrice: number; totalMargin: number; marginPercent: number };

const STATUS_COLORS: Record<string, string> = {
  specified: "bg-ct-cloud text-ct-muted",
  ordered: "bg-ct-saffron/20 text-ct-saffron",
  received: "bg-ct-saffron/20 text-ct-saffron",
  installed: "bg-green-100 text-green-700",
};
const CATEGORIES = ["furniture", "fixture", "equipment", "finish", "textile", "lighting", "other"];
const STATUSES = ["specified", "ordered", "received", "installed"];

export default function FfePage() {
  const currencies = useCurrencies();
  const money = (n: number) => `${currencyLabel(undefined, currencies)}${n.toLocaleString("en-IN", { maximumFractionDigits: 0 })}`;

  const [projects, setProjects] = useState<PickerProject[]>([]);
  const [projectId, setProjectId] = useState("");
  const [loadingProjects, setLoadingProjects] = useState(true);

  const [items, setItems] = useState<FfeItem[]>([]);
  const [margin, setMargin] = useState<MarginSummary | null>(null);
  const [loading, setLoading] = useState(false);

  const [open, setOpen] = useState(false);
  const [itemName, setItemName] = useState("");
  const [roomOrArea, setRoomOrArea] = useState("");
  const [category, setCategory] = useState("furniture");
  const [quantity, setQuantity] = useState("1");
  const [unitCost, setUnitCost] = useState("");
  const [unitPrice, setUnitPrice] = useState("");
  const [widthCm, setWidthCm] = useState("");
  const [depthCm, setDepthCm] = useState("");
  const [heightCm, setHeightCm] = useState("");
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    fetch("/api/projects")
      .then((r) => r.json())
      .then((d) => {
        const list: PickerProject[] = d.projects ?? [];
        setProjects(list);
        if (list.length > 0) setProjectId((prev) => prev || list[0].id);
      })
      .catch(() => toast.error("Failed to load projects"))
      .finally(() => setLoadingProjects(false));
  }, []);

  const load = useCallback(async () => {
    if (!projectId) return;
    setLoading(true);
    try {
      const [itemsRes, marginRes] = await Promise.all([
        fetch(`/api/v1/projexa/ffe?projectId=${encodeURIComponent(projectId)}`),
        fetch(`/api/v1/projexa/ffe/margin-summary?projectId=${encodeURIComponent(projectId)}`),
      ]);
      const itemsData = await itemsRes.json();
      const marginData = await marginRes.json();
      setItems(itemsData.items ?? []);
      setMargin(marginData);
    } catch {
      toast.error("Failed to load FF&E items");
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  useEffect(() => { load(); }, [load]);

  const resetForm = () => {
    setItemName(""); setRoomOrArea(""); setCategory("furniture"); setQuantity("1");
    setUnitCost(""); setUnitPrice(""); setWidthCm(""); setDepthCm(""); setHeightCm("");
  };

  const createItem = async () => {
    if (!projectId || !itemName.trim()) return;
    setCreating(true);
    try {
      const res = await fetch("/api/v1/projexa/ffe", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          projectId, itemName, roomOrArea: roomOrArea || undefined, category,
          quantity: Number(quantity) || 1, unitCost: Number(unitCost) || 0, unitPrice: Number(unitPrice) || 0,
          widthCm: widthCm ? Number(widthCm) : undefined, depthCm: depthCm ? Number(depthCm) : undefined,
          heightCm: heightCm ? Number(heightCm) : undefined,
        }),
      });
      if (!res.ok) throw new Error((await res.json().catch(() => null))?.error ?? "Failed");
      toast.success("FF&E item added");
      setOpen(false);
      resetForm();
      load();
    } catch (err) {
      toast.error(err instanceof Error && err.message ? err.message : "Failed to add FF&E item");
    } finally {
      setCreating(false);
    }
  };

  const advanceStatus = async (item: FfeItem) => {
    const next = STATUSES[STATUSES.indexOf(item.status) + 1];
    if (!next) return;
    try {
      const res = await fetch(`/api/v1/projexa/ffe/${item.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "status", status: next }),
      });
      if (!res.ok) throw new Error((await res.json().catch(() => null))?.error ?? "Failed");
      load();
    } catch (err) {
      toast.error(err instanceof Error && err.message ? err.message : "Failed to update status");
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-heading text-ct-navy">FF&amp;E</h1>
          <p className="text-sm text-ct-muted mt-1">Furniture, Fixtures &amp; Equipment schedule per project -- trade cost vs. client price, procurement-margin summary.</p>
        </div>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild>
            <Button className="bg-ct-saffron hover:bg-ct-saffron-hover text-white shadow-saffron" disabled={!projectId}>
              <Plus className="size-4 mr-1" /> New Item
            </Button>
          </DialogTrigger>
          <DialogContent className="max-w-lg">
            <DialogHeader><DialogTitle>New FF&amp;E Item</DialogTitle><DialogDescription>Specified against the selected project.</DialogDescription></DialogHeader>
            <div className="space-y-4 py-2 max-h-[60vh] overflow-y-auto pr-1">
              <div className="space-y-1.5">
                <Label className="text-xs font-semibold text-ct-muted uppercase">Item Name</Label>
                <Input value={itemName} onChange={(e) => setItemName(e.target.value)} />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label className="text-xs font-semibold text-ct-muted uppercase">Room / Area</Label>
                  <Input value={roomOrArea} onChange={(e) => setRoomOrArea(e.target.value)} />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs font-semibold text-ct-muted uppercase">Category</Label>
                  <Select value={category} onValueChange={setCategory}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>{CATEGORIES.map((c) => <SelectItem key={c} value={c} className="capitalize">{c}</SelectItem>)}</SelectContent>
                  </Select>
                </div>
              </div>
              <div className="grid grid-cols-3 gap-3">
                <div className="space-y-1.5">
                  <Label className="text-xs font-semibold text-ct-muted uppercase">Qty</Label>
                  <Input type="number" value={quantity} onChange={(e) => setQuantity(e.target.value)} />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs font-semibold text-ct-muted uppercase">Cost ({currencyLabel(undefined, currencies).trim()})</Label>
                  <Input type="number" value={unitCost} onChange={(e) => setUnitCost(e.target.value)} />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs font-semibold text-ct-muted uppercase">Client Price ({currencyLabel(undefined, currencies).trim()})</Label>
                  <Input type="number" value={unitPrice} onChange={(e) => setUnitPrice(e.target.value)} />
                </div>
              </div>
              <div className="grid grid-cols-3 gap-3">
                <div className="space-y-1.5">
                  <Label className="text-xs font-semibold text-ct-muted uppercase">Width (cm)</Label>
                  <Input type="number" value={widthCm} onChange={(e) => setWidthCm(e.target.value)} placeholder="for floor plan" />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs font-semibold text-ct-muted uppercase">Depth (cm)</Label>
                  <Input type="number" value={depthCm} onChange={(e) => setDepthCm(e.target.value)} placeholder="for floor plan" />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs font-semibold text-ct-muted uppercase">Height (cm)</Label>
                  <Input type="number" value={heightCm} onChange={(e) => setHeightCm(e.target.value)} placeholder="for floor plan" />
                </div>
              </div>
            </div>
            <DialogFooter>
              <Button onClick={createItem} disabled={creating || !itemName.trim()} className="bg-ct-saffron hover:bg-ct-saffron-hover text-white">
                {creating ? <Loader2 className="size-4 mr-2 animate-spin" /> : null}
                Add Item
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>

      {loadingProjects ? (
        <p className="text-sm text-ct-muted">Loading projects...</p>
      ) : projects.length === 0 ? (
        <NoProjectsCard icon={Plus} />
      ) : (
        <>
          <ProjectPicker projects={projects} value={projectId} onChange={setProjectId} />

          {loading ? (
            <p className="text-sm text-ct-muted">Loading...</p>
          ) : (
            <>
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
                <Card className="rounded-xl shadow-card bg-white"><CardContent className="pt-4"><p className="text-xs text-ct-muted">Total Cost</p><p className="text-2xl font-heading text-ct-navy">{money(margin?.totalCost ?? 0)}</p></CardContent></Card>
                <Card className="rounded-xl shadow-card bg-white"><CardContent className="pt-4"><p className="text-xs text-ct-muted">Total Client Price</p><p className="text-2xl font-heading text-ct-navy">{money(margin?.totalPrice ?? 0)}</p></CardContent></Card>
                <Card className="rounded-xl shadow-card bg-white"><CardContent className="pt-4"><p className="text-xs text-ct-muted">Margin</p><p className="text-2xl font-heading text-green-700">{money(margin?.totalMargin ?? 0)} <span className="text-sm text-ct-muted">({(margin?.marginPercent ?? 0).toFixed(1)}%)</span></p></CardContent></Card>
              </div>

              {items.length === 0 ? (
                <Card className="rounded-xl shadow-card bg-white"><CardContent className="pt-10 pb-10 text-center text-sm text-ct-muted">No FF&amp;E items yet for this project.</CardContent></Card>
              ) : (
                <Card className="rounded-xl shadow-card bg-white">
                  <CardHeader><CardTitle className="text-base text-ct-navy">FF&amp;E Schedule</CardTitle></CardHeader>
                  <CardContent className="p-0">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Item</TableHead><TableHead>Room</TableHead><TableHead>Category</TableHead><TableHead>Qty</TableHead>
                          <TableHead>Cost</TableHead><TableHead>Price</TableHead><TableHead>Status</TableHead><TableHead className="text-right">Actions</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {items.map((i) => (
                          <TableRow key={i.id}>
                            <TableCell className="font-medium text-ct-navy">{i.itemName}</TableCell>
                            <TableCell className="text-ct-muted">{i.roomOrArea ?? "--"}</TableCell>
                            <TableCell className="capitalize text-ct-muted">{i.category}</TableCell>
                            <TableCell>{i.quantity}</TableCell>
                            <TableCell>{money(Number(i.unitCost))}</TableCell>
                            <TableCell>{money(Number(i.unitPrice))}</TableCell>
                            <TableCell><Badge className={`text-xs border-0 ${STATUS_COLORS[i.status] ?? "bg-ct-cloud text-ct-muted"}`}>{i.status}</Badge></TableCell>
                            <TableCell className="text-right">
                              {i.status !== "installed" && <Button size="sm" variant="outline" onClick={() => advanceStatus(i)}>Advance</Button>}
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </CardContent>
                </Card>
              )}
            </>
          )}
        </>
      )}
    </div>
  );
}
