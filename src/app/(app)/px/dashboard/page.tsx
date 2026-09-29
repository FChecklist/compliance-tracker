"use client";

// force-dynamic: see src/app/(app)/knowledge-base/page.tsx for why this is
// required (prevents static prerendering + CDN-cache bypass of middleware).
export const dynamic = "force-dynamic";

// PROJEXA server-merge (ai-os/PROJEXA_SERVER_MERGE_PLAN.md), module
// "dashboard": native port of PROJEXA's own home route (FChecklist/projexa
// src/app/(app)/dashboard/page.tsx + src/components/DashboardHomeView.tsx),
// reading this repo's own GET /api/v1/projexa/dashboard directly -- same
// route src/app/(app)/projects/page.tsx (Phase 0) and construction-dashboard/
// page.tsx already call, same-origin, zero new backend logic.
//
// Lives at px/dashboard, NOT dashboard: compliance-tracker's own /dashboard
// is a different, pre-existing concept (compliance posture, not construction
// project financials) -- src/proxy.ts (already merged) rewrites
// projexa-ai.com/dashboard to this path.
//
// WHY THIS IS A DIFFERENT PAGE FROM construction-dashboard/page.tsx, WHICH
// ALREADY PORTS THE SAME totals+table: that page's own header comment says
// it explicitly punted PROJEXA's greeting chrome ("PROJEXA's own /dashboard
// is actually its designated home route with a HomeGreeting widget this
// repo has no equivalent of, so this page is a straight port of the data
// cards + project table only, not the greeting chrome"). This page is that
// greeting-chrome home route: the "Good morning, {name}" heading, the ONE
// number (earned value vs contract value across the portfolio), the
// needs-you-first project rows with a status word and named reasons, and the
// KPI baseline+direction wording -- rebuilt from DashboardHomeView.tsx,
// lib/dashboard-kpis.ts and lib/dashboard-rows.ts's pure logic (ported
// faithfully, not just the JSX), in compliance-tracker's own shadcn
// vocabulary rather than @fchecklist/veridian-ui-kit.
//
// SCOPE -- deliberately NOT ported, and why:
//   - The Filter drawer (company/department/date-range selects that absorbed
//     the retired /dashboard/hierarchy screen): construction-dashboard/
//     page.tsx already has a native department filter over this same route;
//     duplicating company/date-range filtering here is a separate, later
//     decision, not this port's job.
//   - ModuleDirectory (the grid that "replaces the deleted left rail" in
//     PROJEXA): compliance-tracker already has its own AppSidebar nav --
//     there is no rail to replace here.
//   - DashboardSpeculation (prefetches Scope/Work Progress while the reader
//     is looking at this screen): a pure performance optimisation with no
//     user-visible behaviour: nothing to port.
//   - CurrencyNotSetNotice: an org's base currency is already visible from
//     every "-" money figure below, and is now set at /px/settings (the
//     sibling port) -- a second banner saying the same thing was judged not
//     worth the extra fetch.
//   - Org-wide "permits expiring" chip (PROJEXA's own separate /permits?
//     withinDays=30 call): the per-project permitsExpiring30d figure the
//     dashboard route already returns is used below (in each row's "needs
//     you" reasons) with no second fetch; only the org-wide roll-up chip is
//     skipped.
// The portfolio bar chart (contract/budget/earned/spend per project) IS
// ported, using recharts (already a house dependency -- see
// CustomChartBuilder.tsx) instead of the kit's GroupedBarChart.
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import {
  Building2, Wallet, TrendingUp, Receipt, Plus, RotateCcw, FolderKanban, AlertTriangle, CheckCircle2,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { currencyLabel, useCurrencies } from "@/lib/currency-format";
import {
  Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from "recharts";

// The per-project shape /api/v1/projexa/dashboard returns (construction-
// dashboard-service.ts's OrgDashboardProjectSummary) -- only the fields this
// page actually reads. `value`/`budget`/`earnedValue` are null (never 0) when
// the project has no BOQ yet; every money field is null (never 0) when this
// reader's role had it redacted (see `financialsRedacted` below).
type DashboardProject = {
  id: string;
  name: string;
  expenses: number | null;
  delayedTaskCount: number;
  value: number | null;
  budget: number | null;
  earnedValue: number | null;
  percentByValue: number | null;
  spendOverValue?: boolean | null;
  permitsExpiring30d?: number;
  lastProgressAt?: string | null;
};

type OrgDashboard = {
  totalProjects: number;
  totalBudget: number | null;
  totalLedgerBudget?: number | null;
  totalRevenue: number;
  totalExpenses: number;
  /** True when the API redacted every money figure for this reader's role. */
  financialsRedacted?: boolean;
  projects: DashboardProject[];
};

// --- Ported, pure logic (PROJEXA src/lib/dashboard-rows.ts) ---------------

/** How long earned value may stand still before a row is flagged "needs you". */
const STALLED_AFTER_DAYS = 30;

/** Whole days between two YYYY-MM-DD days, both parsed as UTC midnight, or null if either is unreadable. */
function daysBetween(from: string | null | undefined, to: string): number | null {
  if (!from || !/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to)) return null;
  const a = Date.UTC(Number(from.slice(0, 4)), Number(from.slice(5, 7)) - 1, Number(from.slice(8, 10)));
  const b = Date.UTC(Number(to.slice(0, 4)), Number(to.slice(5, 7)) - 1, Number(to.slice(8, 10)));
  return Math.round((b - a) / 86_400_000);
}

type ProjectRowStatus = { label: "needs you" | "on track"; needsYou: boolean; reasons: string[] };

/**
 * "Needs you" is a list of specific, actionable facts, not a mood: spend past
 * the contract value or the BOQ budget, no progress logged in 30+ days, a
 * permit expiring soon, or a delayed task. Order is reading order -- money
 * first, then the stall, then permits, then schedule. `spendOverValue ===
 * null` means the figure was redacted for this reader's role, not that spend
 * is fine, so a redacted fact never contributes a reason either way.
 */
function projectRowStatus(project: DashboardProject, today: string): ProjectRowStatus {
  const reasons: string[] = [];
  if (project.spendOverValue === true) reasons.push("spend over contract value");
  if (project.expenses !== null && project.budget !== null && project.expenses > project.budget) {
    reasons.push("spend over budget");
  }
  const stalled = daysBetween(project.lastProgressAt, today);
  if (stalled !== null && stalled >= STALLED_AFTER_DAYS) reasons.push(`no progress recorded for ${stalled} days`);
  const permits = project.permitsExpiring30d ?? 0;
  if (permits > 0) reasons.push(permits === 1 ? "1 permit expiring in 30 days" : `${permits} permits expiring in 30 days`);
  if (project.delayedTaskCount > 0) {
    reasons.push(project.delayedTaskCount === 1 ? "1 delayed task" : `${project.delayedTaskCount} delayed tasks`);
  }
  return { label: reasons.length > 0 ? "needs you" : "on track", needsYou: reasons.length > 0, reasons };
}

/** Needs-you first, then the rest, each group in the payload's own order. */
function sortProjectRows(projects: readonly DashboardProject[], today: string): DashboardProject[] {
  return [...projects].sort(
    (a, b) => Number(projectRowStatus(b, today).needsYou) - Number(projectRowStatus(a, today).needsYou)
  );
}

/** The one-line summary above the rows: which project needs attention, and the leading reason why. */
function needsYouSummary(projects: readonly DashboardProject[], today: string): string | null {
  const flagged = projects
    .map((p) => ({ project: p, status: projectRowStatus(p, today) }))
    .filter((f) => f.status.needsYou);
  if (flagged.length === 0) return null;
  const lead = flagged[0];
  const why = lead.status.reasons[0] ? ` — ${lead.status.reasons[0]}` : "";
  if (flagged.length === 1) return `${lead.project.name} needs you${why}.`;
  const others = flagged.length - 1;
  return `${lead.project.name} and ${others} other ${others === 1 ? "project" : "projects"} need you${why}.`;
}

/** The portfolio contract value: the sum of the BOQ root totals that exist. null when none does. */
function portfolioContractValue(projects: readonly DashboardProject[]): number | null {
  const scoped = projects.filter((p) => p.value !== null && p.value !== undefined);
  if (scoped.length === 0) return null;
  return scoped.reduce((sum, p) => sum + (p.value ?? 0), 0);
}

// --- Ported, pure logic (PROJEXA src/lib/dashboard-kpis.ts) ----------------

type KpiDirection = "over" | "under" | "level";
const DIRECTION_GLYPH: Record<KpiDirection, string> = { over: "▲", under: "▼", level: "▬" };

/** over / under / level, or null when there is nothing real to compare against. */
function compareTo(value: number, baseline: number | null | undefined): KpiDirection | null {
  if (baseline === null || baseline === undefined) return null;
  if (value > baseline) return "over";
  if (value < baseline) return "under";
  return "level";
}

function directionSuffix(direction: KpiDirection | null): string {
  return direction ? ` ${DIRECTION_GLYPH[direction]} ${direction}` : "";
}

// --- Hydration-safe greeting (PROJEXA DashboardHomeView.tsx) ---------------
// The server and the browser can disagree on the hour (UTC vs local), which
// is a deterministic hydration mismatch if computed directly in render -- a
// stable string is shown first, swapped for the real greeting client-side.
const GREETING_STABLE = "Welcome back";
function greetingWord(now: Date): string {
  const h = now.getHours();
  if (h < 12) return "Good morning";
  if (h < 17) return "Good afternoon";
  return "Good evening";
}

const PORTFOLIO_CHART_MIN_PROJECTS = 2;

type Kpi = { key: string; title: string; icon: typeof Building2; value: string; baseline: string; href: string | null };

/**
 * The four secondary KPI tiles, decided here rather than assembled in JSX --
 * same split as PROJEXA's own dashboardKpis(). Each tile carries a value, a
 * baseline it is compared against (with the direction as a word, never a
 * colour alone), and a real destination -- or null when redacted or no
 * destination exists natively in this repo (Revenue: PROJEXA's own tile
 * links to its own /invoices, which compliance-tracker has no equivalent
 * of).
 */
function buildKpis(
  data: OrgDashboard,
  scopedCount: number,
  contract: number | null,
  redacted: boolean,
  money: (n: number | null | undefined) => string
): Kpi[] {
  const budgetEntered = data.totalBudget !== null && data.totalBudget !== undefined && data.totalBudget > 0;
  return [
    {
      key: "projects",
      title: "Active Projects",
      icon: Building2,
      value: String(data.totalProjects),
      baseline: data.totalProjects === 0 ? "No projects yet" : `${scopedCount} of ${data.totalProjects} with a BOQ`,
      href: "/projects",
    },
    {
      key: "budget",
      title: "Total Budget",
      icon: Wallet,
      value: redacted ? "Restricted" : budgetEntered ? money(data.totalBudget) : "–",
      baseline: redacted
        ? "Needs manager role"
        : !budgetEntered
          ? "Budget - not entered"
          : contract === null
            ? "From the BOQ"
            : `${money(data.totalBudget)} of ${money(contract)} contract value${directionSuffix(compareTo(data.totalBudget ?? 0, contract))}`,
      href: "/scope",
    },
    {
      key: "revenue",
      title: "Total Revenue",
      icon: TrendingUp,
      value: redacted ? "Restricted" : money(data.totalRevenue),
      baseline: redacted
        ? "Needs manager role"
        : contract === null
          ? "No contract value yet — import a BOQ"
          : `vs ${money(contract)} contract value${directionSuffix(compareTo(data.totalRevenue, contract))}`,
      href: null,
    },
    {
      key: "expenses",
      title: "Total Expenses",
      icon: Receipt,
      value: redacted ? "Restricted" : money(data.totalExpenses),
      baseline: redacted
        ? "Needs manager role"
        : !budgetEntered
          ? "Nothing to measure spend against"
          : `vs ${money(data.totalBudget)} budget${directionSuffix(compareTo(data.totalExpenses, data.totalBudget))}`,
      href: "/expenses",
    },
  ];
}

export default function PxDashboardPage() {
  const currencies = useCurrencies();
  const [name, setName] = useState<string | null>(null);
  const [data, setData] = useState<OrgDashboard | null>(null);
  const [loading, setLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [greeting, setGreeting] = useState(GREETING_STABLE);
  const [today] = useState(() => new Date().toISOString().slice(0, 10));

  useEffect(() => { setGreeting(greetingWord(new Date())); }, []);

  useEffect(() => {
    fetch("/api/me")
      .then((r) => r.json())
      .then((d) => setName(d?.name || (typeof d?.email === "string" ? d.email.split("@")[0] : null)))
      .catch(() => {});
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/v1/projexa/dashboard");
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setData(null);
        setErrorMessage(body?.error ?? `Couldn't load the dashboard (HTTP ${res.status})`);
        return;
      }
      setData(body as OrgDashboard);
      setErrorMessage(null);
    } catch (err) {
      setData(null);
      setErrorMessage(err instanceof Error ? err.message : "Couldn't load the dashboard");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const money = (n: number | null | undefined) =>
    n === null || n === undefined
      ? "–"
      : `${currencyLabel(undefined, currencies)}${n.toLocaleString("en-IN", { maximumFractionDigits: 0 })}`;

  const redacted = data?.financialsRedacted === true;
  const projects = data ? sortProjectRows(data.projects, today) : [];
  const delayedProjectCount = data?.projects.filter((p) => p.delayedTaskCount > 0).length ?? 0;
  const onTrackProjectCount = (data?.totalProjects ?? 0) - delayedProjectCount;
  const attention = data ? needsYouSummary(data.projects, today) : null;

  // THE ONE NUMBER: earned value against contract value, summed only over
  // projects that HAVE a BOQ -- a project with none contributes nothing
  // rather than a zero, so the ratio describes work that has actually been
  // scoped.
  const scoped = projects.filter((p) => p.value !== null && p.earnedValue !== null);
  const totalContract = scoped.reduce((s, p) => s + (p.value ?? 0), 0);
  const totalEarned = scoped.reduce((s, p) => s + (p.earnedValue ?? 0), 0);
  const portfolioPercent = totalContract > 0 ? Math.round((totalEarned / totalContract) * 100) : null;

  const contract = data ? portfolioContractValue(data.projects) : null;
  const kpis: Kpi[] = data ? buildKpis(data, scoped.length, contract, redacted, money) : [];

  const chartData = projects.map((p) => ({
    name: p.name,
    Contract: p.value,
    Budget: p.budget,
    Earned: p.earnedValue,
    Spend: p.expenses,
  }));

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-heading text-2xl text-ct-navy tracking-tight">
          {greeting}, {name ?? "there"}.
        </h1>
        <p className="mt-1 flex flex-wrap items-center gap-2 text-sm text-ct-muted">
          <span>
            {!data
              ? errorMessage
                ? "We couldn't load your projects."
                : "Loading your projects…"
              : data.totalProjects === 0
                ? "You have no active projects yet."
                : `You have ${data.totalProjects} active project${data.totalProjects === 1 ? "" : "s"}.`}
          </span>
          {delayedProjectCount > 0 && (
            <span className="inline-flex items-center gap-1.5 rounded-full bg-red-50 px-2.5 py-0.5 text-[11px] font-semibold text-red-600">
              {delayedProjectCount} delayed
            </span>
          )}
          {onTrackProjectCount > 0 && (
            <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-50 px-2.5 py-0.5 text-[11px] font-semibold text-emerald-700">
              {onTrackProjectCount} on track
            </span>
          )}
        </p>
      </div>

      {errorMessage && (
        <Card className="rounded-xl border-red-200 bg-red-50 shadow-card">
          <CardContent className="p-4 text-sm text-red-700">Could not load live data: {errorMessage}</CardContent>
        </Card>
      )}

      <div className="flex justify-end">
        <Button size="sm" asChild className="bg-ct-saffron hover:bg-ct-saffron-hover text-white shadow-saffron">
          <Link href="/projects"><Plus className="size-4" /> Create Project</Link>
        </Button>
      </div>

      {loading && !data ? (
        <p className="text-sm text-ct-muted" aria-busy="true">Loading…</p>
      ) : !data ? (
        <Card className="rounded-xl shadow-card bg-white">
          <CardHeader><CardTitle className="font-heading text-base text-ct-navy">Projects</CardTitle></CardHeader>
          <CardContent className="space-y-3">
            <p role="alert" className="text-sm text-red-600">Could not load projects</p>
            <Button variant="outline" size="sm" onClick={() => void load()}>
              <RotateCcw className="size-4" /> Retry
            </Button>
          </CardContent>
        </Card>
      ) : (
        <>
          {/* THE ONE NUMBER. */}
          <Card className="rounded-xl shadow-card bg-white">
            <CardContent className="space-y-1 p-5">
              <p className="text-xs text-ct-muted">Earned value across the portfolio</p>
              <p className="font-heading text-4xl text-ct-navy">
                {redacted
                  ? "Restricted"
                  : portfolioPercent === null
                    ? "No BOQ yet"
                    : `${money(totalEarned)} of ${money(totalContract)} (${portfolioPercent}%)`}
              </p>
              <p className="text-xs text-ct-muted">
                {redacted
                  ? "Needs manager role"
                  : portfolioPercent === null
                    ? "Import a BOQ on a project to see earned value."
                    : `Across ${scoped.length} of ${data.totalProjects} ${data.totalProjects === 1 ? "project" : "projects"} with a BOQ.`}
              </p>
              {attention && !redacted && <p className="text-xs text-red-600">{attention}</p>}
            </CardContent>
          </Card>

          {/* Portfolio chart -- hidden below two projects (a comparison of
              one project compares nothing) and while financials are redacted
              (every bar would be null). */}
          {!redacted && projects.length >= PORTFOLIO_CHART_MIN_PROJECTS && (
            <Card className="rounded-xl shadow-card bg-white">
              <CardHeader><CardTitle className="font-heading text-base text-ct-navy">Contract, earned and spend by project</CardTitle></CardHeader>
              <CardContent>
                <ResponsiveContainer width="100%" height={280}>
                  <BarChart data={chartData}>
                    <CartesianGrid strokeDasharray="3 3" vertical={false} />
                    <XAxis dataKey="name" tick={{ fontSize: 11 }} interval={0} angle={-15} textAnchor="end" height={50} />
                    <YAxis tick={{ fontSize: 11 }} />
                    <Tooltip formatter={(v) => money(typeof v === "number" ? v : null)} />
                    <Legend wrapperStyle={{ fontSize: 12 }} />
                    <Bar dataKey="Contract" fill="#1C2B3A" />
                    <Bar dataKey="Budget" fill="#F5820A" />
                    <Bar dataKey="Earned" fill="#0E7C6E" />
                    <Bar dataKey="Spend" fill="#DC2626" />
                  </BarChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>
          )}

          {/* Projects, needs-you first. */}
          <Card className="rounded-xl shadow-card bg-white">
            <CardHeader className="flex flex-row items-center justify-between gap-3">
              <CardTitle className="font-heading text-base text-ct-navy">Projects</CardTitle>
              <Button size="sm" variant="outline" asChild>
                <Link href="/projects"><FolderKanban className="size-4" /> View all</Link>
              </Button>
            </CardHeader>
            <CardContent className="space-y-3">
              {projects.length === 0 ? (
                <p className="py-8 text-center text-sm text-ct-muted">No projects yet.</p>
              ) : (
                <ul className="divide-y">
                  {projects.map((p) => {
                    const status = projectRowStatus(p, today);
                    return (
                      <li key={p.id} className="py-3">
                        <Link
                          href={`/construction-dashboard?projectId=${p.id}`}
                          className="flex flex-wrap items-center justify-between gap-3 hover:underline"
                        >
                          <div className="min-w-0 flex-1">
                            <p className="flex items-center gap-1.5 font-medium text-ct-navy">
                              <FolderKanban className="size-3.5 text-ct-muted shrink-0" /> {p.name}
                            </p>
                            <p className="mt-1 flex items-center gap-2">
                              {p.percentByValue === null ? (
                                <span className="text-xs text-ct-muted">No BOQ yet</span>
                              ) : (
                                <>
                                  <span className="h-1.5 w-24 shrink-0 rounded-full bg-gray-200">
                                    <span
                                      className="block h-full rounded-full bg-ct-teal"
                                      style={{ width: `${Math.max(0, Math.min(100, p.percentByValue))}%` }}
                                    />
                                  </span>
                                  <span className="text-xs tabular-nums text-ct-muted">{Math.round(p.percentByValue)}%</span>
                                </>
                              )}
                            </p>
                          </div>
                          <div className="text-right text-xs text-ct-muted">
                            <p>Contract {redacted ? "Restricted" : money(p.value)}</p>
                            <p>Spend {redacted ? "Restricted" : money(p.expenses)}</p>
                          </div>
                          <span
                            className={`inline-flex shrink-0 items-center gap-1 rounded-full px-2.5 py-0.5 text-[11px] font-semibold ${
                              status.needsYou ? "bg-red-50 text-red-600" : "bg-emerald-50 text-emerald-700"
                            }`}
                            title={status.reasons.join(", ")}
                          >
                            {status.needsYou ? <AlertTriangle className="size-3" /> : <CheckCircle2 className="size-3" />}
                            {status.label}
                          </span>
                        </Link>
                      </li>
                    );
                  })}
                </ul>
              )}
            </CardContent>
          </Card>

          {/* Secondary KPI band -- a portfolio total answers a question you
              ask after "which project needs me today", not before it. */}
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {kpis.map((kpi) => {
              const Icon = kpi.icon;
              const body = (
                <Card className="rounded-xl shadow-card bg-white transition-shadow hover:shadow-md">
                  <CardContent className="flex items-center gap-4 p-4">
                    <div className="flex size-11 shrink-0 items-center justify-center rounded-lg bg-ct-navy/10">
                      <Icon className="size-5 text-ct-navy" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="text-xs font-medium uppercase tracking-wide text-ct-muted">{kpi.title}</p>
                      <p className="mt-0.5 text-2xl font-bold leading-tight text-ct-navy">{kpi.value}</p>
                      <p className="mt-1 truncate text-xs text-ct-muted">{kpi.baseline}</p>
                    </div>
                  </CardContent>
                </Card>
              );
              return kpi.href ? <Link key={kpi.key} href={kpi.href}>{body}</Link> : <div key={kpi.key}>{body}</div>;
            })}
          </div>

          {redacted && (
            <p className="text-xs text-ct-muted">Contract/project values need a manager role or above — restricted for your account.</p>
          )}
        </>
      )}
    </div>
  );
}
