"use client";

export const dynamic = "force-dynamic";

// Wave B (VERIDIAN Review Framework remediation, Fixed Assets wiring):
// asset detail page -- overview, the full depreciation schedule (posted vs
// pending), movement log + create-movement, and the disposal workflow
// (sale/scrap/write-off). The "Dispose" action is only rendered for
// manager-rank-or-above users (client-side UX only -- the real gate is
// server-side, requireRole(dbUser, "manager") in
// src/app/api/erp/fixed-assets/[id]/disposals/route.ts; this list is a
// convenience duplicate of ROLE_RANK's "manager or above" set from
// src/lib/supabase/auth-guard.ts, which is server-only and can't be
// imported into a client component).
import { useEffect, useState, useCallback, use } from "react";
import Link from "next/link";
import { toast } from "sonner";
import { Loader2, ArrowLeft, Plus } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";

const MANAGER_OR_ABOVE = new Set(["manager", "senior_professional", "branch_manager", "admin", "veridian_admin"]);

type Category = { id: string; categoryName: string; assetAccountId: string | null };
type Asset = {
  id: string; assetName: string; status: string; location: string | null; custodianUserId: string | null;
  purchaseDate: string; purchaseCost: string; currentValue: string | null; accumulatedDepreciation: string;
  depreciationMethod: string; usefulLifeMonths: number | null; salvageValue: string; category: Category;
};
type ScheduleRow = { id: string; scheduleDate: string; depreciationAmount: string; accumulatedDepreciationAfter: string; isPosted: boolean; journalEntryId: string | null };
type Movement = { id: string; movementDate: string; fromLocation: string | null; toLocation: string | null; fromCustodianId: string | null; toCustodianId: string | null; purpose: string | null };
type Disposal = { id: string; disposalDate: string; disposalType: string; saleValue: string | null; status: string; journalEntryId: string | null };
type UserOpt = { id: string; name: string };

function fmt(n: number | string | null | undefined) {
  return Number(n ?? 0).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export default function FixedAssetDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const [asset, setAsset] = useState<Asset | null>(null);
  const [schedule, setSchedule] = useState<ScheduleRow[]>([]);
  const [movements, setMovements] = useState<Movement[]>([]);
  const [disposals, setDisposals] = useState<Disposal[]>([]);
  const [users, setUsers] = useState<UserOpt[]>([]);
  const [myRole, setMyRole] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const [moveOpen, setMoveOpen] = useState(false);
  const [moveDate, setMoveDate] = useState(new Date().toISOString().slice(0, 10));
  const [toLocation, setToLocation] = useState("");
  const [toCustodianId, setToCustodianId] = useState("");
  const [purpose, setPurpose] = useState("");
  const [creatingMove, setCreatingMove] = useState(false);

  const [disposeOpen, setDisposeOpen] = useState(false);
  const [disposalDate, setDisposalDate] = useState(new Date().toISOString().slice(0, 10));
  const [disposalType, setDisposalType] = useState("scrap");
  const [saleValue, setSaleValue] = useState("");
  const [creatingDisposal, setCreatingDisposal] = useState(false);

  const load = useCallback(() => {
    Promise.all([
      fetch(`/api/erp/fixed-assets/${id}`), fetch(`/api/erp/fixed-assets/${id}/schedule`),
      fetch(`/api/erp/fixed-assets/${id}/movements`), fetch(`/api/erp/fixed-assets/${id}/disposals`),
      fetch("/api/users"), fetch("/api/me"),
    ])
      .then(([aRes, sRes, mRes, dRes, uRes, meRes]) => Promise.all([aRes.json(), sRes.json(), mRes.json(), dRes.json(), uRes.json(), meRes.json()]))
      .then(([aData, sData, mData, dData, uData, meData]) => {
        setAsset(aData.error ? null : aData);
        setSchedule(sData.schedule ?? []);
        setMovements(mData.movements ?? []);
        setDisposals(dData.disposals ?? []);
        setUsers(uData.users ?? []);
        setMyRole(meData.role ?? null);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, [id]);

  useEffect(load, [load]);

  const createMovement = async () => {
    setCreatingMove(true);
    const res = await fetch(`/api/erp/fixed-assets/${id}/movements`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ movementDate: moveDate, toLocation: toLocation || undefined, toCustodianId: toCustodianId || undefined, purpose: purpose || undefined }),
    });
    setCreatingMove(false);
    const d = await res.json().catch(() => ({}));
    if (!res.ok) { toast.error(d.error ?? "Failed to record movement"); return; }
    setMoveOpen(false); setToLocation(""); setToCustodianId(""); setPurpose("");
    toast.success("Movement recorded");
    load();
  };

  const createDisposal = async () => {
    setCreatingDisposal(true);
    const res = await fetch(`/api/erp/fixed-assets/${id}/disposals`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ disposalDate, disposalType, saleValue: disposalType === "sale" ? Number(saleValue) : undefined }),
    });
    setCreatingDisposal(false);
    const d = await res.json().catch(() => ({}));
    if (!res.ok) { toast.error(d.error ?? "Failed to initiate disposal"); return; }
    setDisposeOpen(false); setSaleValue("");
    toast.success(d.pendingApproval ? "Disposal sent for approval" : "Asset disposed");
    load();
  };

  if (loading) return <div className="p-6 text-center text-ct-muted">Loading…</div>;
  if (!asset) return <div className="p-6 text-center text-ct-muted">Fixed asset not found.</div>;

  const netBookValue = Number(asset.purchaseCost) - Number(asset.accumulatedDepreciation);
  const canDispose = myRole !== null && MANAGER_OR_ABOVE.has(myRole);
  const hasPendingDisposal = disposals.some((d) => d.status === "pending");

  return (
    <div className="space-y-4">
      <Link href="/erp/fixed-assets" className="inline-flex items-center gap-1 text-sm text-ct-teal hover:underline"><ArrowLeft className="w-4 h-4" />Asset Register</Link>

      <div className="flex items-center justify-between">
        <div>
          <h1 className="font-heading text-2xl md:text-3xl text-ct-navy">{asset.assetName}</h1>
          <p className="text-sm text-ct-muted mt-1">{asset.category.categoryName} — {METHOD_LABEL(asset.depreciationMethod)}</p>
        </div>
        <Badge className={asset.status === "in_use" ? "bg-green-100 text-green-700" : asset.status === "draft" ? "bg-ct-cloud text-ct-muted" : "bg-red-100 text-red-700"}>
          {asset.status.replace(/_/g, " ")}
        </Badge>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Card className="rounded-xl shadow-card bg-white"><CardContent className="p-4"><p className="text-xs text-ct-muted">Purchase Cost</p><p className="text-lg font-semibold text-ct-navy">{fmt(asset.purchaseCost)}</p></CardContent></Card>
        <Card className="rounded-xl shadow-card bg-white"><CardContent className="p-4"><p className="text-xs text-ct-muted">Accumulated Depreciation</p><p className="text-lg font-semibold text-ct-navy">{fmt(asset.accumulatedDepreciation)}</p></CardContent></Card>
        <Card className="rounded-xl shadow-card bg-white"><CardContent className="p-4"><p className="text-xs text-ct-muted">Net Book Value</p><p className="text-lg font-semibold text-ct-navy">{fmt(netBookValue)}</p></CardContent></Card>
        <Card className="rounded-xl shadow-card bg-white"><CardContent className="p-4"><p className="text-xs text-ct-muted">Location</p><p className="text-lg font-semibold text-ct-navy">{asset.location ?? "—"}</p></CardContent></Card>
      </div>

      <Tabs defaultValue="schedule">
        <TabsList>
          <TabsTrigger value="schedule">Depreciation Schedule</TabsTrigger>
          <TabsTrigger value="movements">Movements</TabsTrigger>
          <TabsTrigger value="disposal">Disposal</TabsTrigger>
        </TabsList>

        <TabsContent value="schedule" className="space-y-3">
          <Card className="rounded-xl shadow-card bg-white">
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead><tr className="text-left text-ct-muted border-b border-ct-border"><th className="p-3 font-medium">Period Ending</th><th className="p-3 font-medium">Depreciation</th><th className="p-3 font-medium">Accumulated After</th><th className="p-3 font-medium">Status</th></tr></thead>
                <tbody className="divide-y divide-ct-border">
                  {schedule.length === 0 ? <tr><td colSpan={4} className="p-6 text-center text-ct-muted">{asset.status === "draft" ? "No schedule yet -- capitalize this asset from the Asset Register to generate one." : "No depreciation periods."}</td></tr>
                    : schedule.map((s) => (
                      <tr key={s.id} className="hover:bg-ct-row-hover">
                        <td className="p-3">{s.scheduleDate}</td><td className="p-3">{fmt(s.depreciationAmount)}</td><td className="p-3">{fmt(s.accumulatedDepreciationAfter)}</td>
                        <td className="p-3">{s.isPosted ? <Badge className="bg-green-100 text-green-700">Posted</Badge> : <Badge className="bg-ct-cloud text-ct-muted">Pending</Badge>}</td>
                      </tr>
                    ))}
                </tbody>
              </table>
            </div>
          </Card>
        </TabsContent>

        <TabsContent value="movements" className="space-y-3">
          <div className="flex justify-end">
            <Dialog open={moveOpen} onOpenChange={setMoveOpen}>
              <DialogTrigger asChild><Button className="bg-ct-teal hover:bg-ct-teal-hover text-white" disabled={asset.status !== "in_use"}><Plus className="w-4 h-4 mr-1" />Record Movement</Button></DialogTrigger>
              <DialogContent>
                <DialogHeader><DialogTitle>Record Asset Movement</DialogTitle><DialogDescription>Transfer this asset to a new location and/or custodian.</DialogDescription></DialogHeader>
                <div className="space-y-3">
                  <div><Label>Movement Date</Label><Input type="date" value={moveDate} onChange={(e) => setMoveDate(e.target.value)} /></div>
                  <div><Label>To Location</Label><Input value={toLocation} onChange={(e) => setToLocation(e.target.value)} placeholder={asset.location ?? "e.g. Branch Office - 2nd Floor"} /></div>
                  <div><Label>To Custodian</Label>
                    <Select value={toCustodianId || "__none__"} onValueChange={(v) => setToCustodianId(v === "__none__" ? "" : v)}>
                      <SelectTrigger><SelectValue placeholder="Unchanged" /></SelectTrigger>
                      <SelectContent><SelectItem value="__none__">Unchanged</SelectItem>{users.map((u) => <SelectItem key={u.id} value={u.id}>{u.name}</SelectItem>)}</SelectContent>
                    </Select>
                  </div>
                  <div><Label>Purpose (optional)</Label><Input value={purpose} onChange={(e) => setPurpose(e.target.value)} /></div>
                </div>
                <DialogFooter><Button onClick={createMovement} disabled={creatingMove || (!toLocation && !toCustodianId)} className="bg-ct-teal hover:bg-ct-teal-hover text-white">{creatingMove && <Loader2 className="w-4 h-4 mr-1 animate-spin" />}Record</Button></DialogFooter>
              </DialogContent>
            </Dialog>
          </div>
          <Card className="rounded-xl shadow-card bg-white">
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead><tr className="text-left text-ct-muted border-b border-ct-border"><th className="p-3 font-medium">Date</th><th className="p-3 font-medium">From Location</th><th className="p-3 font-medium">To Location</th><th className="p-3 font-medium">Purpose</th></tr></thead>
                <tbody className="divide-y divide-ct-border">
                  {movements.length === 0 ? <tr><td colSpan={4} className="p-6 text-center text-ct-muted">No movements recorded.</td></tr>
                    : movements.map((m) => <tr key={m.id} className="hover:bg-ct-row-hover"><td className="p-3">{m.movementDate}</td><td className="p-3">{m.fromLocation ?? "—"}</td><td className="p-3">{m.toLocation ?? "—"}</td><td className="p-3">{m.purpose ?? "—"}</td></tr>)}
                </tbody>
              </table>
            </div>
          </Card>
        </TabsContent>

        <TabsContent value="disposal" className="space-y-3">
          <div className="flex justify-end">
            {canDispose ? (
              <Dialog open={disposeOpen} onOpenChange={setDisposeOpen}>
                <DialogTrigger asChild><Button variant="destructive" disabled={asset.status !== "in_use" || hasPendingDisposal}><Plus className="w-4 h-4 mr-1" />Initiate Disposal</Button></DialogTrigger>
                <DialogContent>
                  <DialogHeader><DialogTitle>Initiate Asset Disposal</DialogTitle><DialogDescription>Requires manager approval if this org has a disposal approval workflow configured — otherwise it posts immediately. Net book value: {fmt(netBookValue)}.</DialogDescription></DialogHeader>
                  <div className="space-y-3">
                    <div><Label>Disposal Date</Label><Input type="date" value={disposalDate} onChange={(e) => setDisposalDate(e.target.value)} /></div>
                    <div><Label>Disposal Type</Label>
                      <Select value={disposalType} onValueChange={setDisposalType}>
                        <SelectTrigger><SelectValue /></SelectTrigger>
                        <SelectContent><SelectItem value="sale">Sale</SelectItem><SelectItem value="scrap">Scrap</SelectItem><SelectItem value="write_off">Write-off</SelectItem></SelectContent>
                      </Select>
                    </div>
                    {disposalType === "sale" && <div><Label>Sale Value</Label><Input type="number" value={saleValue} onChange={(e) => setSaleValue(e.target.value)} /></div>}
                  </div>
                  <DialogFooter><Button onClick={createDisposal} disabled={creatingDisposal || (disposalType === "sale" && !saleValue)} className="bg-red-600 hover:bg-red-700 text-white">{creatingDisposal && <Loader2 className="w-4 h-4 mr-1 animate-spin" />}Initiate Disposal</Button></DialogFooter>
                </DialogContent>
              </Dialog>
            ) : (
              <p className="text-xs text-ct-muted">Disposing an asset requires manager rank or above.</p>
            )}
          </div>
          <Card className="rounded-xl shadow-card bg-white">
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead><tr className="text-left text-ct-muted border-b border-ct-border"><th className="p-3 font-medium">Date</th><th className="p-3 font-medium">Type</th><th className="p-3 font-medium">Sale Value</th><th className="p-3 font-medium">Status</th></tr></thead>
                <tbody className="divide-y divide-ct-border">
                  {disposals.length === 0 ? <tr><td colSpan={4} className="p-6 text-center text-ct-muted">No disposal history.</td></tr>
                    : disposals.map((d) => (
                      <tr key={d.id} className="hover:bg-ct-row-hover">
                        <td className="p-3">{d.disposalDate}</td><td className="p-3 capitalize">{d.disposalType.replace(/_/g, " ")}</td><td className="p-3">{d.saleValue ? fmt(d.saleValue) : "—"}</td>
                        <td className="p-3"><Badge className={d.status === "completed" ? "bg-green-100 text-green-700" : d.status === "rejected" ? "bg-red-100 text-red-700" : "bg-ct-cloud text-ct-muted"}>{d.status}</Badge></td>
                      </tr>
                    ))}
                </tbody>
              </table>
            </div>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}

function METHOD_LABEL(method: string) {
  return method === "written_down_value" ? "Declining Balance (WDV)" : "Straight-Line";
}
