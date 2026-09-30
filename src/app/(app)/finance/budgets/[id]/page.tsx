"use client";

// force-dynamic: see src/app/(app)/knowledge-base/page.tsx for why this is
// required (prevents static prerendering + CDN-cache bypass of middleware).
export const dynamic = "force-dynamic";

// PROJEXA server-merge module 20/24: port of PROJEXA's BudgetObjectClient.tsx
// (src/app/(app)/finance/budgets/[id]/page.tsx there) -- the ERP budget's
// detail/edit/submit/cancel screen plus real Budget vs Actual (variance).
// Reads GET /api/v1/projexa/project-budgets/[id] (full budget incl.
// lineItems) and GET /api/v1/projexa/project-budgets/[id]/variance, writes
// via PATCH .../[id] (draft-only line-item edit), POST .../submit
// (draft -> submitted) and POST .../cancel (the delete/remove action --
// budgets are never hard-deleted, only cancelled). Zero new backend route --
// every one of these already existed on erp-budget-service.ts before this
// port.
import { useCallback, useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { toast } from "sonner";
import { ArrowLeft, Loader2, Send, XCircle } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { currencyLabel, useCurrencies } from "@/lib/currency-format";

type LineItem = { id: string; accountId: string; annualAmount: string | number };
type Budget = {
  id: string;
  name: string;
  fiscalYearId: string;
  companyId: string | null;
  costCenterId: string | null;
  status: string;
  actionIfExceeded: string | null;
  lineItems: LineItem[];
};
type Account = { id: string; accountName: string; accountNumber: string | null };
type VarianceLine = {
  accountId: string;
  accountName: string;
  annualAmount: number;
  actualAmount: number;
  varianceAmount: number;
  variancePercent: number | null;
  isOverBudget: boolean;
};
type Variance = { asOfDate: string; lines: VarianceLine[]; totalBudget: number; totalActual: number };

const STATUS_VARIANT: Record<string, "default" | "secondary" | "destructive" | "outline"> = {
  draft: "outline",
  submitted: "default",
  cancelled: "destructive",
};

export default function BudgetDetailPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const budgetId = params.id;
  const currencies = useCurrencies();
  const money = (v: string | number) =>
    `${currencyLabel(undefined, currencies)}${Number(v).toLocaleString("en-IN", { maximumFractionDigits: 2 })}`;

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
      setDraftLines(budgetBody.lineItems ?? []);
      if (accountsRes && accountsRes.ok) {
        const acctBody = await accountsRes.json().catch(() => ({}));
        setAccounts(acctBody.accounts ?? []);
      }
      setLoadError(null);
      // Display-only: a variance failure (e.g. no journal-entry activity to
      // read yet) degrades to the section not rendering, never the page.
      fetch(`/api/v1/projexa/project-budgets/${encodeURIComponent(budgetId)}/variance`)
        .then((r) => (r.ok ? r.json() : null))
        .then((v) => setVariance(v))
        .catch(() => setVariance(null));
    } catch (err) {
      setBudget(null);
      setLoadError(err instanceof Error ? err.message : "Couldn't load this budget");
    } finally {
      setLoading(false);
    }
  }, [budgetId]);

  useEffect(() => {
    void load();
  }, [load]);

  function updateLine(idx: number, patch: Partial<LineItem>) {
    setDraftLines((prev) => prev.map((l, i) => (i === idx ? { ...l, ...patch } : l)));
  }

  async function saveLineItems() {
    setSaving(true);
    try {
      const res = await fetch(`/api/v1/projexa/project-budgets/${encodeURIComponent(budgetId)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          lineItems: draftLines.map((l) => ({ accountId: l.accountId, annualAmount: Number(l.annualAmount) })),
        }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) throw new Error(data?.error ?? "Failed to save budget");
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
      const res = await fetch(`/api/v1/projexa/project-budgets/${encodeURIComponent(budgetId)}/${action}`, {
        method: "POST",
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) throw new Error(data?.error ?? `Failed to ${action} budget`);
      toast.success(action === "submit" ? "Budget submitted" : "Budget cancelled");
      await load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : `Couldn't ${action} budget`);
    } finally {
      setActionBusy(null);
    }
  }

  if (loading) {
    return (
      <div className="grid h-40 place-items-center">
        <Loader2 className="size-5 animate-spin text-ct-muted" />
      </div>
    );
  }

  if (loadError || !budget) {
    return (
      <div className="space-y-3">
        <Link href="/finance/budgets" className="inline-flex items-center gap-1 text-sm text-ct-muted hover:text-ct-navy transition">
          <ArrowLeft className="size-4" />
          Back to Budgets
        </Link>
        <p role="alert" className="text-sm text-red-600">
          {loadError ?? "Budget not found."}
        </p>
        <Button variant="outline" size="sm" onClick={() => void load()}>
          Retry
        </Button>
      </div>
    );
  }

  const isDraft = budget.status === "draft";
  const isCancelled = budget.status === "cancelled";
  const totalAnnual = (mode === "edit" ? draftLines : budget.lineItems).reduce(
    (sum, l) => sum + Number(l.annualAmount),
    0
  );

  return (
    <div className="space-y-6">
      <div>
        <Button variant="ghost" size="sm" className="text-ct-muted -ml-2 mb-1" onClick={() => router.push("/finance/budgets")}>
          <ArrowLeft className="size-3.5 mr-1" /> Back to Budgets
        </Button>
        <div className="flex items-center justify-between flex-wrap gap-3">
          <div className="flex items-center gap-2">
            <h1 className="text-2xl font-heading text-ct-navy">{budget.name}</h1>
            <Badge variant={STATUS_VARIANT[budget.status] ?? "outline"} className="capitalize">
              {budget.status}
            </Badge>
          </div>
          <div className="flex items-center gap-2">
            {isDraft && mode === "display" && (
              <>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => {
                    setDraftLines(budget.lineItems);
                    setMode("edit");
                  }}
                >
                  Edit
                </Button>
                <Button
                  size="sm"
                  disabled={actionBusy !== null}
                  onClick={() => runAction("submit")}
                  className="bg-ct-saffron hover:bg-ct-saffron-hover text-white shadow-saffron"
                >
                  {actionBusy === "submit" ? (
                    <Loader2 className="size-3.5 mr-1 animate-spin" />
                  ) : (
                    <Send className="size-3.5 mr-1" />
                  )}
                  {actionBusy === "submit" ? "Submitting…" : "Submit"}
                </Button>
              </>
            )}
            {mode === "edit" && (
              <>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={saving}
                  onClick={() => {
                    setDraftLines(budget.lineItems);
                    setMode("display");
                  }}
                >
                  Cancel edit
                </Button>
                <Button size="sm" disabled={saving} onClick={saveLineItems}>
                  {saving ? <Loader2 className="size-3.5 mr-1 animate-spin" /> : null}
                  {saving ? "Saving…" : "Save"}
                </Button>
              </>
            )}
            {!isCancelled && mode === "display" && (
              <Button
                size="sm"
                variant="outline"
                className="text-red-600 hover:text-red-700"
                disabled={actionBusy !== null}
                onClick={() => runAction("cancel")}
                title="Cancels this budget -- budgets are never deleted"
              >
                {actionBusy === "cancel" ? (
                  <Loader2 className="size-3.5 mr-1 animate-spin" />
                ) : (
                  <XCircle className="size-3.5 mr-1" />
                )}
                {actionBusy === "cancel" ? "Cancelling…" : "Cancel"}
              </Button>
            )}
          </div>
        </div>
        <p className="text-sm text-ct-muted mt-1">
          Annual Total: {money(totalAnnual)} &middot; Action if Exceeded: {budget.actionIfExceeded ?? "warn"}
        </p>
      </div>

      <Card className="rounded-xl shadow-card bg-white">
        <CardHeader>
          <CardTitle className="text-base text-ct-navy">Line Items</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Account</TableHead>
                <TableHead className="text-right">Annual Amount</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {(mode === "edit" ? draftLines : budget.lineItems).map((l, idx) => {
                const account = accounts.find((a) => a.id === l.accountId);
                return (
                  <TableRow key={l.id ?? idx}>
                    <TableCell>
                      {mode === "edit" ? (
                        <Select value={l.accountId} onValueChange={(v) => updateLine(idx, { accountId: v })}>
                          <SelectTrigger className="w-64">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            {accounts.map((a) => (
                              <SelectItem key={a.id} value={a.id}>
                                {a.accountNumber ? `${a.accountNumber} — ` : ""}
                                {a.accountName}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      ) : (
                        <span className="font-medium text-ct-navy">
                          {account ? `${account.accountNumber ? `${account.accountNumber} — ` : ""}${account.accountName}` : l.accountId}
                        </span>
                      )}
                    </TableCell>
                    <TableCell className="text-right">
                      {mode === "edit" ? (
                        <Input
                          type="number"
                          className="w-32 text-right ml-auto"
                          value={String(l.annualAmount)}
                          onChange={(e) => updateLine(idx, { annualAmount: e.target.value })}
                        />
                      ) : (
                        money(l.annualAmount)
                      )}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </CardContent>
        <div className="flex justify-end border-t border-ct-border px-4 py-3 text-sm">
          <span className="text-ct-muted mr-2">Total:</span>
          <span className="font-medium text-ct-navy">{money(totalAnnual)}</span>
        </div>
      </Card>

      {variance && variance.lines.length > 0 && (
        <Card className="rounded-xl shadow-card bg-white">
          <CardHeader>
            <CardTitle className="text-base text-ct-navy">Budget vs Actual (as of {variance.asOfDate})</CardTitle>
          </CardHeader>
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
                    <TableCell className="text-ct-muted">{v.accountName}</TableCell>
                    <TableCell className="text-right">{money(v.annualAmount)}</TableCell>
                    <TableCell className="text-right">{money(v.actualAmount)}</TableCell>
                    <TableCell className={`text-right ${v.isOverBudget ? "text-red-600" : ""}`}>
                      {money(v.varianceAmount)}
                      {v.variancePercent !== null ? ` (${v.variancePercent.toFixed(0)}%)` : ""}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}

      {isCancelled && (
        <p className="text-xs text-ct-muted">Cancelled — budgets are never deleted; this record stays for the audit trail.</p>
      )}
    </div>
  );
}
