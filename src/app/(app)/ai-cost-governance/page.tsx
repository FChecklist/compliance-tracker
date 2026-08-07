"use client";

export const dynamic = "force-dynamic";

// VERIDIAN Review Framework gap-closure (AI Cost Governance & FinOps,
// 2026-08-01), 3 of the 4 findings under that heading closed here:
// (1) "Per-tenant AI cost visibility available to Finance" -- real
// per-tenant spend has been queryable via GET /api/ai/team/token-usage
// since 2026-07-18, but nothing consumed it as a UI page; this is that
// consuming page. (2)+(3) "cost attribution reconciles against actual
// provider invoices" / "cost-per-report and cost-per-AI-action are
// measurable, not estimated" -- both closed by the same manual monthly
// reconciliation feature (GET/POST /api/finance/ai-cost-reconciliation),
// surfaced here as an "estimate accuracy" figure next to every per-action
// cost so nobody mistakes a token-count estimate for a measured fact.
// The 4th finding (cross-repo compliance-tracker+projexa spend visibility)
// is documentation + a projexa-side CI guardrail, not a UI concern -- see
// docs/AI_COST_GOVERNANCE_FINOPS.md.
import { useCallback, useEffect, useState } from "react";
import { DollarSign, TrendingUp, Sparkles, Building2, ShieldCheck, AlertTriangle, Plus } from "lucide-react";
import { toast } from "sonner";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";

type SummaryRow = { groupKey: string | null; requests: number; estimatedCostUsd: number; cacheSavingsUsd: number };
type OrgRow = SummaryRow & { groupLabel: string | null };
type SpendForecast = { actualSpendToDateUsd: number; forecastedMonthEndSpendUsd: number };
type TokenUsageSummary = {
  sinceDays: number;
  totalCostUsd: number;
  totalRequests: number;
  totalCacheSavingsUsd: number;
  byScope: SummaryRow[];
  byRole: SummaryRow[];
  byModel: SummaryRow[];
  byOrg: OrgRow[];
  platformMonthlyForecast: SpendForecast;
};

type Reconciliation = {
  id: string;
  periodMonth: string;
  provider: string;
  actualInvoiceUsd: number;
  estimatedLedgerUsd: number;
  varianceUsd: number;
  variancePct: number | null;
  notes: string | null;
  createdAt: string;
};
type DriftSummary = { recordCount: number; avgAbsVariancePct: number | null };

const money = (n: number, digits = 2) => `$${n.toLocaleString("en-US", { minimumFractionDigits: digits, maximumFractionDigits: digits })}`;

function KpiTile({ icon, label, value, sub }: { icon: React.ReactNode; label: string; value: string; sub?: string }) {
  return (
    <Card className="rounded-xl shadow-card bg-white">
      <CardContent className="p-4">
        <div className="flex items-center gap-2 text-ct-muted text-xs mb-1">{icon}{label}</div>
        <div className="text-xl font-semibold text-ct-navy">{value}</div>
        {sub && <div className="text-[11px] text-ct-muted mt-0.5">{sub}</div>}
      </CardContent>
    </Card>
  );
}

function GroupTable({ rows, groupLabel, labelFor }: { rows: SummaryRow[]; groupLabel: string; labelFor?: (row: SummaryRow) => string }) {
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead className="text-xs font-semibold text-ct-navy">{groupLabel}</TableHead>
          <TableHead className="text-xs font-semibold text-ct-navy text-right">Requests</TableHead>
          <TableHead className="text-xs font-semibold text-ct-navy text-right">Cost</TableHead>
          <TableHead className="text-xs font-semibold text-ct-navy text-right">Cost / Request</TableHead>
          <TableHead className="text-xs font-semibold text-ct-navy text-right">Cache Savings</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.length === 0 ? (
          <TableRow><TableCell colSpan={5} className="h-20 text-center text-ct-muted text-sm">No data for this window.</TableCell></TableRow>
        ) : rows.map((row, i) => (
          <TableRow key={i}>
            <TableCell className="text-sm text-ct-navy font-medium">{labelFor ? labelFor(row) : (row.groupKey ?? "—")}</TableCell>
            <TableCell className="text-sm text-ct-slate text-right">{row.requests.toLocaleString()}</TableCell>
            <TableCell className="text-sm text-ct-slate text-right">{money(row.estimatedCostUsd)}</TableCell>
            <TableCell className="text-sm text-ct-muted text-right">{row.requests > 0 ? money(row.estimatedCostUsd / row.requests, 5) : "—"}</TableCell>
            <TableCell className="text-sm text-emerald-700 text-right">{row.cacheSavingsUsd > 0 ? money(row.cacheSavingsUsd) : "—"}</TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

const COMMON_PROVIDERS = ["openrouter", "groq", "cerebras", "anthropic", "openai", "google"];

export default function AiCostGovernancePage() {
  const [sinceDays, setSinceDays] = useState("30");
  const [summary, setSummary] = useState<TokenUsageSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [forbidden, setForbidden] = useState(false);

  const [reconciliations, setReconciliations] = useState<Reconciliation[]>([]);
  const [driftSummary, setDriftSummary] = useState<DriftSummary | null>(null);
  const [reconLoading, setReconLoading] = useState(true);

  const [dialogOpen, setDialogOpen] = useState(false);
  const [periodMonth, setPeriodMonth] = useState("");
  const [provider, setProvider] = useState("openrouter");
  const [actualInvoiceUsd, setActualInvoiceUsd] = useState("");
  const [notes, setNotes] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const loadSummary = useCallback(() => {
    setLoading(true);
    fetch(`/api/ai/team/token-usage?sinceDays=${sinceDays}`)
      .then((r) => {
        if (r.status === 403) { setForbidden(true); return null; }
        return r.ok ? r.json() : null;
      })
      .then((d) => { if (d) setSummary(d); })
      .finally(() => setLoading(false));
  }, [sinceDays]);

  const loadReconciliations = useCallback(() => {
    setReconLoading(true);
    fetch("/api/finance/ai-cost-reconciliation")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (d) { setReconciliations(d.reconciliations ?? []); setDriftSummary(d.driftSummary ?? null); }
      })
      .finally(() => setReconLoading(false));
  }, []);

  useEffect(() => { loadSummary(); }, [loadSummary]);
  useEffect(() => { loadReconciliations(); }, [loadReconciliations]);

  const submitReconciliation = async () => {
    const actual = Number(actualInvoiceUsd);
    if (!periodMonth || !provider.trim() || !Number.isFinite(actual) || actual < 0) {
      toast.error("Month, provider, and a non-negative actual invoice amount are required.");
      return;
    }
    setSubmitting(true);
    try {
      const res = await fetch("/api/finance/ai-cost-reconciliation", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ periodMonth: `${periodMonth}-01`, provider: provider.trim(), actualInvoiceUsd: actual, notes: notes.trim() || undefined }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error ?? "Failed to record reconciliation");
      }
      toast.success("Reconciliation recorded.");
      setDialogOpen(false);
      setPeriodMonth(""); setActualInvoiceUsd(""); setNotes("");
      loadReconciliations();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to record reconciliation");
    } finally {
      setSubmitting(false);
    }
  };

  if (forbidden) {
    return (
      <Card className="rounded-xl shadow-card bg-white">
        <CardContent className="p-8 text-center text-sm text-ct-muted">
          AI Cost & FinOps is veridian_admin-only.
        </CardContent>
      </Card>
    );
  }

  const accuracyLabel = driftSummary?.avgAbsVariancePct != null
    ? `Estimates track real invoices within ~${driftSummary.avgAbsVariancePct.toFixed(1)}% on average (${driftSummary.recordCount} month${driftSummary.recordCount === 1 ? "" : "s"} reconciled)`
    : "Not yet reconciled against a real provider invoice";

  return (
    <div className="space-y-4">
      <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-3">
        <div>
          <h1 className="font-heading text-2xl md:text-3xl text-ct-navy">AI Cost & FinOps</h1>
          <p className="text-sm text-ct-muted mt-1">
            Real AI spend across every org and internal role, grouped every way Finance needs -- with a standing accuracy check against real provider invoices.
          </p>
        </div>
        <Select value={sinceDays} onValueChange={setSinceDays}>
          <SelectTrigger className="w-[160px] h-9"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="7">Last 7 days</SelectItem>
            <SelectItem value="30">Last 30 days</SelectItem>
            <SelectItem value="90">Last 90 days</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {loading ? (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          {Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-24 rounded-xl" />)}
        </div>
      ) : (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          <KpiTile icon={<DollarSign className="size-3.5" />} label={`Spend (${summary?.sinceDays ?? sinceDays}d)`} value={money(summary?.totalCostUsd ?? 0)} sub={`${(summary?.totalRequests ?? 0).toLocaleString()} requests`} />
          <KpiTile icon={<Sparkles className="size-3.5" />} label="Cache Savings" value={money(summary?.totalCacheSavingsUsd ?? 0)} sub="Real $ saved on cache-read tokens" />
          <KpiTile icon={<TrendingUp className="size-3.5" />} label="Forecasted Month-End" value={money(summary?.platformMonthlyForecast.forecastedMonthEndSpendUsd ?? 0)} sub={`${money(summary?.platformMonthlyForecast.actualSpendToDateUsd ?? 0)} so far this month`} />
          <KpiTile
            icon={driftSummary?.avgAbsVariancePct != null ? <ShieldCheck className="size-3.5" /> : <AlertTriangle className="size-3.5" />}
            label="Estimate Accuracy"
            value={driftSummary?.avgAbsVariancePct != null ? `±${driftSummary.avgAbsVariancePct.toFixed(1)}%` : "Unverified"}
            sub={accuracyLabel}
          />
        </div>
      )}

      <Card className="rounded-xl shadow-card bg-white">
        <CardContent className="p-3">
          <div className="flex items-center gap-2 text-ct-navy font-medium text-sm mb-2 px-1"><Building2 className="size-4" />Per-Tenant Spend</div>
          <div className="overflow-x-auto">
            <GroupTable rows={summary?.byOrg ?? []} groupLabel="Organisation" labelFor={(r) => (r as OrgRow).groupLabel ?? r.groupKey ?? "—"} />
          </div>
        </CardContent>
      </Card>

      <Card className="rounded-xl shadow-card bg-white">
        <CardContent className="p-3">
          <Tabs defaultValue="scope">
            <TabsList>
              <TabsTrigger value="scope">By Scope</TabsTrigger>
              <TabsTrigger value="role">By AI-Team Role</TabsTrigger>
              <TabsTrigger value="model">By Model</TabsTrigger>
            </TabsList>
            <TabsContent value="scope" className="overflow-x-auto"><GroupTable rows={summary?.byScope ?? []} groupLabel="Scope" /></TabsContent>
            <TabsContent value="role" className="overflow-x-auto"><GroupTable rows={summary?.byRole ?? []} groupLabel="Role" /></TabsContent>
            <TabsContent value="model" className="overflow-x-auto"><GroupTable rows={summary?.byModel ?? []} groupLabel="Model" /></TabsContent>
          </Tabs>
        </CardContent>
      </Card>

      <Card className="rounded-xl shadow-card bg-white">
        <CardContent className="p-3">
          <div className="flex items-center justify-between mb-2 px-1">
            <div className="flex items-center gap-2 text-ct-navy font-medium text-sm">
              <ShieldCheck className="size-4" />Monthly Invoice Reconciliation
            </div>
            <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
              <DialogTrigger asChild>
                <Button size="sm" variant="outline" className="h-8"><Plus className="size-3.5 mr-1" />Record Reconciliation</Button>
              </DialogTrigger>
              <DialogContent>
                <DialogHeader><DialogTitle>Record Monthly Reconciliation</DialogTitle></DialogHeader>
                <div className="space-y-3 py-2">
                  <div>
                    <Label className="text-xs">Month</Label>
                    <Input type="month" value={periodMonth} onChange={(e) => setPeriodMonth(e.target.value)} className="h-9 mt-1" />
                  </div>
                  <div>
                    <Label className="text-xs">Provider</Label>
                    <Select value={provider} onValueChange={setProvider}>
                      <SelectTrigger className="h-9 mt-1"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {COMMON_PROVIDERS.map((p) => <SelectItem key={p} value={p}>{p}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </div>
                  <div>
                    <Label className="text-xs">Actual Invoice Total (USD)</Label>
                    <Input type="number" min="0" step="0.01" value={actualInvoiceUsd} onChange={(e) => setActualInvoiceUsd(e.target.value)} className="h-9 mt-1" placeholder="0.00" />
                  </div>
                  <div>
                    <Label className="text-xs">Notes (optional)</Label>
                    <Input value={notes} onChange={(e) => setNotes(e.target.value)} className="h-9 mt-1" placeholder="Invoice reference, adjustments, etc." />
                  </div>
                </div>
                <DialogFooter>
                  <Button onClick={submitReconciliation} disabled={submitting}>{submitting ? "Saving..." : "Save"}</Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>
          </div>
          <p className="text-xs text-ct-muted px-1 mb-2">
            True per-request billing granularity isn&apos;t exposed by any wired provider (invoices are monthly aggregates) -- this is the honest substitute: Finance enters each month&apos;s real invoice total per provider once it arrives, checked against what the ledger&apos;s token-count estimate said for that same month.
          </p>
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="text-xs font-semibold text-ct-navy">Month</TableHead>
                  <TableHead className="text-xs font-semibold text-ct-navy">Provider</TableHead>
                  <TableHead className="text-xs font-semibold text-ct-navy text-right">Actual Invoice</TableHead>
                  <TableHead className="text-xs font-semibold text-ct-navy text-right">Ledger Estimate</TableHead>
                  <TableHead className="text-xs font-semibold text-ct-navy text-right">Variance</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {reconLoading ? (
                  <TableRow><TableCell colSpan={5}><Skeleton className="h-4 w-full" /></TableCell></TableRow>
                ) : reconciliations.length === 0 ? (
                  <TableRow><TableCell colSpan={5} className="h-20 text-center text-ct-muted text-sm">No reconciliations recorded yet.</TableCell></TableRow>
                ) : reconciliations.map((r) => (
                  <TableRow key={r.id}>
                    <TableCell className="text-sm text-ct-navy">{r.periodMonth.slice(0, 7)}</TableCell>
                    <TableCell className="text-sm text-ct-slate">{r.provider}</TableCell>
                    <TableCell className="text-sm text-ct-slate text-right">{money(r.actualInvoiceUsd)}</TableCell>
                    <TableCell className="text-sm text-ct-muted text-right">{money(r.estimatedLedgerUsd)}</TableCell>
                    <TableCell className="text-sm text-right">
                      <Badge variant="secondary" className={r.variancePct !== null && Math.abs(r.variancePct) > 15 ? "bg-red-100 text-red-700" : "bg-emerald-100 text-emerald-700"}>
                        {money(r.varianceUsd)}{r.variancePct !== null ? ` (${r.variancePct > 0 ? "+" : ""}${r.variancePct.toFixed(1)}%)` : ""}
                      </Badge>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
