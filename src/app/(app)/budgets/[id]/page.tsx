"use client";

// force-dynamic: see src/app/(app)/knowledge-base/page.tsx for why this is
// required (prevents static prerendering + CDN-cache bypass of middleware).
export const dynamic = "force-dynamic";

// PROJEXA server-merge (ai-os/PROJEXA_SERVER_MERGE_PLAN.md): port of
// PROJEXA's own BudgetObjectClient.tsx (the Budget Object Page: line items,
// edit-while-draft, Submit, Cancel, and Budget vs Actual). Reads/writes the
// SAME GET/PATCH /api/v1/projexa/project-budgets/{id} and POST .../submit,
// .../cancel, GET .../variance routes this app's backend already serves --
// zero new backend route. Real Delete = real Cancel (cancelBudget() -- an
// actual, designed lifecycle end state; budgets are never hard-deleted),
// same pattern PROJEXA's own object page uses.
//
// Rebuilt on this repo's own Card/Table/Select (matching
// src/app/(app)/customers/[id]/page.tsx, src/app/(app)/kpis/[id]/page.tsx),
// not PROJEXA's @fchecklist/veridian-ui-kit ObjectScreen.
import { useCallback, useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { toast } from "sonner";
import { ArrowLeft, Loader2, Plus, Trash2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  Table, TableBody, TableCell, TableFooter, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { currencyLabel, useCurrencies } from "@/lib/currency-format";

type LineItem = { id?: string; accountId: string; annualAmount: string | number };
type Budget = {
  id: string; name: string; fiscalYearId: string; companyId: string | null; costCenterId: string | null;
  status: string; actionIfExceeded: string | null; lineItems: LineItem[];
};
type Account = { id: string; accountName: string; accountNumber: string | null };
type VarianceLine = {
  accountId: string; accountName: string; annualAmount: number; actualAmount: number;
  varianceAmount: number; variancePercent: number | null; isOverBudget: boolean;
};
type Variance = { asOfDate: string; lines: VarianceLine[]; totalBudget: number; totalActual: number };

const STATUS_VARIANT: Record<string, "default" | "secondary" | "outline"> = {
  draft: "outline", submitted: "secondary", cancelled: "outline",
};

export default function BudgetDetailPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const budgetId = params.id;
  const currencies = useCurrencies();
  const money = (n: number) => `${currencyLabel(undefined, currencies)}${n.toLocaleString("en-IN", { maximumFractionDigits: 0 })}`;

  const [budget, setBudget] = useState<Budget | null>(null);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [variance, setVariance] = useState<Variance | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [mode, setMode] = useState<"display" | "edit">("display");
  const [draftLines, setDraftLines] = useState<LineItem[]>([]);
  const [saving, setSaving] = useState(false);
  const [actionBusy, setActionBusy] = useState<"submit" | "cancel" | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [budgetRes, accountsRes] = await Promise.all([
        fetch(`/api/v1/projexa/project-budgets/${encodeURIComponent(budgetId)}`),
        fetch("/api/v1/projexa/accounts").catch(() => null),
      ]);
      const budgetBody = await budgetRes.json().catch(() => null);
      if (!budgetRes.ok) throw new Error(budgetBody?.error ?? "Couldn't load this budget");
      setBudget(budgetBody as Budget);
      setDraftLines((budgetBody as Budget).lineItems ?? []);
      if (accountsRes && accountsRes.ok) {
        const accountsBody = await accountsRes.json().catch(() => ({}));
        setAccounts(accountsBody.accounts ?? []);
      }
      setLoadError(null);
      // Display-only: a failed variance read degrades to the section not
      // rendering, never blocks the object page itself from loading.
      fetch(`/api/v1/projexa/project-budgets/${encodeURIComponent(budgetId)}/variance`)
        .then((r) => (r.ok ? r.json() : null))
        .then(setVariance)
        .catch(() => setVariance(null));
    } catch (err) {
      setBudget(null);
      setLoadError(err instanceof Error ? err.message : "Couldn't load this budget");
    } finally {
      setLoading(false);
    }
  }, [budgetId]);

  useEffect(() => { void load(); }, [load]);

  function updateLine(idx: number, patch: Partial<LineItem>) {
    setDraftLines((prev) => prev.map((l, i) => (i === idx ? { ...l, ...patch } : l)));
  }
  function addLine() { setDraftLines((prev) => [...prev, { accountId: "", annualAmount: "" }]); }
  function removeLine(idx: number) { setDraftLines((prev) => prev.filter((_, i) => i !== idx)); }

  async function handleSave() {
    setSaving(true);
    try {
      const res = await fetch(`/api/v1/projexa/project-budgets/${encodeURIComponent(budgetId)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          lineItems: draftLines.map((l) => ({ accountId: l.accountId, annualAmount: Number(l.annualAmount) })),
        }),
      });
      const body = await res.json().catch(() => null);
      if (!res.ok) throw new Error(body?.error ?? "Failed to save budget");
      toast.success("Budget saved");
      setMode("display");
      await load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Couldn't save budget");
    } finally {
      setSaving(false);
    }
  }

  async function runAction(action: "submit" | "cancel") {
    setActionBusy(action);
    try {
      const res = await fetch(`/api/v1/projexa/project-budgets/${encodeURIComponent(budgetId)}/${action}`, { method: "POST" });
      const body = await res.json().catch(() => null);
      if (!res.ok) throw new Error(body?.error ?? `Failed to ${action} budget`);
      toast.success(action === "submit" ? "Budget submitted" : "Budget cancelled");
      await load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : `Couldn't ${action} budget`);
    } finally {
      setActionBusy(null);
    }
  }

  if (loading) {
    return <div className="grid h-40 place-items-center"><Loader2 className="size-5 animate-spin text-ct-muted" /></div>;
  }

  if (loadError || !budget) {
    return (
      <div className="space-y-3">
        <Link href="/budgets" className="inline-flex items-center gap-1 text-sm text-ct-muted hover:text-ct-navy transition">
          <ArrowLeft className="size-4" />Back to Budgets
        </Link>
        <p role="alert" className="text-sm text-red-600">{loadError ?? "Budget not found."}</p>
        <Button variant="outline" size="sm" onClick={() => load()}>Retry</Button>
      </div>
    );
  }

  const isDraft = budget.status === "draft";
  const lines = mode === "edit" ? draftLines : budget.lineItems;
  const totalAnnual = budget.lineItems.reduce((sum, l) => sum + Number(l.annualAmount), 0);

  return (
    <div className="space-y-6">
      <div>
        <Button variant="ghost" size="sm" className="text-ct-muted -ml-2 mb-1" onClick={() => router.push("/budgets")}>
          <ArrowLeft className="size-3.5 mr-1" /> Back to Budgets
        </Button>
        <div className="flex items-center justify-between flex-wrap gap-3">
          <div className="flex items-center gap-2">
            <h1 className="text-2xl font-heading text-ct-navy">{budget.name}</h1>
            <Badge variant={STATUS_VARIANT[budget.status] ?? "outline"}>{budget.status}</Badge>
          </div>
          <div className="flex items-center gap-2">
            {mode === "display" && isDraft && (
              <Button variant="outline" size="sm" onClick={() => { setDraftLines(budget.lineItems); setMode("edit"); }}>
                Edit
              </Button>
            )}
            {mode === "display" && isDraft && (
              <Button
                size="sm" disabled={actionBusy !== null}
                className="bg-ct-saffron hover:bg-ct-saffron-hover text-white"
                onClick={() => runAction("submit")}
              >
                {actionBusy === "submit" ? <Loader2 className="size-3.5 mr-1 animate-spin" /> : null}
                {actionBusy === "submit" ? "Submitting..." : "Submit"}
              </Button>
            )}
            {mode === "display" && budget.status !== "cancelled" && (
              <Button
                variant="outline" size="sm" disabled={actionBusy !== null}
                className="text-red-700 border-red-200 hover:bg-red-50"
                onClick={() => {
                  const sentence = `Cancel budget "${budget.name}"? This is the designed end state for a budget -- it is kept, not deleted, and cannot be edited further.`;
                  if (confirm(sentence)) void runAction("cancel");
                }}
              >
                {actionBusy === "cancel" ? <Loader2 className="size-3.5 mr-1 animate-spin" /> : null}
                Cancel Budget
              </Button>
            )}
          </div>
        </div>
        <p className="text-sm text-ct-muted mt-1">
          Annual Total: {money(totalAnnual)} &middot; Action if Exceeded: {budget.actionIfExceeded ?? "warn"}
        </p>
      </div>

      <Card className="rounded-xl shadow-card bg-white">
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle className="text-base text-ct-navy">Line Items</CardTitle>
          {mode === "edit" && (
            <Button type="button" variant="outline" size="sm" onClick={addLine}><Plus className="size-3.5 mr-1" />Add</Button>
          )}
        </CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Account</TableHead>
                <TableHead className="text-right">Annual Amount</TableHead>
                {mode === "edit" && <TableHead />}
              </TableRow>
            </TableHeader>
            <TableBody>
              {lines.map((l, idx) => {
                const account = accounts.find((a) => a.id === l.accountId);
                return (
                  <TableRow key={l.id ?? idx}>
                    <TableCell>
                      {mode === "edit" ? (
                        <Select value={l.accountId} onValueChange={(v) => updateLine(idx, { accountId: v })}>
                          <SelectTrigger className="w-[260px]"><SelectValue placeholder="Select an account" /></SelectTrigger>
                          <SelectContent>
                            {accounts.map((a) => (
                              <SelectItem key={a.id} value={a.id}>{a.accountNumber ? `${a.accountNumber} — ` : ""}{a.accountName}</SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      ) : (
                        account ? `${account.accountNumber ? `${account.accountNumber} — ` : ""}${account.accountName}` : l.accountId
                      )}
                    </TableCell>
                    <TableCell className="text-right">
                      {mode === "edit" ? (
                        <Input
                          type="number" className="w-32 text-right ml-auto"
                          value={String(l.annualAmount)}
                          onChange={(e) => updateLine(idx, { annualAmount: e.target.value })}
                        />
                      ) : money(Number(l.annualAmount))}
                    </TableCell>
                    {mode === "edit" && (
                      <TableCell className="text-right">
                        {lines.length > 1 && (
                          <Button type="button" variant="ghost" size="icon" aria-label="Remove line item" onClick={() => removeLine(idx)}>
                            <Trash2 className="size-4 text-red-500" />
                          </Button>
                        )}
                      </TableCell>
                    )}
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </CardContent>
        {mode === "edit" && (
          <div className="flex justify-end gap-2 p-4 border-t border-ct-border">
            <Button variant="outline" onClick={() => { setDraftLines(budget.lineItems); setMode("display"); }} disabled={saving}>
              Cancel
            </Button>
            <Button className="bg-ct-saffron hover:bg-ct-saffron-hover text-white" onClick={handleSave} disabled={saving}>
              {saving ? <Loader2 className="size-4 mr-2 animate-spin" /> : null}
              Save
            </Button>
          </div>
        )}
      </Card>

      {variance && variance.lines.length > 0 && (
        <Card className="rounded-xl shadow-card bg-white">
          <CardHeader><CardTitle className="text-base text-ct-navy">Budget vs Actual (as of {variance.asOfDate})</CardTitle></CardHeader>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Account</TableHead>
                  <TableHead className="text-right">Budget</TableHead>
                  <TableHead className="text-right">Actual</TableHead>
                  <TableHead className="text-right">Variance</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {variance.lines.map((v) => (
                  <TableRow key={v.accountId}>
                    <TableCell>{v.accountName}</TableCell>
                    <TableCell className="text-right">{money(v.annualAmount)}</TableCell>
                    <TableCell className="text-right">{money(v.actualAmount)}</TableCell>
                    <TableCell className={`text-right ${v.isOverBudget ? "text-red-600" : ""}`}>
                      {money(v.varianceAmount)}{v.variancePercent !== null ? ` (${v.variancePercent.toFixed(0)}%)` : ""}
                      {v.isOverBudget && <Badge className="bg-red-100 text-red-700 ml-2">Over</Badge>}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
              <TableFooter>
                <TableRow>
                  <TableCell className="font-medium text-ct-navy">Total (as of {variance.asOfDate})</TableCell>
                  <TableCell className="text-right font-medium">{money(variance.totalBudget)}</TableCell>
                  <TableCell className="text-right font-medium">{money(variance.totalActual)}</TableCell>
                  <TableCell className="text-right font-medium">{money(variance.totalBudget - variance.totalActual)}</TableCell>
                </TableRow>
              </TableFooter>
            </Table>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
