"use client";

// force-dynamic: see src/app/(app)/knowledge-base/page.tsx for why this is
// required (prevents static prerendering + CDN-cache bypass of middleware).
export const dynamic = "force-dynamic";

// PROJEXA server-merge (ai-os/PROJEXA_SERVER_MERGE_PLAN.md): port of
// PROJEXA's own Sales module landing page (src/app/(app)/sales/page.tsx +
// SalesDashboardClient.tsx there) -- the funnel/pipeline overview for the
// leads+opportunities module. Reads the already-native
// GET /api/v1/projexa/sales-pipeline (a thin alias over crm-service.ts's
// getSalesPipelineOverview) -- zero new backend route, zero HTTP hop to a
// separate origin (verified field-for-field against sales-pipeline/route.ts
// and crm-service.ts before writing this file: totalLeads,
// totalOpportunities, leadsByStatus, opportunitiesByStage{count,value},
// wonCount, lostCount, winRate, openPipelineValue, overdueLeadFollowUps,
// overdueOpportunityFollowUps -- an exact field-for-field match to
// PROJEXA's own `Overview` type).
//
// NOTE (disambiguation, already settled before this module was built): this
// is a genuinely separate feature from this repo's own native /crm page --
// that page calls a different, older API namespace (/api/crm/leads,
// /api/crm/opportunities). This module (/sales/*) calls
// /api/v1/projexa/leads and /api/v1/projexa/opportunities, the
// project-linked, PROJEXA-facing surface. See
// ai-os/PROJEXA_SERVER_MERGE_PLAN.md.
//
// UI is compliance-tracker's own shadcn Card/Badge (matching the house
// convention every already-ported PROJEXA-merge page uses: see
// src/app/(app)/sales-orders/page.tsx / src/app/(app)/quotations/page.tsx),
// not PROJEXA's own @fchecklist/veridian-ui-kit.
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { currencyLabel, useCurrencies } from "@/lib/currency-format";

type Overview = {
  totalLeads: number;
  totalOpportunities: number;
  leadsByStatus: Record<string, number>;
  opportunitiesByStage: Record<string, { count: number; value: number }>;
  wonCount: number;
  lostCount: number;
  winRate: number | null;
  openPipelineValue: number;
  overdueLeadFollowUps: number;
  overdueOpportunityFollowUps: number;
};

const STAGE_ORDER = ["prospecting", "proposal", "negotiation", "won", "lost"];
const LEAD_STATUS_ORDER = ["new", "contacted", "qualified", "converted", "lost"];

export default function SalesDashboardPage() {
  const currencies = useCurrencies();
  const money = (n: number) => `${currencyLabel(undefined, currencies)}${n.toLocaleString("en-IN", { maximumFractionDigits: 0 })}`;

  const [data, setData] = useState<Overview | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/v1/projexa/sales-pipeline");
      const body = await res.json().catch(() => null);
      if (!res.ok) throw new Error(body?.error ?? "Couldn't load sales pipeline overview");
      setData(body as Overview);
      setLoadError(null);
    } catch (err) {
      setData(null);
      const message = err instanceof Error ? err.message : "Couldn't load sales pipeline overview";
      setLoadError(message);
      toast.error(message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  return (
    <div className="flex-1 space-y-6 p-6">
      <div>
        <h1 className="text-2xl font-heading text-ct-navy">Sales</h1>
        <p className="text-sm text-ct-muted mt-1">Leads and opportunities pipeline, from first contact through won or lost.</p>
      </div>

      {loading ? (
        <div className="grid h-40 place-items-center"><Loader2 className="size-5 animate-spin text-ct-muted" /></div>
      ) : loadError || !data ? (
        <Card className="rounded-xl shadow-card bg-white">
          <CardContent className="pt-10 pb-10 text-center text-sm text-ct-muted space-y-3">
            <p role="alert">{loadError ?? "No pipeline data available."}</p>
            <button type="button" onClick={() => void load()} className="text-ct-teal hover:underline">Retry</button>
          </CardContent>
        </Card>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
            <Card className="rounded-xl shadow-card bg-white"><CardHeader className="pb-2"><CardTitle className="text-sm font-medium text-ct-muted">Total Leads</CardTitle></CardHeader><CardContent className="text-2xl font-semibold text-ct-navy">{data.totalLeads}</CardContent></Card>
            <Card className="rounded-xl shadow-card bg-white"><CardHeader className="pb-2"><CardTitle className="text-sm font-medium text-ct-muted">Total Opportunities</CardTitle></CardHeader><CardContent className="text-2xl font-semibold text-ct-navy">{data.totalOpportunities}</CardContent></Card>
            <Card className="rounded-xl shadow-card bg-white"><CardHeader className="pb-2"><CardTitle className="text-sm font-medium text-ct-muted">Win Rate</CardTitle></CardHeader><CardContent className="text-2xl font-semibold text-ct-navy">{data.winRate != null ? `${(data.winRate * 100).toFixed(0)}%` : "—"}</CardContent></Card>
            <Card className="rounded-xl shadow-card bg-white"><CardHeader className="pb-2"><CardTitle className="text-sm font-medium text-ct-muted">Open Pipeline Value</CardTitle></CardHeader><CardContent className="text-2xl font-semibold text-ct-navy">{money(data.openPipelineValue)}</CardContent></Card>
          </div>

          {(data.overdueLeadFollowUps > 0 || data.overdueOpportunityFollowUps > 0) && (
            <Card className="rounded-xl border-destructive/40 shadow-card bg-white">
              <CardContent className="flex flex-wrap items-center justify-between gap-3 py-4 text-sm">
                <span>
                  <Badge variant="destructive" className="mr-2">Overdue</Badge>
                  {data.overdueLeadFollowUps} lead(s) and {data.overdueOpportunityFollowUps} opportunity(ies) have a follow-up date in the past.
                </span>
                <div className="flex gap-3">
                  <Link href="/sales/leads" className="text-ct-teal hover:underline">Review leads</Link>
                  <Link href="/sales/opportunities" className="text-ct-teal hover:underline">Review opportunities</Link>
                </div>
              </CardContent>
            </Card>
          )}

          <Card className="rounded-xl shadow-card bg-white">
            <CardHeader><CardTitle className="text-base text-ct-navy">Opportunity Funnel</CardTitle></CardHeader>
            <CardContent className="space-y-3">
              {(() => {
                const maxStageCount = Math.max(1, ...STAGE_ORDER.map((s) => data.opportunitiesByStage[s]?.count ?? 0));
                return STAGE_ORDER.map((stage) => {
                  const bucket = data.opportunitiesByStage[stage] ?? { count: 0, value: 0 };
                  return (
                    <div key={stage} className="space-y-1">
                      <div className="flex items-center justify-between text-sm">
                        <span className="capitalize text-ct-navy">{stage}</span>
                        <span className="text-ct-muted">{bucket.count} &middot; {money(bucket.value)}</span>
                      </div>
                      <div className="h-2 w-full rounded-full bg-ct-navy/10">
                        <div className="h-2 rounded-full bg-ct-saffron" style={{ width: `${(bucket.count / maxStageCount) * 100}%` }} />
                      </div>
                    </div>
                  );
                });
              })()}
            </CardContent>
          </Card>

          <Card className="rounded-xl shadow-card bg-white">
            <CardHeader><CardTitle className="text-base text-ct-navy">Lead Status Breakdown</CardTitle></CardHeader>
            <CardContent className="flex flex-wrap gap-3">
              {LEAD_STATUS_ORDER.map((status) => (
                <Badge key={status} variant="outline" className="px-3 py-1.5 text-sm capitalize">
                  {status}: {data.leadsByStatus[status] ?? 0}
                </Badge>
              ))}
            </CardContent>
          </Card>

          <div className="flex flex-wrap gap-3 text-sm">
            <Link href="/sales/leads" className="text-ct-teal hover:underline">View all leads &rarr;</Link>
            <Link href="/sales/opportunities" className="text-ct-teal hover:underline">View all opportunities &rarr;</Link>
            <Link href="/quotations" className="text-ct-teal hover:underline">View quotations &rarr;</Link>
            <Link href="/sales-orders" className="text-ct-teal hover:underline">View sales orders &rarr;</Link>
            <Link href="/customers" className="text-ct-teal hover:underline">View customers &rarr;</Link>
          </div>
        </>
      )}
    </div>
  );
}
