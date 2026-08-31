"use client";

export const dynamic = "force-dynamic";

// Sales Pipeline Interactive Dashboard (2026-07-27, Owner-supplied mockup).
// Fetches the full deal set once (see getSalesPipelineDashboardData in
// crm-service.ts) and does every KPI/chart aggregation client-side via
// sales-pipeline-dashboard-service.ts's pure functions -- the same functions
// this feature's unit tests cover -- so clicking a Pipeline Status bar
// (SCOPE item 4) recomputes the whole page instantly with zero extra
// network round-trips.
import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { ArrowLeft, DollarSign, PauseCircle, XCircle, TrendingUp, HeartPulse, Frown, X } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  BarChart, Bar, Cell, XAxis, YAxis, Tooltip, ResponsiveContainer,
  LineChart, Line, CartesianGrid, Legend,
} from "recharts";
import {
  buildPipelineDeals, filterByStatus, computeKpis, computeSalesLeadPerformance,
  computePipelineStatusOverview, computeMonthlyTrend, computeMonthlyTrendTable,
  PIPELINE_STATUSES, type PipelineDeal, type PipelineStatus, type RawOpportunity,
} from "@/lib/services/sales-pipeline-dashboard-service";

const STATUS_COLORS: Record<PipelineStatus, string> = {
  Awarded: "bg-ct-success-light text-ct-success",
  Lost: "bg-ct-error-light text-ct-error",
  Hold: "bg-ct-warning-light text-ct-warning",
  Pitched: "bg-ct-info-light text-ct-info",
  Lead: "bg-ct-cloud text-ct-muted",
  Regret: "bg-ct-draft-light text-ct-draft",
  Estimation: "bg-ct-info-light text-ct-info",
  "Follow up": "bg-ct-warning-light text-ct-warning",
};

const SAFFRON = "#F5820A";
const TEAL = "#0E7C6E";
const NAVY = "#1C2B3A";
const ERROR = "#C0392B";

function monthLabel(month: string): string {
  const [y, m] = month.split("-");
  return new Date(Number(y), Number(m) - 1, 1).toLocaleDateString("en-US", { month: "short", year: "numeric" });
}

function KpiTile({ icon, label, value, sub }: { icon: React.ReactNode; label: string; value: string; sub?: string }) {
  return (
    <Card className="rounded-xl shadow-card bg-white">
      <CardContent className="p-4">
        <div className="flex items-center gap-2 text-ct-muted text-xs mb-1">{icon}{label}</div>
        <p className="text-xl font-heading text-ct-navy">{value}</p>
        {sub && <p className="text-[11px] text-ct-muted mt-0.5">{sub}</p>}
      </CardContent>
    </Card>
  );
}

export default function SalesPipelinePage() {
  const [rawDeals, setRawDeals] = useState<PipelineDeal[]>([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState<PipelineStatus | null>(null);
  const [salespersonFilter, setSalespersonFilter] = useState<string>("all");
  const [monthFilter, setMonthFilter] = useState<string>("all");
  const [targets, setTargets] = useState<{ month: string; targetValue: number }[]>([]);

  useEffect(() => {
    fetch("/api/crm/sales-pipeline")
      .then((r) => (r.ok ? r.json() : { deals: [], targets: [] }))
      .then((data: { deals: RawOpportunity[] & PipelineDeal[]; targets: { month: string; targetValue: number }[] }) => {
        // API already returns normalized PipelineDeal[] (built server-side via
        // buildPipelineDeals) -- re-running buildPipelineDeals here would be
        // redundant, deals arrive pre-shaped.
        setRawDeals(data.deals as unknown as PipelineDeal[]);
        setTargets(data.targets ?? []);
        setLoading(false);
      });
  }, []);

  const salespeople = useMemo(() => [...new Set(rawDeals.map((d) => d.salesperson))].sort(), [rawDeals]);
  const months = useMemo(() => [...new Set(rawDeals.map((d) => d.month).filter((m): m is string => !!m))].sort(), [rawDeals]);

  const deals = useMemo(() => {
    let d = filterByStatus(rawDeals, statusFilter);
    if (salespersonFilter !== "all") d = d.filter((x) => x.salesperson === salespersonFilter);
    if (monthFilter !== "all") d = d.filter((x) => x.month === monthFilter);
    return d;
  }, [rawDeals, statusFilter, salespersonFilter, monthFilter]);

  const kpis = useMemo(() => computeKpis(deals), [deals]);
  const salesBars = useMemo(() => computeSalesLeadPerformance(deals), [deals]);
  const statusBars = useMemo(() => computePipelineStatusOverview(deals), [deals]);
  const trend = useMemo(() => computeMonthlyTrend(deals, targets), [deals, targets]);
  const trendTable = useMemo(() => computeMonthlyTrendTable(trend), [trend]);
  const dealList = useMemo(() => [...deals].sort((a, b) => b.value - a.value), [deals]);

  const heading = statusFilter ? `Sales Pipeline ${statusFilter}` : "Sales Pipeline";

  return (
    <div className="space-y-4">
      <div>
        <Link href="/crm" className="text-xs text-ct-muted hover:text-ct-navy flex items-center gap-1 mb-2">
          <ArrowLeft className="size-3" /> Back to CRM
        </Link>
        <div className="flex items-center justify-between flex-wrap gap-2">
          <div>
            <h1 className="font-heading text-2xl md:text-3xl text-ct-navy flex items-center gap-2">
              <TrendingUp className="w-6 h-6" /> {heading}
            </h1>
            <p className="text-sm text-ct-muted mt-1">Deal value, health, and revenue trend across the pipeline -- click a status bar to drill in.</p>
          </div>
          <div className="flex items-center gap-2">
            <Select value={salespersonFilter} onValueChange={setSalespersonFilter}>
              <SelectTrigger className="w-40"><SelectValue placeholder="Salesperson" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Salespeople</SelectItem>
                {salespeople.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}
              </SelectContent>
            </Select>
            <Select value={monthFilter} onValueChange={setMonthFilter}>
              <SelectTrigger className="w-36"><SelectValue placeholder="Month" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Months</SelectItem>
                {months.map((m) => <SelectItem key={m} value={m}>{monthLabel(m)}</SelectItem>)}
              </SelectContent>
            </Select>
            {statusFilter && (
              <button
                onClick={() => setStatusFilter(null)}
                className="flex items-center gap-1 text-xs px-2.5 py-1.5 rounded-md bg-ct-saffron/10 text-ct-saffron-text hover:bg-ct-saffron/20 transition-colors"
              >
                {statusFilter} <X className="size-3" />
              </button>
            )}
          </div>
        </div>
      </div>

      {loading ? (
        <div className="text-center text-ct-muted p-10">Loading…</div>
      ) : (
        <>
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-3">
            <KpiTile icon={<DollarSign className="w-3.5 h-3.5" />} label="Sales Value" value={`₹${kpis.salesValue.toLocaleString()}`} />
            <KpiTile icon={<PauseCircle className="w-3.5 h-3.5" />} label="Hold %" value={`${kpis.holdPct.toFixed(1)}%`} />
            <KpiTile icon={<XCircle className="w-3.5 h-3.5" />} label="Lost %" value={`${kpis.lostPct.toFixed(1)}%`} />
            <KpiTile icon={<TrendingUp className="w-3.5 h-3.5" />} label="Success %" value={`${kpis.successPct.toFixed(1)}%`} />
            <KpiTile icon={<HeartPulse className="w-3.5 h-3.5" />} label="Health %" value={kpis.healthPct === null ? "—" : `${kpis.healthPct.toFixed(1)}%`} sub={kpis.healthPct === null ? "No AI-scored open deals" : undefined} />
            <KpiTile icon={<Frown className="w-3.5 h-3.5" />} label="Regret %" value={`${kpis.regretPct.toFixed(1)}%`} />
          </div>

          <div className="grid lg:grid-cols-3 gap-4">
            <div className="lg:col-span-2 space-y-4">
              <div className="grid md:grid-cols-2 gap-4">
                <Card className="rounded-xl shadow-card bg-white">
                  <CardContent className="p-4">
                    <h3 className="font-medium text-ct-navy text-sm mb-3">Sales Lead Performance Overview</h3>
                    {salesBars.length === 0 ? <p className="text-xs text-ct-muted">No deals match the current filters.</p> : (
                      <ResponsiveContainer width="100%" height={240}>
                        <BarChart data={salesBars} layout="vertical" margin={{ left: 8 }}>
                          <XAxis type="number" tick={{ fontSize: 10 }} />
                          <YAxis type="category" dataKey="label" tick={{ fontSize: 10 }} width={70} />
                          <Tooltip formatter={(v) => `₹${Number(v).toLocaleString()}`} />
                          <Bar dataKey="value" fill={TEAL} radius={[0, 3, 3, 0]} />
                        </BarChart>
                      </ResponsiveContainer>
                    )}
                  </CardContent>
                </Card>

                <Card className="rounded-xl shadow-card bg-white">
                  <CardContent className="p-4">
                    <h3 className="font-medium text-ct-navy text-sm mb-3">Pipeline Status Overview</h3>
                    <ResponsiveContainer width="100%" height={240}>
                      <BarChart data={statusBars} margin={{ bottom: 24 }}>
                        <XAxis dataKey="label" tick={{ fontSize: 9 }} angle={-35} textAnchor="end" interval={0} />
                        <YAxis tick={{ fontSize: 10 }} allowDecimals={false} />
                        <Tooltip />
                        <Bar
                          dataKey="value"
                          radius={[3, 3, 0, 0]}
                          cursor="pointer"
                          onClick={(data: { payload?: { label: string } }) => {
                            const clicked = data.payload?.label as PipelineStatus | undefined;
                            if (!clicked) return;
                            setStatusFilter((prev) => (prev === clicked ? null : clicked));
                          }}
                        >
                          {statusBars.map((b) => (
                            <Cell key={b.label} fill={SAFFRON} fillOpacity={!statusFilter || statusFilter === b.label ? 1 : 0.3} />
                          ))}
                        </Bar>
                      </BarChart>
                    </ResponsiveContainer>
                  </CardContent>
                </Card>
              </div>

              <Card className="rounded-xl shadow-card bg-white">
                <CardContent className="p-4">
                  <h3 className="font-medium text-ct-navy text-sm mb-3">Monthly Revenue Trend Analysis</h3>
                  {trend.length === 0 ? <p className="text-xs text-ct-muted">No dated deals or targets match the current filters.</p> : (
                    <ResponsiveContainer width="100%" height={240}>
                      <LineChart data={trend.map((t) => ({ ...t, monthLabel: monthLabel(t.month) }))}>
                        <CartesianGrid strokeDasharray="3 3" stroke="#EEE" />
                        <XAxis dataKey="monthLabel" tick={{ fontSize: 10 }} />
                        <YAxis tick={{ fontSize: 10 }} />
                        <Tooltip formatter={(v) => `₹${Number(v).toLocaleString()}`} />
                        <Legend wrapperStyle={{ fontSize: 11 }} />
                        <Line type="monotone" dataKey="target" name="Target" stroke={NAVY} strokeDasharray="4 3" strokeWidth={2} dot={{ r: 3 }} />
                        <Line type="monotone" dataKey="achieved" name="Achieved" stroke={TEAL} strokeWidth={2} dot={{ r: 3 }} />
                        <Line type="monotone" dataKey="shortfall" name="Shortfall" stroke={ERROR} strokeWidth={2} dot={{ r: 3 }} />
                      </LineChart>
                    </ResponsiveContainer>
                  )}

                  {trendTable.months.length > 0 && (
                    <div className="mt-4 overflow-x-auto">
                      <table className="w-full text-xs">
                        <thead>
                          <tr className="border-b border-ct-cloud text-ct-muted">
                            <th className="text-left py-1.5 pr-2 font-medium">Series</th>
                            {trendTable.months.map((m) => <th key={m} className="text-right py-1.5 px-2 font-medium">{monthLabel(m)}</th>)}
                            <th className="text-right py-1.5 pl-2 font-medium">Total</th>
                          </tr>
                        </thead>
                        <tbody>
                          {trendTable.rows.map((row) => (
                            <tr key={row.label} className="border-b border-ct-cloud/60">
                              <td className="py-1.5 pr-2 text-ct-navy font-medium">{row.label}</td>
                              {row.byMonth.map((v, i) => <td key={i} className="text-right py-1.5 px-2 text-ct-navy">₹{v.toLocaleString()}</td>)}
                              <td className="text-right py-1.5 pl-2 font-semibold text-ct-navy">₹{row.total.toLocaleString()}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </CardContent>
              </Card>
            </div>

            <Card className="rounded-xl shadow-card bg-white lg:col-span-1">
              <CardContent className="p-4">
                <h3 className="font-medium text-ct-navy text-sm mb-3">Project Value Status Analysis</h3>
                {dealList.length === 0 ? <p className="text-xs text-ct-muted">No deals match the current filters.</p> : (
                  <ul className="space-y-2 max-h-[560px] overflow-y-auto pr-1">
                    {dealList.map((d) => (
                      <li key={d.id} className="flex items-center justify-between gap-2 text-xs border-b border-ct-cloud/60 pb-2">
                        <div className="min-w-0">
                          <p className="text-ct-navy font-medium truncate">{d.name}</p>
                          <p className="text-ct-muted">{d.salesperson}</p>
                        </div>
                        <div className="flex flex-col items-end gap-1 shrink-0">
                          <Badge className={`text-[10px] border-0 ${STATUS_COLORS[d.status]}`}>{d.status}</Badge>
                          <span className="text-ct-navy font-semibold">₹{d.value.toLocaleString()}</span>
                        </div>
                      </li>
                    ))}
                  </ul>
                )}
              </CardContent>
            </Card>
          </div>
        </>
      )}
    </div>
  );
}
