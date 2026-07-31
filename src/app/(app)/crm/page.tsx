"use client";

export const dynamic = "force-dynamic";

// Wave 3 (2026-07-21) refactor: this page used to cram both the full Leads
// and Opportunities management UI into two tabs, fetched unpaginated, with
// no detail pages underneath. That's exactly the "lacks fineness" gap the
// Owner flagged. All of that functionality now lives on its own dedicated,
// paginated page (crm/leads, crm/opportunities/[id], crm/contacts,
// crm/accounts -- the last one already existed from Wave B). This page is
// now what it should have been from the start: a real overview/dashboard
// -- headline counts + AI-attention items -- with clear links into each
// module, matching how crm/accounts already stood on its own.
//
// Generalized CRM gap-analysis follow-up: getSalesPipelineOverview()
// (src/lib/services/crm-service.ts) already existed with real leads-by-status,
// opportunities-by-stage+value, win-rate, and overdue-follow-up aggregation,
// but it was only ever exposed externally at /api/v1/projexa/sales-pipeline --
// nothing inside this app's own UI rendered it. This adds a "Sales Pipeline"
// section below the existing module grid (that grid is left completely
// unchanged) that calls the new in-app /api/crm/sales-pipeline route. Chart
// styling intentionally mirrors this codebase's own existing recharts usage
// (src/components/home/DashboardAnalytics.tsx's ComplianceChart) -- same
// design-token colors, same custom tooltip shape -- not the reference gap
// analysis' legacy Google-Charts pie/card layout, per Owner instruction to
// keep this app's own UI/UX unchanged in style.
import { useEffect, useState } from "react";
import Link from "next/link";
import {
  UserPlus, Target, Building2, Users, Megaphone, Sparkles, TrendingUp, Wallet, Clock,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer,
} from "recharts";
import { currencyLabel, useCurrencies } from "@/lib/currency-format";

type Counts = { leads: number; opportunities: number; accounts: number; contacts: number; campaigns: number };

const MODULES = [
  { key: "leads", href: "/crm/leads", label: "Leads", icon: UserPlus, description: "Prospects not yet a client" },
  { key: "opportunities", href: "/crm/opportunities", label: "Opportunities", icon: Target, description: "Deals in progress, tracked stage by stage" },
  { key: "accounts", href: "/crm/accounts", label: "Accounts", icon: Building2, description: "Company-level records and subsidiary hierarchy" },
  { key: "contacts", href: "/crm/contacts", label: "Contacts", icon: Users, description: "Every named person across your account book" },
  { key: "campaigns", href: "/crm/campaigns", label: "Campaigns", icon: Megaphone, description: "Marketing efforts leads can be attributed to" },
] as const;

// Same status/stage vocab + label/color convention already established on
// crm/leads/page.tsx and crm/opportunities/page.tsx (kept as local consts
// there too, not shared -- following that same precedent rather than
// inventing a new shared-constants module for this one page).
const LEAD_STATUS_ORDER = ["new", "contacted", "qualified", "converted", "lost"] as const;
const LEAD_STATUS_LABELS: Record<string, string> = {
  new: "New", contacted: "Contacted", qualified: "Qualified", converted: "Converted", lost: "Lost",
};
const OPP_STAGE_ORDER = ["prospecting", "proposal", "negotiation", "won", "lost"] as const;
const OPP_STAGE_LABELS: Record<string, string> = {
  prospecting: "Prospecting", proposal: "Proposal", negotiation: "Negotiation", won: "Won", lost: "Lost",
};

type SalesPipelineOverview = {
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

// Orders known keys first (matching this module's own status/stage vocab),
// then appends anything unexpected rather than silently dropping it -- an
// org-configured or future status this page doesn't know the label for yet
// still shows up (title-cased from the raw key), it just sorts last.
function orderedEntries<T>(byKey: Record<string, T>, order: readonly string[], labels: Record<string, string>) {
  const known = order.filter((k) => k in byKey).map((k) => ({ key: k, label: labels[k] ?? k }));
  const extra = Object.keys(byKey).filter((k) => !order.includes(k)).map((k) => ({ key: k, label: k.charAt(0).toUpperCase() + k.slice(1) }));
  return [...known, ...extra];
}

function PipelineTooltip({ active, payload, label, formatValue }: {
  active?: boolean; payload?: Array<{ value: number }>; label?: string; formatValue: (n: number) => string;
}) {
  if (!active || !payload || !payload.length) return null;
  return (
    <div className="bg-white border border-ct-border rounded-lg shadow-lg p-3 text-sm">
      <p className="font-semibold text-ct-navy mb-1">{label}</p>
      <p className="text-xs text-ct-slate">{formatValue(payload[0].value)}</p>
    </div>
  );
}

function StatTile({ title, value, icon: Icon, accent, iconBg }: {
  title: string; value: string; icon: React.ElementType; accent: string; iconBg: string;
}) {
  return (
    <Card className="rounded-xl shadow-card bg-white">
      <CardContent className="p-5">
        <div className="flex items-center justify-between mb-2">
          <span className="text-sm font-medium text-ct-muted">{title}</span>
          <div className={`size-9 rounded-lg flex items-center justify-center ${iconBg}`}>
            <Icon className={`size-4.5 ${accent}`} />
          </div>
        </div>
        <p className="text-2xl font-heading text-ct-navy">{value}</p>
      </CardContent>
    </Card>
  );
}

export default function CrmPage() {
  const [counts, setCounts] = useState<Counts | null>(null);
  const [pipeline, setPipeline] = useState<SalesPipelineOverview | null>(null);
  const [pipelineError, setPipelineError] = useState(false);
  const currencies = useCurrencies();
  const money = (n: number) => `${currencyLabel(undefined, currencies)}${n.toLocaleString("en-IN", { maximumFractionDigits: 0 })}`;

  useEffect(() => {
    Promise.all([
      fetch("/api/crm/leads?pageSize=1").then((r) => r.json()),
      fetch("/api/crm/opportunities?pageSize=1").then((r) => r.json()),
      fetch("/api/crm/accounts?pageSize=1").then((r) => r.json()),
      fetch("/api/crm/contacts?pageSize=1").then((r) => r.json()),
      fetch("/api/crm/campaigns").then((r) => r.json()),
    ]).then(([leads, opportunities, accounts, contacts, campaigns]) => {
      setCounts({
        leads: leads.total ?? 0,
        opportunities: opportunities.total ?? 0,
        accounts: accounts.total ?? 0,
        contacts: contacts.total ?? 0,
        campaigns: Array.isArray(campaigns) ? campaigns.length : 0,
      });
    });
  }, []);

  useEffect(() => {
    fetch("/api/crm/sales-pipeline")
      .then((r) => { if (!r.ok) throw new Error("failed"); return r.json(); })
      .then((d) => setPipeline(d))
      .catch(() => setPipelineError(true));
  }, []);

  const leadsChartData = pipeline
    ? orderedEntries(pipeline.leadsByStatus, LEAD_STATUS_ORDER, LEAD_STATUS_LABELS).map((e) => ({ name: e.label, value: pipeline.leadsByStatus[e.key] ?? 0 }))
    : [];
  const oppChartData = pipeline
    ? orderedEntries(pipeline.opportunitiesByStage, OPP_STAGE_ORDER, OPP_STAGE_LABELS).map((e) => ({ name: e.label, value: pipeline.opportunitiesByStage[e.key]?.value ?? 0, count: pipeline.opportunitiesByStage[e.key]?.count ?? 0 }))
    : [];

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-heading text-ct-navy flex items-center gap-2"><Sparkles className="size-5 text-ct-saffron" /> CRM</h1>
        <p className="text-sm text-ct-muted mt-1">Lead-to-client pipeline -- how you actually get a new client, and keep the ones you have.</p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {MODULES.map((m) => {
          const Icon = m.icon;
          return (
            <Link key={m.key} href={m.href}>
              <Card className="rounded-xl shadow-card bg-white hover:shadow-md transition-shadow h-full">
                <CardContent className="p-5 space-y-2">
                  <div className="flex items-center justify-between">
                    <div className="grid place-items-center size-9 rounded-lg bg-ct-saffron/10"><Icon className="size-4.5 text-ct-saffron" /></div>
                    <span className="text-2xl font-heading text-ct-navy">{counts ? counts[m.key as keyof Counts] : "—"}</span>
                  </div>
                  <p className="text-sm font-semibold text-ct-navy">{m.label}</p>
                  <p className="text-xs text-ct-muted">{m.description}</p>
                </CardContent>
              </Card>
            </Link>
          );
        })}
      </div>

      <div>
        <h2 className="text-lg font-heading text-ct-navy">Sales Pipeline</h2>
        <p className="text-sm text-ct-muted mt-0.5">Where every lead and opportunity stands right now, and what needs a follow-up.</p>
      </div>

      {pipelineError ? (
        <Card className="rounded-xl shadow-card bg-white"><CardContent className="pt-10 pb-10 text-center text-sm text-ct-muted">Couldn't load the sales pipeline overview.</CardContent></Card>
      ) : (
        <>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <StatTile
              title="Win Rate"
              value={pipeline?.winRate != null ? `${Math.round(pipeline.winRate * 100)}%` : "—"}
              icon={TrendingUp} accent="text-ct-teal" iconBg="bg-ct-teal/10"
            />
            <StatTile
              title="Open Pipeline Value"
              value={pipeline ? money(pipeline.openPipelineValue) : "—"}
              icon={Wallet} accent="text-ct-saffron" iconBg="bg-ct-saffron/10"
            />
            <StatTile
              title="Overdue Lead Follow-ups"
              value={pipeline ? String(pipeline.overdueLeadFollowUps) : "—"}
              icon={Clock} accent="text-red-600" iconBg="bg-red-100"
            />
            <StatTile
              title="Overdue Opportunity Follow-ups"
              value={pipeline ? String(pipeline.overdueOpportunityFollowUps) : "—"}
              icon={Clock} accent="text-red-600" iconBg="bg-red-100"
            />
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <Card className="rounded-xl shadow-card bg-white">
              <CardHeader><CardTitle className="text-base text-ct-navy">Leads by Status</CardTitle></CardHeader>
              <CardContent>
                {!pipeline ? (
                  <p className="text-sm text-ct-muted">Loading...</p>
                ) : leadsChartData.every((d) => d.value === 0) ? (
                  <p className="text-sm text-ct-muted py-8 text-center">No leads yet.</p>
                ) : (
                  <ResponsiveContainer width="100%" height={260}>
                    <BarChart data={leadsChartData} margin={{ top: 5, right: 20, left: 0, bottom: 5 }} barCategoryGap="25%">
                      <XAxis dataKey="name" tick={{ fontSize: 12, fill: "#718096" }} axisLine={{ stroke: "#E2E8F0" }} tickLine={false} />
                      <YAxis tick={{ fontSize: 12, fill: "#718096" }} axisLine={false} tickLine={false} allowDecimals={false} />
                      <Tooltip content={<PipelineTooltip formatValue={(n) => `${n} lead${n === 1 ? "" : "s"}`} />} cursor={{ fill: "#F0F4F8" }} />
                      <Bar dataKey="value" name="Leads" fill="#F5820A" radius={[4, 4, 0, 0]} maxBarSize={48} />
                    </BarChart>
                  </ResponsiveContainer>
                )}
              </CardContent>
            </Card>

            <Card className="rounded-xl shadow-card bg-white">
              <CardHeader><CardTitle className="text-base text-ct-navy">Opportunities by Stage (Value)</CardTitle></CardHeader>
              <CardContent>
                {!pipeline ? (
                  <p className="text-sm text-ct-muted">Loading...</p>
                ) : oppChartData.every((d) => d.count === 0) ? (
                  <p className="text-sm text-ct-muted py-8 text-center">No opportunities yet.</p>
                ) : (
                  <ResponsiveContainer width="100%" height={260}>
                    <BarChart data={oppChartData} margin={{ top: 5, right: 20, left: 0, bottom: 5 }} barCategoryGap="25%">
                      <XAxis dataKey="name" tick={{ fontSize: 12, fill: "#718096" }} axisLine={{ stroke: "#E2E8F0" }} tickLine={false} />
                      <YAxis tick={{ fontSize: 12, fill: "#718096" }} axisLine={false} tickLine={false} allowDecimals={false} />
                      <Tooltip content={<PipelineTooltip formatValue={(n) => money(n)} />} cursor={{ fill: "#F0F4F8" }} />
                      <Bar dataKey="value" name="Value" fill="#0E7C6E" radius={[4, 4, 0, 0]} maxBarSize={48} />
                    </BarChart>
                  </ResponsiveContainer>
                )}
              </CardContent>
            </Card>
          </div>
        </>
      )}
    </div>
  );
}
