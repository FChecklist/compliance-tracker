"use client";

// force-dynamic: see src/app/(app)/knowledge-base/page.tsx for why this is
// required (prevents static prerendering + CDN-cache bypass of middleware).
export const dynamic = "force-dynamic";

// PROJEXA server-merge (ai-os/PROJEXA_SERVER_MERGE_PLAN.md), module 16 of 24:
// port of PROJEXA's own Accounting module (src/app/(app)/accounting/page.tsx
// + AccountingClient.tsx there -- 8 tabs: Dashboard, General Ledger, Trial
// Balance, P&L, Balance Sheet, P&L by Project, Bank Reconciliation,
// Companies). Every tab reads an already-native /api/v1/projexa/* route --
// zero new backend route, zero HTTP hop to a separate origin -- verified
// field-for-field against each route.ts and its service function
// (erp-accounting-service.ts's listJournalEntriesPaged/getJournalEntry,
// erp-financial-report-service.ts's trialBalance/profitAndLoss/balanceSheet/
// profitAndLossByCostCenter, erp-invoicing-service.ts's getFinanceDashboard,
// erp-bank-reconciliation-service.ts's listImports/listLines,
// erp-company-service.ts's listCompanies/createCompany) before writing this
// file:
//   GET  /api/v1/projexa/finance-dashboard              -> getFinanceDashboard
//   GET  /api/v1/projexa/journal-entries                -> listJournalEntriesPaged (paged, header-only)
//   GET  /api/v1/projexa/trial-balance                  -> trialBalance
//   GET  /api/v1/projexa/profit-and-loss                -> profitAndLoss
//   GET  /api/v1/projexa/balance-sheet                  -> balanceSheet
//   GET  /api/v1/projexa/profit-and-loss-by-project      -> profitAndLossByCostCenter
//   GET  /api/v1/projexa/bank-reconciliation             -> listImports / listLines (?importId=)
//   GET  /api/v1/projexa/companies                       -> listCompanies
// All of the above already matched PROJEXA's own client-side assumptions
// field-for-field (this port did not have to correct a contract mismatch
// here, unlike several prior modules this session) -- the AccountBalance
// shape (accountId/accountName/accountNumber/rootType/accountType/
// totalDebit/totalCredit/netBalance) returned by trial-balance/pnl/
// balance-sheet is identical to what PROJEXA's AccountingClient.tsx already
// expected.
//
// UI is compliance-tracker's own shadcn Tabs/Table/Card/Select (matching the
// house convention every already-ported PROJEXA-merge page uses: see
// src/app/(app)/invoices/page.tsx for the same tabbed, URL-synced pattern),
// not PROJEXA's @fchecklist/veridian-ui-kit ScreenFrame/AccountingClient.
// The multi-company scope selector (companyId + consolidate) that PROJEXA's
// company-scope.tsx shared across several modules is inlined here instead --
// no other ported module in this repo needs it yet, so a new shared file
// wasn't started speculatively; a future module that also needs it can
// extract this into src/lib or src/components at that point.
import { Suspense, useCallback, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Loader2, Plus, Landmark, ChevronLeft, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { currencyLabel, useCurrencies, type Currency } from "@/lib/currency-format";

// ---------------------------------------------------------------------------
// Shared types -- field-for-field from the route.ts/service-function bodies
// cited above, not from PROJEXA's own client-side assumptions.
// ---------------------------------------------------------------------------
type JournalEntry = {
  id: string; entryNumber: number; postingDate: string; referenceType: string | null;
  userRemark: string | null; status: string; totalDebit: string; totalCredit: string;
};
type FinanceDashboard = {
  asOfDate: string; cashPosition: number;
  arAging: { totalOutstanding: number; buckets: { current: number; d1_30: number; d31_60: number; d61_90: number; d90Plus: number } };
  topOverdueInvoices: { invoiceId: string; invoiceNumber: number; customerName: string | null; outstandingAmount: string; daysOverdue: number }[];
  revenue: { thisMonth: number; lastMonth: number };
};
type AccountBalance = { accountId: string; accountName: string; accountNumber: string | null; rootType: string; totalDebit: number; totalCredit: number; netBalance: number };
type TrialBalanceReport = { asOfDate: string; accounts: AccountBalance[]; totalDebit: number; totalCredit: number; isBalanced: boolean };
type PnlReport = { fromDate: string; toDate: string; income: AccountBalance[]; expense: AccountBalance[]; totalIncome: number; totalExpense: number; netProfit: number };
type BalanceSheetReport = { asOfDate: string; assets: AccountBalance[]; liabilities: AccountBalance[]; equity: AccountBalance[]; totalAssets: number; totalLiabilities: number; totalEquity: number; isBalanced: boolean };
type ProjectPnl = { fromDate: string; toDate: string; costCenters: { costCenterId: string; costCenterName: string; projectId: string | null; income: number; expense: number; netProfit: number }[]; totalIncome: number; totalExpense: number };
type BankImport = { id: string; fileName: string; totalLines: number; importedAt: string };
type BankLine = { id: string; transactionDate: string; description: string | null; debitAmount: string; creditAmount: string; status: string };
export type Company = { id: string; companyName: string; abbr: string | null; parentCompanyId: string | null; isGroup: boolean; country: string | null; isActive: boolean };
type CompanyScope = { companyId: string | null; consolidate: boolean };

const VALID_TABS = new Set(["dashboard", "ledger", "trial-balance", "pnl", "balance-sheet", "project-pnl", "bank-rec", "companies"]);
const REPORT_TABS = new Set(["trial-balance", "pnl", "balance-sheet", "project-pnl"]);

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString();
}

async function fetchOk<T>(url: string, what: string): Promise<T> {
  const res = await fetch(url);
  const body = await res.json().catch(() => null);
  if (!res.ok) throw new Error(body?.error ?? `Couldn't load ${what} (HTTP ${res.status})`);
  return body as T;
}

function money(n: number | string, currencies: Currency[]) {
  return `${currencyLabel(undefined, currencies)}${Number(n).toLocaleString("en-IN", { maximumFractionDigits: 0 })}`;
}

function companyScopeQuery(scope: CompanyScope) {
  if (!scope.companyId) return "";
  return `&companyId=${encodeURIComponent(scope.companyId)}${scope.consolidate ? "&consolidate=true" : ""}`;
}

// ---------------------------------------------------------------------------
// Company / consolidation scope selector -- shown above the 4 report tabs
// that support it (trial balance, P&L, balance sheet, P&L by project).
// ---------------------------------------------------------------------------
const ALL_COMPANIES = "__all__";

function CompanySelector({ companies, scope, onChange }: { companies: Company[]; scope: CompanyScope; onChange: (s: CompanyScope) => void }) {
  if (companies.length === 0) return null;
  return (
    <div className="flex flex-wrap items-center gap-2 text-sm">
      <Label className="text-xs font-semibold text-ct-muted uppercase">Company</Label>
      <Select
        value={scope.companyId ?? ALL_COMPANIES}
        onValueChange={(v) => onChange({ companyId: v === ALL_COMPANIES ? null : v, consolidate: scope.consolidate })}
      >
        <SelectTrigger className="w-56"><SelectValue /></SelectTrigger>
        <SelectContent>
          <SelectItem value={ALL_COMPANIES}>All companies / consolidated</SelectItem>
          {companies.map((c) => <SelectItem key={c.id} value={c.id}>{c.companyName}</SelectItem>)}
        </SelectContent>
      </Select>
      {scope.companyId && (
        <label className="flex items-center gap-1.5 text-xs text-ct-muted">
          <input type="checkbox" checked={scope.consolidate} onChange={(e) => onChange({ ...scope, consolidate: e.target.checked })} className="size-3.5" />
          Include sub-companies
        </label>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Finance Dashboard tab
// ---------------------------------------------------------------------------
function DashboardPanel() {
  const currencies = useCurrencies();
  const [data, setData] = useState<FinanceDashboard | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setData(await fetchOk<FinanceDashboard>("/api/v1/projexa/finance-dashboard", "the finance dashboard"));
      setLoadError(null);
    } catch (err) {
      setData(null);
      setLoadError(err instanceof Error ? err.message : "Couldn't load the finance dashboard");
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => { void load(); }, [load]);

  if (loading) return <div className="grid h-40 place-items-center"><Loader2 className="size-5 animate-spin text-ct-muted" /></div>;
  if (loadError || !data) {
    return (
      <Card className="rounded-xl shadow-card bg-white">
        <CardContent className="pt-10 pb-10 text-center text-sm text-ct-muted space-y-3">
          <p role="alert">{loadError ?? "Couldn't load the finance dashboard."} (An org needs its ERP module + a chart of accounts set up first.)</p>
          <Button variant="outline" size="sm" onClick={() => void load()}>Retry</Button>
        </CardContent>
      </Card>
    );
  }

  const revenueChange = data.revenue.lastMonth > 0 ? ((data.revenue.thisMonth - data.revenue.lastMonth) / data.revenue.lastMonth) * 100 : null;
  // Same honest-empty-state discipline as invoices/page.tsx's ArAgingPanel --
  // an org with genuinely zero GL postings would otherwise show every
  // figure as a bare currency-less zero with no explanation.
  const noPostedActivity = data.cashPosition === 0 && data.arAging.totalOutstanding === 0 && data.revenue.thisMonth === 0 && data.revenue.lastMonth === 0 && data.topOverdueInvoices.length === 0;

  return (
    <div className="space-y-4">
      {noPostedActivity && (
        <div className="rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-800">
          No journal entries have been posted to the General Ledger yet, so every figure below reads {money(0, currencies)}. Submit a journal entry from the General Ledger tab to see real postings here.
        </div>
      )}
      <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
        <Card className="rounded-xl shadow-card bg-white"><CardContent className="p-4"><p className="text-xs font-medium text-ct-muted uppercase">Cash Position</p><p className="mt-1 text-2xl font-bold text-ct-navy">{money(data.cashPosition, currencies)}</p></CardContent></Card>
        <Card className="rounded-xl shadow-card bg-white"><CardContent className="p-4"><p className="text-xs font-medium text-ct-muted uppercase">AR Outstanding</p><p className="mt-1 text-2xl font-bold text-ct-navy">{money(data.arAging.totalOutstanding, currencies)}</p></CardContent></Card>
        <Card className="rounded-xl shadow-card bg-white"><CardContent className="p-4"><p className="text-xs font-medium text-ct-muted uppercase">Revenue (This Month)</p><p className="mt-1 text-2xl font-bold text-ct-navy">{money(data.revenue.thisMonth, currencies)}</p>{revenueChange !== null && <p className={`text-xs ${revenueChange >= 0 ? "text-green-600" : "text-red-600"}`}>{revenueChange >= 0 ? "+" : ""}{revenueChange.toFixed(1)}% vs last month</p>}</CardContent></Card>
        <Card className="rounded-xl shadow-card bg-white"><CardContent className="p-4"><p className="text-xs font-medium text-ct-muted uppercase">90+ Days Overdue</p><p className="mt-1 text-2xl font-bold text-red-600">{money(data.arAging.buckets.d90Plus, currencies)}</p></CardContent></Card>
      </div>

      <Card className="rounded-xl shadow-card bg-white">
        <CardHeader><CardTitle className="text-base text-ct-navy">AR Aging</CardTitle></CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 sm:grid-cols-5 gap-2 text-center text-sm">
            {([["Current", data.arAging.buckets.current], ["1-30d", data.arAging.buckets.d1_30], ["31-60d", data.arAging.buckets.d31_60], ["61-90d", data.arAging.buckets.d61_90], ["90+d", data.arAging.buckets.d90Plus]] as [string, number][]).map(([label, value]) => (
              <div key={label} className="rounded-md border border-ct-border p-3">
                <p className="text-xs text-ct-muted">{label}</p>
                <p className="mt-1 font-semibold text-ct-navy">{money(value, currencies)}</p>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      <Card className="rounded-xl shadow-card bg-white">
        <CardHeader><CardTitle className="text-base text-ct-navy">Top Overdue Invoices</CardTitle></CardHeader>
        <CardContent className="p-0">
          {data.topOverdueInvoices.length === 0 ? (
            <p className="py-6 text-center text-sm text-ct-muted">No overdue invoices.</p>
          ) : (
            <Table>
              <TableHeader><TableRow><TableHead>Invoice</TableHead><TableHead>Customer</TableHead><TableHead>Days Overdue</TableHead><TableHead className="text-right">Outstanding</TableHead></TableRow></TableHeader>
              <TableBody>
                {data.topOverdueInvoices.map((inv) => (
                  <TableRow key={inv.invoiceId}>
                    <TableCell className="font-medium text-ct-navy">#{inv.invoiceNumber}</TableCell>
                    <TableCell className="text-ct-muted">{inv.customerName ?? "—"}</TableCell>
                    <TableCell className="text-red-600">{inv.daysOverdue}d</TableCell>
                    <TableCell className="text-right">{money(inv.outstandingAmount, currencies)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

// ---------------------------------------------------------------------------
// General Ledger tab
// ---------------------------------------------------------------------------
function GeneralLedgerPanel() {
  const router = useRouter();
  const currencies = useCurrencies();
  const [entries, setEntries] = useState<JournalEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [statusFilter, setStatusFilter] = useState("all");
  const [search, setSearch] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ page: String(page), limit: "25" });
      if (statusFilter !== "all") params.set("status", statusFilter);
      if (search) params.set("search", search);
      const data = await fetchOk<{ entries?: JournalEntry[]; totalPages?: number }>(`/api/v1/projexa/journal-entries?${params.toString()}`, "the General Ledger");
      setEntries(data.entries ?? []);
      setTotalPages(data.totalPages ?? 1);
      setLoadError(null);
    } catch (err) {
      setEntries([]);
      setLoadError(err instanceof Error ? err.message : "Couldn't load the General Ledger");
    } finally {
      setLoading(false);
    }
  }, [page, statusFilter, search]);
  useEffect(() => { void load(); }, [page, statusFilter]);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <Input placeholder="Search remarks…" value={search} onChange={(e) => setSearch(e.target.value)} onKeyDown={(e) => e.key === "Enter" && void load()} className="max-w-xs" />
          <Select value={statusFilter} onValueChange={(v) => { setPage(1); setStatusFilter(v); }}>
            <SelectTrigger className="w-40"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All statuses</SelectItem>
              {["draft", "submitted", "cancelled"].map((s) => <SelectItem key={s} value={s} className="capitalize">{s}</SelectItem>)}
            </SelectContent>
          </Select>
          <Button variant="outline" size="sm" onClick={() => void load()}>Search</Button>
        </div>
        <Button className="bg-ct-saffron hover:bg-ct-saffron-hover text-white shadow-saffron" onClick={() => router.push("/accounting/journal-entries/new")}>
          <Plus className="size-4 mr-1" /> New Journal Entry
        </Button>
      </div>

      {loadError ? (
        <Card className="rounded-xl shadow-card bg-white">
          <CardContent className="pt-10 pb-10 text-center text-sm text-ct-muted space-y-3">
            <p role="alert">Could not load the General Ledger: {loadError}</p>
            <Button variant="outline" size="sm" onClick={() => void load()}>Retry</Button>
          </CardContent>
        </Card>
      ) : loading ? (
        <div className="grid h-32 place-items-center"><Loader2 className="size-5 animate-spin text-ct-muted" /></div>
      ) : entries.length === 0 ? (
        <Card className="rounded-xl shadow-card bg-white">
          <CardContent className="pt-10 pb-10 text-center text-sm text-ct-muted">No journal entries found.</CardContent>
        </Card>
      ) : (
        <Card className="rounded-xl shadow-card bg-white">
          <CardContent className="p-0">
            <Table>
              <TableHeader><TableRow><TableHead>#</TableHead><TableHead>Posting Date</TableHead><TableHead>Remark</TableHead><TableHead className="text-right">Debit</TableHead><TableHead className="text-right">Credit</TableHead><TableHead>Status</TableHead></TableRow></TableHeader>
              <TableBody>
                {entries.map((e) => (
                  <TableRow key={e.id} className="cursor-pointer hover:bg-ct-row-hover" onClick={() => router.push(`/accounting/journal-entries/${e.id}`)}>
                    <TableCell className="text-ct-muted">{e.entryNumber}</TableCell>
                    <TableCell>{formatDate(e.postingDate)}</TableCell>
                    <TableCell className="text-ct-muted">{e.userRemark ?? e.referenceType ?? "—"}</TableCell>
                    <TableCell className="text-right">{money(e.totalDebit, currencies)}</TableCell>
                    <TableCell className="text-right">{money(e.totalCredit, currencies)}</TableCell>
                    <TableCell><Badge variant={e.status === "submitted" ? "default" : "outline"} className="capitalize">{e.status}</Badge></TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}
      {totalPages > 1 && (
        <div className="flex items-center justify-center gap-3 text-sm text-ct-muted">
          <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}><ChevronLeft className="size-4" /></Button>
          Page {page} of {totalPages}
          <Button variant="outline" size="sm" disabled={page >= totalPages} onClick={() => setPage((p) => p + 1)}><ChevronRight className="size-4" /></Button>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Trial Balance / P&L / Balance Sheet tabs (shared date-range pattern)
// ---------------------------------------------------------------------------
function BalanceRows({ rows, currencies }: { rows: AccountBalance[]; currencies: Currency[] }) {
  return (
    <Table>
      <TableHeader><TableRow><TableHead>Account</TableHead><TableHead className="text-right">Debit</TableHead><TableHead className="text-right">Credit</TableHead><TableHead className="text-right">Net</TableHead></TableRow></TableHeader>
      <TableBody>
        {rows.map((r) => (
          <TableRow key={r.accountId}>
            <TableCell>{r.accountNumber ? `${r.accountNumber} — ` : ""}{r.accountName}</TableCell>
            <TableCell className="text-right">{money(r.totalDebit, currencies)}</TableCell>
            <TableCell className="text-right">{money(r.totalCredit, currencies)}</TableCell>
            <TableCell className="text-right font-medium">{money(r.netBalance, currencies)}</TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

function TrialBalancePanel({ scope }: { scope: CompanyScope }) {
  const currencies = useCurrencies();
  const [asOfDate, setAsOfDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [report, setReport] = useState<TrialBalanceReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setReport(await fetchOk<TrialBalanceReport>(`/api/v1/projexa/trial-balance?asOfDate=${asOfDate}${companyScopeQuery(scope)}`, "the trial balance"));
      setLoadError(null);
    } catch (err) {
      setReport(null);
      setLoadError(err instanceof Error ? err.message : "Couldn't generate trial balance");
    } finally {
      setLoading(false);
    }
  }, [asOfDate, scope.companyId, scope.consolidate]);
  useEffect(() => { void load(); }, [scope.companyId, scope.consolidate]);

  return (
    <div className="space-y-4">
      <div className="flex items-end gap-2">
        <div className="space-y-1.5"><Label className="text-xs font-semibold text-ct-muted uppercase">As of</Label><Input type="date" value={asOfDate} onChange={(e) => setAsOfDate(e.target.value)} /></div>
        <Button size="sm" onClick={() => void load()}>Generate</Button>
      </div>
      <Card className="rounded-xl shadow-card bg-white">
        <CardContent className="p-0">
          {loadError ? <p role="alert" className="py-10 text-center text-sm text-red-600">{loadError}</p>
            : loading ? <div className="grid h-32 place-items-center"><Loader2 className="size-5 animate-spin text-ct-muted" /></div>
            : !report || report.accounts.length === 0 ? <p className="py-10 text-center text-sm text-ct-muted">No postings yet.</p>
            : (<>
              <BalanceRows rows={report.accounts} currencies={currencies} />
              <div className="flex items-center justify-between border-t border-ct-border p-3 text-sm font-semibold">
                <span>Total</span>
                <span>{money(report.totalDebit, currencies)} / {money(report.totalCredit, currencies)} {report.isBalanced ? <Badge className="ml-2" variant="default">Balanced</Badge> : <Badge className="ml-2" variant="destructive">Out of balance</Badge>}</span>
              </div>
            </>)}
        </CardContent>
      </Card>
    </div>
  );
}

function ProfitAndLossPanel({ scope }: { scope: CompanyScope }) {
  const currencies = useCurrencies();
  const now = new Date();
  const [fromDate, setFromDate] = useState(() => new Date(now.getFullYear(), now.getMonth(), 1).toISOString().slice(0, 10));
  const [toDate, setToDate] = useState(() => now.toISOString().slice(0, 10));
  const [report, setReport] = useState<PnlReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setReport(await fetchOk<PnlReport>(`/api/v1/projexa/profit-and-loss?fromDate=${fromDate}&toDate=${toDate}${companyScopeQuery(scope)}`, "the profit & loss statement"));
      setLoadError(null);
    } catch (err) {
      setReport(null);
      setLoadError(err instanceof Error ? err.message : "Couldn't generate P&L");
    } finally {
      setLoading(false);
    }
  }, [fromDate, toDate, scope.companyId, scope.consolidate]);
  useEffect(() => { void load(); }, [scope.companyId, scope.consolidate]);

  return (
    <div className="space-y-4">
      <div className="flex items-end gap-2">
        <div className="space-y-1.5"><Label className="text-xs font-semibold text-ct-muted uppercase">From</Label><Input type="date" value={fromDate} onChange={(e) => setFromDate(e.target.value)} /></div>
        <div className="space-y-1.5"><Label className="text-xs font-semibold text-ct-muted uppercase">To</Label><Input type="date" value={toDate} onChange={(e) => setToDate(e.target.value)} /></div>
        <Button size="sm" onClick={() => void load()}>Generate</Button>
      </div>
      {loadError ? <p role="alert" className="py-10 text-center text-sm text-red-600">{loadError}</p>
        : loading ? <div className="grid h-32 place-items-center"><Loader2 className="size-5 animate-spin text-ct-muted" /></div>
        : !report ? null : (
        <div className="space-y-4">
          <Card className="rounded-xl shadow-card bg-white"><CardHeader><CardTitle className="text-base text-ct-navy">Income</CardTitle></CardHeader><CardContent className="p-0">{report.income.length === 0 ? <p className="py-6 text-center text-sm text-ct-muted">No income postings.</p> : <BalanceRows rows={report.income} currencies={currencies} />}</CardContent></Card>
          <Card className="rounded-xl shadow-card bg-white"><CardHeader><CardTitle className="text-base text-ct-navy">Expense</CardTitle></CardHeader><CardContent className="p-0">{report.expense.length === 0 ? <p className="py-6 text-center text-sm text-ct-muted">No expense postings.</p> : <BalanceRows rows={report.expense} currencies={currencies} />}</CardContent></Card>
          <Card className="rounded-xl shadow-card bg-white"><CardContent className="flex items-center justify-between p-4 text-sm font-semibold"><span>Net Profit</span><span className={report.netProfit >= 0 ? "text-green-600" : "text-red-600"}>{money(report.netProfit, currencies)}</span></CardContent></Card>
        </div>
      )}
    </div>
  );
}

function BalanceSheetPanel({ scope }: { scope: CompanyScope }) {
  const currencies = useCurrencies();
  const [asOfDate, setAsOfDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [report, setReport] = useState<BalanceSheetReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setReport(await fetchOk<BalanceSheetReport>(`/api/v1/projexa/balance-sheet?asOfDate=${asOfDate}${companyScopeQuery(scope)}`, "the balance sheet"));
      setLoadError(null);
    } catch (err) {
      setReport(null);
      setLoadError(err instanceof Error ? err.message : "Couldn't generate balance sheet");
    } finally {
      setLoading(false);
    }
  }, [asOfDate, scope.companyId, scope.consolidate]);
  useEffect(() => { void load(); }, [scope.companyId, scope.consolidate]);

  return (
    <div className="space-y-4">
      <div className="flex items-end gap-2">
        <div className="space-y-1.5"><Label className="text-xs font-semibold text-ct-muted uppercase">As of</Label><Input type="date" value={asOfDate} onChange={(e) => setAsOfDate(e.target.value)} /></div>
        <Button size="sm" onClick={() => void load()}>Generate</Button>
      </div>
      {loadError ? <p role="alert" className="py-10 text-center text-sm text-red-600">{loadError}</p>
        : loading ? <div className="grid h-32 place-items-center"><Loader2 className="size-5 animate-spin text-ct-muted" /></div>
        : !report ? null : (
        <div className="space-y-4">
          <Card className="rounded-xl shadow-card bg-white"><CardHeader><CardTitle className="text-base text-ct-navy">Assets — {money(report.totalAssets, currencies)}</CardTitle></CardHeader><CardContent className="p-0">{report.assets.length === 0 ? <p className="py-6 text-center text-sm text-ct-muted">No asset postings.</p> : <BalanceRows rows={report.assets} currencies={currencies} />}</CardContent></Card>
          <Card className="rounded-xl shadow-card bg-white"><CardHeader><CardTitle className="text-base text-ct-navy">Liabilities — {money(report.totalLiabilities, currencies)}</CardTitle></CardHeader><CardContent className="p-0">{report.liabilities.length === 0 ? <p className="py-6 text-center text-sm text-ct-muted">No liability postings.</p> : <BalanceRows rows={report.liabilities} currencies={currencies} />}</CardContent></Card>
          <Card className="rounded-xl shadow-card bg-white"><CardHeader><CardTitle className="text-base text-ct-navy">Equity — {money(report.totalEquity, currencies)}</CardTitle></CardHeader><CardContent className="p-0">{report.equity.length === 0 ? <p className="py-6 text-center text-sm text-ct-muted">No equity postings.</p> : <BalanceRows rows={report.equity} currencies={currencies} />}</CardContent></Card>
          <Card className="rounded-xl shadow-card bg-white"><CardContent className="flex items-center justify-between p-4 text-sm font-semibold">
            <span>Assets = Liabilities + Equity</span>
            {report.isBalanced ? <Badge variant="default">Balanced</Badge> : <Badge variant="destructive">Out of balance</Badge>}
          </CardContent></Card>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// P&L by Project tab
// ---------------------------------------------------------------------------
function ProjectPnlPanel({ scope }: { scope: CompanyScope }) {
  const currencies = useCurrencies();
  const now = new Date();
  const [fromDate, setFromDate] = useState(() => new Date(now.getFullYear(), now.getMonth(), 1).toISOString().slice(0, 10));
  const [toDate, setToDate] = useState(() => now.toISOString().slice(0, 10));
  const [report, setReport] = useState<ProjectPnl | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setReport(await fetchOk<ProjectPnl>(`/api/v1/projexa/profit-and-loss-by-project?fromDate=${fromDate}&toDate=${toDate}${companyScopeQuery(scope)}`, "the per-project P&L"));
      setLoadError(null);
    } catch (err) {
      setReport(null);
      setLoadError(err instanceof Error ? err.message : "Couldn't generate per-project P&L");
    } finally {
      setLoading(false);
    }
  }, [fromDate, toDate, scope.companyId, scope.consolidate]);
  useEffect(() => { void load(); }, [scope.companyId, scope.consolidate]);

  return (
    <div className="space-y-4">
      <div className="flex items-end gap-2">
        <div className="space-y-1.5"><Label className="text-xs font-semibold text-ct-muted uppercase">From</Label><Input type="date" value={fromDate} onChange={(e) => setFromDate(e.target.value)} /></div>
        <div className="space-y-1.5"><Label className="text-xs font-semibold text-ct-muted uppercase">To</Label><Input type="date" value={toDate} onChange={(e) => setToDate(e.target.value)} /></div>
        <Button size="sm" onClick={() => void load()}>Generate</Button>
      </div>
      <p className="text-xs text-ct-muted">Requires journal-entry lines tagged with a cost center linked to a project (Chart of Accounts / Cost Centers setup). Cost centers with no tagged postings in this range won&apos;t appear.</p>
      <Card className="rounded-xl shadow-card bg-white">
        <CardContent className="p-0">
          {loadError ? <p role="alert" className="py-10 text-center text-sm text-red-600">{loadError}</p>
            : loading ? <div className="grid h-32 place-items-center"><Loader2 className="size-5 animate-spin text-ct-muted" /></div>
            : !report || report.costCenters.length === 0 ? <p className="py-10 text-center text-sm text-ct-muted">No cost-center-tagged postings in this range.</p>
            : (
              <Table>
                <TableHeader><TableRow><TableHead>Project / Cost Center</TableHead><TableHead className="text-right">Income</TableHead><TableHead className="text-right">Expense</TableHead><TableHead className="text-right">Net Profit</TableHead></TableRow></TableHeader>
                <TableBody>
                  {report.costCenters.map((c) => (
                    <TableRow key={c.costCenterId}>
                      <TableCell className="font-medium text-ct-navy">{c.costCenterName}</TableCell>
                      <TableCell className="text-right">{money(c.income, currencies)}</TableCell>
                      <TableCell className="text-right">{money(c.expense, currencies)}</TableCell>
                      <TableCell className={`text-right font-medium ${c.netProfit >= 0 ? "text-green-600" : "text-red-600"}`}>{money(c.netProfit, currencies)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
        </CardContent>
      </Card>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Companies / Offices tab -- list + create.
// ---------------------------------------------------------------------------
function CompaniesPanel({ companies, loading, loadError, onRetry }: { companies: Company[]; loading: boolean; loadError: string | null; onRetry: () => void }) {
  const router = useRouter();

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-2">
        <p className="text-xs text-ct-muted">Legal entities / offices within this org&apos;s ERP. Chart of accounts is shared across companies; reports can be scoped to one company or consolidated across its sub-companies from the selector above the financial-report tabs.</p>
        <Button className="bg-ct-saffron hover:bg-ct-saffron-hover text-white shadow-saffron shrink-0" onClick={() => router.push("/accounting/companies/new")}>
          <Plus className="size-4 mr-1" /> New Company / Office
        </Button>
      </div>
      <Card className="rounded-xl shadow-card bg-white">
        <CardContent className="p-0">
          {loadError ? (
            <div className="pt-10 pb-10 text-center text-sm text-ct-muted space-y-3">
              <p role="alert">Could not load companies: {loadError}</p>
              <Button variant="outline" size="sm" onClick={onRetry}>Retry</Button>
            </div>
          ) : loading ? (
            <div className="grid h-32 place-items-center"><Loader2 className="size-5 animate-spin text-ct-muted" /></div>
          ) : companies.length === 0 ? (
            <p className="py-10 text-center text-sm text-ct-muted">No companies/offices set up yet — everything defaults to org-wide.</p>
          ) : (
            <Table>
              <TableHeader><TableRow><TableHead>Company</TableHead><TableHead>Abbr.</TableHead><TableHead>Parent</TableHead><TableHead>Country</TableHead><TableHead>Type</TableHead><TableHead>Status</TableHead></TableRow></TableHeader>
              <TableBody>
                {companies.map((c) => (
                  <TableRow key={c.id}>
                    <TableCell className="font-medium text-ct-navy">{c.companyName}</TableCell>
                    <TableCell className="text-ct-muted">{c.abbr ?? "—"}</TableCell>
                    <TableCell className="text-ct-muted">{companies.find((p) => p.id === c.parentCompanyId)?.companyName ?? "—"}</TableCell>
                    <TableCell className="text-ct-muted">{c.country ?? "—"}</TableCell>
                    <TableCell>{c.isGroup ? <Badge variant="outline">Group</Badge> : <Badge variant="outline">Company</Badge>}</TableCell>
                    <TableCell><Badge variant={c.isActive ? "default" : "outline"}>{c.isActive ? "Active" : "Inactive"}</Badge></TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Bank Reconciliation tab (read-only for this wave -- matches PROJEXA's own
// scope cut: importing a new bank statement and matching/ignoring a line
// need a file-upload UI PROJEXA never built either).
// ---------------------------------------------------------------------------
function BankReconciliationPanel() {
  const currencies = useCurrencies();
  const [imports, setImports] = useState<BankImport[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [selectedImportId, setSelectedImportId] = useState<string | null>(null);
  const [lines, setLines] = useState<BankLine[]>([]);
  const [linesLoading, setLinesLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await fetchOk<{ imports?: BankImport[] }>("/api/v1/projexa/bank-reconciliation", "bank statement imports");
      setImports(data.imports ?? []);
      setLoadError(null);
    } catch (err) {
      setImports([]);
      setLoadError(err instanceof Error ? err.message : "Couldn't load bank statement imports");
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => { void load(); }, [load]);

  async function viewImport(id: string) {
    setSelectedImportId(id);
    setLinesLoading(true);
    try {
      const data = await fetchOk<{ lines?: BankLine[] }>(`/api/v1/projexa/bank-reconciliation?importId=${encodeURIComponent(id)}`, "statement lines");
      setLines(data.lines ?? []);
    } catch {
      setLines([]);
    } finally {
      setLinesLoading(false);
    }
  }

  return (
    <div className="space-y-4">
      <p className="text-xs text-ct-muted">Read-only for this wave — importing a new bank statement (file upload) and matching lines to journal entries is done from VERIDIAN&apos;s own Accounting workspace for now.</p>
      {loadError ? (
        <Card className="rounded-xl shadow-card bg-white">
          <CardContent className="pt-10 pb-10 text-center text-sm text-ct-muted space-y-3">
            <p role="alert">{loadError}</p>
            <Button variant="outline" size="sm" onClick={() => void load()}>Retry</Button>
          </CardContent>
        </Card>
      ) : loading ? (
        <div className="grid h-32 place-items-center"><Loader2 className="size-5 animate-spin text-ct-muted" /></div>
      ) : imports.length === 0 ? (
        <Card className="rounded-xl shadow-card bg-white">
          <CardContent className="pt-10 pb-10 text-center text-sm text-ct-muted">No bank statements imported yet.</CardContent>
        </Card>
      ) : (
        <div className="grid gap-4 md:grid-cols-[280px_1fr]">
          <Card className="rounded-xl shadow-card bg-white">
            <CardContent className="p-2">
              {imports.map((imp) => (
                <button key={imp.id} onClick={() => viewImport(imp.id)} className={`w-full rounded-md px-3 py-2 text-left text-sm transition-colors ${selectedImportId === imp.id ? "bg-ct-saffron/10 text-ct-navy" : "hover:bg-ct-row-hover"}`}>
                  <div className="font-medium">{imp.fileName}</div>
                  <div className="text-xs text-ct-muted">{imp.totalLines} lines &middot; {formatDate(imp.importedAt)}</div>
                </button>
              ))}
            </CardContent>
          </Card>
          <Card className="rounded-xl shadow-card bg-white">
            <CardContent className="p-0">
              {!selectedImportId ? <p className="py-10 text-center text-sm text-ct-muted">Select an import to view its lines.</p>
                : linesLoading ? <div className="grid h-32 place-items-center"><Loader2 className="size-5 animate-spin text-ct-muted" /></div>
                : (
                  <Table>
                    <TableHeader><TableRow><TableHead>Date</TableHead><TableHead>Description</TableHead><TableHead className="text-right">Debit</TableHead><TableHead className="text-right">Credit</TableHead><TableHead>Status</TableHead></TableRow></TableHeader>
                    <TableBody>
                      {lines.map((l) => (
                        <TableRow key={l.id}>
                          <TableCell>{formatDate(l.transactionDate)}</TableCell>
                          <TableCell className="text-ct-muted">{l.description ?? "—"}</TableCell>
                          <TableCell className="text-right">{Number(l.debitAmount) > 0 ? money(l.debitAmount, currencies) : "—"}</TableCell>
                          <TableCell className="text-right">{Number(l.creditAmount) > 0 ? money(l.creditAmount, currencies) : "—"}</TableCell>
                          <TableCell><Badge variant={l.status === "matched" ? "default" : "outline"} className="capitalize">{l.status}</Badge></TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                )}
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Root client
// ---------------------------------------------------------------------------
function AccountingPageInner() {
  const searchParams = useSearchParams();
  const initialTab = searchParams.get("tab");
  const [activeTab, setActiveTabState] = useState(initialTab && VALID_TABS.has(initialTab) ? initialTab : "dashboard");

  function setActiveTab(next: string) {
    setActiveTabState(next);
    const params = new URLSearchParams(window.location.search);
    params.set("tab", next);
    window.history.replaceState(null, "", `${window.location.pathname}?${params.toString()}`);
  }

  const [companies, setCompanies] = useState<Company[]>([]);
  const [companiesLoading, setCompaniesLoading] = useState(true);
  const [companiesError, setCompaniesError] = useState<string | null>(null);
  // Defaults to "All companies / consolidated" (companyId: null) -- an org
  // that never sets up companies/offices sees no change to any report.
  const [scope, setScope] = useState<CompanyScope>({ companyId: null, consolidate: false });

  const loadCompanies = useCallback(async () => {
    setCompaniesLoading(true);
    try {
      const data = await fetchOk<{ companies?: Company[] }>("/api/v1/projexa/companies", "companies");
      setCompanies(data.companies ?? []);
      setCompaniesError(null);
    } catch (err) {
      setCompanies([]);
      setCompaniesError(err instanceof Error ? err.message : "Couldn't load companies");
    } finally {
      setCompaniesLoading(false);
    }
  }, []);
  useEffect(() => { void loadCompanies(); }, [loadCompanies]);

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-heading text-ct-navy">Accounting</h1>
        <p className="text-sm text-ct-muted mt-1 flex items-center gap-2"><Landmark className="size-4" /> Real GL data — every journal entry, report, and balance below is generated from actual postings.</p>
      </div>

      <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-4">
        <TabsList className="flex-wrap h-auto">
          <TabsTrigger value="dashboard">Dashboard</TabsTrigger>
          <TabsTrigger value="ledger">General Ledger</TabsTrigger>
          <TabsTrigger value="trial-balance">Trial Balance</TabsTrigger>
          <TabsTrigger value="pnl">P&amp;L</TabsTrigger>
          <TabsTrigger value="balance-sheet">Balance Sheet</TabsTrigger>
          <TabsTrigger value="project-pnl">P&amp;L by Project</TabsTrigger>
          <TabsTrigger value="bank-rec">Bank Reconciliation</TabsTrigger>
          <TabsTrigger value="companies">Companies</TabsTrigger>
        </TabsList>
        {REPORT_TABS.has(activeTab) && (
          <CompanySelector companies={companies} scope={scope} onChange={setScope} />
        )}
        <TabsContent value="dashboard"><DashboardPanel /></TabsContent>
        <TabsContent value="ledger"><GeneralLedgerPanel /></TabsContent>
        <TabsContent value="trial-balance"><TrialBalancePanel scope={scope} /></TabsContent>
        <TabsContent value="pnl"><ProfitAndLossPanel scope={scope} /></TabsContent>
        <TabsContent value="balance-sheet"><BalanceSheetPanel scope={scope} /></TabsContent>
        <TabsContent value="project-pnl"><ProjectPnlPanel scope={scope} /></TabsContent>
        <TabsContent value="bank-rec"><BankReconciliationPanel /></TabsContent>
        <TabsContent value="companies"><CompaniesPanel companies={companies} loading={companiesLoading} loadError={companiesError} onRetry={() => void loadCompanies()} /></TabsContent>
      </Tabs>
    </div>
  );
}

export default function AccountingPage() {
  return (
    <Suspense fallback={<div className="grid h-64 place-items-center"><Loader2 className="size-6 animate-spin text-ct-muted" /></div>}>
      <AccountingPageInner />
    </Suspense>
  );
}
