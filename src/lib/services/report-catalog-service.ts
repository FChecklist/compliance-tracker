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

// "CRM" added 2026-08-07 (Sales Pipeline gap-closure, "Reporting & Export
// Accuracy" finding): getSalesPipelineOverview() (crm-service.ts) was
// computed but had no catalog entry at all -- classifications already had
// a "sales" value (report-taxonomy.ts) with zero real entries using it.
// Gated to the 'sales' product branch, not 'ERP' -- see
// report-domain-enablement-service.ts's REPORT_DOMAIN_BRANCH_GATE; CRM/
// Sales is its own purchasable branch (crm-enablement-service.ts), not part
// of ERP, so mislabeling this "ERP" would gate it against the wrong module.
export type ReportDomain = "compliance" | "ERP" | "construction" | "AI-ops" | "custom" | "CRM"

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
  { id: "construction-designer-timesheet", name: "Designer Timesheet Report", description: "PMS time-entry hours summed by user, plus Budget-vs-Actual broken down by category, designer, project, and designer status.", classifications: ["resource", "project", "financial"] },
  { id: "construction-kpi", name: "KPI Report", description: "Approved KPI entries for the project's KPI definitions.", classifications: ["project", "executive", "construction"] },
  { id: "construction-revenue", name: "Revenue Report", description: "Non-cancelled sales invoices for the project, with total value.", classifications: ["financial", "revenue", "sales", "construction"] },
  { id: "construction-expense", name: "Expense Report", description: "Expense entries for the project, summarized by expense head.", classifications: ["financial", "construction"] },
  { id: "construction-category-progress", name: "Category Progress Report", description: "Latest % complete averaged per activity category.", classifications: ["project", "construction"] },
  { id: "construction-project-completion", name: "Project Completion Report", description: "Overall completion % (from the project dashboard) plus a per-category breakdown.", classifications: ["project", "executive", "construction"] },
  { id: "construction-certified-payroll", name: "Certified Payroll Report", description: "US WH-347-shaped weekly per-worker breakdown for public-works projects: hours by day, trade classification, rate paid vs. the project's prevailing-wage determination, gross wages, and a compliance statement flagging shortfalls (deductions and fringe-benefits-paid are honestly not tracked for this site-labour workforce).", classifications: ["hr", "financial", "compliance", "construction"] },
]

const CONSTRUCTION_ROUTE_NOTE = "Real, auth-required API endpoint (GET /api/construction/reports/<reportName>?projectId=<id>, also aliased at /api/v1/projexa/reports/<reportName> for API-key callers) -- returns real DB-backed JSON. No dedicated UI page renders it yet, so there is nothing to navigate straight to without already knowing a projectId (and, for weekly-project and certified-payroll, a weekStart)."

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

  // FI-AR-004 (SAP gap-analysis "Dunning List", HIGH priority, 2026-07-30):
  // real overdue-customer-invoice list grouped by aging bucket, with each
  // row's real dunningLevel/lastDunningSentAt (new erp_sales_invoices
  // columns, see schema.ts) and a suggestedDunningLevel derived from its
  // bucket. No dedicated UI page yet -- API-only, same honest "no
  // dashboard surface" caveat as the construction/AI-ops entries below.
  // (Note: its sibling AR Aging report -- erp-invoicing-service.ts's
  // arAgingReport, exposed at /api/v1/projexa/ar-aging -- has the exact
  // same catalog gap: real, working, but never added to this list before
  // this wave. Left as-is here since fixing that is outside FI-AR-004's
  // scope, but flagged honestly rather than silently worked around.)
  {
    id: "erp-dunning-list",
    name: "Dunning List",
    description: "Every overdue, non-fully-paid customer invoice grouped by aging bucket (1-30/31-60/61-90/90+ days overdue), with its real dunning level (Friendly Reminder/Formal Notice/Final Demand) and a suggested next level to drive collections follow-up.",
    domain: "ERP",
    sourceService: "src/lib/services/erp-invoicing-service.ts#dunningList",
    outputFormats: ["JSON (API only, no dedicated UI page yet: GET /api/v1/projexa/dunning-list)"],
    route: "/api/v1/projexa/dunning-list",
    routeNote: "Real, auth-required API endpoint -- returns real DB-backed JSON. No dedicated UI page renders it yet.",
    directlyNavigable: false,
    category: "software_report",
    classifications: ["financial", "revenue", "customer"],
    periodicity: "on_demand",
  },

  // FI-AP-007 (SAP gap-analysis "Subcontractor Retention Summary", HIGH
  // priority, 2026-07-30): per-subcontractor retention withheld/released/
  // still-held, computed from real erp_purchase_invoices.retentionAmount/
  // retentionReleasedAmount (new columns, see schema.ts). No dedicated UI
  // page yet -- API-only, same honest "no dashboard surface" caveat as the
  // FI-AR-004 entry immediately above this wave's sibling PRs and the
  // construction/AI-ops entries below.
  {
    id: "erp-subcontractor-retention-summary",
    name: "Subcontractor Retention Summary",
    description: "Per-subcontractor summary of retention withheld from bills to date, how much has been released, and how much remains held -- the review worklist before releasing retention at practical completion or after the defects-liability period. Groups by subcontractor (supplier); no subcontractor-contract table exists in this schema to group by contract instead.",
    domain: "ERP",
    sourceService: "src/lib/services/erp-invoicing-service.ts#subcontractorRetentionSummary",
    outputFormats: ["JSON (API only, no dedicated UI page yet: GET /api/v1/projexa/subcontractor-retention-summary)"],
    route: "/api/v1/projexa/subcontractor-retention-summary",
    routeNote: "Real, auth-required API endpoint -- returns real DB-backed JSON. No dedicated UI page renders it yet.",
    directlyNavigable: false,
    category: "software_report",
    classifications: ["financial", "procurement", "construction"],
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

  // ── Sales / CRM reports (crm-service.ts) ──────────────────────────────
  // Sales Pipeline gap-closure (2026-08-07): getSalesPipelineOverview() was
  // already fully implemented (leadsByStatus, opportunitiesByStage,
  // winRate, openPipelineValue) with a real in-app consumer as of this
  // wave -- the Pipeline tab on /crm. Previously only reachable via the
  // /api/v1/projexa/sales-pipeline external-API alias, with zero catalog
  // entry and zero UI page.
  {
    id: "sales-pipeline-overview",
    name: "Sales Pipeline Overview",
    description: "Lead funnel by status, opportunity funnel by stage (count + base-currency value), win rate, open pipeline value, and overdue follow-up counts.",
    domain: "CRM",
    sourceService: "src/lib/services/crm-service.ts#getSalesPipelineOverview",
    outputFormats: ["on-screen Kanban + summary cards (JSON API: GET /api/v1/projexa/sales-pipeline)", "CSV (GET /api/crm/pipeline/export)"],
    route: "/crm",
    routeNote: "Real live page -- 'Pipeline' tab. No required query params.",
    directlyNavigable: true,
    category: "software_report",
    classifications: ["sales", "org_specific"],
    periodicity: "on_demand",
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

  // FI-AP-008 (SAP gap-analysis "Subcontractor Payment Application Status",
  // HIGH priority): worklist of every subcontractor payment application --
  // a real erp_payment_entries pay/supplier row linked to a purchase
  // invoice, already carrying a genuine draft -> submitted ->
  // approved/rejected workflow with real submittedAt/decidedAt timestamps
  // (Wave B, VERIDIAN Review Framework) -- plus subcontractor invoices with
  // no payment application started yet. No dedicated UI page yet --
  // API-only, same honest "no dashboard surface" caveat as this file's
  // other entries. Appended at the end of this array (not inserted near
  // the FI-AR-004/FI-AP-007 entries above) to avoid a real merge-conflict
  // collision with those still-open sibling PRs editing the same region.
  {
    id: "erp-subcontractor-payment-application-status",
    name: "Subcontractor Payment Application Status",
    description: "Every subcontractor payment application with its real current status, submission date, amount, and days-in-current-status aging -- a worklist for whoever manages subcontractor payments.",
    domain: "ERP",
    sourceService: "src/lib/services/erp-payment-entries-service.ts#subcontractorPaymentApplicationStatus",
    outputFormats: ["JSON (API only, no dedicated UI page yet: GET /api/v1/projexa/subcontractor-payment-application-status)"],
    route: "/api/v1/projexa/subcontractor-payment-application-status",
    routeNote: "Real, auth-required API endpoint -- returns real DB-backed JSON. No dedicated UI page renders it yet.",
    directlyNavigable: false,
    category: "software_report",
    classifications: ["financial", "procurement", "construction"],
    periodicity: "on_demand",
  },

  // FI-AA-006 (SAP gap-analysis "Asset-to-GL Reconciliation", MEDIUM
  // priority): per asset-category comparison of the fixed-asset sub-ledger's
  // aggregate gross cost / accumulated depreciation / net book value
  // against the real posted GL balance of that category's own mapped Asset
  // Account / Accumulated Depreciation Account. A real, independently-found
  // GL-posting bug (fixed in this same PR, see erp-fixed-assets-service.ts's
  // own header comment) meant every fixed-asset journal entry ever created
  // sat permanently in draft, invisible to any GL balance query -- fixed at
  // the root rather than papered over here. No dedicated UI page yet --
  // API-only, same honest "no dashboard surface" caveat this file's other
  // recent entries (FI-AR-004/FI-AP-005/FI-AP-007/FI-AP-008) already
  // disclose. Appended at the end of this array (not inserted near other
  // FI-* entries above) to avoid a real merge-conflict collision with those
  // still-open sibling PRs editing the same region.
  {
    id: "erp-asset-to-gl-reconciliation",
    name: "Asset-to-GL Reconciliation",
    description: "Per asset-category comparison of the fixed-asset sub-ledger's gross cost / accumulated depreciation / net book value against the real posted balance of that category's mapped GL accounts -- a month-end control flagging any variance for investigation.",
    domain: "ERP",
    sourceService: "src/lib/services/erp-fixed-assets-service.ts#assetToGlReconciliation",
    outputFormats: ["JSON (API only, no dedicated UI page yet: GET /api/v1/projexa/asset-to-gl-reconciliation)"],
    route: "/api/v1/projexa/asset-to-gl-reconciliation",
    routeNote: "Real, auth-required API endpoint -- returns real DB-backed JSON. No dedicated UI page renders it yet.",
    directlyNavigable: false,
    category: "software_report",
    classifications: ["financial", "construction"],
    periodicity: "on_demand",
  },

  // FI-AP-006 (SAP gap-analysis "Vendor Payment History / Payment Behavior
  // Analysis", MEDIUM priority, BUILD_NEW): per-supplier real average
  // days-to-pay, DPO (Days Payable Outstanding), and a fixed
  // payment-reliability classification. category='software_analysis'
  // (CATEGORY 2, a calculated ratio -- same as SPI/CPI) rather than
  // 'software_report', matching how the identically-shaped AR-side sibling
  // (FI-AR-006 Customer Payment Behavior / DSO, a separate still-open PR
  // as of this writing) would be classified. No dedicated UI page yet --
  // API-only, same honest "no dashboard surface" caveat this file's other
  // recent entries (FI-AR-004/FI-AP-005/FI-AP-007/FI-AP-008/FI-AA-006)
  // already disclose. Appended at the end of this array (not inserted near
  // other FI-* entries above) to avoid a real merge-conflict collision with
  // those still-open sibling PRs editing the same region.
  {
    id: "erp-vendor-payment-behavior",
    name: "Vendor Payment History / Payment Behavior Analysis",
    description: "Per-supplier historical payment-behavior metric across all their invoices: real average days-to-pay for invoices with a discoverable payment-completion date, the industry-standard DPO (Days Payable Outstanding) formula, and a fixed payment-reliability classification (consistently_early/on_time/late/chronically_late) against the supplier's real agreed terms. SAP FBL1N/DPO-analysis equivalent.",
    domain: "ERP",
    sourceService: "src/lib/services/erp-invoicing-service.ts#vendorPaymentBehaviorReport",
    outputFormats: ["JSON (API only, no dedicated UI page yet: GET /api/v1/projexa/vendor-payment-behavior)"],
    route: "/api/v1/projexa/vendor-payment-behavior",
    routeNote: "Real, auth-required API endpoint -- returns real DB-backed JSON. No dedicated UI page renders it yet.",
    directlyNavigable: false,
    category: "software_analysis",
    classifications: ["financial", "procurement", "construction"],
    periodicity: "on_demand",
  },

  // CO-001/CO-003/FI-GL-002/FI-GL-007/FI-GL-008 (SAP gap-analysis
  // calculation-track engines, sap_mapping.sqlite/sap_reports): 4
  // EXTEND_EXISTING GL/cost-center reports + 1 BUILD_NEW reconciliation
  // report. No dedicated UI page yet for any of the 5 -- API-only, same
  // honest "no dashboard surface" caveat this wave's other recent entries
  // already disclose. Appended at the end of this array (not inserted near
  // other FI-*/CO-* entries above) to avoid a real merge-conflict collision
  // with those still-open sibling PRs editing the same region.
  {
    id: "erp-cost-center-line-items",
    name: "Cost Center Line Item Display",
    description: "Every posted journal-entry line that carries a cost center, showing both the GL account and the cost center on one row -- SAP KSB1 equivalent.",
    domain: "ERP",
    sourceService: "src/lib/services/erp-accounting-service.ts#listJournalEntryLinesByCostCenter",
    outputFormats: ["JSON (API only, no dedicated UI page yet: GET /api/v1/projexa/cost-center-line-items)"],
    route: "/api/v1/projexa/cost-center-line-items",
    routeNote: "Real, auth-required API endpoint -- returns real DB-backed JSON. No dedicated UI page renders it yet.",
    directlyNavigable: false,
    category: "software_report",
    classifications: ["financial", "org_specific"],
    periodicity: "on_demand",
  },
  {
    id: "erp-cost-center-hierarchy",
    name: "Cost Center Hierarchy Report",
    description: "Overhead spending (expense-account postings tagged with a cost center) rolled up through the real cost-center parent/child tree.",
    domain: "ERP",
    sourceService: "src/lib/services/erp-accounting-service.ts#costCenterHierarchyReport",
    outputFormats: ["JSON (API only, no dedicated UI page yet: GET /api/v1/projexa/cost-center-hierarchy)"],
    route: "/api/v1/projexa/cost-center-hierarchy",
    routeNote: "Real, auth-required API endpoint -- returns real DB-backed JSON. No dedicated UI page renders it yet.",
    directlyNavigable: false,
    category: "software_report",
    classifications: ["financial", "org_specific"],
    periodicity: "on_demand",
  },
  {
    id: "erp-gl-account-balance-display",
    name: "G/L Account Balances Display",
    description: "Per selected GL account: opening balance, period debit/credit movement, and closing balance over a date range -- SAP FS10N equivalent, a direct filter of Trial Balance's existing output.",
    domain: "ERP",
    sourceService: "src/lib/services/erp-financial-report-service.ts#glAccountBalanceDisplay",
    outputFormats: ["on-screen table (JSON API: GET /api/erp/reports/gl-account-balance-display)"],
    route: "/api/erp/reports/gl-account-balance-display",
    routeNote: "Real, auth-required API endpoint -- returns real DB-backed JSON. Requires at least one accountId query param. No dedicated UI page renders it yet.",
    directlyNavigable: false,
    category: "software_report",
    classifications: ["financial", "org_specific"],
    periodicity: "on_demand",
  },
  {
    id: "erp-gl-account-group-balances",
    name: "G/L Account Group Balances Summary",
    description: "Trial Balance's per-account closing balances rolled up through the real chart-of-accounts group hierarchy, as of a date.",
    domain: "ERP",
    sourceService: "src/lib/services/erp-financial-report-service.ts#glAccountGroupBalancesSummary",
    outputFormats: ["on-screen table (JSON API: GET /api/erp/reports/gl-account-group-balances)"],
    route: "/api/erp/reports/gl-account-group-balances",
    routeNote: "Real, auth-required API endpoint -- returns real DB-backed JSON. No dedicated UI page renders it yet.",
    directlyNavigable: false,
    category: "software_report",
    classifications: ["financial", "org_specific"],
    periodicity: "on_demand",
  },
  {
    id: "erp-subledger-gl-reconciliation",
    name: "Subledger-to-GL Reconciliation",
    description: "Month-end close control comparing each real subledger's own total outstanding balance (AR/AP) against its corresponding GL control-account balance from the Trial Balance -- a non-zero variance flags a real problem before the books are considered reliable. Fixed-asset reconciliation is a separate report (Asset-to-GL Reconciliation); inventory/stock is not included because stock movements do not yet post to the GL in this codebase.",
    domain: "ERP",
    sourceService: "src/lib/services/erp-financial-report-service.ts#subledgerToGlReconciliation",
    outputFormats: ["on-screen table (JSON API: GET /api/erp/reports/subledger-gl-reconciliation)"],
    route: "/api/erp/reports/subledger-gl-reconciliation",
    routeNote: "Real, auth-required API endpoint -- returns real DB-backed JSON. No dedicated UI page renders it yet.",
    directlyNavigable: false,
    category: "software_report",
    classifications: ["financial", "org_specific"],
    periodicity: "on_demand",
  },
]

export function getReportCatalogEntry(id: string): ReportCatalogEntry | undefined {
  return REPORT_CATALOG.find((e) => e.id === id)
}

export function listReportCatalogByDomain(): Record<ReportDomain, ReportCatalogEntry[]> {
  const byDomain: Record<ReportDomain, ReportCatalogEntry[]> = { compliance: [], ERP: [], construction: [], "AI-ops": [], custom: [], CRM: [] }
  for (const entry of REPORT_CATALOG) byDomain[entry.domain].push(entry)
  return byDomain
}

// Priority 11 (2026-07-13): the DB-backed merge with report_definitions
// (report-engine-service.ts) deliberately does NOT live in this file --
// this file's own header states it is a "DATA-ONLY registry" with no DB
// access, and it's imported by ReportCatalogList.tsx, a CLIENT component
// (`"use client"`). Adding a withTenantContext()/db-touching function here
// once broke the production build: Next.js's client bundler pulled the
// `postgres` driver (which needs Node's `tls`/`perf_hooks`, absent in the
// browser) into the client JS bundle via this file. The merge function
// (getFullReportCatalog/getFullReportCatalogByDomain) lives in
// report-engine-service.ts instead -- an already server-only file (it
// already imports `db`/LLM clients), consumed only by server code
// (capability-tree-service.ts, API routes), never by a client component.
