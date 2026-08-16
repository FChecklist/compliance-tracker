"use client";

export const dynamic = "force-dynamic";

// Wave 95 (Comparison CSV 3 gap analysis: AI010 "Orchestra Analytics
// Dashboard"). A real dashboard over the existing orchestra_executions data
// (Wave 22/23 observability columns) -- no new telemetry, purely surfacing
// what recordOrchestraExecution() already captures on every real LLM call.
import { useEffect, useState, useCallback } from "react";
import Link from "next/link";
import { ArrowLeft, Activity, DollarSign, Timer, ShieldAlert, XCircle } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer } from "recharts";

type Analytics = {
  totalExecutions: number; completedCount: number; failedCount: number; deniedCount: number;
  failureRate: number; denialRate: number; totalCostUsd: number;
  latencyP50Ms: number | null; latencyP95Ms: number | null;
  costByModel: { model: string; provider: string; costUsd: number; executions: number }[];
  executionsByDay: { day: string; count: number }[];
};

function StatCard({ icon, label, value, sub }: { icon: React.ReactNode; label: string; value: string; sub?: string }) {
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

export default function OrchestraAnalyticsPage() {
  const [sinceDays, setSinceDays] = useState("30");
  const [data, setData] = useState<Analytics | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    const res = await fetch(`/api/orchestra/analytics?sinceDays=${sinceDays}`);
    setData(res.ok ? await res.json() : null);
    setLoading(false);
  }, [sinceDays]);

  useEffect(() => { load(); }, [load]);

  return (
    <div className="space-y-4">
      <div>
        <Link href="/orchestra" className="text-xs text-ct-muted hover:text-ct-navy flex items-center gap-1 mb-2">
          <ArrowLeft className="size-3" /> Back to VERIDIAN AI Orchestra
        </Link>
        <div className="flex items-center justify-between flex-wrap gap-2">
          <div>
            <h1 className="font-heading text-2xl md:text-3xl text-ct-navy flex items-center gap-2"><Activity className="w-6 h-6" />Orchestra Analytics</h1>
            <p className="text-sm text-ct-muted mt-1">Real usage over your orchestra_executions log — cost, latency, failure/denial rate.</p>
          </div>
          <Select value={sinceDays} onValueChange={setSinceDays}>
            <SelectTrigger className="w-32"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="7">Last 7 days</SelectItem>
              <SelectItem value="30">Last 30 days</SelectItem>
              <SelectItem value="90">Last 90 days</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      {loading || !data ? (
        <div className="text-center text-ct-muted p-10">Loading…</div>
      ) : (
        <>
          <div className="grid sm:grid-cols-2 lg:grid-cols-5 gap-3">
            <StatCard icon={<Activity className="w-3.5 h-3.5" />} label="Executions" value={data.totalExecutions.toLocaleString()} sub={`${data.completedCount} completed`} />
            <StatCard icon={<DollarSign className="w-3.5 h-3.5" />} label="Total Cost" value={`$${data.totalCostUsd.toFixed(4)}`} />
            <StatCard icon={<Timer className="w-3.5 h-3.5" />} label="Latency p50 / p95" value={data.latencyP50Ms !== null ? `${Math.round(data.latencyP50Ms)}ms / ${Math.round(data.latencyP95Ms ?? 0)}ms` : "—"} />
            <StatCard icon={<XCircle className="w-3.5 h-3.5" />} label="Failure Rate" value={`${(data.failureRate * 100).toFixed(1)}%`} sub={`${data.failedCount} failed`} />
            <StatCard icon={<ShieldAlert className="w-3.5 h-3.5" />} label="Denial Rate" value={`${(data.denialRate * 100).toFixed(1)}%`} sub={`${data.deniedCount} policy-denied`} />
          </div>

          <div className="grid lg:grid-cols-2 gap-4">
            <Card className="rounded-xl shadow-card bg-white">
              <CardContent className="p-4">
                <h3 className="font-medium text-ct-navy text-sm mb-3">Executions Over Time</h3>
                {data.executionsByDay.length === 0 ? <p className="text-xs text-ct-muted">No executions in this window.</p> : (
                  <ResponsiveContainer width="100%" height={220}>
                    <BarChart data={data.executionsByDay}>
                      <XAxis dataKey="day" tick={{ fontSize: 10 }} />
                      <YAxis tick={{ fontSize: 10 }} allowDecimals={false} />
                      <Tooltip />
                      <Bar dataKey="count" fill="#0E7C6E" radius={[3, 3, 0, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                )}
              </CardContent>
            </Card>

            <Card className="rounded-xl shadow-card bg-white">
              <CardContent className="p-4">
                <h3 className="font-medium text-ct-navy text-sm mb-3">Cost by Model</h3>
                {data.costByModel.length === 0 ? <p className="text-xs text-ct-muted">No costed executions in this window.</p> : (
                  <ul className="space-y-2 max-h-[220px] overflow-y-auto">
                    {data.costByModel.map((m) => (
                      <li key={`${m.provider}-${m.model}`} className="flex items-center justify-between text-xs">
                        <span className="text-ct-navy">{m.provider} / {m.model}</span>
                        <span className="text-ct-muted">${m.costUsd.toFixed(5)} · {m.executions} runs</span>
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
