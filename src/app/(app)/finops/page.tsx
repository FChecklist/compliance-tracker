"use client";

import { useEffect, useState, useCallback } from "react";
import {
  DollarSign, Activity, TrendingUp, Scale, PowerOff, Loader2, AlertTriangle,
} from "lucide-react";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";

// VERIDIAN Review Framework gap-closure (AI Cost Governance & FinOps):
// the Finance / FinOps dashboard. veridian_admin-only (the route enforces
// it; this page shows a graceful gate for anyone else who reaches the URL).
// Surfaces the four findings this gap-closure closes:
//   1. Cost anomalies (spike-relative-to-baseline, across org/role/model)
//   2. Forecast vs actual (linear run-rate projection for the month)
//   3. FinOps reconciliation (engineering cost claim vs Finance ledger)
//   4. Unused / idle AI capacity (provisioned-but-unconsumed)
// Read-only, matching OrgLimitsSection.tsx / AdoptionMetricsSection.tsx's
// conventions. The Finance ledger figure is an INPUT (a Finance admin enters
// the month's invoice total) -- not persisted, since no external Finance-
// system integration exists and the finding defers building a second
// independent estimate unless spend scale justifies it.

type SpendAnomaly = {
  groupKey: string;
  dimension: "org" | "role" | "model";
  currentSpendUsd: number;
  baselineSpendUsd: number;
  ratio: number;
  deltaUsd: number;
  severity: "info" | "warning" | "critical";
  currentRequests: number;
  baselineRequests: number;
};

type MonthForecast = {
  spendSoFarUsd: number;
  fractionElapsed: number;
  projectedMonthEndUsd: number | null;
  capComparison: { monthlyCapUsd: number; projectedVsCapRatio: number; wouldExceedCap: boolean } | null;
};

type FinOpsReconciliation = {
  engineeringClaimUsd: number;
  financeLedgerUsd: number | null;
  varianceUsd: number | null;
  variancePct: number | null;
  verdict: "balanced" | "platform_under_reports" | "platform_over_reports" | "no_finance_figure";
  note: string;
};

type IdleCapacityFinding = {
  kind: "unused_byo_config" | "dormant_floor_tier_org";
  orgId: string;
  model: string | null;
  provider: string | null;
  windowDays: number;
  requestsInWindow: number;
  note: string;
};

type Dashboard = {
  generatedAtIso: string;
  anomaly: { currentWindowDays: number; baselineWindowDays: number; findings: SpendAnomaly[] };
  forecast: MonthForecast;
  reconciliation: FinOpsReconciliation;
  idleCapacity: { windowDays: number; findings: IdleCapacityFinding[] };
};

type ApiResponse = { dashboard: Dashboard; orgForecast: MonthForecast | null };

const SEVERITY_BADGE: Record<SpendAnomaly["severity"], { label: string; variant: "destructive" | "outline" | "secondary" }> = {
  critical: { label: "Critical", variant: "destructive" },
  warning: { label: "Warning", variant: "outline" },
  info: { label: "Info", variant: "secondary" },
};

const VERDICT_BADGE: Record<FinOpsReconciliation["verdict"], { label: string; variant: "destructive" | "outline" | "secondary" }> = {
  balanced: { label: "Balanced", variant: "secondary" },
  platform_under_reports: { label: "Under-reporting", variant: "destructive" },
  platform_over_reports: { label: "Over-reporting", variant: "outline" },
  no_finance_figure: { label: "No Finance figure", variant: "outline" },
};

function usd(n: number | null | undefined): string {
  if (n == null) return "—";
  return `$${n.toFixed(2)}`;
}

function ratioStr(r: number): string {
  if (r === Infinity) return "∞";
  return `${r.toFixed(1)}x`;
}

export default function FinOpsPage() {
  const [loading, setLoading] = useState(true);
  const [forbidden, setForbidden] = useState(false);
  const [data, setData] = useState<ApiResponse | null>(null);
  const [role, setRole] = useState<string | null>(null);
  const [financeInput, setFinanceInput] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const qs = financeInput.trim() === "" ? "" : `?financeLedgerUsd=${encodeURIComponent(financeInput)}`;
      const res = await fetch(`/api/ai/finops${qs}`);
      if (res.status === 403) {
        setForbidden(true);
        return;
      }
      if (!res.ok) return;
      const json = (await res.json()) as ApiResponse;
      setData(json);
    } finally {
      setLoading(false);
    }
  }, [financeInput]);

  useEffect(() => {
    fetch("/api/me").then((r) => r.json()).then((d) => setRole(d.role ?? null)).catch(() => {});
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const isAdmin = role === "veridian_admin";

  if (loading && !data) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-16 w-full" />
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <Skeleton className="h-48 w-full" />
          <Skeleton className="h-48 w-full" />
        </div>
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  if (forbidden || (role && !isAdmin)) {
    return (
      <Card className="rounded-xl shadow-card bg-white">
        <CardContent className="py-10 text-center">
          <DollarSign className="h-8 w-8 text-muted-foreground mx-auto mb-3" />
          <p className="text-sm text-muted-foreground">
            The AI FinOps dashboard is restricted to veridian_admin (Finance) accounts.
          </p>
        </CardContent>
      </Card>
    );
  }

  if (!data) {
    return (
      <Card className="rounded-xl shadow-card bg-white">
        <CardContent className="py-10 text-center">
          <p className="text-sm text-muted-foreground">FinOps dashboard is unavailable right now.</p>
          <Button variant="outline" size="sm" className="mt-3" onClick={load}>Retry</Button>
        </CardContent>
      </Card>
    );
  }

  const d = data.dashboard;
  const critical = d.anomaly.findings.filter((f) => f.severity === "critical").length;
  const warning = d.anomaly.findings.filter((f) => f.severity === "warning").length;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-heading text-2xl md:text-3xl text-ct-navy flex items-center gap-2">
          <DollarSign className="h-7 w-7" />
          AI FinOps
        </h1>
        <p className="text-sm text-ct-muted mt-1">
          AI cost governance: anomaly detection, forecast vs actual, Finance reconciliation, and idle capacity.
        </p>
      </div>

      {/* KPI row */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <KpiCard
          icon={Activity}
          label="Spend anomalies"
          value={`${d.anomaly.findings.length}`}
          sub={`${critical} critical · ${warning} warning · last ${d.anomaly.currentWindowDays}d vs ${d.anomaly.baselineWindowDays}d baseline`}
          tone={critical > 0 ? "destructive" : warning > 0 ? "warning" : "neutral"}
        />
        <KpiCard
          icon={TrendingUp}
          label="Projected month-end"
          value={usd(d.forecast.projectedMonthEndUsd)}
          sub={`${usd(d.forecast.spendSoFarUsd)} spent so far · ${Math.round(d.forecast.fractionElapsed * 100)}% of month elapsed`}
          tone={d.forecast.capComparison?.wouldExceedCap ? "destructive" : "neutral"}
        />
        <KpiCard
          icon={Scale}
          label="FinOps reconciliation"
          value={VERDICT_BADGE[d.reconciliation.verdict].label}
          sub={`Engineering claim ${usd(d.reconciliation.engineeringClaimUsd)}`}
          tone={d.reconciliation.verdict === "platform_under_reports" ? "destructive" : "neutral"}
        />
        <KpiCard
          icon={PowerOff}
          label="Idle AI capacity"
          value={`${d.idleCapacity.findings.length}`}
          sub={`provisioned-but-unconsumed · last ${d.idleCapacity.windowDays}d`}
          tone={d.idleCapacity.findings.length > 0 ? "warning" : "neutral"}
        />
      </div>

      {/* Org forecast detail (if available) */}
      {data.orgForecast && (
        <Card className="rounded-xl shadow-card bg-white">
          <CardHeader>
            <CardTitle className="text-base font-semibold text-ct-navy flex items-center gap-2">
              <TrendingUp className="h-4 w-4" /> Your org&apos;s run-rate forecast
            </CardTitle>
          </CardHeader>
          <CardContent className="text-sm space-y-1">
            <p className="text-muted-foreground">
              Spend so far this month: <span className="font-semibold text-ct-navy">{usd(data.orgForecast.spendSoFarUsd)}</span>
              {" · "}projected month-end: <span className="font-semibold text-ct-navy">{usd(data.orgForecast.projectedMonthEndUsd)}</span>
              {" · "}{Math.round(data.orgForecast.fractionElapsed * 100)}% of month elapsed.
            </p>
            {data.orgForecast.capComparison && (
              <p className="text-muted-foreground">
                Cap: <span className="font-semibold text-ct-navy">{usd(data.orgForecast.capComparison.monthlyCapUsd)}</span>
                {" · "}projected/cap ratio: <span className="font-semibold text-ct-navy">{data.orgForecast.capComparison.projectedVsCapRatio.toFixed(2)}x</span>
                {data.orgForecast.capComparison.wouldExceedCap && (
                  <Badge variant="destructive" className="ml-2">Would exceed cap</Badge>
                )}
              </p>
            )}
            <p className="text-xs text-muted-foreground italic">
              Linear run-rate projection (spend-so-far ÷ fraction-of-month-elapsed). Refine to a statistical model only if this proves systematically inaccurate in practice.
            </p>
          </CardContent>
        </Card>
      )}

      {/* Anomalies */}
      <Card className="rounded-xl shadow-card bg-white">
        <CardHeader>
          <CardTitle className="text-base font-semibold text-ct-navy flex items-center gap-2">
            <Activity className="h-4 w-4" /> Cost anomalies (spike vs baseline)
          </CardTitle>
        </CardHeader>
        <CardContent>
          {d.anomaly.findings.length === 0 ? (
            <p className="text-sm text-muted-foreground">No spend anomalies detected in the last {d.anomaly.currentWindowDays} days. Spend across org / role / model is within its recent baseline.</p>
          ) : (
            <div className="rounded-lg border divide-y">
              {d.anomaly.findings.slice(0, 15).map((a, i) => (
                <div key={`${a.dimension}-${a.groupKey}-${i}`} className="flex items-center justify-between gap-3 px-3 py-2.5 text-sm">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <Badge variant={SEVERITY_BADGE[a.severity].variant}>{SEVERITY_BADGE[a.severity].label}</Badge>
                      <span className="font-medium text-ct-navy capitalize">{a.dimension}</span>
                      <span className="text-muted-foreground truncate">{a.groupKey}</span>
                    </div>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      {usd(a.currentSpendUsd)} now vs {usd(a.baselineSpendUsd)} baseline · {ratioStr(a.ratio)} · +{usd(a.deltaUsd)} · {a.currentRequests} calls now vs {a.baselineRequests} baseline
                    </p>
                  </div>
                </div>
              ))}
              {d.anomaly.findings.length > 15 && (
                <p className="px-3 py-2 text-xs text-muted-foreground">+ {d.anomaly.findings.length - 15} more — see the daily cost-anomaly-audit loop&apos;s loop_executions rows for the full list.</p>
              )}
            </div>
          )}
          <p className="text-xs text-muted-foreground italic mt-3">
            Ratio-based deviation (current vs its own {d.anomaly.baselineWindowDays}-day baseline), not a statistical model. Detects spikes cost-guard&apos;s absolute cap can&apos;t see. A daily loop records each finding for review.
          </p>
        </CardContent>
      </Card>

      {/* FinOps reconciliation */}
      <Card className="rounded-xl shadow-card bg-white">
        <CardHeader>
          <CardTitle className="text-base font-semibold text-ct-navy flex items-center gap-2">
            <Scale className="h-4 w-4" /> FinOps reconciliation
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex items-center gap-2">
            <Badge variant={VERDICT_BADGE[d.reconciliation.verdict].variant}>{VERDICT_BADGE[d.reconciliation.verdict].label}</Badge>
            <span className="text-sm text-muted-foreground">
              Engineering claim {usd(d.reconciliation.engineeringClaimUsd)}
              {d.reconciliation.financeLedgerUsd != null && <> · Finance ledger {usd(d.reconciliation.financeLedgerUsd)}</>}
              {d.reconciliation.varianceUsd != null && <> · variance {usd(d.reconciliation.varianceUsd)}{d.reconciliation.variancePct != null && ` (${(d.reconciliation.variancePct * 100).toFixed(0)}%)`}</>}
            </span>
          </div>
          <p className="text-xs text-muted-foreground">{d.reconciliation.note}</p>
          <div className="flex items-end gap-3 pt-1">
            <div className="flex-1 max-w-[220px]">
              <Label htmlFor="finance-ledger" className="text-xs">Finance ledger figure (USD, this month)</Label>
              <Input
                id="finance-ledger"
                type="number"
                min={0}
                step="0.01"
                placeholder="e.g. provider invoice total"
                value={financeInput}
                onChange={(e) => setFinanceInput(e.target.value)}
              />
            </div>
            <Button size="sm" disabled={loading} onClick={load}>
              {loading && <Loader2 className="h-3 w-3 mr-1 animate-spin" />}
              Reconcile
            </Button>
          </div>
          <p className="text-xs text-muted-foreground italic">
            Reconciles the platform&apos;s own per-call engineering estimate against an independent Finance figure you enter. No external Finance-system integration is wired (deferred unless spend scale or an audit requirement justifies building a second independent estimate).
          </p>
        </CardContent>
      </Card>

      {/* Idle capacity */}
      <Card className="rounded-xl shadow-card bg-white">
        <CardHeader>
          <CardTitle className="text-base font-semibold text-ct-navy flex items-center gap-2">
            <PowerOff className="h-4 w-4" /> Unused / idle AI capacity
          </CardTitle>
        </CardHeader>
        <CardContent>
          {d.idleCapacity.findings.length === 0 ? (
            <p className="text-sm text-muted-foreground">No idle AI capacity identified in the last {d.idleCapacity.windowDays} days. All provisioned models/orgs are being exercised.</p>
          ) : (
            <div className="rounded-lg border divide-y">
              {d.idleCapacity.findings.map((f, i) => (
                <div key={`${f.kind}-${f.orgId}-${i}`} className="px-3 py-2.5 text-sm">
                  <div className="flex items-center gap-2">
                    <Badge variant="outline">{f.kind === "unused_byo_config" ? "Unused BYO config" : "Dormant floor-tier org"}</Badge>
                    <span className="font-medium text-ct-navy">{f.orgId}</span>
                    {f.model && <span className="text-muted-foreground">{f.provider}/{f.model}</span>}
                  </div>
                  <p className="text-xs text-muted-foreground mt-0.5">{f.note}</p>
                </div>
              ))}
            </div>
          )}
          <p className="text-xs text-muted-foreground italic mt-3">
            Simple {d.idleCapacity.windowDays}-day query — not dedicated tooling, per the finding&apos;s own recommendation at current scale. Reuses the existing BYO-model-audit detection shape rather than forking a second detector.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}

function KpiCard({
  icon: Icon, label, value, sub, tone,
}: {
  icon: React.ElementType;
  label: string;
  value: string;
  sub: string;
  tone: "neutral" | "warning" | "destructive";
}) {
  const toneClass = tone === "destructive" ? "text-red-600" : tone === "warning" ? "text-ct-saffron" : "text-ct-navy";
  return (
    <div className="rounded-lg border p-3 space-y-1">
      <div className="flex items-center gap-1.5 text-muted-foreground">
        <Icon className="h-3.5 w-3.5" />
        <span className="text-xs font-medium">{label}</span>
      </div>
      <div className={`text-xl font-semibold ${toneClass} flex items-center gap-1`}>
        {tone !== "neutral" && <AlertTriangle className="h-3.5 w-3.5" />}
        {value}
      </div>
      <p className="text-[11px] text-muted-foreground leading-tight">{sub}</p>
    </div>
  );
}
