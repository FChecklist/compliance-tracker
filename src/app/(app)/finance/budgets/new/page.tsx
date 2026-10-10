"use client";

// force-dynamic: see src/app/(app)/knowledge-base/page.tsx for why this is
// required (prevents static prerendering + CDN-cache bypass of middleware).
export const dynamic = "force-dynamic";

// PROJEXA server-merge module 20/24: port of PROJEXA's BudgetCreateClient.tsx
// (src/app/(app)/finance/budgets/new/page.tsx there). POSTs to the same
// POST /api/v1/projexa/project-budgets this app's backend already serves
// (createBudget in erp-budget-service.ts) -- zero new backend route. Reads
// the same 4 reference-data lookups PROJEXA's budget-lookups.ts models
// (fiscal years, cost centers, chart of accounts, companies), client-side,
// via Promise.allSettled -- one failed OPTIONAL lookup (companies) must
// never blank the two REQUIRED ones (fiscal years, accounts), and a
// genuinely FAILED read must never be reported to the user as "this org has
// none" (that is a fact about their setup, not about a flaky backend call).
//
// Two deliberate simplifications vs PROJEXA's original (see the PR that
// ported this module): no "ask your administrator" task-filing flow (the
// blocked banner is shown to every role, with no filing action), and the
// "Set up in VERIDIAN" link is a plain internal <Link href="/erp/periods">
// rather than a cross-origin resolve -- this repo IS Veridian, so
// /erp/periods is a real page here, not a separate app to link out to.
import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { currencyLabel, useCurrencies } from "@/lib/currency-format";

type FiscalYear = { id: string; yearName: string; startDate: string; endDate: string; isClosed: boolean };
type CostCenter = { id: string; name: string; projectId: string | null };
type Account = { id: string; accountName: string; accountNumber: string | null };
type Company = { id: string; companyName: string; abbr: string | null };

function reasonText(missing: string[]): string {
  return `needs ${missing.join(" and ")}`;
}

export default function BudgetNewPage() {
  const router = useRouter();
  const currencies = useCurrencies();
  const label = currencyLabel(undefined, currencies);

  const [fiscalYears, setFiscalYears] = useState<FiscalYear[]>([]);
  const [costCenters, setCostCenters] = useState<CostCenter[]>([]);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [companies, setCompanies] = useState<Company[]>([]);
  const [lookupsLoading, setLookupsLoading] = useState(true);
  const [lookupError, setLookupError] = useState<string | null>(null);

  const [name, setName] = useState("");
  const [fiscalYearId, setFiscalYearId] = useState("");
  const [costCenterId, setCostCenterId] = useState("");
  const [accountId, setAccountId] = useState("");
  const [annualAmount, setAnnualAmount] = useState("");
  const [companyId, setCompanyId] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const loadLookups = useCallback(async () => {
    setLookupsLoading(true);
    const [fy, cc, ac, co] = await Promise.allSettled([
      fetch("/api/v1/projexa/fiscal-years").then((r) => r.json()),
      fetch("/api/v1/projexa/cost-centers").then((r) => r.json()),
      fetch("/api/v1/projexa/accounts").then((r) => r.json()),
      fetch("/api/v1/projexa/companies").then((r) => r.json()),
    ]);
    const failed: string[] = [];
    if (fy.status === "fulfilled") setFiscalYears(fy.value.fiscalYears ?? []);
    else failed.push("fiscal years");
    if (cc.status === "fulfilled") setCostCenters(cc.value.costCenters ?? []);
    else failed.push("cost centers");
    if (ac.status === "fulfilled") setAccounts(ac.value.accounts ?? []);
    else failed.push("the chart of accounts");
    if (co.status === "fulfilled") setCompanies(co.value.companies ?? []);
    else failed.push("companies");
    setLookupError(failed.length > 0 ? `Couldn't load ${failed.join(", ")}` : null);
    setLookupsLoading(false);
  }, []);

  useEffect(() => {
    void loadLookups();
  }, [loadLookups]);

  const missingLookups = [
    fiscalYears.length === 0 ? "a fiscal year" : null,
    accounts.length === 0 ? "an account" : null,
  ].filter((x): x is string => x !== null);
  // Only a lookup that genuinely SUCCEEDED may claim the org has none -- a
  // failed read is not the same fact as "this org has no fiscal years", and
  // must not be reported to the user as if it were.
  const blocked = !lookupsLoading && !lookupError && missingLookups.length > 0;
  const fieldsDisabled = lookupsLoading || blocked || submitting;

  async function createBudget() {
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
          lineItems: [{ accountId, annualAmount: Number(annualAmount) }],
        }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) throw new Error(data?.error ?? "Failed to create budget");
      toast.success("Budget created");
      router.push(`/finance/budgets/${data.id}`);
    } catch (err) {
      toast.error(err instanceof Error && err.message ? err.message : "Couldn't create budget");
    } finally {
      setSubmitting(false);
    }
  }

  const saveDisabledReason = blocked
    ? reasonText(missingLookups)
    : !name.trim()
      ? "Budget name is required"
      : !fiscalYearId
        ? "Fiscal year is required"
        : !accountId
          ? "Account is required"
          : !annualAmount.trim() || Number.isNaN(Number(annualAmount))
            ? "A valid annual amount is required"
            : undefined;

  return (
    <div className="space-y-4 max-w-2xl">
      <div>
        <h1 className="text-2xl font-heading text-ct-navy">New Budget</h1>
        <p className="text-sm text-ct-muted mt-1">Finance / Budgets / New</p>
      </div>

      {blocked && (
        <div role="alert" className="rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-800 space-y-2">
          <p>
            This organisation has no {missingLookups.join(" and ")} set up yet in the ERP module, and both are
            required to create a budget. They must be set up before a budget can be created here.
          </p>
          <Link href="/erp/periods" className="font-medium underline">
            Set up fiscal years / accounts
          </Link>
        </div>
      )}
      {lookupError && (
        <div role="alert" className="rounded-md border border-red-300 bg-red-50 p-3 text-sm text-red-700 space-y-2">
          <p>
            Could not load fiscal years, cost centers or accounts: {lookupError}. This screen cannot tell whether
            they exist, so nothing here is a statement about your setup.
          </p>
          <Button size="sm" variant="outline" onClick={() => void loadLookups()} disabled={lookupsLoading}>
            {lookupsLoading ? "Reloading…" : "Reload lists"}
          </Button>
        </div>
      )}

      <Card className="rounded-xl shadow-card bg-white">
        <CardHeader>
          <CardTitle className="text-base text-ct-navy">Budget Details</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-1.5">
            <Label className="text-xs font-semibold text-ct-muted uppercase">Budget Name</Label>
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. FY2026 Site Overheads"
              disabled={fieldsDisabled}
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label className="text-xs font-semibold text-ct-muted uppercase">Fiscal Year</Label>
              <Select value={fiscalYearId} onValueChange={setFiscalYearId} disabled={fieldsDisabled || fiscalYears.length === 0}>
                <SelectTrigger>
                  <SelectValue
                    placeholder={fiscalYears.length ? "Select a fiscal year" : lookupsLoading ? "Loading…" : "No fiscal years found"}
                  />
                </SelectTrigger>
                <SelectContent>
                  {fiscalYears.map((fy) => (
                    <SelectItem key={fy.id} value={fy.id}>
                      {fy.yearName}
                      {fy.isClosed ? " (closed)" : ""}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs font-semibold text-ct-muted uppercase">Cost Center</Label>
              <Select value={costCenterId} onValueChange={setCostCenterId} disabled={fieldsDisabled || costCenters.length === 0}>
                <SelectTrigger>
                  <SelectValue
                    placeholder={costCenters.length ? "Select a cost center" : lookupsLoading ? "Loading…" : "No cost centers found"}
                  />
                </SelectTrigger>
                <SelectContent>
                  {costCenters.map((cc) => (
                    <SelectItem key={cc.id} value={cc.id}>
                      {cc.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label className="text-xs font-semibold text-ct-muted uppercase">Account</Label>
              <Select value={accountId} onValueChange={setAccountId} disabled={fieldsDisabled || accounts.length === 0}>
                <SelectTrigger>
                  <SelectValue
                    placeholder={accounts.length ? "Select an account" : lookupsLoading ? "Loading…" : "No accounts found"}
                  />
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
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs font-semibold text-ct-muted uppercase">
                Annual Amount{label.trim() ? ` (${label.trim()})` : ""}
              </Label>
              <Input
                type="number"
                value={annualAmount}
                onChange={(e) => setAnnualAmount(e.target.value)}
                placeholder="e.g. 250000"
                disabled={fieldsDisabled}
              />
            </div>
          </div>

          {companies.length > 0 && (
            <div className="space-y-1.5">
              <Label className="text-xs font-semibold text-ct-muted uppercase">Company / Office</Label>
              <Select value={companyId} onValueChange={setCompanyId} disabled={fieldsDisabled}>
                <SelectTrigger>
                  <SelectValue placeholder="Org-wide (no specific company)" />
                </SelectTrigger>
                <SelectContent>
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
        </CardContent>
      </Card>

      <div className="flex justify-end gap-2">
        <Button variant="outline" onClick={() => router.push("/finance/budgets")} disabled={submitting}>
          Cancel
        </Button>
        <Button
          className="bg-ct-saffron hover:bg-ct-saffron-hover text-white shadow-saffron"
          onClick={createBudget}
          disabled={submitting || !!saveDisabledReason}
          title={saveDisabledReason}
        >
          {submitting ? <Loader2 className="size-4 mr-2 animate-spin" /> : null}
          {blocked ? `Save (${reasonText(missingLookups)})` : submitting ? "Creating…" : "Save"}
        </Button>
      </div>
    </div>
  );
}
