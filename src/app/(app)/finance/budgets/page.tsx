"use client";

// force-dynamic: see src/app/(app)/knowledge-base/page.tsx for why this is
// required (prevents static prerendering + CDN-cache bypass of middleware).
export const dynamic = "force-dynamic";

// PROJEXA server-merge (ai-os/PROJEXA_SERVER_MERGE_PLAN.md), module 20 of 24:
// port of PROJEXA's real ERP fiscal-year Budgets screen
// (src/app/(app)/finance/budgets/{page.tsx,new/page.tsx,[id]/page.tsx} +
// BudgetsClient.tsx/BudgetCreateClient.tsx/BudgetObjectClient.tsx there).
// NOT the same thing as this repo's already-existing
// src/app/(app)/budgets/page.tsx (a prior session's own port of the same
// list, at a different route -- both read GET /api/v1/projexa/
// project-budgets and coexist deliberately, same precedent as
// /erp/budgets (native) + /budgets + /finance/budgets all reading the same
// erp_budgets table for different module surfaces), and NOT the
// project-level BOQ budget (/scope?tab=budget, a different concept
// entirely). PROJEXA's own /budgets, /budgets/[id], /budgets/new are
// redirect shims onto /finance/budgets/* (R67 D-62) -- this ports the real
// screens those shims point at.
//
// Reads/writes the already-live /api/v1/projexa/project-budgets* routes
// (erp-budget-service.ts) -- zero new backend route. Contract verified
// field-for-field against project-budgets/route.ts, [id]/route.ts,
// [id]/submit/route.ts, [id]/cancel/route.ts, [id]/variance/route.ts before
// writing this file.
//
// UI is compliance-tracker's own shadcn Table/Card/Select (house
// convention -- see src/app/(app)/accounting/journal-entries/{new,[id]}/
// page.tsx, the most recently-merged 3-page create/detail pattern), not
// PROJEXA's @fchecklist/veridian-ui-kit ScreenFrame/ListScreen.
//
// Org-wide, not project-scoped -- no ProjectPicker/NoProjectsCard needed,
// unlike most other PROJEXA-merge modules in this repo.
import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Plus, Wallet } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { currencyLabel, useCurrencies, type Currency } from "@/lib/currency-format";

type Budget = {
  id: string;
  name: string;
  fiscalYearId: string;
  companyId: string | null;
  costCenterId: string | null;
  status: string;
  actionIfExceeded: string | null;
  fiscalYearName?: string | null;
  annualAmount?: string | number | null;
};
type Company = { id: string; companyName: string; abbr: string | null };

const STATUS_VARIANT: Record<string, "default" | "secondary" | "destructive" | "outline"> = {
  draft: "outline",
  submitted: "default",
  cancelled: "destructive",
};

function money(n: number | string, currencies: Currency[]) {
  return `${currencyLabel(undefined, currencies)}${Number(n).toLocaleString("en-IN", { maximumFractionDigits: 0 })}`;
}

const ALL_COMPANIES = "__all__";

export default function BudgetsPage() {
  const router = useRouter();
  const currencies = useCurrencies();
  const [budgets, setBudgets] = useState<Budget[]>([]);
  const [companies, setCompanies] = useState<Company[]>([]);
  const [companyId, setCompanyId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const load = useCallback(async (scopedCompanyId: string | null) => {
    setLoading(true);
    try {
      const qs = scopedCompanyId ? `?companyId=${encodeURIComponent(scopedCompanyId)}` : "";
      const res = await fetch(`/api/v1/projexa/project-budgets${qs}`);
      const data = await res.json().catch(() => null);
      if (!res.ok) throw new Error(data?.error ?? "Couldn't load budgets");
      setBudgets(data.projectBudgets ?? []);
      setLoadError(null);
    } catch (err) {
      // Rows are NOT cleared on a failed refresh -- an empty table beside an
      // error reads as "the budgets are gone", which they aren't.
      setLoadError(err instanceof Error ? err.message : "Couldn't load budgets");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load(companyId);
  }, [companyId, load]);

  useEffect(() => {
    // Display-only lookup for the company filter: a failure degrades to no
    // filter shown, never blocks the list itself.
    fetch("/api/v1/projexa/companies")
      .then((r) => r.json())
      .then((d) => setCompanies(d.companies ?? []))
      .catch(() => {});
  }, []);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-heading text-ct-navy">Budgets</h1>
          <p className="text-sm text-ct-muted mt-1 flex items-center gap-2">
            <Wallet className="size-4" /> Annual budgets by account and fiscal year. For the budget against a
            project&apos;s BOQ line, open Scope of Work &rsaquo; Budget instead.
          </p>
        </div>
        <Button
          className="bg-ct-saffron hover:bg-ct-saffron-hover text-white shadow-saffron"
          onClick={() => router.push("/finance/budgets/new")}
        >
          <Plus className="size-4 mr-1" /> New Budget
        </Button>
      </div>

      {companies.length > 0 && (
        <div className="flex items-center gap-2 text-sm">
          <Label className="text-xs font-semibold text-ct-muted uppercase">Company</Label>
          <Select
            value={companyId ?? ALL_COMPANIES}
            onValueChange={(v) => setCompanyId(v === ALL_COMPANIES ? null : v)}
          >
            <SelectTrigger className="w-56">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL_COMPANIES}>All companies</SelectItem>
              {companies.map((c) => (
                <SelectItem key={c.id} value={c.id}>
                  {c.abbr ? `${c.abbr} — ` : ""}
                  {c.companyName}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      )}

      {loadError ? (
        <Card className="rounded-xl shadow-card bg-white">
          <CardContent className="pt-10 pb-10 text-center text-sm text-ct-muted space-y-3">
            <p role="alert">Could not load budgets: {loadError}</p>
            <Button variant="outline" size="sm" onClick={() => void load(companyId)}>
              Retry
            </Button>
          </CardContent>
        </Card>
      ) : loading ? (
        <div className="grid h-32 place-items-center">
          <Loader2 className="size-5 animate-spin text-ct-muted" />
        </div>
      ) : budgets.length === 0 ? (
        <Card className="rounded-xl shadow-card bg-white">
          <CardContent className="pt-10 pb-10 text-center text-sm text-ct-muted space-y-3">
            <p>No budgets yet.</p>
            <Button size="sm" onClick={() => router.push("/finance/budgets/new")}>
              <Plus className="size-4 mr-1" /> New Budget
            </Button>
          </CardContent>
        </Card>
      ) : (
        <Card className="rounded-xl shadow-card bg-white">
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Fiscal Year</TableHead>
                  <TableHead className="text-right">Annual Amount</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Action if Exceeded</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {budgets.map((b) => (
                  <TableRow
                    key={b.id}
                    className="cursor-pointer hover:bg-ct-row-hover"
                    onClick={() => router.push(`/finance/budgets/${b.id}`)}
                  >
                    <TableCell className="font-medium text-ct-navy">{b.name}</TableCell>
                    <TableCell className="text-ct-muted">{b.fiscalYearName ?? "—"}</TableCell>
                    <TableCell className="text-right">
                      {b.annualAmount === undefined || b.annualAmount === null || b.annualAmount === "" ? (
                        <span
                          className="text-ct-muted"
                          title="This budget's line items haven't been totalled yet — open it to see them"
                        >
                          —
                        </span>
                      ) : (
                        money(b.annualAmount, currencies)
                      )}
                    </TableCell>
                    <TableCell>
                      <Badge variant={STATUS_VARIANT[b.status] ?? "outline"} className="capitalize">
                        {b.status}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-ct-muted">{b.actionIfExceeded ?? "—"}</TableCell>
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
