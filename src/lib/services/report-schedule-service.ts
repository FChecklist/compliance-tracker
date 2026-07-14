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
import { PERIODICITY_BASE_VALUES, type PeriodicityBase, validatePeriodicity } from "./report-taxonomy"
import { ServiceError } from "./compliance-service"
export { ServiceError }

// Priority 11 (2026-07-13): expanded from the original 3-value
// 'daily'|'weekly'|'monthly' set to the full report-taxonomy.ts periodicity
// vocabulary -- re-exported here (not redefined) so this file stays the
// single import call sites already use (`REPORT_CADENCES`/`ReportCadence`),
// while report-taxonomy.ts stays the actual source of truth.
export const REPORT_CADENCES = PERIODICITY_BASE_VALUES
export type ReportCadence = PeriodicityBase

export type CreateReportScheduleInput = {
  reportId: string
  cadence: ReportCadence
  dayOfWeek?: number | null
  dayOfMonth?: number | null
  timesOfDay?: string[] | null
  startDate?: string | null
  endDate?: string | null
  recipientUserIds: string[]
}

// ─── Pure validation/decision logic (unit-testable without a DB) ──────────

/** Same validate-then-throw shape as delegation-service.ts's validateDelegationInput. Delegates the periodicity-shape check to report-taxonomy.ts's validatePeriodicity() so both files can't drift apart on what each cadence requires. */
export function validateReportScheduleInput(
  input: Pick<CreateReportScheduleInput, "reportId" | "cadence" | "dayOfWeek" | "dayOfMonth" | "timesOfDay" | "startDate" | "endDate" | "recipientUserIds">
): { valid: true } | { valid: false; reason: string } {
  if (!input.reportId?.trim()) return { valid: false, reason: "reportId is required" }
  const periodicityCheck = validatePeriodicity(input.cadence, {
    dayOfWeek: input.dayOfWeek ?? undefined,
    dayOfMonth: input.dayOfMonth ?? undefined,
    startDate: input.startDate ?? undefined,
    endDate: input.endDate ?? undefined,
  })
  if (!periodicityCheck.valid) return periodicityCheck
  if (!input.recipientUserIds?.length) return { valid: false, reason: "recipientUserIds must have at least one user" }
  return { valid: true }
}

const WEEKLY_LIKE: ReportCadence[] = ["weekly", "biweekly", "fortnightly"]
const MONTHLY_LIKE: ReportCadence[] = ["monthly", "bimonthly", "quarterly", "half_yearly", "yearly", "biyearly"]
// Cadence -> how many times isScheduleDue() should fire per its own natural
// unit before "due" resets -- biweekly (twice a week) fires on dayOfWeek AND
// 3 days later; the rest of the *_LIKE lists fire on exactly one day per
// their unit (a monthly-family cadence firing "every Nth month" beyond
// plain monthly is a scheduling-frequency concept the vercel.json cron
// itself doesn't yet distinguish -- see this function's own note below).
const MONTH_INTERVAL: Partial<Record<ReportCadence, number>> = { monthly: 1, bimonthly: 2, quarterly: 3, half_yearly: 6, yearly: 12, biyearly: 24 }

/**
 * Pure: is this already-fetched schedule row due on `date` (defaults to
 * now, UTC)? Monthly-family dayOfMonth is clamped to the real last day of
 * shorter months (e.g. 31 fires on Feb 28/29), matching how a person
 * actually means "the last day of the month" when they pick day 31 -- not
 * silently skipping the month entirely.
 *
 * Honest limitation: bimonthly/quarterly/half_yearly/yearly/biyearly all
 * fire on `dayOfMonth` every time that day-of-month recurs (i.e. they
 * behave like `monthly` today) -- true "every Nth month" gating (skip
 * months in between) needs an anchor/reference month stored per schedule,
 * which this pass doesn't add (report_schedules has no "reference month"
 * column). Flagged here rather than silently claiming full N-month-interval
 * precision the schema doesn't yet support.
 */
export function isScheduleDue(
  schedule: { cadence: string; dayOfWeek: number | null; dayOfMonth: number | null; startDate?: string | null; endDate?: string | null },
  date: Date = new Date()
): boolean {
  const cadence = schedule.cadence as ReportCadence

  if (cadence === "immediate" || cadence === "on_demand") return false // never cron-fired -- immediate fires on its triggering event elsewhere, on_demand is manual-only
  if (cadence === "hourly") return true // the cron itself controls hourly granularity (see vercel.json) -- every invocation is "due"
  if (cadence === "daily") return true

  if (WEEKLY_LIKE.includes(cadence)) {
    if (schedule.dayOfWeek == null) return false
    if (date.getUTCDay() !== schedule.dayOfWeek) {
      // biweekly = twice a week -- also fires 3 days after the anchor day (a
      // fixed, documented approximation of "twice weekly", not a precise
      // Tue/Fri-style named-pair schedule).
      if (cadence === "biweekly") return date.getUTCDay() === (schedule.dayOfWeek + 3) % 7
      return false
    }
    return true
  }

  if (MONTHLY_LIKE.includes(cadence)) {
    if (schedule.dayOfMonth == null) return false
    const lastDayOfMonth = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0)).getUTCDate()
    const effectiveDay = Math.min(schedule.dayOfMonth, lastDayOfMonth)
    return date.getUTCDate() === effectiveDay
  }

  if (cadence === "year_to_date") {
    // Fires once a year on Jan 1 (the natural "a new YTD period begins" point) plus dayOfMonth if set for an additional recurring within-year checkpoint.
    return date.getUTCMonth() === 0 && date.getUTCDate() === 1
  }

  if (cadence === "custom_range") {
    if (!schedule.startDate || !schedule.endDate) return false
    // Date-only comparison (truncate `date` to its own UTC midnight) --
    // startDate/endDate are date-only ISO strings that parse to UTC
    // midnight, so comparing exact timestamps against `date` (which
    // usually carries a real time-of-day, e.g. 09:00 UTC from a cron run)
    // would wrongly exclude the end date itself for any run after 00:00.
    const dateOnly = Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate())
    const start = new Date(schedule.startDate)
    const end = new Date(schedule.endDate)
    return dateOnly >= start.getTime() && dateOnly <= end.getTime() && date.getUTCDate() === end.getUTCDate() && date.getUTCMonth() === end.getUTCMonth() && date.getUTCFullYear() === end.getUTCFullYear()
  }

  return false
}

/** Pure: does `timesOfDay` (array of "HH:MM" 24h UTC) include the current hour:minute-truncated-to-hour? Used alongside isScheduleDue() for hourly/daily cadences that specify specific clock times -- an empty/undefined timesOfDay means "fire once, whenever the cron itself runs" (unchanged pre-Priority-11 behavior). */
export function matchesTimeOfDay(timesOfDay: string[] | null | undefined, date: Date = new Date()): boolean {
  if (!timesOfDay || timesOfDay.length === 0) return true
  const currentHour = String(date.getUTCHours()).padStart(2, "0")
  return timesOfDay.some((t) => t.startsWith(`${currentHour}:`))
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

  const weeklyLike: ReportCadence[] = ["weekly", "biweekly", "fortnightly"]
  const monthlyLike: ReportCadence[] = ["monthly", "bimonthly", "quarterly", "half_yearly", "yearly", "biyearly"]

  return withTenantContext({ orgId: ctx.orgId, userId: ctx.userId }, async (db) => {
    const [created] = await db.insert(reportSchedules).values({
      orgId: ctx.orgId,
      reportId: input.reportId.trim(),
      cadence: input.cadence,
      dayOfWeek: weeklyLike.includes(input.cadence) ? input.dayOfWeek ?? null : null,
      dayOfMonth: monthlyLike.includes(input.cadence) ? input.dayOfMonth ?? null : null,
      timesOfDay: input.cadence === "hourly" || input.cadence === "daily" ? input.timesOfDay ?? null : null,
      startDate: input.cadence === "custom_range" ? input.startDate ?? null : null,
      endDate: input.cadence === "custom_range" ? input.endDate ?? null : null,
      recipientUserIds: input.recipientUserIds,
      createdBy: ctx.userId,
    }).returning()
    return created
  })
}

export async function updateReportSchedule(
  ctx: { orgId: string },
  scheduleId: string,
  patch: Partial<{ cadence: ReportCadence; dayOfWeek: number | null; dayOfMonth: number | null; timesOfDay: string[] | null; startDate: string | null; endDate: string | null; recipientUserIds: string[]; isActive: boolean }>
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
    if (!matchesTimeOfDay(schedule.timesOfDay as string[] | null, now)) continue
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
