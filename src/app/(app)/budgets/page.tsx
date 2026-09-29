"use client";

// force-dynamic: see src/app/(app)/knowledge-base/page.tsx for why this is
// required (prevents static prerendering + CDN-cache bypass of middleware).
export const dynamic = "force-dynamic";

// PROJEXA server-merge (ai-os/PROJEXA_SERVER_MERGE_PLAN.md): port of
// PROJEXA's own Budgets list (its real UI now lives at
// src/app/(app)/finance/budgets/page.tsx + BudgetsClient.tsx there --
// /budgets/page.tsx in that repo is a redirect shim onto it, see that
// file's own header comment, R67 D-62). Reads the SAME
// GET /api/v1/projexa/project-budgets this app's backend already serves
// (a thin alias over erp-budget-service.ts's listBudgets -- see that
// route's own header comment), zero new backend route, zero HTTP hop to a
// separate origin.
//
// UI is compliance-tracker's own shadcn Table/Card/Select (matching the
// house convention every already-ported PROJEXA page uses -- see
// src/app/(app)/customers/page.tsx, src/app/(app)/kpis/page.tsx), not
// PROJEXA's @fchecklist/veridian-ui-kit ScreenFrame/ListScreen. Porting the
// DATA and BEHAVIOUR, not the exact component tree.
//
// This is a real second UI over the same erp_budgets table compliance-
// tracker's own native src/app/(app)/erp/budgets/page.tsx already renders
// (a single all-in-one dialog-based screen for compliance-tracker's own
// finance-department audience). The two coexist deliberately -- same
// precedent as /erp/customers (native) + /customers (this PROJEXA-merge
// series, PR #1957): this route is PROJEXA's own module surface, for
// PROJEXA's own users/nav once host-based branding routes them here, not a
// replacement for the native ERP screen.
import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Plus, Wallet } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { currencyLabel, useCurrencies } from "@/lib/currency-format";

type Budget = {
  id: string; name: string; fiscalYearId: string; companyId: string | null; costCenterId: string | null;
  status: string; actionIfExceeded: string | null;
  // Optional -- a budget list response from a VERIDIAN older than R67 F-08
  // would not carry these (see erp-budget-service.ts's listBudgets comment).
  annualAmount?: string | number | null;
  fiscalYearName?: string | null;
};
type Company = { id: string; companyName: string; abbr: string | null };

const STATUS_VARIANT: Record<string, "default" | "secondary" | "outline"> = {
  draft: "outline", submitted: "secondary", cancelled: "outline",
};
const ALL_COMPANIES = "__all__";

export default function BudgetsPage() {
  const router = useRouter();
  const currencies = useCurrencies();

  const [budgets, setBudgets] = useState<Budget[]>([]);
  const [companies, setCompanies] = useState<Company[]>([]);
  const [companyId, setCompanyId] = useState<string>(ALL_COMPANIES);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const load = useCallback(async (filterCompanyId: string) => {
    setLoading(true);
    try {
      const qs = filterCompanyId !== ALL_COMPANIES ? `?companyId=${encodeURIComponent(filterCompanyId)}` : "";
      const res = await fetch(`/api/v1/projexa/project-budgets${qs}`);
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body?.error ?? `Couldn't load budgets (HTTP ${res.status})`);
      setBudgets(body.projectBudgets ?? []);
      setLoadError(null);
    } catch (err) {
      setBudgets([]);
      setLoadError(err instanceof Error ? err.message : "Couldn't load budgets");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(companyId); }, [companyId, load]);

  useEffect(() => {
    // Display-only lookup, same as the row-fiscal-year name: a failure here
    // degrades to no filter, not a broken list.
    fetch("/api/v1/projexa/companies")
      .then((r) => r.json())
      .then((d) => setCompanies(d.companies ?? []))
      .catch(() => {});
  }, []);

  const money = (n: string | number | null | undefined) =>
    n === null || n === undefined || n === ""
      ? "—"
      : `${currencyLabel(undefined, currencies)}${Number(n).toLocaleString("en-IN", { maximumFractionDigits: 0 })}`;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-heading text-ct-navy">Budgets</h1>
          <p className="text-sm text-ct-muted mt-1">
            Annual budgets by account and fiscal year. Budget vs Actual is computed live off posted journal entries.
          </p>
        </div>
        <div className="flex items-center gap-2">
          {companies.length > 0 && (
            <Select value={companyId} onValueChange={setCompanyId}>
              <SelectTrigger className="w-48"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL_COMPANIES}>All companies</SelectItem>
                {companies.map((c) => (
                  <SelectItem key={c.id} value={c.id}>{c.abbr ? `${c.abbr} — ` : ""}{c.companyName}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
          <Button
            className="bg-ct-saffron hover:bg-ct-saffron-hover text-white shadow-saffron"
            onClick={() => router.push("/budgets/new")}
          >
            <Plus className="size-4 mr-1" /> New Budget
          </Button>
        </div>
      </div>

      {loadError ? (
        <Card className="rounded-xl shadow-card bg-white">
          <CardContent className="pt-10 pb-10 text-center space-y-3">
            <p className="text-sm text-red-600">{loadError}</p>
            <Button variant="outline" size="sm" onClick={() => load(companyId)}>Retry</Button>
          </CardContent>
        </Card>
      ) : (
        <Card className="rounded-xl shadow-card bg-white">
          <CardContent className="p-0">
            {loading ? (
              <div className="grid h-32 place-items-center"><Loader2 className="size-5 animate-spin text-ct-muted" /></div>
            ) : budgets.length === 0 ? (
              <p className="py-10 text-center text-sm text-ct-muted">No budgets yet.</p>
            ) : (
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
                    <TableRow key={b.id} className="cursor-pointer hover:bg-ct-row-hover" onClick={() => router.push(`/budgets/${b.id}`)}>
                      <TableCell className="flex items-center gap-2 font-medium text-ct-navy">
                        <Wallet className="size-4 text-ct-muted" />{b.name}
                      </TableCell>
                      <TableCell className="text-ct-muted">{b.fiscalYearName ?? "—"}</TableCell>
                      <TableCell className="text-right tabular-nums">{money(b.annualAmount)}</TableCell>
                      <TableCell><Badge variant={STATUS_VARIANT[b.status] ?? "outline"}>{b.status}</Badge></TableCell>
                      <TableCell className="text-ct-muted">{b.actionIfExceeded ?? "—"}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
