// GAP-D19-REPORT-CADENCES (tree4-unified U-D19.B1.S1, same requirement
// ai-performance-report-service.ts's daily report answers): that report's
// own header honestly flagged Escalations/Recommendations/Risk-Trends as
// NOT covered at the time it was built, because none of them had an
// obvious, already-aggregated source table. Re-investigating (this wave)
// found that all 3 dimensions DO have a genuine, deterministic, already-
// written source once you look one level deeper than "is there a table
// literally named for this" -- none of the 3 below invents a number or
// calls an LLM to grade/summarize anything:
//
//   - Escalations: every nextEscalationRung() call site in
//     task-execution-engine.ts (confirmed by reading all 4 of them) writes
//     a taskChatMessages row with role='system' and a content string ending
//     in the fixed suffix " -- escalated to {title} ({authority})." -- this
//     IS a real escalation-event log, just an unstructured one. Deterministic
//     regex extraction over an already-deterministically-generated string is
//     not "inventing data" (no LLM involved, nothing is guessed) -- it's the
//     same class of parsing this codebase already does elsewhere (e.g.
//     gst/column-mapper.ts parsing dates out of free text). Messages that
//     don't match the fixed suffix are silently excluded, never counted as
//     zero or guessed at.
//   - Recommendations: loop_improvements rows ARE recommendations in the
//     literal sense -- each row is a proposed change (beforeState/
//     afterState) the CLEE loop generated, independent of whether it was
//     ever deployed. ai-performance-report-service.ts's "learning" section
//     already reports outcome counts (generated/deployed/rolled-back) off
//     this same table -- that is NOT a reason to skip this report, it's a
//     different, non-duplicative slice: the open queue of undecided
//     recommendations (not yet deployed, not rolled back) plus a breakdown
//     by improvementType/targetType, which "learning" does not surface.
//   - Risk-Trends: activity_log.riskLevel (schema.ts) is written for real
//     by POST /api/ai/team/dispatch (route.ts's classifyRisk() call),
//     alongside createdAt -- a genuine time-series of risk classifications
//     over real dispatches. risk-classification.ts's classifyRisk() itself
//     is pure/deterministic (no LLM), so every riskLevel value aggregated
//     here traces back to a rule, not a guess. (riskLevel is only persisted
//     on rows where requiresAudit was true -- see that route -- so this is
//     honestly "trend among audited dispatches," not "every dispatch";
//     documented on the return type below, not hidden.)
//
// Same pattern as ai-performance-report-service.ts throughout: pure
// assembly/aggregation functions (unit-tested) + a thin async DB-reading
// wrapper (not unit-tested, matches this file's own test file and
// task-service.test.ts's documented convention). Same cadence posture too --
// only "daily" is wired to a cron entry (see the 3 new /api/internal/*/run
// routes + vercel.json); every function still takes an arbitrary `days`
// window, so a different cadence is a second cron entry later, not new code.
import { db, taskChatMessages, loopImprovements, activityLog } from "@/lib/db"
import { and, eq, gte, isNotNull } from "drizzle-orm"

// ─── Escalations ────────────────────────────────────────────────────────

export type EscalationEvent = { title: string; authority: string }

const ESCALATION_SUFFIX_RE = / -- escalated to (.+?) \((.+?)\)\.$/

/**
 * Pure: extracts {title, authority} from a taskChatMessages.content string,
 * or null when the string doesn't match the fixed suffix every
 * nextEscalationRung() call site in task-execution-engine.ts writes. Never
 * throws -- an unparseable system message is just not an escalation event.
 */
export function parseEscalationEvent(content: string): EscalationEvent | null {
  const match = ESCALATION_SUFFIX_RE.exec(content)
  if (!match) return null
  return { title: match[1], authority: match[2] }
}

/** Pure: groups parsed escalation events by rung title, e.g. "Chief Software Engineering Officer (CSEO)" -> 4. */
export function summarizeEscalationsByRung(events: EscalationEvent[]): Record<string, number> {
  const counts: Record<string, number> = {}
  for (const event of events) counts[event.title] = (counts[event.title] ?? 0) + 1
  return counts
}

export type EscalationsReport = {
  cadence: "daily"
  periodStart: string
  periodEnd: string
  totalEscalations: number
  byRung: Record<string, number>
  /** How this report's events were sourced -- see this file's header for why regex extraction over a deterministically-written string is not fabricated data. */
  sourceNote: string
}

/** Real DB read: every system-role taskChatMessages row in the period, parsed for the fixed escalation suffix. */
export async function generateEscalationsReport(days = 1): Promise<EscalationsReport> {
  const periodEndDate = new Date()
  const periodStartDate = new Date(periodEndDate.getTime() - days * 86_400_000)

  const rows = await db
    .select({ content: taskChatMessages.content })
    .from(taskChatMessages)
    .where(and(eq(taskChatMessages.role, "system"), gte(taskChatMessages.createdAt, periodStartDate)))

  const events = rows.map((r) => parseEscalationEvent(r.content)).filter((e): e is EscalationEvent => e !== null)

  return {
    cadence: "daily",
    periodStart: periodStartDate.toISOString(),
    periodEnd: periodEndDate.toISOString(),
    totalEscalations: events.length,
    byRung: summarizeEscalationsByRung(events),
    sourceNote: "Parsed from task_chat_messages system rows written by escalation-ladder.ts's nextEscalationRung() call sites in task-execution-engine.ts -- real events, not a persisted structured events table (none exists yet).",
  }
}

// ─── Recommendations ────────────────────────────────────────────────────

export type LoopImprovementRow = {
  id: string
  loopId: string
  improvementType: string
  targetType: string
  targetId: string | null
  isDeployed: boolean
  rollbackTriggered: boolean
}

/** Pure: groups rows by improvementType, e.g. "prompt_tuning" -> 3. */
export function summarizeRecommendationsByType(rows: LoopImprovementRow[]): Record<string, number> {
  const counts: Record<string, number> = {}
  for (const row of rows) counts[row.improvementType] = (counts[row.improvementType] ?? 0) + 1
  return counts
}

/** Pure: groups rows by targetType, e.g. "worker_agent" -> 5. */
export function summarizeRecommendationsByTarget(rows: LoopImprovementRow[]): Record<string, number> {
  const counts: Record<string, number> = {}
  for (const row of rows) counts[row.targetType] = (counts[row.targetType] ?? 0) + 1
  return counts
}

/** Pure: the open queue -- proposed changes neither deployed nor rolled back yet, i.e. still awaiting a decision. */
export function selectOpenRecommendations(rows: LoopImprovementRow[]): LoopImprovementRow[] {
  return rows.filter((row) => !row.isDeployed && !row.rollbackTriggered)
}

export type RecommendationsReport = {
  cadence: "daily"
  periodStart: string
  periodEnd: string
  totalRecommendations: number
  byImprovementType: Record<string, number>
  byTargetType: Record<string, number>
  openRecommendations: LoopImprovementRow[]
  sourceNote: string
}

/** Real DB read: loop_improvements rows in the period -- the same table ai-performance-report-service.ts's "learning" section reads, aggregated a different (non-duplicative) way: what is currently being recommended, not just outcome counts. */
export async function generateRecommendationsReport(days = 1): Promise<RecommendationsReport> {
  const periodEndDate = new Date()
  const periodStartDate = new Date(periodEndDate.getTime() - days * 86_400_000)

  const rows = await db.query.loopImprovements.findMany({
    where: gte(loopImprovements.createdAt, periodStartDate),
    columns: { id: true, loopId: true, improvementType: true, targetType: true, targetId: true, isDeployed: true, rollbackTriggered: true },
  })

  return {
    cadence: "daily",
    periodStart: periodStartDate.toISOString(),
    periodEnd: periodEndDate.toISOString(),
    totalRecommendations: rows.length,
    byImprovementType: summarizeRecommendationsByType(rows),
    byTargetType: summarizeRecommendationsByTarget(rows),
    openRecommendations: selectOpenRecommendations(rows),
    sourceNote: "Sourced from loop_improvements (the same real, populated table ai-performance-report-service.ts's learning section reads) -- each row is a real proposed change (beforeState/afterState) the CLEE loop generated, not an LLM-summarized recommendation.",
  }
}

// ─── Risk-Trends ────────────────────────────────────────────────────────

export type RiskLevel = "low" | "medium" | "high" | "critical"

const RISK_LEVELS: readonly RiskLevel[] = ["low", "medium", "high", "critical"]

export type RiskEventRow = { riskLevel: string | null; createdAt: Date }

export type RiskTrendPoint = { date: string; counts: Record<RiskLevel, number>; total: number }

/** Pure: buckets rows by calendar day (UTC, YYYY-MM-DD) and riskLevel, dropping null riskLevel rows (a dispatch that never required audit has no riskLevel written -- excluded, not counted as "low"). Days are returned sorted ascending, so callers get an actual chronological trend, not an unordered map. */
export function buildRiskTrendSeries(rows: RiskEventRow[]): RiskTrendPoint[] {
  const byDate = new Map<string, Record<RiskLevel, number>>()
  for (const row of rows) {
    if (row.riskLevel === null || !RISK_LEVELS.includes(row.riskLevel as RiskLevel)) continue
    const date = row.createdAt.toISOString().slice(0, 10)
    if (!byDate.has(date)) byDate.set(date, { low: 0, medium: 0, high: 0, critical: 0 })
    const bucket = byDate.get(date)!
    bucket[row.riskLevel as RiskLevel] += 1
  }
  return [...byDate.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, counts]) => ({ date, counts, total: RISK_LEVELS.reduce((sum, level) => sum + counts[level], 0) }))
}

/** Pure: overall counts by risk level across the whole period, independent of day-bucketing -- the "how bad is it right now" headline number a trend series alone doesn't give you at a glance. */
export function summarizeRiskTotals(rows: RiskEventRow[]): Record<RiskLevel, number> {
  const counts: Record<RiskLevel, number> = { low: 0, medium: 0, high: 0, critical: 0 }
  for (const row of rows) {
    if (row.riskLevel === null || !RISK_LEVELS.includes(row.riskLevel as RiskLevel)) continue
    counts[row.riskLevel as RiskLevel] += 1
  }
  return counts
}

export type RiskTrendsReport = {
  cadence: "daily"
  periodStart: string
  periodEnd: string
  totals: Record<RiskLevel, number>
  series: RiskTrendPoint[]
  sourceNote: string
}

/** Real DB read: activity_log rows with a non-null riskLevel (risk-classification.ts's classifyRisk() output, persisted by POST /api/ai/team/dispatch) in the period. Default window is 7 days, not 1 -- a single day rarely shows a "trend"; the cron still runs this daily, it just always looks back a week. */
export async function generateRiskTrendsReport(days = 7): Promise<RiskTrendsReport> {
  const periodEndDate = new Date()
  const periodStartDate = new Date(periodEndDate.getTime() - days * 86_400_000)

  const rows = await db
    .select({ riskLevel: activityLog.riskLevel, createdAt: activityLog.createdAt })
    .from(activityLog)
    .where(and(isNotNull(activityLog.riskLevel), gte(activityLog.createdAt, periodStartDate)))

  return {
    cadence: "daily",
    periodStart: periodStartDate.toISOString(),
    periodEnd: periodEndDate.toISOString(),
    totals: summarizeRiskTotals(rows),
    series: buildRiskTrendSeries(rows),
    sourceNote: "Sourced from activity_log.riskLevel (risk-classification.ts's deterministic classifyRisk(), persisted by POST /api/ai/team/dispatch) -- only rows where a dispatch required audit have a riskLevel written, so this is a trend among audited dispatches, not every dispatch.",
  }
}
