"use client";

export const dynamic = "force-dynamic";

// Wave 98 (Comparison CSV 3 gap analysis: BI005/BI010 "Enterprise KPI Hub").
// A real cross-module executive scorecard computed live from real
// compliance/risk/ERP/ticket/AI-ops data -- no new schema, no fabricated
// metrics. AI-ops section reuses Wave 95's orchestra-analytics-service.
// Wave 7 (PROJEXA reconcile): added the Construction KPIs card, a read-only
// rollup of construction-kpi-service.ts's definitions/entries -- that
// service's own approval workflow (PROJEXA's /kpis page) is unaffected.
import { useEffect, useState } from "react";
import { LayoutDashboard, ShieldCheck, AlertTriangle, Banknote, Ticket, Activity, HardHat } from "lucide-react";
import { currencyLabel, useCurrencies } from "@/lib/currency-format";
import { Card, CardContent } from "@/components/ui/card";

type KpiSummary = {
  compliance: { total: number; completed: number; overdue: number; completionRate: number };
  risk: { totalOpen: number; highSeverityOpen: number };
  revenue: { totalInvoicedYtd: number; totalOutstandingAr: number; overdueAr: number };
  tickets: { total: number; open: number; slaComplianceRate: number };
  construction: { totalDefinitions: number; totalEntries: number; pendingApproval: number; approved: number; onTargetRate: number };
  aiOps: { totalExecutions: number; totalCostUsd: number; failureRate: number; denialRate: number };
};



function KpiCard({ icon, title, children }: { icon: React.ReactNode; title: string; children: React.ReactNode }) {
  return (
    <Card className="rounded-xl shadow-card bg-white">
      <CardContent className="p-4">
        <div className="flex items-center gap-2 text-ct-navy font-medium text-sm mb-3">{icon}{title}</div>
        <div className="space-y-2">{children}</div>
      </CardContent>
    </Card>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between text-xs">
      <span className="text-ct-muted">{label}</span>
      <span className="font-semibold text-ct-navy">{value}</span>
    </div>
  );
}

export default function KpiHubPage() {
  const currencies = useCurrencies();
  // Priority 17 re-sweep fix: was a module-level fmtCurrency() hardcoding
  // "₹" -- now a closure over `currencies` so both existing call sites
  // below resolve the org's real base currency instead.
  const fmtCurrency = (n: number) => `${currencyLabel(undefined, currencies)}${n.toLocaleString("en-IN", { maximumFractionDigits: 0 })}`;
  const [data, setData] = useState<KpiSummary | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch("/api/kpi-hub")
      .then((r) => (r.ok ? r.json() : null))
      .then(setData)
      .finally(() => setLoading(false));
  }, []);

  return (
    <div className="space-y-4">
      <div>
        <h1 className="font-heading text-2xl md:text-3xl text-ct-navy flex items-center gap-2"><LayoutDashboard className="w-6 h-6" />Enterprise KPI Hub</h1>
        <p className="text-sm text-ct-muted mt-1">A live cross-module scorecard — compliance, risk, revenue, tickets, construction, and AI operations, computed from real data.</p>
      </div>

      {loading || !data ? (
        <div className="text-center text-ct-muted p-10">Loading…</div>
      ) : (
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
          <KpiCard icon={<ShieldCheck className="w-4 h-4" />} title="Compliance">
            <Stat label="Completion Rate" value={`${(data.compliance.completionRate * 100).toFixed(1)}%`} />
            <Stat label="Total Items" value={data.compliance.total.toLocaleString()} />
            <Stat label="Overdue" value={data.compliance.overdue.toLocaleString()} />
          </KpiCard>

          <KpiCard icon={<AlertTriangle className="w-4 h-4" />} title="Risk">
            <Stat label="Open Risks" value={data.risk.totalOpen.toLocaleString()} />
            <Stat label="High Severity" value={data.risk.highSeverityOpen.toLocaleString()} />
          </KpiCard>

          <KpiCard icon={<Banknote className="w-4 h-4" />} title="Revenue">
            <Stat label="Invoiced (YTD)" value={fmtCurrency(data.revenue.totalInvoicedYtd)} />
            <Stat label="Outstanding AR" value={fmtCurrency(data.revenue.totalOutstandingAr)} />
            <Stat label="Overdue AR" value={fmtCurrency(data.revenue.overdueAr)} />
          </KpiCard>

          <KpiCard icon={<Ticket className="w-4 h-4" />} title="Support Tickets">
            <Stat label="Total" value={data.tickets.total.toLocaleString()} />
            <Stat label="Open" value={data.tickets.open.toLocaleString()} />
            <Stat label="SLA Compliance" value={`${(data.tickets.slaComplianceRate * 100).toFixed(1)}%`} />
          </KpiCard>

          <KpiCard icon={<HardHat className="w-4 h-4" />} title="Construction KPIs">
            <Stat label="Definitions" value={data.construction.totalDefinitions.toLocaleString()} />
            <Stat label="Entries Pending Approval" value={data.construction.pendingApproval.toLocaleString()} />
            <Stat label="On-Target Rate (Approved)" value={`${(data.construction.onTargetRate * 100).toFixed(1)}%`} />
          </KpiCard>

          <KpiCard icon={<Activity className="w-4 h-4" />} title="AI Operations (30d)">
            <Stat label="Executions" value={data.aiOps.totalExecutions.toLocaleString()} />
            <Stat label="Total Cost" value={`$${data.aiOps.totalCostUsd.toFixed(4)}`} />
            <Stat label="Failure Rate" value={`${(data.aiOps.failureRate * 100).toFixed(1)}%`} />
            <Stat label="Denial Rate" value={`${(data.aiOps.denialRate * 100).toFixed(1)}%`} />
          </KpiCard>
        </div>
      )}
    </div>
  );
}
