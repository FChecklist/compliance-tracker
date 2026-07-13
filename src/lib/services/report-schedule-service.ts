// Owner directive 2026-07-13: reports should be schedulable (daily/weekly/
// monthly, user/org-definable), wired to a real execution+delivery path --
// not just the 3 hardcoded-daily crons report-cadence-service.ts already
// has (generateEscalationsReport/generateRecommendationsReport/
// generateRiskTrendsReport, each a literal `cadence: "daily"` type).
//
// Delivery deliberately does NOT extend those 3 reports' own
// /api/internal/*/run pattern -- read literally, each of those routes'
// own header honestly discloses "No persistence layer... this computes and
// returns the report, there is no dashboard/inbox surface to read it from
// later." There is nothing there to "extend" as a delivery mechanism; it
// is a compute-and-return-JSON-to-a-cron-caller pattern with no recipient
// concept at all. The real, already-firing delivery mechanism in this same
// scheduled-report/cron ecosystem is metric-alert-service.ts's
// evaluateAllMetricAlertRules() (Wave 38): `db.insert(notifications)`,
// itself Wave 14's existing notifications-table convention. That is what
// runDueReportSchedules() below reuses verbatim -- not a new email/Slack/
// webhook system.
//
// reportId is a plain free-text identifier (see schema.ts's own comment on
// report_schedules.report_id) -- for the 3 keys report-cadence-service.ts
// already knows how to generate ('escalations' | 'recommendations' |
// 'risk_trends') the real report body is generated and attached to the
// notification; for any other reportId (e.g. a savedReports.id, or an id
// from a report-catalog table a separate agent may add independently) this
// still delivers a real "your scheduled report is due" notification --
// it just honestly can't attach generated content for a report type it
// doesn't know how to compute yet, and says so in the message rather than
// fabricating a number.
import { db, reportSchedules, notifications } from "@/lib/db"
import { withTenantContext } from "@/lib/db/tenant-scoped"
import { and, eq } from "drizzle-orm"
import { generateEscalationsReport, generateRecommendationsReport, generateRiskTrendsReport } from "./report-cadence-service"
import { ServiceError } from "./compliance-service"
export { ServiceError }

export const REPORT_CADENCES = ["daily", "weekly", "monthly"] as const
export type ReportCadence = (typeof REPORT_CADENCES)[number]

export type CreateReportScheduleInput = {
  reportId: string
  cadence: ReportCadence
  dayOfWeek?: number | null
  dayOfMonth?: number | null
  recipientUserIds: string[]
}

// ─── Pure validation/decision logic (unit-testable without a DB) ──────────

/** Same validate-then-throw shape as delegation-service.ts's validateDelegationInput. */
export function validateReportScheduleInput(
  input: Pick<CreateReportScheduleInput, "reportId" | "cadence" | "dayOfWeek" | "dayOfMonth" | "recipientUserIds">
): { valid: true } | { valid: false; reason: string } {
  if (!input.reportId?.trim()) return { valid: false, reason: "reportId is required" }
  if (!REPORT_CADENCES.includes(input.cadence)) return { valid: false, reason: `cadence must be one of: ${REPORT_CADENCES.join(", ")}` }
  if (input.cadence === "weekly" && (input.dayOfWeek == null || input.dayOfWeek < 0 || input.dayOfWeek > 6)) {
    return { valid: false, reason: "dayOfWeek (0=Sunday .. 6=Saturday) is required for a weekly cadence" }
  }
  if (input.cadence === "monthly" && (input.dayOfMonth == null || input.dayOfMonth < 1 || input.dayOfMonth > 31)) {
    return { valid: false, reason: "dayOfMonth (1-31) is required for a monthly cadence" }
  }
  if (!input.recipientUserIds?.length) return { valid: false, reason: "recipientUserIds must have at least one user" }
  return { valid: true }
}

/**
 * Pure: is this already-fetched schedule row due on `date` (defaults to
 * now, UTC)? Monthly dayOfMonth is clamped to the real last day of shorter
 * months (e.g. 31 fires on Feb 28/29), matching how a person actually means
 * "the last day of the month" when they pick day 31 -- not silently
 * skipping the month entirely.
 */
export function isScheduleDue(schedule: { cadence: string; dayOfWeek: number | null; dayOfMonth: number | null }, date: Date = new Date()): boolean {
  if (schedule.cadence === "daily") return true
  if (schedule.cadence === "weekly") return schedule.dayOfWeek != null && date.getUTCDay() === schedule.dayOfWeek
  if (schedule.cadence === "monthly") {
    if (schedule.dayOfMonth == null) return false
    const lastDayOfMonth = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0)).getUTCDate()
    const effectiveDay = Math.min(schedule.dayOfMonth, lastDayOfMonth)
    return date.getUTCDate() === effectiveDay
  }
  return false
}

// ─── DB-touching, org-scoped CRUD (withTenantContext + ctx.orgId, matching
// custom-report-service.ts / metric-alert-service.ts exactly) ────────────

export async function listReportSchedules(ctx: { orgId: string }) {
  return withTenantContext({ orgId: ctx.orgId }, (db) =>
    db.query.reportSchedules.findMany({
      where: eq(reportSchedules.orgId, ctx.orgId),
      orderBy: (t, { desc }) => desc(t.createdAt),
    })
  )
}

export async function createReportSchedule(ctx: { orgId: string; userId: string }, input: CreateReportScheduleInput) {
  const check = validateReportScheduleInput(input)
  if (!check.valid) throw new ServiceError(check.reason, 400)

  return withTenantContext({ orgId: ctx.orgId, userId: ctx.userId }, async (db) => {
    const [created] = await db.insert(reportSchedules).values({
      orgId: ctx.orgId,
      reportId: input.reportId.trim(),
      cadence: input.cadence,
      dayOfWeek: input.cadence === "weekly" ? input.dayOfWeek ?? null : null,
      dayOfMonth: input.cadence === "monthly" ? input.dayOfMonth ?? null : null,
      recipientUserIds: input.recipientUserIds,
      createdBy: ctx.userId,
    }).returning()
    return created
  })
}

export async function updateReportSchedule(
  ctx: { orgId: string },
  scheduleId: string,
  patch: Partial<{ cadence: ReportCadence; dayOfWeek: number | null; dayOfMonth: number | null; recipientUserIds: string[]; isActive: boolean }>
) {
  return withTenantContext({ orgId: ctx.orgId }, async (db) => {
    const existing = await db.query.reportSchedules.findFirst({ where: and(eq(reportSchedules.id, scheduleId), eq(reportSchedules.orgId, ctx.orgId)) })
    if (!existing) throw new ServiceError("Report schedule not found", 404)
    const [updated] = await db.update(reportSchedules).set({ ...patch, updatedAt: new Date() }).where(eq(reportSchedules.id, scheduleId)).returning()
    return updated
  })
}

export async function deleteReportSchedule(ctx: { orgId: string }, scheduleId: string) {
  return withTenantContext({ orgId: ctx.orgId }, async (db) => {
    const existing = await db.query.reportSchedules.findFirst({ where: and(eq(reportSchedules.id, scheduleId), eq(reportSchedules.orgId, ctx.orgId)) })
    if (!existing) throw new ServiceError("Report schedule not found", 404)
    await db.delete(reportSchedules).where(eq(reportSchedules.id, scheduleId))
  })
}

// ─── Cron entry point (see /api/internal/report-schedules/run) ──────────
// Mirrors evaluateAllMetricAlertRules()'s exact posture: raw `db` client
// (a scheduled job has no single request-scoped org, same as
// instruction-mismatch-audit.ts and metric-alert-service.ts), iterates
// every active schedule across every org.

const KNOWN_REPORT_GENERATORS: Record<string, (days?: number) => Promise<Record<string, unknown>>> = {
  escalations: () => generateEscalationsReport(1),
  recommendations: () => generateRecommendationsReport(1),
  risk_trends: () => generateRiskTrendsReport(7),
}

export async function runDueReportSchedules(now: Date = new Date()): Promise<{ checked: number; due: number; delivered: number }> {
  const schedules = await db.query.reportSchedules.findMany({ where: eq(reportSchedules.isActive, true) })
  let due = 0
  let delivered = 0

  for (const schedule of schedules) {
    if (!isScheduleDue(schedule, now)) continue
    due++
    try {
      const generator = KNOWN_REPORT_GENERATORS[schedule.reportId]
      const report = generator ? await generator() : null
      const recipientUserIds = Array.isArray(schedule.recipientUserIds) ? (schedule.recipientUserIds as string[]) : []

      for (const userId of recipientUserIds) {
        await db.insert(notifications).values({
          userId,
          title: `Scheduled report ready: ${schedule.reportId}`,
          message: report
            ? `Your ${schedule.cadence} "${schedule.reportId}" report is ready -- see Reports for details.`
            : `Your ${schedule.cadence} "${schedule.reportId}" report is due. Open Reports to view it (no auto-generator is wired for this report id yet, so no content is attached here).`,
          type: "system",
          metadata: { reportScheduleId: schedule.id, reportId: schedule.reportId, cadence: schedule.cadence, ...(report ? { report } : {}) },
        })
        delivered++
      }
    } catch (err) {
      console.error(`Report schedule ${schedule.id} run failed:`, err)
    }
  }

  return { checked: schedules.length, due, delivered }
}
