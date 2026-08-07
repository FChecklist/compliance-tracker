"use client";

export const dynamic = "force-dynamic";

// VERIDIAN Review Framework gap-closure (AI Cost Governance & FinOps,
// 2026-08-07). Closes the finding that per-tenant AI cost visibility
// "exists at the API/service level [token-usage-service.ts's
// getTokenUsageSummary, /api/ai/team/token-usage] but UI-surfaced Finance
// dashboard usage [was] not independently verified" -- this page IS that
// consuming UI, plus the manual provider-invoice reconciliation mechanism
// for the two related findings (cost attribution vs. real invoices,
// cost-per-report/action measured not estimated). See PROGRESS.md for the
// full gap-by-gap disposition.
import { useEffect, useState, useCallback } from "react";
import { DollarSign, Database, TrendingUp, Sparkles, Plus, Info } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer } from "recharts";
import { toast } from "sonner";

type SummaryRow = { groupKey: string | null; requests: number; promptTokens: number; completionTokens: number; estimatedCostUsd: number; cacheSavingsUsd: number };
type TokenUsageSummary = {
  sinceDays: number;
  totalCostUsd: number;
  totalRequests: number;
  totalCacheSavingsUsd: number;
  byScope: SummaryRow[];
  byRole: SummaryRow[];
  byModel: SummaryRow[];
  byOrg: SummaryRow[];
  platformMonthlyForecast: { actualSpendToDateUsd: number; forecastedMonthEndSpendUsd: number; daysElapsed: number; daysInMonth: number };
};

type ReconciliationRow = {
  id: string;
  periodMonth: string;
  provider: string;
  actualInvoiceUsd: number;
  estimatedLedgerUsd: number;
  driftUsd: number;
  driftPct: number | null;
  notes: string | null;
  createdAt: string;
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

function SummaryList({ rows, valueLabel }: { rows: SummaryRow[]; valueLabel: (r: SummaryRow) => string }) {
  if (rows.length === 0) return <p className="text-xs text-ct-muted">No data in this window.</p>;
  return (
    <ul className="space-y-2 max-h-[220px] overflow-y-auto">
      {rows.map((r) => (
        <li key={r.groupKey ?? "unknown"} className="flex items-center justify-between text-xs">
          <span className="text-ct-navy">{r.groupKey ?? "—"}</span>
          <span className="text-ct-muted">{valueLabel(r)}</span>
        </li>
      ))}
    </ul>
  );
}

export default function AiCostGovernancePage() {
  const [sinceDays, setSinceDays] = useState("30");
  const [data, setData] = useState<TokenUsageSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [forbidden, setForbidden] = useState(false);

  const [recon, setRecon] = useState<ReconciliationRow[]>([]);
  const [reconLoading, setReconLoading] = useState(true);
  const [formOpen, setFormOpen] = useState(false);
  const [formPeriod, setFormPeriod] = useState("");
  const [formProvider, setFormProvider] = useState("openrouter");
  const [formActual, setFormActual] = useState("");
  const [formNotes, setFormNotes] = useState("");
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    const res = await fetch(`/api/ai/team/token-usage?sinceDays=${sinceDays}`);
    if (res.status === 403) { setForbidden(true); setLoading(false); return; }
    setData(res.ok ? await res.json() : null);
    setLoading(false);
  }, [sinceDays]);

  const loadRecon = useCallback(async () => {
    setReconLoading(true);
    const res = await fetch("/api/ai/team/cost-reconciliation");
    if (res.status === 403) { setReconLoading(false); return; }
    const body = res.ok ? await res.json() : { reconciliations: [] };
    setRecon(body.reconciliations ?? []);
    setReconLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);
  useEffect(() => { loadRecon(); }, [loadRecon]);

  async function submitInvoice() {
    if (!formPeriod || !formActual) {
      toast.error("Period (YYYY-MM) and actual invoice amount are required");
      return;
    }
    setSaving(true);
    try {
      const res = await fetch("/api/ai/team/cost-reconciliation", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          periodMonth: formPeriod,
          provider: formProvider,
          actualInvoiceUsd: Number(formActual),
          notes: formNotes || undefined,
        }),
      });
      const respBody = await res.json();
      if (!res.ok) { toast.error(respBody.error ?? "Failed to record invoice"); return; }
      toast.success("Invoice recorded");
      setFormOpen(false); setFormPeriod(""); setFormActual(""); setFormNotes("");
      loadRecon();
    } finally {
      setSaving(false);
    }
  }

  if (forbidden) {
    return (
      <Card className="rounded-xl shadow-card bg-white p-10 text-center">
        <Info className="size-8 text-ct-border mx-auto mb-3" />
        <p className="text-ct-navy font-medium">Veridian admin (Finance) access required</p>
        <p className="text-sm text-ct-muted mt-1">This page reports real platform-wide AI spend across every organisation.</p>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div>
          <h1 className="font-heading text-2xl md:text-3xl text-ct-navy flex items-center gap-2"><DollarSign className="w-6 h-6" />AI Cost Governance &amp; FinOps</h1>
          <p className="text-sm text-ct-muted mt-1">
            Finance-facing real AI/LLM spend — platform-wide, per-organisation, per-role, per-model, from token_usage_ledger.
          </p>
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

      <Card className="rounded-xl shadow-card bg-white">
        <CardContent className="p-4 flex gap-2 items-start">
          <Info className="size-4 text-ct-teal mt-0.5 shrink-0" />
          <p className="text-xs text-ct-muted">
            Cross-repo spend: PROJEXA (FChecklist/projexa) has zero local LLM client — every AI call it makes
            routes through this platform&apos;s <code>/api/v1/projexa/*</code> endpoints, which log through the same
            token_usage_ledger below. So the platform-wide totals here are already the combined compliance-tracker
            + PROJEXA figure, not a separate rollup. A CI check in this repo (<code>scripts/check-provider-key-usage.mjs</code>)
            fails the build if any new code path starts calling a provider directly outside the logged/ledgered
            call sites, so this invariant can&apos;t silently regress on the compliance-tracker side.
          </p>
        </CardContent>
      </Card>

      {loading || !data ? (
        <div className="text-center text-ct-muted p-10">Loading…</div>
      ) : (
        <>
          <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-3">
            <StatCard icon={<DollarSign className="w-3.5 h-3.5" />} label="Total Cost (window)" value={`$${data.totalCostUsd.toFixed(4)}`} sub={`${data.totalRequests.toLocaleString()} requests`} />
            <StatCard icon={<Sparkles className="w-3.5 h-3.5" />} label="Cache Savings (window)" value={`$${data.totalCacheSavingsUsd.toFixed(4)}`} />
            <StatCard icon={<TrendingUp className="w-3.5 h-3.5" />} label="This Month So Far" value={`$${data.platformMonthlyForecast.actualSpendToDateUsd.toFixed(2)}`} sub={`day ${Math.round(data.platformMonthlyForecast.daysElapsed)} of ${data.platformMonthlyForecast.daysInMonth}`} />
            <StatCard icon={<TrendingUp className="w-3.5 h-3.5" />} label="Forecasted Month End" value={`$${data.platformMonthlyForecast.forecastedMonthEndSpendUsd.toFixed(2)}`} sub="linear run-rate" />
          </div>

          <Card className="rounded-xl shadow-card bg-white">
            <CardContent className="p-4">
              <h3 className="font-medium text-ct-navy text-sm mb-1">Cost by Organisation (per-tenant)</h3>
              <p className="text-[11px] text-ct-muted mb-3">
                product_orchestra-scope spend only — org-less ai_team_internal rows are excluded by construction.
                Known partial-coverage gap, not fixed by this page: token_usage_ledger&apos;s per-org rows are
                currently written only by the call sites that also record prompt-cache metrics (VERI Chat, Help Ask),
                not every Orchestra Layer — see orchestra_executions / the AI Observability and Orchestra Analytics
                pages for the complete per-call record across every layer.
              </p>
              {data.byOrg.length === 0 ? <p className="text-xs text-ct-muted">No per-org spend in this window.</p> : (
                <ResponsiveContainer width="100%" height={Math.max(160, data.byOrg.length * 34)}>
                  <BarChart data={data.byOrg} layout="vertical" margin={{ left: 8 }}>
                    <XAxis type="number" tick={{ fontSize: 10 }} />
                    <YAxis type="category" dataKey="groupKey" tick={{ fontSize: 10 }} width={140} />
                    <Tooltip formatter={(v) => `$${Number(v).toFixed(4)}`} />
                    <Bar dataKey="estimatedCostUsd" fill="#0E7C6E" radius={[0, 3, 3, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              )}
            </CardContent>
          </Card>

          <div className="grid lg:grid-cols-3 gap-4">
            <Card className="rounded-xl shadow-card bg-white">
              <CardContent className="p-4">
                <h3 className="font-medium text-ct-navy text-sm mb-3">Cost by Scope</h3>
                <SummaryList rows={data.byScope} valueLabel={(r) => `$${r.estimatedCostUsd.toFixed(4)} · ${r.requests} calls`} />
              </CardContent>
            </Card>
            <Card className="rounded-xl shadow-card bg-white">
              <CardContent className="p-4">
                <h3 className="font-medium text-ct-navy text-sm mb-3">Cost by AI Team Role</h3>
                <SummaryList rows={data.byRole} valueLabel={(r) => `$${r.estimatedCostUsd.toFixed(4)} · ${r.requests} calls`} />
              </CardContent>
            </Card>
            <Card className="rounded-xl shadow-card bg-white">
              <CardContent className="p-4">
                <h3 className="font-medium text-ct-navy text-sm mb-3">Cost by Model</h3>
                <SummaryList rows={data.byModel} valueLabel={(r) => `$${r.estimatedCostUsd.toFixed(5)} · ${r.requests} calls`} />
              </CardContent>
            </Card>
          </div>
        </>
      )}

      <Card className="rounded-xl shadow-card bg-white">
        <CardContent className="p-4">
          <div className="flex items-center justify-between mb-1">
            <h3 className="font-medium text-ct-navy text-sm">Provider Invoice Reconciliation</h3>
            <Button size="sm" variant="outline" onClick={() => setFormOpen((v) => !v)}>
              <Plus className="size-3.5 mr-1" /> Record invoice
            </Button>
          </div>
          <p className="text-[11px] text-ct-muted mb-3">
            Manual monthly check: paste the real total from the provider&apos;s own billing dashboard for a closed
            month. Estimated is computed live from token_usage_ledger for the same period — this is the
            reconciliation itself, not a second estimate.
          </p>

          {formOpen && (
            <div className="flex flex-wrap items-end gap-2 mb-4 p-3 rounded-lg bg-ct-cloud/40">
              <div>
                <label className="text-[10px] text-ct-muted block mb-1">Period (YYYY-MM)</label>
                <Input className="h-8 w-28" placeholder="2026-07" value={formPeriod} onChange={(e) => setFormPeriod(e.target.value)} />
              </div>
              <div>
                <label className="text-[10px] text-ct-muted block mb-1">Provider</label>
                <Select value={formProvider} onValueChange={setFormProvider}>
                  <SelectTrigger className="h-8 w-36"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="openrouter">openrouter</SelectItem>
                    <SelectItem value="anthropic">anthropic</SelectItem>
                    <SelectItem value="openai">openai</SelectItem>
                    <SelectItem value="groq">groq</SelectItem>
                    <SelectItem value="cerebras">cerebras</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <label className="text-[10px] text-ct-muted block mb-1">Actual invoice (USD)</label>
                <Input className="h-8 w-28" type="number" step="0.01" min="0" value={formActual} onChange={(e) => setFormActual(e.target.value)} />
              </div>
              <div className="flex-1 min-w-[140px]">
                <label className="text-[10px] text-ct-muted block mb-1">Notes</label>
                <Input className="h-8" placeholder="e.g. OpenRouter dashboard, billing period Jul 1-31" value={formNotes} onChange={(e) => setFormNotes(e.target.value)} />
              </div>
              <Button size="sm" disabled={saving} onClick={submitInvoice}>{saving ? "Saving…" : "Save"}</Button>
            </div>
          )}

          {reconLoading ? (
            <p className="text-xs text-ct-muted">Loading…</p>
          ) : recon.length === 0 ? (
            <p className="text-xs text-ct-muted">No invoices recorded yet.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="text-left text-ct-muted border-b border-ct-border">
                    <th className="py-1.5 pr-3 font-medium">Period</th>
                    <th className="py-1.5 pr-3 font-medium">Provider</th>
                    <th className="py-1.5 pr-3 font-medium">Actual invoice</th>
                    <th className="py-1.5 pr-3 font-medium">Estimated (ledger)</th>
                    <th className="py-1.5 pr-3 font-medium">Drift</th>
                    <th className="py-1.5 font-medium">Notes</th>
                  </tr>
                </thead>
                <tbody>
                  {recon.map((r) => (
                    <tr key={r.id} className="border-b border-ct-border/50">
                      <td className="py-1.5 pr-3 text-ct-navy">{r.periodMonth}</td>
                      <td className="py-1.5 pr-3 text-ct-muted">{r.provider}</td>
                      <td className="py-1.5 pr-3 text-ct-navy">${r.actualInvoiceUsd.toFixed(2)}</td>
                      <td className="py-1.5 pr-3 text-ct-navy">${r.estimatedLedgerUsd.toFixed(2)}</td>
                      <td className={`py-1.5 pr-3 ${Math.abs(r.driftPct ?? 0) > 20 ? "text-red-600 font-medium" : "text-ct-muted"}`}>
                        {r.driftUsd >= 0 ? "+" : ""}${r.driftUsd.toFixed(2)}{r.driftPct !== null ? ` (${r.driftPct >= 0 ? "+" : ""}${r.driftPct.toFixed(1)}%)` : ""}
                      </td>
                      <td className="py-1.5 text-ct-muted">{r.notes ?? "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
