"use client";

export const dynamic = "force-dynamic";

// Wave 70 (Budgeting) -- per COMPARISON_CSV_GAP_ANALYSIS.md, Finance>Budgeting
// was a complete gap with no schema, service, or UI at all. Budget vs Actual
// is computed live server-side (erp-budget-service.ts's getBudgetVariance)
// off the existing GL, never a duplicated actuals ledger.
import { useEffect, useState, useCallback } from "react";
import { toast } from "sonner";
import { Wallet, Plus, Loader2, Trash2, Send, Ban } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

type FiscalYear = { id: string; yearName: string; startDate: string; endDate: string };
type CostCenter = { id: string; name: string };
type Account = { id: string; accountName: string; accountNumber: string | null };
type Budget = { id: string; name: string; fiscalYearId: string; costCenterId: string | null; actionIfExceeded: string; status: string };
type LineItemDraft = { accountId: string; annualAmount: string };
type VarianceLine = { accountId: string; accountName: string; annualAmount: number; actualAmount: number; varianceAmount: number; variancePercent: number | null; isOverBudget: boolean };
type Variance = { budget: Budget; asOfDate: string; lines: VarianceLine[]; totalBudget: number; totalActual: number };

const STATUS_VARIANT: Record<string, "default" | "secondary" | "outline"> = { draft: "outline", submitted: "default", cancelled: "secondary" };

function fmt(n: number) { return n.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }

export default function ErpBudgetsPage() {
  const [budgets, setBudgets] = useState<Budget[]>([]);
  const [fiscalYears, setFiscalYears] = useState<FiscalYear[]>([]);
  const [costCenters, setCostCenters] = useState<CostCenter[]>([]);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [loading, setLoading] = useState(true);

  const [dialogOpen, setDialogOpen] = useState(false);
  const [name, setName] = useState("");
  const [fiscalYearId, setFiscalYearId] = useState("");
  const [costCenterId, setCostCenterId] = useState("");
  const [actionIfExceeded, setActionIfExceeded] = useState("warn");
  const [lineItems, setLineItems] = useState<LineItemDraft[]>([{ accountId: "", annualAmount: "" }]);
  const [creating, setCreating] = useState(false);

  const [fyDialogOpen, setFyDialogOpen] = useState(false);
  const [fyName, setFyName] = useState("");
  const [fyStart, setFyStart] = useState("");
  const [fyEnd, setFyEnd] = useState("");
  const [creatingFy, setCreatingFy] = useState(false);

  const [selectedBudgetId, setSelectedBudgetId] = useState<string | null>(null);
  const [variance, setVariance] = useState<Variance | null>(null);
  const [varianceLoading, setVarianceLoading] = useState(false);

  const load = useCallback(async () => {
    const [budgetsRes, fyRes, ccRes, accRes] = await Promise.all([
      fetch("/api/erp/budgets"),
      fetch("/api/erp/fiscal-years"),
      fetch("/api/erp/cost-centers"),
      fetch("/api/erp/accounts"),
    ]);
    const [budgetsData, fyData, ccData, accData] = await Promise.all([budgetsRes.json(), fyRes.json(), ccRes.json(), accRes.json()]);
    setBudgets(budgetsData.budgets ?? []);
    setFiscalYears(fyData.fiscalYears ?? []);
    setCostCenters(ccData.costCenters ?? []);
    setAccounts(accData.accounts ?? []);
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  const fetchVariance = useCallback(async (budgetId: string) => {
    setSelectedBudgetId(budgetId);
    setVarianceLoading(true);
    const res = await fetch(`/api/erp/budgets/${budgetId}/variance`);
    setVariance(res.ok ? await res.json() : null);
    setVarianceLoading(false);
  }, []);

  async function createFiscalYear() {
    if (!fyName.trim() || !fyStart || !fyEnd) { toast.error("Name, start and end date are required"); return; }
    setCreatingFy(true);
    const res = await fetch("/api/erp/fiscal-years", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ yearName: fyName, startDate: fyStart, endDate: fyEnd }) });
    setCreatingFy(false);
    if (!res.ok) { toast.error((await res.json()).error ?? "Failed to create fiscal year"); return; }
    const fy = await res.json();
    toast.success("Fiscal year created");
    setFyDialogOpen(false);
    setFyName(""); setFyStart(""); setFyEnd("");
    setFiscalYears((prev) => [fy, ...prev]);
    setFiscalYearId(fy.id);
  }

  function updateLineItem(index: number, patch: Partial<LineItemDraft>) {
    setLineItems((prev) => prev.map((li, i) => (i === index ? { ...li, ...patch } : li)));
  }
  function addLineItem() { setLineItems((prev) => [...prev, { accountId: "", annualAmount: "" }]); }
  function removeLineItem(index: number) { setLineItems((prev) => prev.filter((_, i) => i !== index)); }

  async function createBudget() {
    if (!name.trim() || !fiscalYearId) { toast.error("Name and fiscal year are required"); return; }
    const validLines = lineItems.filter((li) => li.accountId && li.annualAmount);
    if (validLines.length === 0) { toast.error("At least one budget line item is required"); return; }

    setCreating(true);
    const res = await fetch("/api/erp/budgets", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name, fiscalYearId, costCenterId: costCenterId || undefined, actionIfExceeded,
        lineItems: validLines.map((li) => ({ accountId: li.accountId, annualAmount: Number(li.annualAmount) })),
      }),
    });
    setCreating(false);
    if (!res.ok) { toast.error((await res.json()).error ?? "Failed to create budget"); return; }
    toast.success("Budget created");
    setDialogOpen(false);
    setName(""); setFiscalYearId(""); setCostCenterId(""); setActionIfExceeded("warn"); setLineItems([{ accountId: "", annualAmount: "" }]);
    load();
  }

  async function submitBudget(id: string) {
    const res = await fetch(`/api/erp/budgets/${id}/submit`, { method: "POST" });
    if (!res.ok) { toast.error((await res.json()).error ?? "Failed to submit budget"); return; }
    toast.success("Budget submitted");
    load();
  }

  async function cancelBudget(id: string) {
    const res = await fetch(`/api/erp/budgets/${id}/cancel`, { method: "POST" });
    if (!res.ok) { toast.error((await res.json()).error ?? "Failed to cancel budget"); return; }
    toast.success("Budget cancelled");
    if (selectedBudgetId === id) { setSelectedBudgetId(null); setVariance(null); }
    load();
  }

  const fyNameById = new Map(fiscalYears.map((f) => [f.id, f.yearName]));
  const ccNameById = new Map(costCenters.map((c) => [c.id, c.name]));

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div>
          <h1 className="font-heading text-2xl md:text-3xl text-ct-navy flex items-center gap-2"><Wallet className="w-6 h-6" />Budgeting</h1>
          <p className="text-sm text-ct-muted mt-1">Budget vs Actual, computed live from posted journal entries — never a duplicated actuals ledger</p>
        </div>
        <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
          <DialogTrigger asChild><Button className="bg-ct-teal hover:bg-ct-teal/90"><Plus className="w-4 h-4 mr-1" />New Budget</Button></DialogTrigger>
          <DialogContent className="max-w-2xl">
            <DialogHeader><DialogTitle>New Budget</DialogTitle><DialogDescription>Set annual budget amounts per account. Variance is computed live against the GL.</DialogDescription></DialogHeader>
            <div className="space-y-3">
              <div><Label>Name</Label><Input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. FY26 Marketing Budget" /></div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label>Fiscal Year</Label>
                  <div className="flex gap-1">
                    <Select value={fiscalYearId} onValueChange={setFiscalYearId}>
                      <SelectTrigger><SelectValue placeholder="Select fiscal year" /></SelectTrigger>
                      <SelectContent>{fiscalYears.map((f) => <SelectItem key={f.id} value={f.id}>{f.yearName}</SelectItem>)}</SelectContent>
                    </Select>
                    <Dialog open={fyDialogOpen} onOpenChange={setFyDialogOpen}>
                      <DialogTrigger asChild><Button type="button" variant="outline" size="sm">+</Button></DialogTrigger>
                      <DialogContent>
                        <DialogHeader><DialogTitle>New Fiscal Year</DialogTitle></DialogHeader>
                        <div className="space-y-3">
                          <div><Label>Name</Label><Input value={fyName} onChange={(e) => setFyName(e.target.value)} placeholder="e.g. FY 2026-27" /></div>
                          <div className="grid grid-cols-2 gap-3">
                            <div><Label>Start Date</Label><Input type="date" value={fyStart} onChange={(e) => setFyStart(e.target.value)} /></div>
                            <div><Label>End Date</Label><Input type="date" value={fyEnd} onChange={(e) => setFyEnd(e.target.value)} /></div>
                          </div>
                        </div>
                        <DialogFooter><Button onClick={createFiscalYear} disabled={creatingFy}>{creatingFy ? <Loader2 className="w-4 h-4 animate-spin" /> : "Create"}</Button></DialogFooter>
                      </DialogContent>
                    </Dialog>
                  </div>
                </div>
                <div>
                  <Label>Cost Center (optional)</Label>
                  <Select value={costCenterId || "__none__"} onValueChange={(v) => setCostCenterId(v === "__none__" ? "" : v)}>
                    <SelectTrigger><SelectValue placeholder="Org-wide" /></SelectTrigger>
                    <SelectContent><SelectItem value="__none__">Org-wide (no cost center)</SelectItem>{costCenters.map((c) => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}</SelectContent>
                  </Select>
                </div>
              </div>
              <div>
                <Label>If budget is exceeded</Label>
                <Select value={actionIfExceeded} onValueChange={setActionIfExceeded}>
                  <SelectTrigger className="w-48"><SelectValue /></SelectTrigger>
                  <SelectContent><SelectItem value="ignore">Ignore</SelectItem><SelectItem value="warn">Warn</SelectItem><SelectItem value="stop">Stop</SelectItem></SelectContent>
                </Select>
              </div>

              <div>
                <div className="flex items-center justify-between mb-1"><Label>Line Items</Label><Button type="button" variant="outline" size="sm" onClick={addLineItem}><Plus className="w-3 h-3 mr-1" />Add</Button></div>
                <div className="space-y-2">
                  {lineItems.map((li, i) => (
                    <div key={i} className="flex gap-2 items-center">
                      <Select value={li.accountId} onValueChange={(v) => updateLineItem(i, { accountId: v })}>
                        <SelectTrigger className="flex-1"><SelectValue placeholder="Account" /></SelectTrigger>
                        <SelectContent>{accounts.map((a) => <SelectItem key={a.id} value={a.id}>{a.accountNumber ? `${a.accountNumber} — ` : ""}{a.accountName}</SelectItem>)}</SelectContent>
                      </Select>
                      <Input type="number" placeholder="Annual amount" className="w-40" value={li.annualAmount} onChange={(e) => updateLineItem(i, { annualAmount: e.target.value })} />
                      {lineItems.length > 1 && <Button type="button" variant="ghost" size="icon" onClick={() => removeLineItem(i)}><Trash2 className="w-4 h-4 text-red-500" /></Button>}
                    </div>
                  ))}
                </div>
              </div>
            </div>
            <DialogFooter><Button onClick={createBudget} disabled={creating}>{creating ? <Loader2 className="w-4 h-4 animate-spin" /> : "Create Budget"}</Button></DialogFooter>
          </DialogContent>
        </Dialog>
      </div>

      {loading ? (
        <div className="text-center text-ct-muted p-10">Loading…</div>
      ) : (
        <div className="grid md:grid-cols-2 gap-4">
          <Card className="rounded-xl shadow-card bg-white">
            <CardContent className="p-0">
              <table className="w-full text-xs">
                <thead><tr className="text-left text-ct-muted border-b border-ct-border"><th className="p-3 font-medium">Budget</th><th className="p-3 font-medium">Fiscal Year</th><th className="p-3 font-medium">Cost Center</th><th className="p-3 font-medium">Status</th><th className="p-3 font-medium"></th></tr></thead>
                <tbody className="divide-y divide-ct-border">
                  {budgets.length === 0 ? <tr><td colSpan={5} className="p-6 text-center text-ct-muted">No budgets yet.</td></tr>
                    : budgets.map((b) => (
                      <tr key={b.id} className={`hover:bg-ct-row-hover cursor-pointer ${selectedBudgetId === b.id ? "bg-ct-row-hover" : ""}`} onClick={() => fetchVariance(b.id)}>
                        <td className="p-3">{b.name}</td>
                        <td className="p-3">{fyNameById.get(b.fiscalYearId) ?? "—"}</td>
                        <td className="p-3">{b.costCenterId ? (ccNameById.get(b.costCenterId) ?? "—") : "Org-wide"}</td>
                        <td className="p-3"><Badge variant={STATUS_VARIANT[b.status] ?? "outline"}>{b.status}</Badge></td>
                        <td className="p-3 text-right">
                          {b.status === "draft" && <Button variant="ghost" size="icon" onClick={(e) => { e.stopPropagation(); submitBudget(b.id); }}><Send className="w-4 h-4" /></Button>}
                          {b.status !== "cancelled" && <Button variant="ghost" size="icon" onClick={(e) => { e.stopPropagation(); cancelBudget(b.id); }}><Ban className="w-4 h-4 text-red-500" /></Button>}
                        </td>
                      </tr>
                    ))}
                </tbody>
              </table>
            </CardContent>
          </Card>

          <Card className="rounded-xl shadow-card bg-white">
            <CardContent className="p-4">
              <h3 className="font-medium text-ct-navy mb-2">Budget vs Actual</h3>
              {!selectedBudgetId ? (
                <p className="text-sm text-ct-muted">Select a budget to see variance.</p>
              ) : varianceLoading ? (
                <div className="text-center text-ct-muted p-6">Loading…</div>
              ) : !variance ? (
                <p className="text-sm text-ct-muted">Failed to load variance.</p>
              ) : (
                <table className="w-full text-xs">
                  <thead><tr className="text-left text-ct-muted border-b border-ct-border"><th className="p-2 font-medium">Account</th><th className="p-2 font-medium text-right">Budget</th><th className="p-2 font-medium text-right">Actual</th><th className="p-2 font-medium text-right">Variance</th></tr></thead>
                  <tbody className="divide-y divide-ct-border">
                    {variance.lines.map((l) => (
                      <tr key={l.accountId}>
                        <td className="p-2">{l.accountName}</td>
                        <td className="p-2 text-right">{fmt(l.annualAmount)}</td>
                        <td className="p-2 text-right">{fmt(l.actualAmount)}</td>
                        <td className={`p-2 text-right ${l.isOverBudget ? "text-red-600" : "text-ct-teal"}`}>{fmt(l.varianceAmount)}{l.isOverBudget && <Badge className="bg-red-100 text-red-700 ml-2">Over</Badge>}</td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot><tr className="border-t-2 border-ct-navy font-medium"><td className="p-2">Total (as of {variance.asOfDate})</td><td className="p-2 text-right">{fmt(variance.totalBudget)}</td><td className="p-2 text-right">{fmt(variance.totalActual)}</td><td className="p-2 text-right">{fmt(variance.totalBudget - variance.totalActual)}</td></tr></tfoot>
                </table>
              )}
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  );
}
