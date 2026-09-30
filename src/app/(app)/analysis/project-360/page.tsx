"use client";

// force-dynamic: see src/app/(app)/knowledge-base/page.tsx for why this is
// required (prevents static prerendering + CDN-cache bypass of middleware).
export const dynamic = "force-dynamic";

// PROJEXA server-merge (ai-os/PROJEXA_SERVER_MERGE_PLAN.md), module
// "analysis": native port of PROJEXA's Project 360 Analysis (FChecklist/
// projexa src/app/(app)/analysis/project-360/page.tsx +
// src/components/Project360Client.tsx). Sumeet requirement #7 ("for a
// project, the change of BOQ, change of scope, billing, milestones,
// timelines analysis") combined with #8 ("profit and loss analysis for the
// project") -- one screen, five already-built, already-tested domains, read
// only:
//   - P&L / BOQ change: GET /api/v1/projexa/reports/boq-analysis?projectId=
//     -> { row } (src/app/api/v1/projexa/reports/boq-analysis/route.ts:44-46,
//     backed by boq-analysis-service.ts's getProjectAnalysis). ROLE FLOOR:
//     "manager" (requireRoleOrScope(ctx, "manager", "read"), route.ts:41) --
//     stricter than most GET routes in this repo because this is explicitly
//     "the single most valuable screen in the product for an owner" per that
//     route's own comment. A lower-ranked role's fetch here 403s and surfaces
//     as the plain error state below, same as any other failure -- no special
//     casing added.
//   - Change of scope: GET /api/v1/projexa/change-orders?projectId= ->
//     { changeOrders } (route.ts:15-16).
//   - Milestones: GET /api/v1/projexa/milestones?projectId= -> { milestones }
//     (route.ts:33-34).
//   - Timeline: GET /api/v1/projexa/schedule/gantt?projectId= -> raw
//     { tasks, dependencies, milestones } with no wrapper key (route.ts:27-28,
//     schedule-service.ts's getGanttData) -- note this is NOT { tasks: [...] }
//     wrapped again, the route already returns the object with a `tasks` key
//     at the top level.
//   - Billing milestones: GET /api/v1/projexa/billing-claims?projectId= ->
//     { claims } (route.ts:31-34).
// PROJEXA's own Project360Client.tsx calls PROJEXA-internal proxy paths
// (/api/reports/boq-analysis, /api/change-orders, /api/milestones,
// /api/schedule/gantt, /api/billing-claims) since it is a separate app
// proxying through -- this port calls the real /api/v1/projexa/* routes
// directly, same convention as every other module ported this session.
//
// No resolveSelectedProject/getServerOrganizationId equivalent exists in
// this repo (checked before starting) -- uses the same "use client" +
// ProjectPicker + /api/projects convention as change-orders/page.tsx, and
// currencyLabel/useCurrencies (lib/currency-format.ts) in place of
// PROJEXA's useOrgMoney/formatNumber, which also do not exist here.
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Loader2, LayoutDashboard } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ProjectPicker, NoProjectsCard, type PickerProject } from "@/components/ProjectPicker";
import { currencyLabel, useCurrencies } from "@/lib/currency-format";

type MoneyFigure = number | "NOT_SET";

type ProfitAtBothLevels = {
  profitOnGross: MoneyFigure;
  profitOnGrossPercent: MoneyFigure;
  profitOnNetReceivable: MoneyFigure;
  profitOnNetReceivablePercent: MoneyFigure;
};

type ProjectAnalysisRow = {
  hasBaseline: boolean;
  contractAtFirstConfirmation: MoneyFigure;
  contractValueNow: MoneyFigure;
  contractVariance: MoneyFigure;
  approvedVariationCount: number;
  baselineEstimatedCost: MoneyFigure;
  committed: MoneyFigure;
  spent: MoneyFigure;
  commitmentDriftSign: "under_baseline" | "over_baseline" | "on_baseline" | "unknown";
  costPerformanceSign: "under_baseline" | "over_baseline" | "on_baseline" | "unknown";
  expectedProfitGross: MoneyFigure;
  actualProfit: ProfitAtBothLevels;
  profitVsExpectedDelta: MoneyFigure;
};

type ChangeOrder = { id: string; status: string; costImpact: string };
type Milestone = { id: string; status: string; completionPercentage: number };
type GanttTask = { id: string; isCritical: boolean };
type BillingClaim = { id: string; status: string; isOverdue: boolean };

const SIGN_LABEL: Record<ProjectAnalysisRow["commitmentDriftSign"], string> = {
  under_baseline: "Under baseline",
  over_baseline: "Over baseline",
  on_baseline: "On baseline",
  unknown: "Not yet known",
};

const SIGN_VARIANT: Record<ProjectAnalysisRow["commitmentDriftSign"], "default" | "secondary" | "destructive" | "outline"> = {
  under_baseline: "default",
  over_baseline: "destructive",
  on_baseline: "secondary",
  unknown: "outline",
};

export default function Project360Page() {
  const currencies = useCurrencies();
  const fmt = (v: MoneyFigure) =>
    v === "NOT_SET" ? "Not yet baselined" : `${currencyLabel(undefined, currencies)}${v.toLocaleString("en-IN", { maximumFractionDigits: 0 })}`;
  const fmtPercent = (v: MoneyFigure) => (v === "NOT_SET" ? "--" : `${v.toFixed(1)}%`);

  const [projects, setProjects] = useState<PickerProject[]>([]);
  const [projectId, setProjectId] = useState("");
  const [loadingProjects, setLoadingProjects] = useState(true);

  const [analysis, setAnalysis] = useState<ProjectAnalysisRow | null>(null);
  const [changeOrders, setChangeOrders] = useState<ChangeOrder[]>([]);
  const [milestones, setMilestones] = useState<Milestone[]>([]);
  const [tasks, setTasks] = useState<GanttTask[]>([]);
  const [billingClaims, setBillingClaims] = useState<BillingClaim[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/projects")
      .then((r) => r.json())
      .then((d) => {
        const list: PickerProject[] = d.projects ?? [];
        setProjects(list);
        if (list.length > 0) setProjectId((prev) => prev || list[0].id);
      })
      .catch(() => toast.error("Failed to load projects"))
      .finally(() => setLoadingProjects(false));
  }, []);

  useEffect(() => {
    if (!projectId) return;
    let cancelled = false;
    async function load() {
      setLoading(true);
      setError(null);
      try {
        const qs = `projectId=${encodeURIComponent(projectId)}`;
        const [analysisRes, changeOrdersRes, milestonesRes, ganttRes, billingRes] = await Promise.all([
          fetch(`/api/v1/projexa/reports/boq-analysis?${qs}`),
          fetch(`/api/v1/projexa/change-orders?${qs}`),
          fetch(`/api/v1/projexa/milestones?${qs}`),
          fetch(`/api/v1/projexa/schedule/gantt?${qs}`),
          fetch(`/api/v1/projexa/billing-claims?${qs}`),
        ]);
        const [analysisData, changeOrdersData, milestonesData, ganttData, billingData] = await Promise.all([
          analysisRes.json(),
          changeOrdersRes.json(),
          milestonesRes.json(),
          ganttRes.json(),
          billingRes.json(),
        ]);
        if (!analysisRes.ok) throw new Error(analysisData?.error ?? "Failed to load the Project 360 analysis");
        if (cancelled) return;
        setAnalysis(analysisData.row);
        setChangeOrders(changeOrdersData.changeOrders ?? []);
        setMilestones(milestonesData.milestones ?? []);
        setTasks(ganttData.tasks ?? []);
        setBillingClaims(billingData.claims ?? []);
      } catch (err) {
        if (!cancelled) setError(err instanceof Error && err.message ? err.message : "Couldn't load the Project 360 analysis");
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, [projectId]);

  const pendingChangeOrders = changeOrders.filter((c) => c.status !== "approved" && c.status !== "rejected");
  const totalScopeChangeImpact = changeOrders.reduce((sum, c) => sum + Number(c.costImpact || 0), 0);

  const milestonesByStatus = milestones.reduce<Record<string, number>>((acc, m) => {
    acc[m.status] = (acc[m.status] ?? 0) + 1;
    return acc;
  }, {});
  const avgMilestoneCompletion = milestones.length
    ? Math.round(milestones.reduce((sum, m) => sum + m.completionPercentage, 0) / milestones.length)
    : 0;

  const criticalTaskCount = tasks.filter((t) => t.isCritical).length;
  const overdueBillingClaims = billingClaims.filter((c) => c.isOverdue).length;

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-heading text-ct-navy">Project 360 Analysis</h1>
        <p className="text-sm text-ct-muted mt-1">
          Did we make the margin we quoted, and where did it go -- combined with scope changes, billing milestones and schedule slippage.
        </p>
      </div>

      {loadingProjects ? (
        <p className="text-sm text-ct-muted">Loading projects...</p>
      ) : projects.length === 0 ? (
        <NoProjectsCard icon={LayoutDashboard} />
      ) : (
        <>
          <ProjectPicker projects={projects} value={projectId} onChange={setProjectId} />

          {loading ? (
            <div className="grid h-32 place-items-center">
              <Loader2 className="size-5 animate-spin text-ct-muted" />
            </div>
          ) : error || !analysis ? (
            <Card className="rounded-xl shadow-card bg-white">
              <CardContent className="p-8 text-center text-sm text-red-600">{error ?? "No analysis available"}</CardContent>
            </Card>
          ) : (
            <div className="space-y-4">
              {/* THE ANSWER (Sumeet #8: Profit & Loss) */}
              <Card className="rounded-xl shadow-card bg-white">
                <CardHeader>
                  <CardTitle className="font-heading text-base text-ct-navy">Profit &amp; Loss -- the answer</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
                    <div>
                      <p className="text-xs text-ct-muted">Expected profit (at first confirmation)</p>
                      <p className="text-lg font-heading text-ct-navy">{fmt(analysis.expectedProfitGross)}</p>
                    </div>
                    <div>
                      <p className="text-xs text-ct-muted">Actual profit (gross)</p>
                      <p className="text-lg font-heading text-ct-navy">{fmt(analysis.actualProfit.profitOnGross)}</p>
                      <p className="text-xs text-ct-muted">{fmtPercent(analysis.actualProfit.profitOnGrossPercent)} margin</p>
                    </div>
                    <div>
                      <p className="text-xs text-ct-muted">Actual profit (net receivable)</p>
                      <p className="text-lg font-heading text-ct-navy">{fmt(analysis.actualProfit.profitOnNetReceivable)}</p>
                      <p className="text-xs text-ct-muted">{fmtPercent(analysis.actualProfit.profitOnNetReceivablePercent)} margin</p>
                    </div>
                    <div>
                      <p className="text-xs text-ct-muted">Vs. quoted margin</p>
                      <p className={`text-lg font-heading ${analysis.profitVsExpectedDelta !== "NOT_SET" && analysis.profitVsExpectedDelta < 0 ? "text-red-600" : "text-ct-navy"}`}>
                        {fmt(analysis.profitVsExpectedDelta)}
                      </p>
                    </div>
                  </div>
                  {!analysis.hasBaseline && (
                    <p className="mt-3 text-xs text-ct-muted">No baseline has been confirmed for this project&apos;s BOQ yet -- the figures above will read &quot;Not yet baselined&quot; until one is.</p>
                  )}
                </CardContent>
              </Card>

              {/* CHANGE OF BOQ (Sumeet #6) */}
              <Card className="rounded-xl shadow-card bg-white">
                <CardHeader>
                  <CardTitle className="font-heading text-base text-ct-navy">Change of BOQ</CardTitle>
                </CardHeader>
                <CardContent className="grid grid-cols-2 gap-4 sm:grid-cols-4">
                  <div>
                    <p className="text-xs text-ct-muted">Contract at first confirmation</p>
                    <p className="text-lg font-heading text-ct-navy">{fmt(analysis.contractAtFirstConfirmation)}</p>
                  </div>
                  <div>
                    <p className="text-xs text-ct-muted">Contract now</p>
                    <p className="text-lg font-heading text-ct-navy">{fmt(analysis.contractValueNow)}</p>
                  </div>
                  <div>
                    <p className="text-xs text-ct-muted">Variation impact</p>
                    <p className="text-lg font-heading text-ct-navy">{fmt(analysis.contractVariance)}</p>
                    <p className="text-xs text-ct-muted">{analysis.approvedVariationCount} approved revision(s)</p>
                  </div>
                  <div>
                    <p className="text-xs text-ct-muted">Cost vs. baseline</p>
                    <div className="mt-1 flex flex-wrap gap-1">
                      <Badge variant={SIGN_VARIANT[analysis.commitmentDriftSign]} className="text-[10px]">
                        Committed: {SIGN_LABEL[analysis.commitmentDriftSign]}
                      </Badge>
                      <Badge variant={SIGN_VARIANT[analysis.costPerformanceSign]} className="text-[10px]">
                        Spent: {SIGN_LABEL[analysis.costPerformanceSign]}
                      </Badge>
                    </div>
                  </div>
                </CardContent>
              </Card>

              {/* CHANGE OF SCOPE (Sumeet #5) + MILESTONES (Sumeet #2) + TIMELINE + BILLING (#3) */}
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                <Card className="rounded-xl shadow-card bg-white">
                  <CardHeader>
                    <CardTitle className="font-heading text-sm text-ct-navy">Scope changes</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <p className="text-2xl font-heading text-ct-navy">{changeOrders.length}</p>
                    <p className="text-xs text-ct-muted">{pendingChangeOrders.length} pending decision</p>
                    <p className="text-xs text-ct-muted">{fmt(totalScopeChangeImpact)} total cost impact</p>
                  </CardContent>
                </Card>
                <Card className="rounded-xl shadow-card bg-white">
                  <CardHeader>
                    <CardTitle className="font-heading text-sm text-ct-navy">Milestones</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <p className="text-2xl font-heading text-ct-navy">{milestones.length}</p>
                    <p className="text-xs text-ct-muted">{avgMilestoneCompletion}% average completion</p>
                    <p className="text-xs text-ct-muted">{milestonesByStatus.completed ?? 0} completed</p>
                  </CardContent>
                </Card>
                <Card className="rounded-xl shadow-card bg-white">
                  <CardHeader>
                    <CardTitle className="font-heading text-sm text-ct-navy">Timeline</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <p className="text-2xl font-heading text-ct-navy">{tasks.length}</p>
                    <p className="text-xs text-ct-muted">{criticalTaskCount} activities on the critical path</p>
                  </CardContent>
                </Card>
                <Card className="rounded-xl shadow-card bg-white">
                  <CardHeader>
                    <CardTitle className="font-heading text-sm text-ct-navy">Billing milestones</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <p className="text-2xl font-heading text-ct-navy">{billingClaims.length}</p>
                    <p className={`text-xs ${overdueBillingClaims > 0 ? "text-red-600" : "text-ct-muted"}`}>{overdueBillingClaims} overdue</p>
                  </CardContent>
                </Card>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
