"use client";

export const dynamic = "force-dynamic";

// Wave B (VERIDIAN Review Framework remediation, Fixed Assets wiring):
// first real UI on top of the Wave 49/drizzle/0042 schema scaffold -- asset
// register (list/create/capitalize), category management, and an org-wide
// depreciation run, all wired to erp-fixed-assets-service.ts. Per-asset
// depreciation schedule/movements/disposal-workflow UI lives on the detail
// page (./[id]/page.tsx). Matches erp/journal-entries/page.tsx's own
// Tabs + Dialog + table layout exactly.
import { useEffect, useState, useCallback } from "react";
import Link from "next/link";
import { toast } from "sonner";
import { Loader2, Plus, ArrowRight, PlayCircle } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";

type Category = {
  id: string; categoryName: string; defaultDepreciationMethod: string; defaultUsefulLifeMonths: number | null;
  assetAccountId: string | null; depreciationExpenseAccountId: string | null; accumulatedDepreciationAccountId: string | null;
};
type Asset = {
  id: string; assetName: string; assetCategoryId: string; status: string; location: string | null;
  purchaseDate: string; purchaseCost: string; currentValue: string | null; accumulatedDepreciation: string;
  depreciationMethod: string; usefulLifeMonths: number | null; category?: Category;
};
type Account = { id: string; accountName: string; accountNumber: string | null; rootType: string };
type Department = { id: string; name: string };

const STATUS_COLORS: Record<string, string> = {
  draft: "bg-ct-cloud text-ct-muted",
  in_use: "bg-green-100 text-green-700",
  submitted: "bg-blue-100 text-blue-700",
  disposed: "bg-red-100 text-red-700",
  scrapped: "bg-red-100 text-red-700",
};
const METHOD_LABELS: Record<string, string> = { straight_line: "Straight-Line", written_down_value: "Declining Balance (WDV)" };

function fmt(n: number | string | null | undefined) {
  return Number(n ?? 0).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export default function FixedAssetsPage() {
  const [assets, setAssets] = useState<Asset[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [departments, setDepartments] = useState<Department[]>([]);
  const [loading, setLoading] = useState(true);

  const [assetOpen, setAssetOpen] = useState(false);
  const [assetName, setAssetName] = useState("");
  const [categoryId, setCategoryId] = useState("");
  const [departmentId, setDepartmentId] = useState("");
  const [location, setLocation] = useState("");
  const [purchaseDate, setPurchaseDate] = useState(new Date().toISOString().slice(0, 10));
  const [purchaseCost, setPurchaseCost] = useState("");
  const [depreciationMethod, setDepreciationMethod] = useState("straight_line");
  const [usefulLifeMonths, setUsefulLifeMonths] = useState("");
  const [salvageValue, setSalvageValue] = useState("0");
  const [creatingAsset, setCreatingAsset] = useState(false);

  const [catOpen, setCatOpen] = useState(false);
  const [catName, setCatName] = useState("");
  const [catMethod, setCatMethod] = useState("straight_line");
  const [catLife, setCatLife] = useState("");
  const [catAssetAcct, setCatAssetAcct] = useState("");
  const [catExpenseAcct, setCatExpenseAcct] = useState("");
  const [catAccumAcct, setCatAccumAcct] = useState("");
  const [creatingCat, setCreatingCat] = useState(false);

  const [submittingId, setSubmittingId] = useState<string | null>(null);
  const [runOpen, setRunOpen] = useState(false);
  const [runAsOfDate, setRunAsOfDate] = useState(new Date().toISOString().slice(0, 10));
  const [running, setRunning] = useState(false);

  const load = useCallback(() => {
    Promise.all([
      fetch("/api/erp/fixed-assets"), fetch("/api/erp/fixed-assets/categories"),
      fetch("/api/erp/accounts"), fetch("/api/departments"),
    ])
      .then(([aRes, cRes, acctRes, dRes]) => Promise.all([aRes.json(), cRes.json(), acctRes.json(), dRes.json()]))
      .then(([aData, cData, acctData, dData]) => {
        setAssets(aData.assets ?? []);
        setCategories(cData.categories ?? []);
        setAccounts(acctData.accounts ?? []);
        setDepartments(dData.departments ?? []);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, []);

  useEffect(load, [load]);

  const createCategory = async () => {
    if (!catName.trim()) return;
    setCreatingCat(true);
    const res = await fetch("/api/erp/fixed-assets/categories", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        categoryName: catName, defaultDepreciationMethod: catMethod,
        defaultUsefulLifeMonths: catLife ? Number(catLife) : undefined,
        assetAccountId: catAssetAcct || undefined, depreciationExpenseAccountId: catExpenseAcct || undefined,
        accumulatedDepreciationAccountId: catAccumAcct || undefined,
      }),
    });
    setCreatingCat(false);
    if (!res.ok) { const d = await res.json().catch(() => ({})); toast.error(d.error ?? "Failed to create category"); return; }
    setCatOpen(false); setCatName(""); setCatLife(""); setCatAssetAcct(""); setCatExpenseAcct(""); setCatAccumAcct("");
    toast.success("Asset category created");
    load();
  };

  const createAsset = async () => {
    if (!assetName.trim() || !categoryId || !purchaseCost) return;
    setCreatingAsset(true);
    const res = await fetch("/api/erp/fixed-assets", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        assetName, assetCategoryId: categoryId, departmentId: departmentId || undefined, location: location || undefined,
        purchaseDate, purchaseCost: Number(purchaseCost), depreciationMethod,
        usefulLifeMonths: usefulLifeMonths ? Number(usefulLifeMonths) : undefined, salvageValue: Number(salvageValue) || 0,
      }),
    });
    setCreatingAsset(false);
    if (!res.ok) { const d = await res.json().catch(() => ({})); toast.error(d.error ?? "Failed to create asset"); return; }
    setAssetOpen(false); setAssetName(""); setCategoryId(""); setDepartmentId(""); setLocation(""); setPurchaseCost(""); setUsefulLifeMonths(""); setSalvageValue("0");
    toast.success("Asset created as draft");
    load();
  };

  const capitalizeAsset = async (id: string) => {
    setSubmittingId(id);
    const res = await fetch(`/api/erp/fixed-assets/${id}/submit`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({}) });
    setSubmittingId(null);
    const d = await res.json().catch(() => ({}));
    if (!res.ok) { toast.error(d.error ?? "Failed to capitalize asset"); return; }
    toast.success(`Capitalized -- ${d.scheduleCount ?? 0} depreciation period(s) scheduled`);
    load();
  };

  const runDepreciation = async () => {
    setRunning(true);
    const res = await fetch("/api/erp/fixed-assets/depreciation-runs", {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ asOfDate: runAsOfDate }),
    });
    setRunning(false);
    const d = await res.json().catch(() => ({}));
    if (!res.ok) { toast.error(d.error ?? "Depreciation run failed"); return; }
    toast.success(`Depreciation run posted ${d.postedCount ?? 0} schedule row(s)`);
    setRunOpen(false);
    load();
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="font-heading text-2xl md:text-3xl text-ct-navy">Fixed Assets</h1>
          <p className="text-sm text-ct-muted mt-1">Asset register, categories &amp; depreciation — VERI ERP AI</p>
        </div>
        <Dialog open={runOpen} onOpenChange={setRunOpen}>
          <DialogTrigger asChild><Button variant="outline"><PlayCircle className="w-4 h-4 mr-1" />Run Depreciation</Button></DialogTrigger>
          <DialogContent>
            <DialogHeader><DialogTitle>Run Depreciation</DialogTitle><DialogDescription>Posts every unposted depreciation-schedule row (across all in-use assets) whose period ends on or before this date, into the general ledger.</DialogDescription></DialogHeader>
            <div><Label>As of Date</Label><Input type="date" value={runAsOfDate} onChange={(e) => setRunAsOfDate(e.target.value)} /></div>
            <DialogFooter><Button onClick={runDepreciation} disabled={running} className="bg-ct-teal hover:bg-ct-teal-hover text-white">{running && <Loader2 className="w-4 h-4 mr-1 animate-spin" />}Run</Button></DialogFooter>
          </DialogContent>
        </Dialog>
      </div>

      <Tabs defaultValue="assets">
        <TabsList>
          <TabsTrigger value="assets">Asset Register</TabsTrigger>
          <TabsTrigger value="categories">Categories</TabsTrigger>
        </TabsList>

        <TabsContent value="assets" className="space-y-3">
          <div className="flex justify-end">
            <Dialog open={assetOpen} onOpenChange={setAssetOpen}>
              <DialogTrigger asChild><Button className="bg-ct-teal hover:bg-ct-teal-hover text-white"><Plus className="w-4 h-4 mr-1" />New Asset</Button></DialogTrigger>
              <DialogContent className="max-w-2xl">
                <DialogHeader><DialogTitle>New Fixed Asset</DialogTitle><DialogDescription>Created as a draft -- capitalize it once ready to generate its depreciation schedule.</DialogDescription></DialogHeader>
                <div className="space-y-3">
                  <div className="grid grid-cols-2 gap-3">
                    <div><Label>Asset Name</Label><Input value={assetName} onChange={(e) => setAssetName(e.target.value)} /></div>
                    <div><Label>Category</Label>
                      <Select value={categoryId} onValueChange={(v) => {
                        setCategoryId(v);
                        const c = categories.find((c) => c.id === v);
                        if (c) { setDepreciationMethod(c.defaultDepreciationMethod); if (c.defaultUsefulLifeMonths) setUsefulLifeMonths(String(c.defaultUsefulLifeMonths)); }
                      }}>
                        <SelectTrigger><SelectValue placeholder="Select category" /></SelectTrigger>
                        <SelectContent>{categories.map((c) => <SelectItem key={c.id} value={c.id}>{c.categoryName}</SelectItem>)}</SelectContent>
                      </Select>
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div><Label>Department (optional)</Label>
                      <Select value={departmentId || "__none__"} onValueChange={(v) => setDepartmentId(v === "__none__" ? "" : v)}>
                        <SelectTrigger><SelectValue placeholder="No department" /></SelectTrigger>
                        <SelectContent><SelectItem value="__none__">No department</SelectItem>{departments.map((d) => <SelectItem key={d.id} value={d.id}>{d.name}</SelectItem>)}</SelectContent>
                      </Select>
                    </div>
                    <div><Label>Location (optional)</Label><Input value={location} onChange={(e) => setLocation(e.target.value)} placeholder="e.g. HO - 3rd Floor" /></div>
                  </div>
                  <div className="grid grid-cols-3 gap-3">
                    <div><Label>Purchase Date</Label><Input type="date" value={purchaseDate} onChange={(e) => setPurchaseDate(e.target.value)} /></div>
                    <div><Label>Purchase Cost</Label><Input type="number" value={purchaseCost} onChange={(e) => setPurchaseCost(e.target.value)} /></div>
                    <div><Label>Salvage Value</Label><Input type="number" value={salvageValue} onChange={(e) => setSalvageValue(e.target.value)} /></div>
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div><Label>Depreciation Method</Label>
                      <Select value={depreciationMethod} onValueChange={setDepreciationMethod}>
                        <SelectTrigger><SelectValue /></SelectTrigger>
                        <SelectContent><SelectItem value="straight_line">Straight-Line</SelectItem><SelectItem value="written_down_value">Declining Balance (WDV)</SelectItem></SelectContent>
                      </Select>
                    </div>
                    <div><Label>Useful Life (months)</Label><Input type="number" value={usefulLifeMonths} onChange={(e) => setUsefulLifeMonths(e.target.value)} /></div>
                  </div>
                </div>
                <DialogFooter><Button onClick={createAsset} disabled={creatingAsset || !assetName || !categoryId || !purchaseCost} className="bg-ct-teal hover:bg-ct-teal-hover text-white">{creatingAsset && <Loader2 className="w-4 h-4 mr-1 animate-spin" />}Create Draft</Button></DialogFooter>
              </DialogContent>
            </Dialog>
          </div>

          <Card className="rounded-xl shadow-card bg-white">
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead><tr className="text-left text-ct-muted border-b border-ct-border">
                  <th className="p-3 font-medium">Asset</th><th className="p-3 font-medium">Category</th><th className="p-3 font-medium">Status</th>
                  <th className="p-3 font-medium">Purchase Cost</th><th className="p-3 font-medium">Accum. Depr.</th><th className="p-3 font-medium">Current Value</th><th className="p-3 font-medium"></th>
                </tr></thead>
                <tbody className="divide-y divide-ct-border">
                  {loading ? <tr><td colSpan={7} className="p-6 text-center text-ct-muted">Loading…</td></tr>
                    : assets.length === 0 ? <tr><td colSpan={7} className="p-6 text-center text-ct-muted">No assets yet — create one to get started.</td></tr>
                    : assets.map((a) => (
                      <tr key={a.id} className="hover:bg-ct-row-hover">
                        <td className="p-3"><Link href={`/erp/fixed-assets/${a.id}`} className="text-ct-teal hover:underline font-medium">{a.assetName}</Link></td>
                        <td className="p-3">{a.category?.categoryName ?? "—"}</td>
                        <td className="p-3"><Badge className={STATUS_COLORS[a.status] ?? ""}>{a.status.replace(/_/g, " ")}</Badge></td>
                        <td className="p-3">{fmt(a.purchaseCost)}</td>
                        <td className="p-3">{fmt(a.accumulatedDepreciation)}</td>
                        <td className="p-3">{fmt(a.currentValue)}</td>
                        <td className="p-3 text-right">
                          {a.status === "draft"
                            ? <Button size="sm" className="h-7 text-xs bg-ct-teal hover:bg-ct-teal-hover text-white" onClick={() => capitalizeAsset(a.id)} disabled={submittingId === a.id}>{submittingId === a.id && <Loader2 className="w-3 h-3 mr-1 animate-spin" />}Capitalize</Button>
                            : <Link href={`/erp/fixed-assets/${a.id}`}><Button size="sm" variant="outline" className="h-7 text-xs">Details <ArrowRight className="w-3 h-3 ml-1" /></Button></Link>}
                        </td>
                      </tr>
                    ))}
                </tbody>
              </table>
            </div>
          </Card>
        </TabsContent>

        <TabsContent value="categories" className="space-y-3">
          <div className="flex justify-end">
            <Dialog open={catOpen} onOpenChange={setCatOpen}>
              <DialogTrigger asChild><Button className="bg-ct-teal hover:bg-ct-teal-hover text-white"><Plus className="w-4 h-4 mr-1" />New Category</Button></DialogTrigger>
              <DialogContent className="max-w-lg">
                <DialogHeader><DialogTitle>New Asset Category</DialogTitle><DialogDescription>Sets the default depreciation method/useful life and the GL accounts assets in this category post to.</DialogDescription></DialogHeader>
                <div className="space-y-3">
                  <div><Label>Category Name</Label><Input value={catName} onChange={(e) => setCatName(e.target.value)} placeholder="e.g. Computers &amp; IT Equipment" /></div>
                  <div className="grid grid-cols-2 gap-3">
                    <div><Label>Default Method</Label>
                      <Select value={catMethod} onValueChange={setCatMethod}>
                        <SelectTrigger><SelectValue /></SelectTrigger>
                        <SelectContent><SelectItem value="straight_line">Straight-Line</SelectItem><SelectItem value="written_down_value">Declining Balance (WDV)</SelectItem></SelectContent>
                      </Select>
                    </div>
                    <div><Label>Default Useful Life (months)</Label><Input type="number" value={catLife} onChange={(e) => setCatLife(e.target.value)} /></div>
                  </div>
                  <div><Label>Asset Account</Label>
                    <Select value={catAssetAcct || "__none__"} onValueChange={(v) => setCatAssetAcct(v === "__none__" ? "" : v)}>
                      <SelectTrigger><SelectValue placeholder="No account" /></SelectTrigger>
                      <SelectContent><SelectItem value="__none__">No account</SelectItem>{accounts.map((a) => <SelectItem key={a.id} value={a.id}>{a.accountName}</SelectItem>)}</SelectContent>
                    </Select>
                  </div>
                  <div><Label>Depreciation Expense Account</Label>
                    <Select value={catExpenseAcct || "__none__"} onValueChange={(v) => setCatExpenseAcct(v === "__none__" ? "" : v)}>
                      <SelectTrigger><SelectValue placeholder="No account" /></SelectTrigger>
                      <SelectContent><SelectItem value="__none__">No account</SelectItem>{accounts.map((a) => <SelectItem key={a.id} value={a.id}>{a.accountName}</SelectItem>)}</SelectContent>
                    </Select>
                  </div>
                  <div><Label>Accumulated Depreciation Account</Label>
                    <Select value={catAccumAcct || "__none__"} onValueChange={(v) => setCatAccumAcct(v === "__none__" ? "" : v)}>
                      <SelectTrigger><SelectValue placeholder="No account" /></SelectTrigger>
                      <SelectContent><SelectItem value="__none__">No account</SelectItem>{accounts.map((a) => <SelectItem key={a.id} value={a.id}>{a.accountName}</SelectItem>)}</SelectContent>
                    </Select>
                  </div>
                </div>
                <DialogFooter><Button onClick={createCategory} disabled={creatingCat || !catName} className="bg-ct-teal hover:bg-ct-teal-hover text-white">{creatingCat && <Loader2 className="w-4 h-4 mr-1 animate-spin" />}Create</Button></DialogFooter>
              </DialogContent>
            </Dialog>
          </div>
          <Card className="rounded-xl shadow-card bg-white">
            <CardContent className="p-0">
              <table className="w-full text-xs">
                <thead><tr className="text-left text-ct-muted border-b border-ct-border"><th className="p-3 font-medium">Name</th><th className="p-3 font-medium">Default Method</th><th className="p-3 font-medium">Default Useful Life</th></tr></thead>
                <tbody className="divide-y divide-ct-border">
                  {categories.length === 0 ? <tr><td colSpan={3} className="p-6 text-center text-ct-muted">No categories yet.</td></tr>
                    : categories.map((c) => <tr key={c.id} className="hover:bg-ct-row-hover"><td className="p-3">{c.categoryName}</td><td className="p-3">{METHOD_LABELS[c.defaultDepreciationMethod] ?? c.defaultDepreciationMethod}</td><td className="p-3">{c.defaultUsefulLifeMonths ? `${c.defaultUsefulLifeMonths} months` : "—"}</td></tr>)}
                </tbody>
              </table>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
