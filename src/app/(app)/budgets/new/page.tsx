"use client";

// force-dynamic: see src/app/(app)/knowledge-base/page.tsx for why this is
// required (prevents static prerendering + CDN-cache bypass of middleware).
export const dynamic = "force-dynamic";

// PROJEXA server-merge (ai-os/PROJEXA_SERVER_MERGE_PLAN.md): port of
// PROJEXA's own BudgetCreateClient.tsx (its real home is now
// src/app/(app)/finance/budgets/new/page.tsx there -- /budgets/new is a
// redirect shim, R67 D-62). Same fields, same live lookups
// (fiscal years / cost centers / chart of accounts / companies), same
// blocked-reason honesty when fiscal years or a chart of accounts aren't
// provisioned yet. POSTs to the SAME POST /api/v1/projexa/project-budgets
// this app's backend already serves.
//
// Rebuilt on this repo's own Card/Input/Select (matching
// src/app/(app)/customers/new/page.tsx, src/app/(app)/kpis/new/page.tsx),
// not PROJEXA's @fchecklist/veridian-ui-kit ObjectScreen/CreateScreen.
// Deliberately simpler than PROJEXA's own create screen: the "ask your
// administrator" flow there exists because PROJEXA is a separate app with
// no direct link to compliance-tracker's own ERP setup screens. Here we
// ARE compliance-tracker, so the missing-precondition banner links straight
// to the real /erp/periods screen instead.
import { Suspense, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { toast } from "sonner";
import { ArrowLeft, Loader2, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

type FiscalYear = { id: string; yearName: string; isClosed?: boolean };
type CostCenter = { id: string; name: string };
type Account = { id: string; accountName: string; accountNumber: string | null };
type Company = { id: string; companyName: string; abbr: string | null };
type LineItemDraft = { accountId: string; annualAmount: string };

const NO_COST_CENTER = "__none__";
const NO_COMPANY = "__none__";

function NewBudgetForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const companyIdParam = searchParams.get("companyId") ?? "";

  const [fiscalYears, setFiscalYears] = useState<FiscalYear[]>([]);
  const [costCenters, setCostCenters] = useState<CostCenter[]>([]);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [companies, setCompanies] = useState<Company[]>([]);
  const [lookupsLoading, setLookupsLoading] = useState(true);

  const [name, setName] = useState("");
  const [fiscalYearId, setFiscalYearId] = useState("");
  const [costCenterId, setCostCenterId] = useState("");
  const [companyId, setCompanyId] = useState(companyIdParam);
  const [actionIfExceeded, setActionIfExceeded] = useState("warn");
  const [lineItems, setLineItems] = useState<LineItemDraft[]>([{ accountId: "", annualAmount: "" }]);
  const [submitting, setSubmitting] = useState(false);

  // allSettled, not Promise.all: one failed lookup (e.g. companies, which is
  // optional on this form) must not blank the fiscal-year/account lists too
  // -- same reasoning as PROJEXA's own BudgetCreateClient.tsx (R67 F-19).
  useEffect(() => {
    let live = true;
    (async () => {
      setLookupsLoading(true);
      const [fyRes, ccRes, acRes, coRes] = await Promise.allSettled([
        fetch("/api/v1/projexa/fiscal-years").then((r) => r.json()),
        fetch("/api/v1/projexa/cost-centers").then((r) => r.json()),
        fetch("/api/v1/projexa/accounts").then((r) => r.json()),
        fetch("/api/v1/projexa/companies").then((r) => r.json()),
      ]);
      if (!live) return;
      if (fyRes.status === "fulfilled") setFiscalYears(fyRes.value.fiscalYears ?? []);
      if (ccRes.status === "fulfilled") setCostCenters(ccRes.value.costCenters ?? []);
      if (acRes.status === "fulfilled") setAccounts(acRes.value.accounts ?? []);
      if (coRes.status === "fulfilled") setCompanies(coRes.value.companies ?? []);
      setLookupsLoading(false);
    })();
    return () => { live = false; };
  }, []);

  function updateLineItem(index: number, patch: Partial<LineItemDraft>) {
    setLineItems((prev) => prev.map((li, i) => (i === index ? { ...li, ...patch } : li)));
  }
  function addLineItem() { setLineItems((prev) => [...prev, { accountId: "", annualAmount: "" }]); }
  function removeLineItem(index: number) { setLineItems((prev) => prev.filter((_, i) => i !== index)); }

  const missing = [
    fiscalYears.length === 0 ? "a fiscal year" : null,
    accounts.length === 0 ? "an account" : null,
  ].filter((m): m is string => m !== null);
  const blocked = !lookupsLoading && missing.length > 0;
  const fieldsDisabled = lookupsLoading || blocked;

  const create = async () => {
    if (!name.trim()) { toast.error("Budget name is required"); return; }
    if (!fiscalYearId) { toast.error("Fiscal year is required"); return; }
    const validLines = lineItems.filter((li) => li.accountId && li.annualAmount);
    if (validLines.length === 0) { toast.error("At least one budget line item is required"); return; }

    setSubmitting(true);
    try {
      const res = await fetch("/api/v1/projexa/project-budgets", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: name.trim(),
          fiscalYearId,
          costCenterId: costCenterId || undefined,
          companyId: companyId || undefined,
          actionIfExceeded,
          lineItems: validLines.map((li) => ({ accountId: li.accountId, annualAmount: Number(li.annualAmount) })),
        }),
      });
      const body = await res.json().catch(() => null);
      if (!res.ok) throw new Error(body?.error ?? "Couldn't create budget");
      toast.success("Budget created");
      router.push(`/budgets/${body.id}`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Couldn't create budget");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="space-y-6 max-w-2xl">
      <Link href="/budgets" className="inline-flex items-center gap-1 text-sm text-ct-muted hover:text-ct-navy transition">
        <ArrowLeft className="size-4" />Back to Budgets
      </Link>

      <div>
        <h1 className="font-heading text-2xl md:text-3xl text-ct-navy">New Budget</h1>
        <p className="text-sm text-ct-muted mt-1">Set annual budget amounts per account. Budget vs Actual is computed live against the general ledger.</p>
      </div>

      {blocked && (
        <div role="alert" className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">
          This organisation has no {missing.join(" and ")} set up yet, and both are required to create a budget.
          {missing.includes("a fiscal year") && (
            <>
              {" "}<Link href="/erp/periods" className="underline font-medium">Set up a fiscal year</Link> in Finance &rsaquo; Periods first.
            </>
          )}
        </div>
      )}

      <Card className="rounded-xl shadow-card bg-white">
        <CardHeader><CardTitle className="text-base text-ct-navy">Budget Details</CardTitle></CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-1.5">
            <Label className="text-xs font-semibold text-ct-muted uppercase">Budget Name</Label>
            <Input
              value={name} onChange={(e) => setName(e.target.value)}
              placeholder="e.g. FY2026 Site Overheads" disabled={fieldsDisabled}
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label className="text-xs font-semibold text-ct-muted uppercase">Fiscal Year</Label>
              <Select value={fiscalYearId} onValueChange={setFiscalYearId} disabled={lookupsLoading || fiscalYears.length === 0}>
                <SelectTrigger><SelectValue placeholder={fiscalYears.length ? "Select a fiscal year" : "No fiscal years found"} /></SelectTrigger>
                <SelectContent>
                  {fiscalYears.map((fy) => (
                    <SelectItem key={fy.id} value={fy.id}>{fy.yearName}{fy.isClosed ? " (closed)" : ""}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs font-semibold text-ct-muted uppercase">Cost Center (optional)</Label>
              <Select
                value={costCenterId || NO_COST_CENTER}
                onValueChange={(v) => setCostCenterId(v === NO_COST_CENTER ? "" : v)}
                disabled={lookupsLoading || costCenters.length === 0}
              >
                <SelectTrigger><SelectValue placeholder={costCenters.length ? "Select a cost center" : "No cost centers found"} /></SelectTrigger>
                <SelectContent>
                  <SelectItem value={NO_COST_CENTER}>Org-wide (no cost center)</SelectItem>
                  {costCenters.map((cc) => <SelectItem key={cc.id} value={cc.id}>{cc.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          </div>
          {companies.length > 0 && (
            <div className="space-y-1.5">
              <Label className="text-xs font-semibold text-ct-muted uppercase">Company / Office (optional)</Label>
              <Select value={companyId || NO_COMPANY} onValueChange={(v) => setCompanyId(v === NO_COMPANY ? "" : v)}>
                <SelectTrigger><SelectValue placeholder="Org-wide (no specific company)" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value={NO_COMPANY}>Org-wide (no specific company)</SelectItem>
                  {companies.map((c) => (
                    <SelectItem key={c.id} value={c.id}>{c.abbr ? `${c.abbr} — ` : ""}{c.companyName}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}
          <div className="space-y-1.5">
            <Label className="text-xs font-semibold text-ct-muted uppercase">If budget is exceeded</Label>
            <Select value={actionIfExceeded} onValueChange={setActionIfExceeded}>
              <SelectTrigger className="w-48"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="ignore">Ignore</SelectItem>
                <SelectItem value="warn">Warn</SelectItem>
                <SelectItem value="stop">Stop</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div>
            <div className="flex items-center justify-between mb-1">
              <Label className="text-xs font-semibold text-ct-muted uppercase">Line Items</Label>
              <Button type="button" variant="outline" size="sm" onClick={addLineItem} disabled={fieldsDisabled}>
                <Plus className="size-3.5 mr-1" />Add
              </Button>
            </div>
            <div className="space-y-2">
              {lineItems.map((li, i) => (
                <div key={i} className="flex gap-2 items-center">
                  <Select
                    value={li.accountId} onValueChange={(v) => updateLineItem(i, { accountId: v })}
                    disabled={lookupsLoading || accounts.length === 0}
                  >
                    <SelectTrigger className="flex-1"><SelectValue placeholder={accounts.length ? "Select an account" : "No chart of accounts found"} /></SelectTrigger>
                    <SelectContent>
                      {accounts.map((a) => (
                        <SelectItem key={a.id} value={a.id}>{a.accountNumber ? `${a.accountNumber} — ` : ""}{a.accountName}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <Input
                    type="number" placeholder="Annual amount" className="w-40"
                    value={li.annualAmount} onChange={(e) => updateLineItem(i, { annualAmount: e.target.value })}
                    disabled={fieldsDisabled}
                  />
                  {lineItems.length > 1 && (
                    <Button type="button" variant="ghost" size="icon" aria-label="Remove line item" onClick={() => removeLineItem(i)}>
                      <Trash2 className="size-4 text-red-500" />
                    </Button>
                  )}
                </div>
              ))}
            </div>
          </div>
        </CardContent>
      </Card>

      <div className="flex gap-3">
        <Button
          type="button" className="bg-ct-saffron hover:bg-ct-saffron-hover text-white shadow-saffron"
          disabled={submitting || fieldsDisabled || !name.trim()}
          onClick={create}
        >
          {submitting ? <Loader2 className="size-4 mr-2 animate-spin" /> : null}
          {submitting ? "Creating..." : "Create Budget"}
        </Button>
        <Button type="button" variant="outline" onClick={() => router.push("/budgets")}>Cancel</Button>
      </div>
    </div>
  );
}

export default function BudgetNewPage() {
  return (
    <Suspense fallback={<p className="text-sm text-ct-muted">Loading...</p>}>
      <NewBudgetForm />
    </Suspense>
  );
}
