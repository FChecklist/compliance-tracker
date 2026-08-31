// Sales Pipeline Interactive Dashboard (2026-07-27, Owner mockup).
//
// Pure, no-DB-import aggregation layer -- same convention as
// crm-accounts-service.ts's wouldCreateCycle()/resolveAccountShippingAddress()
// (pure predicates tested without a live DB, see that file's test header).
// Everything here is a plain function over already-fetched data so it can be
// unit-tested AND re-run client-side on every cross-filter click with zero
// extra network round-trips.
//
// STAGE MAPPING (documented per this task's own SCOPE item 1): crmOpportunities
// .stage (schema.ts) is a free-text column with 5 real legacy values --
// 'prospecting' | 'proposal' | 'negotiation' | 'won' | 'lost' -- built for a
// CA/legal-firm CRM. None of the Owner mockup's 8 pipeline-status names
// (Awarded/Lost/Hold/Pitched/Lead/Regret/Estimation/Follow up) exist anywhere
// else in this codebase (confirmed by grep before this wave). Renaming the
// live enum/column would silently rewrite the meaning of every existing
// opportunity row and break crm/opportunities/page.tsx's kanban (which
// hardcodes those 5 values) -- explicitly out of scope per this task's own
// CONSTRAINTS ("do not modify existing CRM lead/opportunity creation flows").
// Instead: a normalization/mapping layer. The column has no CHECK/enum
// constraint, so a future opportunity can already have stage set directly to
// one of the 8 canonical names (e.g. via the existing PATCH endpoint) and it
// passes through unchanged here -- this is additive, not a migration.
export const PIPELINE_STATUSES = [
  "Awarded", "Lost", "Hold", "Pitched", "Lead", "Regret", "Estimation", "Follow up",
] as const

export type PipelineStatus = (typeof PIPELINE_STATUSES)[number]

const LEGACY_STAGE_MAP: Record<string, PipelineStatus> = {
  prospecting: "Lead",
  proposal: "Pitched",
  negotiation: "Follow up",
  won: "Awarded",
  lost: "Lost",
}

const CANONICAL_LOOKUP: Record<string, PipelineStatus> = Object.fromEntries(
  PIPELINE_STATUSES.map((s) => [s.toLowerCase().replace(/[\s_-]+/g, ""), s])
) as Record<string, PipelineStatus>

/** Maps any raw crmOpportunities.stage value to one of the 8 mockup statuses. */
export function normalizePipelineStatus(rawStage: string): PipelineStatus {
  const key = rawStage.toLowerCase().replace(/[\s_-]+/g, "")
  if (CANONICAL_LOOKUP[key]) return CANONICAL_LOOKUP[key]
  if (LEGACY_STAGE_MAP[rawStage.toLowerCase()]) return LEGACY_STAGE_MAP[rawStage.toLowerCase()]
  // Unknown future value: fold into "Lead" (the funnel's entry point) rather
  // than silently dropping the deal from every KPI/chart.
  return "Lead"
}

export type PipelineDeal = {
  id: string
  name: string
  salesperson: string
  value: number
  status: PipelineStatus
  rawStage: string
  month: string | null // 'YYYY-MM', derived from expectedCloseDate
  aiWinProbability: number | null
}

export type RawOpportunity = {
  id: string
  name: string
  ownerId: string | null
  estimatedValue: string | number | null
  stage: string
  expectedCloseDate: string | null
  aiWinProbability: number | null
}

/** Builds the dashboard's deal list from raw opportunity rows + an owner-id -> name lookup. */
export function buildPipelineDeals(
  opportunities: RawOpportunity[],
  ownerNameById: Record<string, string>
): PipelineDeal[] {
  return opportunities.map((o) => ({
    id: o.id,
    name: o.name,
    salesperson: (o.ownerId && ownerNameById[o.ownerId]) || "Unassigned",
    value: o.estimatedValue != null ? Number(o.estimatedValue) : 0,
    status: normalizePipelineStatus(o.stage),
    rawStage: o.stage,
    month: o.expectedCloseDate ? o.expectedCloseDate.slice(0, 7) : null,
    aiWinProbability: o.aiWinProbability,
  }))
}

export function filterByStatus(deals: PipelineDeal[], status: PipelineStatus | null): PipelineDeal[] {
  if (!status) return deals
  return deals.filter((d) => d.status === status)
}

export type PipelineKpis = {
  salesValue: number
  holdPct: number
  lostPct: number
  successPct: number
  healthPct: number | null
  regretPct: number
}

/**
 * KPI tiles. Per the Owner's confirmed drill-down screenshot, these always
 * compute over whatever `deals` subset is passed in -- global when no status
 * filter is active, single-status when one is (so e.g. filtering to
 * "Awarded" correctly shows Success % = 100%, Hold % = 0%, not the
 * unfiltered global rate).
 *
 * successPct reuses crm-service.ts's existing getSalesPipelineOverview
 * definition (won / (won + lost), i.e. Awarded / (Awarded + Lost)) rather
 * than inventing a new one -- that's the only pipeline-aggregate formula
 * already established in this codebase.
 *
 * healthPct has no existing pipeline-level definition anywhere in this
 * codebase (aiWinProbability is an opaque per-deal LLM score with no
 * aggregate formula -- see analyzeOpportunity() in crm-service.ts). Defined
 * here as the average aiWinProbability across open deals in the set (Hold/
 * Pitched/Lead/Follow up/Estimation -- excludes the terminal Awarded/Lost/
 * Regret outcomes, which no longer have a "probability of winning" to
 * report). Returns null (not 0) when no open deal in the set has been AI-
 * scored yet, so the UI can show "not yet scored" instead of a fabricated 0%.
 */
export function computeKpis(deals: PipelineDeal[]): PipelineKpis {
  const total = deals.length
  const count = (s: PipelineStatus) => deals.filter((d) => d.status === s).length
  const awarded = count("Awarded")
  const lost = count("Lost")
  const hold = count("Hold")
  const regret = count("Regret")

  const openStatuses: PipelineStatus[] = ["Hold", "Pitched", "Lead", "Follow up", "Estimation"]
  const openScored = deals.filter((d) => openStatuses.includes(d.status) && d.aiWinProbability != null)

  return {
    salesValue: deals.reduce((sum, d) => sum + d.value, 0),
    holdPct: total > 0 ? (hold / total) * 100 : 0,
    lostPct: total > 0 ? (lost / total) * 100 : 0,
    successPct: awarded + lost > 0 ? (awarded / (awarded + lost)) * 100 : 0,
    healthPct: openScored.length > 0
      ? openScored.reduce((sum, d) => sum + (d.aiWinProbability ?? 0), 0) / openScored.length
      : null,
    regretPct: total > 0 ? (regret / total) * 100 : 0,
  }
}

export type BarDatum = { label: string; value: number }

/** "Sales Lead Performance Overview" -- sum of deal value per salesperson. */
export function computeSalesLeadPerformance(deals: PipelineDeal[]): BarDatum[] {
  const byPerson = new Map<string, number>()
  for (const d of deals) byPerson.set(d.salesperson, (byPerson.get(d.salesperson) ?? 0) + d.value)
  return [...byPerson.entries()]
    .map(([label, value]) => ({ label, value }))
    .sort((a, b) => b.value - a.value)
}

/** "Pipeline Status Overview" -- count of deals per status, all 8 buckets always present. */
export function computePipelineStatusOverview(deals: PipelineDeal[]): BarDatum[] {
  const byStatus = new Map<PipelineStatus, number>(PIPELINE_STATUSES.map((s) => [s, 0]))
  for (const d of deals) byStatus.set(d.status, (byStatus.get(d.status) ?? 0) + 1)
  return PIPELINE_STATUSES.map((label) => ({ label, value: byStatus.get(label) ?? 0 }))
}

export type MonthlyTrendRow = { month: string; target: number; achieved: number; shortfall: number }

/**
 * "Monthly Revenue Trend Analysis". Achieved = sum of Awarded-deal value in
 * that month (bucketed by expectedCloseDate, the only date field an
 * opportunity carries -- there's no separate "actual close date"). Target
 * comes from the new crm_sales_targets table (genuinely new input, no
 * existing source -- see schema.ts comment). Shortfall = max(target -
 * achieved, 0), the standard definition -- never negative (a month that beat
 * its target has zero shortfall, not a negative one).
 */
export function computeMonthlyTrend(
  deals: PipelineDeal[],
  targets: { month: string; targetValue: number }[]
): MonthlyTrendRow[] {
  const achievedByMonth = new Map<string, number>()
  for (const d of deals) {
    if (d.status !== "Awarded" || !d.month) continue
    achievedByMonth.set(d.month, (achievedByMonth.get(d.month) ?? 0) + d.value)
  }
  const targetByMonth = new Map(targets.map((t) => [t.month, t.targetValue]))

  const months = [...new Set([...achievedByMonth.keys(), ...targetByMonth.keys()])].sort()
  return months.map((month) => {
    const target = targetByMonth.get(month) ?? 0
    const achieved = achievedByMonth.get(month) ?? 0
    return { month, target, achieved, shortfall: Math.max(target - achieved, 0) }
  })
}

export type MonthlyTrendTable = {
  rows: { label: "Target" | "Achieved" | "Shortfall"; byMonth: number[]; total: number }[]
  months: string[]
}

/** Same 3 series as computeMonthlyTrend, reshaped into the KPI table's row-per-series + Total column. */
export function computeMonthlyTrendTable(trend: MonthlyTrendRow[]): MonthlyTrendTable {
  const months = trend.map((t) => t.month)
  const targetRow = trend.map((t) => t.target)
  const achievedRow = trend.map((t) => t.achieved)
  const shortfallRow = trend.map((t) => t.shortfall)
  const sum = (arr: number[]) => arr.reduce((a, b) => a + b, 0)
  return {
    months,
    rows: [
      { label: "Target", byMonth: targetRow, total: sum(targetRow) },
      { label: "Achieved", byMonth: achievedRow, total: sum(achievedRow) },
      { label: "Shortfall", byMonth: shortfallRow, total: sum(shortfallRow) },
    ],
  }
}
