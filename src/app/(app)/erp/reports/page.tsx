"use client";

export const dynamic = "force-dynamic";

// Wave 50 (VERI ERP gap-fill): Trial Balance / P&L / Balance Sheet --
// per ERP_BENCHMARK_COMPARISON.md, the single highest-value fix in the
// whole platform (closes Finance's #1 gap and Reporting & BI's #1 gap
// simultaneously). Plain tables, not charts -- correctness first.
import { useEffect, useState, useCallback } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

type AccountRow = { accountId: string; accountName: string; accountNumber: string | null; totalDebit: number; totalCredit: number; netBalance: number };
type Company = { id: string; companyName: string; abbr: string | null; isGroup: boolean };

function fmt(n: number) { return n.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }

export default function ErpReportsPage() {
  const [asOfDate, setAsOfDate] = useState(new Date().toISOString().slice(0, 10));
  const [fromDate, setFromDate] = useState(new Date(new Date().getFullYear(), 0, 1).toISOString().slice(0, 10));
  const [toDate, setToDate] = useState(new Date().toISOString().slice(0, 10));
  const [companies, setCompanies] = useState<Company[]>([]);
  const [companyId, setCompanyId] = useState("");
  const [consolidate, setConsolidate] = useState(false);

  const [tb, setTb] = useState<{ accounts: AccountRow[]; totalDebit: number; totalCredit: number; isBalanced: boolean } | null>(null);
  const [pnl, setPnl] = useState<{ income: AccountRow[]; expense: AccountRow[]; totalIncome: number; totalExpense: number; netProfit: number } | null>(null);
  const [bs, setBs] = useState<{ assets: AccountRow[]; liabilities: AccountRow[]; equity: AccountRow[]; totalAssets: number; totalLiabilities: number; totalEquity: number; isBalanced: boolean } | null>(null);
  // Wave 70 addendum: Statement of Cash Flows (indirect method) -- see
  // erp-financial-report-service.ts's cashFlowStatement() for the derivation.
  const [cf, setCf] = useState<{
    netProfit: number;
    operating: { cashFlow: number; receivableChange: number; stockChange: number; payableChange: number; otherWorkingCapitalChange: number };
    investing: { cashFlow: number; fixedAssetChange: number };
    financing: { cashFlow: number; otherLiabilityEquityChange: number };
    netChangeInCash: number;
    actualCashChange: number;
    isBalanced: boolean;
  } | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch("/api/erp/companies").then((r) => r.json()).then((d) => setCompanies(d.companies ?? [])).catch(() => {});
  }, []);

  const load = useCallback(() => {
    const companyParams = companyId ? `&companyId=${companyId}&consolidate=${consolidate}` : "";
    Promise.resolve()
      .then(() => {
        setLoading(true);
        return Promise.all([
          fetch(`/api/erp/reports/trial-balance?asOfDate=${asOfDate}${companyParams}`),
          fetch(`/api/erp/reports/profit-and-loss?fromDate=${fromDate}&toDate=${toDate}${companyParams}`),
          fetch(`/api/erp/reports/balance-sheet?asOfDate=${asOfDate}${companyParams}`),
          fetch(`/api/erp/reports/cash-flow?fromDate=${fromDate}&toDate=${toDate}${companyParams}`),
        ]);
      })
      .then(([tbRes, pnlRes, bsRes, cfRes]) => Promise.all([tbRes.json(), pnlRes.json(), bsRes.json(), cfRes.json()]))
      .then(([tbData, pnlData, bsData, cfData]) => {
        setTb(tbData);
        setPnl(pnlData);
        setBs(bsData);
        setCf(cfData);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, [asOfDate, fromDate, toDate, companyId, consolidate]);

  useEffect(load, [load]);

  return (
    <div className="space-y-4">
      <div>
        <h1 className="font-heading text-2xl md:text-3xl text-ct-navy">Financial Reports</h1>
        <p className="text-sm text-ct-muted mt-1">Trial Balance, Profit &amp; Loss, Balance Sheet — computed live from posted journal entries</p>
      </div>

      <div className="flex gap-4 items-end flex-wrap">
        <div><Label>As of</Label><Input type="date" value={asOfDate} onChange={(e) => setAsOfDate(e.target.value)} className="w-40" /></div>
        <div><Label>P&amp;L From</Label><Input type="date" value={fromDate} onChange={(e) => setFromDate(e.target.value)} className="w-40" /></div>
        <div><Label>P&amp;L To</Label><Input type="date" value={toDate} onChange={(e) => setToDate(e.target.value)} className="w-40" /></div>
        {companies.length > 0 && (
          <>
            <div><Label>Company</Label>
              <Select value={companyId || "__all__"} onValueChange={(v) => setCompanyId(v === "__all__" ? "" : v)}>
                <SelectTrigger className="w-48"><SelectValue placeholder="All companies" /></SelectTrigger>
                <SelectContent><SelectItem value="__all__">All companies (no filter)</SelectItem>{companies.map((c) => <SelectItem key={c.id} value={c.id}>{c.abbr ? `${c.abbr} — ` : ""}{c.companyName}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            {companyId && (
              <label className="flex items-center gap-2 text-sm pb-2"><input type="checkbox" checked={consolidate} onChange={(e) => setConsolidate(e.target.checked)} />Consolidate subsidiaries</label>
            )}
          </>
        )}
      </div>

      {loading ? (
        <div className="text-center text-ct-muted p-10">Loading…</div>
      ) : (
        <Tabs defaultValue="tb">
          <TabsList>
            <TabsTrigger value="tb">Trial Balance</TabsTrigger>
            <TabsTrigger value="pnl">Profit &amp; Loss</TabsTrigger>
            <TabsTrigger value="bs">Balance Sheet</TabsTrigger>
            <TabsTrigger value="cf">Cash Flow</TabsTrigger>
          </TabsList>

          <TabsContent value="tb">
            <Card className="rounded-xl shadow-card bg-white">
              <CardContent className="p-0">
                <table className="w-full text-xs">
                  <thead><tr className="text-left text-ct-muted border-b border-ct-border"><th className="p-3 font-medium">Account</th><th className="p-3 font-medium text-right">Debit</th><th className="p-3 font-medium text-right">Credit</th></tr></thead>
                  <tbody className="divide-y divide-ct-border">
                    {(tb?.accounts ?? []).length === 0 ? <tr><td colSpan={3} className="p-6 text-center text-ct-muted">No posted transactions yet.</td></tr>
                      : tb!.accounts.map((a) => <tr key={a.accountId} className="hover:bg-ct-row-hover"><td className="p-3">{a.accountNumber ? `${a.accountNumber} — ` : ""}{a.accountName}</td><td className="p-3 text-right">{fmt(a.totalDebit)}</td><td className="p-3 text-right">{fmt(a.totalCredit)}</td></tr>)}
                  </tbody>
                  {tb && tb.accounts.length > 0 && (
                    <tfoot><tr className="border-t-2 border-ct-navy font-medium"><td className="p-3">Total {tb.isBalanced ? <Badge className="bg-green-100 text-green-700 ml-2">Balanced</Badge> : <Badge className="bg-red-100 text-red-700 ml-2">Out of balance</Badge>}</td><td className="p-3 text-right">{fmt(tb.totalDebit)}</td><td className="p-3 text-right">{fmt(tb.totalCredit)}</td></tr></tfoot>
                  )}
                </table>
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="pnl">
            <div className="grid md:grid-cols-2 gap-4">
              <Card className="rounded-xl shadow-card bg-white"><CardContent className="p-4">
                <h3 className="font-medium text-ct-navy mb-2">Income</h3>
                <table className="w-full text-xs">
                  <tbody className="divide-y divide-ct-border">{(pnl?.income ?? []).map((a) => <tr key={a.accountId}><td className="p-2">{a.accountName}</td><td className="p-2 text-right">{fmt(-a.netBalance)}</td></tr>)}</tbody>
                  <tfoot><tr className="border-t-2 border-ct-navy font-medium"><td className="p-2">Total Income</td><td className="p-2 text-right">{fmt(pnl?.totalIncome ?? 0)}</td></tr></tfoot>
                </table>
              </CardContent></Card>
              <Card className="rounded-xl shadow-card bg-white"><CardContent className="p-4">
                <h3 className="font-medium text-ct-navy mb-2">Expense</h3>
                <table className="w-full text-xs">
                  <tbody className="divide-y divide-ct-border">{(pnl?.expense ?? []).map((a) => <tr key={a.accountId}><td className="p-2">{a.accountName}</td><td className="p-2 text-right">{fmt(a.netBalance)}</td></tr>)}</tbody>
                  <tfoot><tr className="border-t-2 border-ct-navy font-medium"><td className="p-2">Total Expense</td><td className="p-2 text-right">{fmt(pnl?.totalExpense ?? 0)}</td></tr></tfoot>
                </table>
              </CardContent></Card>
            </div>
            <Card className="rounded-xl shadow-card bg-white mt-4"><CardContent className="p-4 flex justify-between items-center">
              <span className="font-heading text-lg text-ct-navy">Net Profit</span>
              <span className={`font-heading text-xl ${(pnl?.netProfit ?? 0) >= 0 ? "text-ct-teal" : "text-red-600"}`}>{fmt(pnl?.netProfit ?? 0)}</span>
            </CardContent></Card>
          </TabsContent>

          <TabsContent value="bs">
            <div className="grid md:grid-cols-3 gap-4">
              <Card className="rounded-xl shadow-card bg-white"><CardContent className="p-4">
                <h3 className="font-medium text-ct-navy mb-2">Assets</h3>
                <table className="w-full text-xs"><tbody className="divide-y divide-ct-border">{(bs?.assets ?? []).map((a) => <tr key={a.accountId}><td className="p-2">{a.accountName}</td><td className="p-2 text-right">{fmt(a.netBalance)}</td></tr>)}</tbody>
                  <tfoot><tr className="border-t-2 border-ct-navy font-medium"><td className="p-2">Total</td><td className="p-2 text-right">{fmt(bs?.totalAssets ?? 0)}</td></tr></tfoot></table>
              </CardContent></Card>
              <Card className="rounded-xl shadow-card bg-white"><CardContent className="p-4">
                <h3 className="font-medium text-ct-navy mb-2">Liabilities</h3>
                <table className="w-full text-xs"><tbody className="divide-y divide-ct-border">{(bs?.liabilities ?? []).map((a) => <tr key={a.accountId}><td className="p-2">{a.accountName}</td><td className="p-2 text-right">{fmt(-a.netBalance)}</td></tr>)}</tbody>
                  <tfoot><tr className="border-t-2 border-ct-navy font-medium"><td className="p-2">Total</td><td className="p-2 text-right">{fmt(bs?.totalLiabilities ?? 0)}</td></tr></tfoot></table>
              </CardContent></Card>
              <Card className="rounded-xl shadow-card bg-white"><CardContent className="p-4">
                <h3 className="font-medium text-ct-navy mb-2">Equity</h3>
                <table className="w-full text-xs"><tbody className="divide-y divide-ct-border">{(bs?.equity ?? []).map((a) => <tr key={a.accountId}><td className="p-2">{a.accountName}</td><td className="p-2 text-right">{fmt(-a.netBalance)}</td></tr>)}</tbody>
                  <tfoot><tr className="border-t-2 border-ct-navy font-medium"><td className="p-2">Total</td><td className="p-2 text-right">{fmt(bs?.totalEquity ?? 0)}</td></tr></tfoot></table>
              </CardContent></Card>
            </div>
            <Card className="rounded-xl shadow-card bg-white mt-4"><CardContent className="p-4 flex justify-between items-center">
              <span className="font-heading text-lg text-ct-navy">Assets = Liabilities + Equity</span>
              {bs?.isBalanced ? <Badge className="bg-green-100 text-green-700">Balanced</Badge> : <Badge className="bg-red-100 text-red-700">Out of balance</Badge>}
            </CardContent></Card>
          </TabsContent>

          <TabsContent value="cf">
            <div className="grid md:grid-cols-3 gap-4">
              <Card className="rounded-xl shadow-card bg-white"><CardContent className="p-4 space-y-2">
                <h3 className="font-medium text-ct-navy mb-2">Operating Activities</h3>
                <div className="flex justify-between text-xs"><span>Net Profit</span><span>{fmt(cf?.netProfit ?? 0)}</span></div>
                <div className="flex justify-between text-xs"><span>Change in Receivables</span><span>{fmt(-(cf?.operating.receivableChange ?? 0))}</span></div>
                <div className="flex justify-between text-xs"><span>Change in Stock</span><span>{fmt(-(cf?.operating.stockChange ?? 0))}</span></div>
                <div className="flex justify-between text-xs"><span>Change in Payables</span><span>{fmt(-(cf?.operating.payableChange ?? 0))}</span></div>
                <div className="flex justify-between text-xs"><span>Other Working Capital</span><span>{fmt(-(cf?.operating.otherWorkingCapitalChange ?? 0))}</span></div>
                <div className="flex justify-between border-t-2 border-ct-navy font-medium pt-2"><span>Net Operating Cash Flow</span><span>{fmt(cf?.operating.cashFlow ?? 0)}</span></div>
              </CardContent></Card>
              <Card className="rounded-xl shadow-card bg-white"><CardContent className="p-4 space-y-2">
                <h3 className="font-medium text-ct-navy mb-2">Investing Activities</h3>
                <div className="flex justify-between text-xs"><span>Change in Fixed Assets</span><span>{fmt(-(cf?.investing.fixedAssetChange ?? 0))}</span></div>
                <div className="flex justify-between border-t-2 border-ct-navy font-medium pt-2"><span>Net Investing Cash Flow</span><span>{fmt(cf?.investing.cashFlow ?? 0)}</span></div>
              </CardContent></Card>
              <Card className="rounded-xl shadow-card bg-white"><CardContent className="p-4 space-y-2">
                <h3 className="font-medium text-ct-navy mb-2">Financing Activities</h3>
                <div className="flex justify-between text-xs"><span>Other Liabilities &amp; Equity</span><span>{fmt(-(cf?.financing.otherLiabilityEquityChange ?? 0))}</span></div>
                <div className="flex justify-between border-t-2 border-ct-navy font-medium pt-2"><span>Net Financing Cash Flow</span><span>{fmt(cf?.financing.cashFlow ?? 0)}</span></div>
              </CardContent></Card>
            </div>
            <Card className="rounded-xl shadow-card bg-white mt-4"><CardContent className="p-4 flex justify-between items-center">
              <span className="font-heading text-lg text-ct-navy">Net Change in Cash</span>
              <div className="flex items-center gap-3">
                <span className={`font-heading text-xl ${(cf?.netChangeInCash ?? 0) >= 0 ? "text-ct-teal" : "text-red-600"}`}>{fmt(cf?.netChangeInCash ?? 0)}</span>
                {cf?.isBalanced ? <Badge className="bg-green-100 text-green-700">Reconciled</Badge> : <Badge className="bg-red-100 text-red-700">Unreconciled</Badge>}
              </div>
            </CardContent></Card>
          </TabsContent>
        </Tabs>
      )}
    </div>
  );
}
