// Unified Reports & Analysis catalog. Report logic was scattered across 4
// services (custom-report-service.ts, erp-financial-report-service.ts,
// construction-reports-service.ts, ai-performance-report-service.ts +
// report-cadence-service.ts) with no single place listing what actually
// exists. This is a DATA-ONLY registry describing those already-real
// reports -- it does not reimplement or re-execute any report logic, it
// just catalogs it. Every entry below was verified against its real
// underlying service function and route before being listed here (no
// speculative/aspirational entries).
//
// `route` is honestly what it is today, not what would be ideal -- some
// entries are a real navigable UI page, others are only a real API
// endpoint with no dedicated UI page yet, and the 4 AI-ops cadence reports
// are only reachable via a cron-secret-protected internal endpoint (no
// user session can call them at all). `routeNote` spells out that
// distinction per entry so nothing here silently overstates what a user
// can actually click through to. See capability-tree-service.ts's
// buildReportCatalogNodes() for how this drives the "Reports & Analysis"
// Dynamic Chain Options Selector branch -- only entries with a directly
// navigable, no-required-params route get wired as a reportUrl leaf
// (matching VeriComposer.tsx's dispatchInstruction(), which does a plain
// router.push(leaf.reportUrl) with no way to attach query params or an
// Authorization header); the rest still appear as leaves, they just fall
// through to the normal AI-planning path instead of a fixed navigation.

// Priority 11 (Owner directive 2026-07-13, Reports & Analysis Engine):
// every catalog entry now also carries the 3-axis taxonomy from
// report-taxonomy.ts (category/classifications/periodicity) -- backfilled
// below for all 26 pre-existing entries with real values, not left blank.
import type { ReportCategory } from "./report-taxonomy"
import { withTenantContext } from "@/lib/db/tenant-scoped"

export type ReportDomain = "compliance" | "ERP" | "construction" | "AI-ops" | "custom"

export type ReportCatalogEntry = {
  id: string
  name: string
  description: string
  domain: ReportDomain
  /** file.ts#functionName (or #REGISTRY_KEY for the construction dispatcher) this entry is sourced from. */
  sourceService: string
  outputFormats: string[]
  /** The real URL/page or API path where this report can be run/viewed today. */
  route: string
  /** Honest caveat about what `route` actually gets you -- required params, auth, or "no dedicated UI page yet". */
  routeNote: string
  /** Whether `route` is a page a user can navigate straight to with no required query params/headers. Drives capability-tree wiring. */
  directlyNavigable: boolean
  /** report-taxonomy.ts's 7-value CATEGORY axis -- who/what produces this report. */
  category: ReportCategory
  /** report-taxonomy.ts's open CLASSIFICATION list -- subject-matter grouping (executive/financial/hr/sales/...). */
  classifications: string[]
  /** report-taxonomy.ts's PeriodicityBase, or undefined for on-demand/ad-hoc entries (the 22 API-only/cron-only entries below already run on a fixed real cadence or are param-gated ad-hoc; the daily cron ones are tagged "daily"). */
  periodicity?: string
}

const CONSTRUCTION_REPORT_META: { id: string; name: string; description: string; classifications: string[] }[] = [
  { id: "construction-work-progress", name: "Work Progress Report", description: "Latest logged % complete and total quantity done per project activity.", classifications: ["project", "construction"] },
  { id: "construction-weekly-project", name: "Weekly Project Report", description: "Composite weekly snapshot: progress entries, labour cost/attendance, site diary entries, and expenses for a 7-day window.", classifications: ["project", "construction", "executive"] },
  { id: "construction-project-status", name: "Project Status Report", description: "Overall project dashboard figures (budget, progress, KPIs) reused verbatim from the project dashboard.", classifications: ["project", "construction", "executive"] },
  { id: "construction-attendance", name: "Attendance Report", description: "Present/absent/half-day counts and labour cost, grouped by trade.", classifications: ["resource", "hr", "construction"] },
  { id: "construction-site-picture", name: "Site Picture Report", description: "Site photo documents for the project, grouped by date.", classifications: ["project", "construction"] },
  { id: "construction-scope", name: "Scope Report", description: "BOQ total value and line-item count for the latest non-superseded revision, plus revision history.", classifications: ["project", "procurement", "construction"] },
  { id: "construction-budget-summary", name: "Budget Summary", description: "Total budget and line items by account, via the project's cost centre.", classifications: ["financial", "project", "construction"] },
  { id: "construction-budget-vs-actual", name: "Budget vs Actual", description: "Budget total (via cost centre) vs actual expenses, with variance and a by-head breakdown.", classifications: ["financial", "project", "construction"] },
  { id: "construction-material-consumption", name: "Material Consumption Report", description: "Net stock movement per item for the project (negative = consumed).", classifications: ["procurement", "resource", "construction"] },
  { id: "construction-vendor-cost", name: "Vendor Cost Report", description: "Labour-vendor cost by vendor (purchase-invoice-based vendor cost not included -- no project_id on that table yet).", classifications: ["financial", "vendor_management", "construction"] },
  { id: "construction-manpower-cost", name: "Manpower Cost Report", description: "Attendance-based labour cost and worker-days, summed by trade.", classifications: ["resource", "financial", "hr", "construction"] },
  { id: "construction-designer-timesheet", name: "Designer Timesheet Report", description: "PMS time-entry hours summed by user, for this project's issues.", classifications: ["resource", "project"] },
  { id: "construction-kpi", name: "KPI Report", description: "Approved KPI entries for the project's KPI definitions.", classifications: ["project", "executive", "construction"] },
  { id: "construction-revenue", name: "Revenue Report", description: "Non-cancelled sales invoices for the project, with total value.", classifications: ["financial", "revenue", "sales", "construction"] },
  { id: "construction-expense", name: "Expense Report", description: "Expense entries for the project, summarized by expense head.", classifications: ["financial", "construction"] },
  { id: "construction-category-progress", name: "Category Progress Report", description: "Latest % complete averaged per activity category.", classifications: ["project", "construction"] },
  { id: "construction-project-completion", name: "Project Completion Report", description: "Overall completion % (from the project dashboard) plus a per-category breakdown.", classifications: ["project", "executive", "construction"] },
]

const CONSTRUCTION_ROUTE_NOTE = "Real, auth-required API endpoint (GET /api/construction/reports/<reportName>?projectId=<id>, also aliased at /api/v1/projexa/reports/<reportName> for API-key callers) -- returns real DB-backed JSON. No dedicated UI page renders it yet, so there is nothing to navigate straight to without already knowing a projectId (and, for weekly-project, a weekStart)."

const CONSTRUCTION_ENTRIES: ReportCatalogEntry[] = CONSTRUCTION_REPORT_META.map(({ id, name, description, classifications }) => {
  const reportName = id.replace(/^construction-/, "")
  return {
    id,
    name,
    description,
    domain: "construction",
    sourceService: `src/lib/services/construction-reports-service.ts#REPORT_REGISTRY["${reportName}"]`,
    outputFormats: ["JSON (API only, no dedicated UI page yet)"],
    route: `/api/construction/reports/${reportName}`,
    routeNote: CONSTRUCTION_ROUTE_NOTE,
    directlyNavigable: false,
    category: "software_report" as ReportCategory,
    classifications,
    periodicity: "on_demand",
  }
})

export const REPORT_CATALOG: ReportCatalogEntry[] = [
  // ── ERP financial reports (erp-financial-report-service.ts) ──────────
  // Rendered live in /erp/reports (Trial Balance / P&L / Balance Sheet /
  // Cash Flow tabs). Plain on-screen tables -- this page has no CSV/Excel/
  // PDF export today (unlike /reports's compliance-items export).
  {
    id: "erp-trial-balance",
    name: "Trial Balance",
    description: "Every account's cumulative debit/credit as of a date, from inception, with a balanced-ledger check.",
    domain: "ERP",
    sourceService: "src/lib/services/erp-financial-report-service.ts#trialBalance",
    outputFormats: ["on-screen table (JSON API: GET /api/erp/reports/trial-balance)"],
    route: "/erp/reports",
    routeNote: "Real live page -- 'Trial Balance' tab. Optional company/date query params on the page itself, not required to load.",
    directlyNavigable: true,
    category: "software_report",
    classifications: ["financial", "org_specific"],
    periodicity: "on_demand",
  },
  {
    id: "erp-profit-and-loss",
    name: "Profit & Loss",
    description: "Income/expense accounts over a date range (not cumulative from inception), with net profit.",
    domain: "ERP",
    sourceService: "src/lib/services/erp-financial-report-service.ts#profitAndLoss",
    outputFormats: ["on-screen table (JSON API: GET /api/erp/reports/profit-and-loss)"],
    route: "/erp/reports",
    routeNote: "Real live page -- 'Profit & Loss' tab. Optional company/date query params on the page itself, not required to load.",
    directlyNavigable: true,
    category: "software_report",
    classifications: ["financial", "revenue", "org_specific"],
    periodicity: "on_demand",
  },
  {
    id: "erp-balance-sheet",
    name: "Balance Sheet",
    description: "Asset/liability/equity accounts, cumulative as of a date, with a balanced-sheet check.",
    domain: "ERP",
    sourceService: "src/lib/services/erp-financial-report-service.ts#balanceSheet",
    outputFormats: ["on-screen table (JSON API: GET /api/erp/reports/balance-sheet)"],
    route: "/erp/reports",
    routeNote: "Real live page -- 'Balance Sheet' tab. Optional company/date query params on the page itself, not required to load.",
    directlyNavigable: true,
    category: "software_report",
    classifications: ["financial", "org_specific"],
    periodicity: "on_demand",
  },
  {
    id: "erp-cash-flow",
    name: "Cash Flow Statement",
    description: "Indirect-method statement of cash flows (operating/investing/financing), derived from real GL account movement.",
    domain: "ERP",
    sourceService: "src/lib/services/erp-financial-report-service.ts#cashFlowStatement",
    outputFormats: ["on-screen table (JSON API: GET /api/erp/reports/cash-flow)"],
    route: "/erp/reports",
    routeNote: "Real live page -- 'Cash Flow' tab. Optional company/date query params on the page itself, not required to load.",
    directlyNavigable: true,
    category: "software_report",
    classifications: ["financial", "org_specific"],
    periodicity: "on_demand",
  },

  // ── Construction / PROJEXA reports (construction-reports-service.ts) ─
  ...CONSTRUCTION_ENTRIES,

  // ── AI-ops daily cadence reports (ai-performance-report-service.ts /
  // report-cadence-service.ts) ──────────────────────────────────────────
  // All 4 are real, DB-backed, deterministic (no LLM fabrication) -- but
  // all 4 are cron-only: the route is a shared-secret-gated internal
  // endpoint with no user session path at all, matching that route file's
  // own header comment ("no dashboard/inbox surface to read it from
  // later"). Listed honestly as cron-only, not as a page a user can visit.
  {
    id: "ai-performance-report",
    name: "AI Performance Report",
    description: "Daily rollup of Orchestra execution failure rate, token usage, worker-agent accuracy, and CLEE loop-improvement outcomes.",
    domain: "AI-ops",
    sourceService: "src/lib/services/ai-performance-report-service.ts#generateAiPerformanceReport",
    outputFormats: ["JSON (cron-triggered only; requires Authorization: Bearer <CRON_SECRET>, not user-navigable)"],
    route: "/api/internal/ai-performance-report/run",
    routeNote: "Cron-only endpoint (see vercel.json). Visiting this URL directly in a browser returns 401 -- there is no dashboard/inbox surface for this report today.",
    directlyNavigable: false,
    category: "software_report",
    classifications: ["operations", "executive"],
    periodicity: "daily",
  },
  {
    id: "escalations-report",
    name: "Escalations Report",
    description: "Daily count of task escalation events, parsed from the fixed escalation-suffix pattern in system chat messages, grouped by rung.",
    domain: "AI-ops",
    sourceService: "src/lib/services/report-cadence-service.ts#generateEscalationsReport",
    outputFormats: ["JSON (cron-triggered only; requires Authorization: Bearer <CRON_SECRET>, not user-navigable)"],
    route: "/api/internal/escalations-report/run",
    routeNote: "Cron-only endpoint (see vercel.json). Visiting this URL directly in a browser returns 401 -- there is no dashboard/inbox surface for this report today.",
    directlyNavigable: false,
    category: "software_report",
    classifications: ["operations", "executive"],
    periodicity: "daily",
  },
  {
    id: "recommendations-report",
    name: "Recommendations Report",
    description: "Daily open queue of CLEE loop_improvements recommendations (not yet deployed or rolled back), grouped by improvement type and target type.",
    domain: "AI-ops",
    sourceService: "src/lib/services/report-cadence-service.ts#generateRecommendationsReport",
    outputFormats: ["JSON (cron-triggered only; requires Authorization: Bearer <CRON_SECRET>, not user-navigable)"],
    route: "/api/internal/recommendations-report/run",
    routeNote: "Cron-only endpoint (see vercel.json). Visiting this URL directly in a browser returns 401 -- there is no dashboard/inbox surface for this report today.",
    directlyNavigable: false,
    category: "software_report",
    classifications: ["operations", "predictive"],
    periodicity: "daily",
  },
  {
    id: "risk-trends-report",
    name: "Risk-Trends Report",
    description: "7-day trend of dispatch risk classifications (activity_log.riskLevel), with daily buckets and period totals.",
    domain: "AI-ops",
    sourceService: "src/lib/services/report-cadence-service.ts#generateRiskTrendsReport",
    outputFormats: ["JSON (cron-triggered only; requires Authorization: Bearer <CRON_SECRET>, not user-navigable)"],
    route: "/api/internal/risk-trends-report/run",
    routeNote: "Cron-only endpoint (see vercel.json). Visiting this URL directly in a browser returns 401 -- there is no dashboard/inbox surface for this report today.",
    directlyNavigable: false,
    category: "software_analysis",
    classifications: ["operations", "predictive", "compliance"],
    periodicity: "daily",
  },

  // ── Custom / user-authored reports (custom-report-service.ts) ────────
  {
    id: "custom-report",
    name: "Custom Report",
    description: "User-authored saved query (whitelisted grouped-count) over compliance_items, notices, risks, pms_issues, incidents, or the 3 construction entity tables -- created and run from the Custom Reports section, rendered as a table/bar/pie/line chart.",
    domain: "custom",
    sourceService: "src/lib/services/custom-report-service.ts#runReport (savedReports table)",
    outputFormats: ["on-screen table", "on-screen chart (bar / pie / line)"],
    route: "/reports#custom-reports",
    routeNote: "Real live section (CustomReportsSection.tsx) on the main Reports & Analytics page. A specific saved report can be deep-linked at /reports?report=<id>#custom-reports.",
    directlyNavigable: true,
    category: "software_report",
    classifications: ["user_specific", "org_specific"],
    periodicity: "on_demand",
  },
]

export function getReportCatalogEntry(id: string): ReportCatalogEntry | undefined {
  return REPORT_CATALOG.find((e) => e.id === id)
}

export function listReportCatalogByDomain(): Record<ReportDomain, ReportCatalogEntry[]> {
  const byDomain: Record<ReportDomain, ReportCatalogEntry[]> = { compliance: [], ERP: [], construction: [], "AI-ops": [], custom: [] }
  for (const entry of REPORT_CATALOG) byDomain[entry.domain].push(entry)
  return byDomain
}

// Priority 11 (2026-07-13): the Reports & Analysis Engine's report_definitions
// table (report-engine-service.ts) is a second, DB-backed source of catalog
// entries -- new reports/analyses get ADDED there as data, not as new
// TypeScript in this file. This merges both sources into one list so every
// caller (ReportCatalogList.tsx, capability-tree-service.ts's Chain Selector
// wiring) sees the full picture without needing to know there are two
// sources. Static REPORT_CATALOG entries keep their real, already-verified
// routes; DB entries get a synthetic route pointing at the generic
// /reports/definitions/<id>/run engine endpoint (execution_type dependent --
// see report-engine-service.ts) since they don't have their own bespoke page.
export type FullCatalogEntry = ReportCatalogEntry & { source: "static" | "definition"; definitionId?: string; status?: "built" | "data_gap" | "planned" }

export async function getFullReportCatalog(ctx: { orgId: string }): Promise<FullCatalogEntry[]> {
  const staticEntries: FullCatalogEntry[] = REPORT_CATALOG.map((e) => ({ ...e, source: "static" }))

  const definitions = await withTenantContext({ orgId: ctx.orgId }, (db) =>
    db.query.reportDefinitions.findMany({
      where: (t, { and, eq, or, isNull }) => and(or(eq(t.orgId, ctx.orgId), isNull(t.orgId)), eq(t.isActive, true)),
      orderBy: (t, { desc }) => desc(t.createdAt),
    })
  )

  const definitionEntries: FullCatalogEntry[] = definitions.map((d) => {
    const classifications = Array.isArray(d.classifications) ? (d.classifications as string[]) : []
    const domain: ReportDomain = classifications.includes("compliance")
      ? "compliance"
      : classifications.includes("financial") || classifications.includes("revenue")
        ? "ERP"
        : classifications.includes("construction") || classifications.includes("project")
          ? "construction"
          : "custom"
    return {
      id: d.id,
      name: d.name,
      description: d.description,
      domain,
      sourceService: "src/lib/services/report-engine-service.ts#executeReportDefinition",
      outputFormats: Array.isArray(d.outputFormats) ? (d.outputFormats as string[]) : ["table"],
      route: `/api/reports/definitions/${d.id}/run`,
      routeNote: d.status === "built" ? "Real, auth-required API endpoint (POST) executed by the generic Reports & Analysis Engine dispatcher." : `Not yet built -- ${d.dataGapNote ?? "status: " + d.status}`,
      directlyNavigable: false,
      category: d.category as ReportCategory,
      classifications,
      periodicity: d.periodicity ?? undefined,
      source: "definition",
      definitionId: d.id,
      status: d.status as "built" | "data_gap" | "planned",
    }
  })

  return [...staticEntries, ...definitionEntries]
}

export async function getFullReportCatalogByDomain(ctx: { orgId: string }): Promise<Record<ReportDomain, FullCatalogEntry[]>> {
  const all = await getFullReportCatalog(ctx)
  const byDomain: Record<ReportDomain, FullCatalogEntry[]> = { compliance: [], ERP: [], construction: [], "AI-ops": [], custom: [] }
  for (const entry of all) byDomain[entry.domain].push(entry)
  return byDomain
}
