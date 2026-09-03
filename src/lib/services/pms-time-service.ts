// Wave 28 (VERIDIAN AI PMS) service layer -- time tracking + billable
// rates (OpenProject's unique contribution among the 3 studied tools).
// Callers must have already passed requirePmsEnabled() (enforced at the
// route layer).
import { pmsTimeEntries, pmsBillableRates, pmsIssues, users as usersTable } from "@/lib/db"
import { withTenantContext } from "@/lib/db/tenant-scoped"
import { and, eq, inArray } from "drizzle-orm"
import { ServiceError } from "./compliance-service"
export { ServiceError }
import type { users } from "@/lib/db"

export type PmsContext = { orgId: string; userId: string; dbUser: typeof users.$inferSelect }

// R67 WS-H (item H-01). The Design Studio object page and its delete
// confirmation name the entry the user is looking at ("Delete entry
// TS-000123 ..."), so an entry needs a SHORT, stable, human-quotable
// reference. pms_time_entries has no sequence column and inventing one would
// mean a migration plus a backfill plus a per-org counter under concurrency,
// for a label -- so the reference is DERIVED from the row's own primary key
// instead: "TS-" + the last 6 characters of the cuid, uppercased. It is
// stable for the life of the row, unique in practice within a day's grid,
// and needs no schema change. It is deliberately NOT presented as a
// sequential document number anywhere in the UI.
export function timesheetEntryRef(entryId: string): string {
  return `TS-${entryId.slice(-6).toUpperCase()}`
}

/** The people-facing columns the Design Studio grid and object page read. */
type TimeEntryPeople = { loggedBy: { id: string; name: string } | null; reviewedBy: { id: string; name: string } | null }

async function resolvePeople(
  db: Parameters<Parameters<typeof withTenantContext>[1]>[0],
  entries: Array<{ userId: string; approvedById: string | null }>
): Promise<Map<string, string>> {
  const ids = [...new Set(entries.flatMap((e) => [e.userId, e.approvedById]).filter((id): id is string => !!id))]
  if (ids.length === 0) return new Map()
  const rows = await db.query.users.findMany({ where: inArray(usersTable.id, ids), columns: { id: true, name: true } })
  return new Map(rows.map((u) => [u.id, u.name]))
}

function withPeople<T extends { id: string; userId: string; approvedById: string | null }>(entry: T, names: Map<string, string>): T & TimeEntryPeople & { ref: string } {
  return {
    ...entry,
    ref: timesheetEntryRef(entry.id),
    loggedBy: { id: entry.userId, name: names.get(entry.userId) ?? entry.userId },
    reviewedBy: entry.approvedById ? { id: entry.approvedById, name: names.get(entry.approvedById) ?? entry.approvedById } : null,
  }
}

export async function listTimeEntriesForIssue(ctx: { orgId: string }, issueId: string) {
  return withTenantContext({ orgId: ctx.orgId }, (db) =>
    db.query.pmsTimeEntries.findMany({ where: and(eq(pmsTimeEntries.orgId, ctx.orgId), eq(pmsTimeEntries.issueId, issueId)), orderBy: (t, { desc }) => desc(t.spentOn) })
  )
}

// R67 WS-H (items H-01/H-02/H-03). Two additive changes, both driven by what
// the Design Studio day grid and its object page actually have to render and
// could not before:
//   1. `loggedBy` / `reviewedBy` -- the grid's "Logged by" and "Reviewed by"
//      facets. Resolved in ONE extra query over the distinct user ids on the
//      page, never per row (the N+1 shape construction-reports-service.ts's
//      designerTimesheetReport was already fixed for once).
//   2. `filters` -- the grid is a DAY grid (D-07), and "my timesheet" is one
//      designer's day, so the day and the owner have to be selectable
//      server-side rather than by shipping a project's whole history to the
//      browser and filtering it there.
// The existing shape (every pms_time_entries column plus `issue`) is
// unchanged, so every prior caller keeps working.
export async function listTimeEntriesForProject(
  ctx: { orgId: string },
  projectId: string,
  filters: { spentOn?: string; userId?: string } = {}
) {
  return withTenantContext({ orgId: ctx.orgId }, async (db) => {
    const issues = await db.query.pmsIssues.findMany({ where: and(eq(pmsIssues.orgId, ctx.orgId), eq(pmsIssues.projectId, projectId)), columns: { id: true, number: true, title: true } })
    const issueIds = issues.map((i) => i.id)
    if (issueIds.length === 0) return []
    const conditions = [inArray(pmsTimeEntries.issueId, issueIds)]
    if (filters.spentOn) conditions.push(eq(pmsTimeEntries.spentOn, filters.spentOn))
    if (filters.userId) conditions.push(eq(pmsTimeEntries.userId, filters.userId))
    const entries = await db.query.pmsTimeEntries.findMany({
      where: and(...conditions),
      orderBy: (t, { desc }) => desc(t.spentOn),
    })
    const issueById = new Map(issues.map((i) => [i.id, i]))
    const names = await resolvePeople(db, entries)
    return entries.map((e) => ({ ...withPeople(e, names), issue: issueById.get(e.issueId) ?? null, projectId }))
  })
}

// R67 WS-H (item H-01): the object page opens read-only on ONE entry, with
// facets Date / Project / Category / Task / Hours / Logged by / Reviewed by
// -- none of which the list endpoint can answer for an entry the user
// deep-linked to without loading a whole project's day.
export async function getTimeEntry(ctx: { orgId: string }, entryId: string) {
  return withTenantContext({ orgId: ctx.orgId }, async (db) => {
    const entry = await db.query.pmsTimeEntries.findFirst({ where: and(eq(pmsTimeEntries.id, entryId), eq(pmsTimeEntries.orgId, ctx.orgId)) })
    if (!entry) throw new ServiceError("Time entry not found", 404)
    const issue = await db.query.pmsIssues.findFirst({ where: and(eq(pmsIssues.id, entry.issueId), eq(pmsIssues.orgId, ctx.orgId)), columns: { id: true, number: true, title: true, projectId: true } })
    const names = await resolvePeople(db, [entry])
    return { ...withPeople(entry, names), issue: issue ?? null, projectId: issue?.projectId ?? null }
  })
}

// R67 WS-H (item H-01): the object page's explicit Edit. Deliberately as
// narrow as deleteTimeEntry() already is -- only the logging designer, and
// only while the entry is still a draft. Once it is submitted it belongs to
// the manager's queue, and editing it underneath them is exactly the
// "writes without a decision point" D-11 rules against.
export async function updateTimeEntry(
  ctx: { orgId: string; userId: string },
  entryId: string,
  patch: { issueId?: string; hours?: string; spentOn?: string; activityType?: string | null; comments?: string | null }
) {
  if (patch.hours !== undefined) {
    const hours = Number(patch.hours)
    if (!Number.isFinite(hours) || hours <= 0) throw new ServiceError("Hours must be more than 0", 400)
  }
  return withTenantContext({ orgId: ctx.orgId, userId: ctx.userId }, async (db) => {
    const existing = await db.query.pmsTimeEntries.findFirst({ where: and(eq(pmsTimeEntries.id, entryId), eq(pmsTimeEntries.orgId, ctx.orgId)) })
    if (!existing) throw new ServiceError("Time entry not found", 404)
    if (existing.userId !== ctx.userId) throw new ServiceError("Only the logging user may edit this entry", 403)
    if (existing.approvalStatus !== "draft") throw new ServiceError("Only a draft time entry can be edited", 400)
    if (patch.issueId) {
      const issue = await db.query.pmsIssues.findFirst({ where: and(eq(pmsIssues.id, patch.issueId), eq(pmsIssues.orgId, ctx.orgId)) })
      if (!issue) throw new ServiceError("Issue not found", 404)
    }
    const [row] = await db.update(pmsTimeEntries).set({
      ...(patch.issueId ? { issueId: patch.issueId } : {}),
      ...(patch.hours !== undefined ? { hours: patch.hours } : {}),
      ...(patch.spentOn ? { spentOn: patch.spentOn } : {}),
      ...(patch.activityType !== undefined ? { activityType: patch.activityType || null } : {}),
      ...(patch.comments !== undefined ? { comments: patch.comments || null } : {}),
    }).where(eq(pmsTimeEntries.id, entryId)).returning()
    return row
  })
}

export async function logTime(
  ctx: PmsContext,
  input: { issueId: string; hours: string; spentOn: string; activityType?: string; comments?: string }
) {
  if (!input.issueId) throw new ServiceError("issueId is required", 400)
  const hours = Number(input.hours)
  if (!Number.isFinite(hours) || hours <= 0) throw new ServiceError("hours must be a positive number", 400)
  if (!input.spentOn) throw new ServiceError("spentOn is required", 400)

  return withTenantContext({ orgId: ctx.orgId, userId: ctx.userId }, async (db) => {
    const issue = await db.query.pmsIssues.findFirst({ where: and(eq(pmsIssues.id, input.issueId), eq(pmsIssues.orgId, ctx.orgId)) })
    if (!issue) throw new ServiceError("Issue not found", 404)

    const [entry] = await db.insert(pmsTimeEntries).values({
      orgId: ctx.orgId, issueId: input.issueId, userId: ctx.userId, hours: input.hours,
      spentOn: input.spentOn, activityType: input.activityType || null, comments: input.comments || null,
    }).returning()
    return entry
  })
}

export async function deleteTimeEntry(ctx: { orgId: string; userId: string }, entryId: string) {
  return withTenantContext({ orgId: ctx.orgId }, async (db) => {
    const existing = await db.query.pmsTimeEntries.findFirst({ where: and(eq(pmsTimeEntries.id, entryId), eq(pmsTimeEntries.orgId, ctx.orgId)) })
    if (!existing) throw new ServiceError("Time entry not found", 404)
    if (existing.userId !== ctx.userId) throw new ServiceError("Only the logging user may delete this entry", 403)
    await db.delete(pmsTimeEntries).where(eq(pmsTimeEntries.id, entryId))
    return { deleted: true }
  })
}

// Design Studio timesheets approval flow (Owner item 12, "IMPORTANT",
// 2026-07-28): draft (designer editing, logTime's default) -> submitted
// (designer done for the day) -> approved/rejected (manager review).
// Modeled directly on construction-kpi-service.ts's submitKpiEntry/
// approveKpiEntry -- role gating (submit=owner, approve/reject=manager+)
// is enforced at the route layer via requireRole, self-approval blocked
// here the same way approveKpiEntry blocks it.
export async function submitTimeEntry(ctx: { orgId: string; userId: string }, entryId: string) {
  return withTenantContext({ orgId: ctx.orgId }, async (db) => {
    const existing = await db.query.pmsTimeEntries.findFirst({ where: and(eq(pmsTimeEntries.id, entryId), eq(pmsTimeEntries.orgId, ctx.orgId)) })
    if (!existing) throw new ServiceError("Time entry not found", 404)
    if (existing.userId !== ctx.userId) throw new ServiceError("Only the logging user may submit this entry", 403)
    if (existing.approvalStatus !== "draft") throw new ServiceError("Only a draft time entry can be submitted", 400)

    const [row] = await db.update(pmsTimeEntries)
      .set({ approvalStatus: "submitted" })
      .where(eq(pmsTimeEntries.id, entryId)).returning()
    return row
  })
}

// R67 WS-H (items H-01/H-03): "Submit today (4 rows, 7.50 h)" / "Submit day
// for review" is ONE decision by the designer over the whole day, not four
// separate submits the UI fakes by looping -- a partial loop leaves half a
// day submitted with no way for either side to tell. One transaction, one
// answer, and the entries it actually moved are returned so the caller can
// mint exactly one review task per entry and report the real count.
export async function submitDayForReview(
  ctx: { orgId: string; userId: string },
  input: { projectId: string; spentOn: string }
) {
  if (!input.projectId) throw new ServiceError("projectId is required", 400)
  if (!input.spentOn) throw new ServiceError("spentOn is required", 400)

  return withTenantContext({ orgId: ctx.orgId, userId: ctx.userId }, async (db) => {
    const issues = await db.query.pmsIssues.findMany({ where: and(eq(pmsIssues.orgId, ctx.orgId), eq(pmsIssues.projectId, input.projectId)), columns: { id: true, number: true, title: true } })
    const issueIds = issues.map((i) => i.id)
    if (issueIds.length === 0) throw new ServiceError("No hours logged for this day", 400)

    const drafts = await db.query.pmsTimeEntries.findMany({
      where: and(
        eq(pmsTimeEntries.orgId, ctx.orgId),
        eq(pmsTimeEntries.userId, ctx.userId),
        eq(pmsTimeEntries.spentOn, input.spentOn),
        eq(pmsTimeEntries.approvalStatus, "draft"),
        inArray(pmsTimeEntries.issueId, issueIds)
      ),
    })
    if (drafts.length === 0) throw new ServiceError("No hours logged for this day", 400)

    const ids = drafts.map((d) => d.id)
    const rows = await db.update(pmsTimeEntries).set({ approvalStatus: "submitted" }).where(inArray(pmsTimeEntries.id, ids)).returning()
    const issueById = new Map(issues.map((i) => [i.id, i]))
    return {
      submitted: rows.length,
      hours: rows.reduce((sum, r) => sum + Number(r.hours), 0),
      entries: rows.map((r) => ({ ...r, ref: timesheetEntryRef(r.id), issue: issueById.get(r.issueId) ?? null })),
    }
  })
}

async function reviewTimeEntry(ctx: { orgId: string; userId: string }, entryId: string, decision: "approved" | "rejected", rejectionReason?: string) {
  return withTenantContext({ orgId: ctx.orgId }, async (db) => {
    const existing = await db.query.pmsTimeEntries.findFirst({ where: and(eq(pmsTimeEntries.id, entryId), eq(pmsTimeEntries.orgId, ctx.orgId)) })
    if (!existing) throw new ServiceError("Time entry not found", 404)
    if (existing.approvalStatus !== "submitted") throw new ServiceError("Only a submitted time entry can be reviewed", 400)
    if (existing.userId === ctx.userId) throw new ServiceError("The submitter cannot review their own time entry", 403)

    const [row] = await db.update(pmsTimeEntries)
      .set({
        approvalStatus: decision,
        approvedById: ctx.userId,
        approvedAt: new Date(),
        rejectionReason: decision === "rejected" ? (rejectionReason || null) : null,
      })
      .where(eq(pmsTimeEntries.id, entryId)).returning()
    return row
  })
}

export async function approveTimeEntry(ctx: { orgId: string; userId: string }, entryId: string) {
  return reviewTimeEntry(ctx, entryId, "approved")
}

export async function rejectTimeEntry(ctx: { orgId: string; userId: string }, entryId: string, rejectionReason?: string) {
  return reviewTimeEntry(ctx, entryId, "rejected", rejectionReason)
}

export async function listBillableRates(ctx: { orgId: string }) {
  return withTenantContext({ orgId: ctx.orgId }, (db) =>
    db.query.pmsBillableRates.findMany({ where: eq(pmsBillableRates.orgId, ctx.orgId), orderBy: (t, { desc }) => desc(t.validFrom) })
  )
}

export async function setBillableRate(ctx: PmsContext, input: { userId?: string; hourlyRate: string; validFrom: string }) {
  const rate = Number(input.hourlyRate)
  if (!Number.isFinite(rate) || rate < 0) throw new ServiceError("hourlyRate must be a non-negative number", 400)
  if (!input.validFrom) throw new ServiceError("validFrom is required", 400)

  return withTenantContext({ orgId: ctx.orgId }, async (db) => {
    const [row] = await db.insert(pmsBillableRates).values({
      orgId: ctx.orgId, userId: input.userId || null, hourlyRate: input.hourlyRate, validFrom: input.validFrom,
    }).returning()
    return row
  })
}

export type PmsBillableRateRow = { userId: string | null; hourlyRate: string | number; validFrom: string }

/**
 * Pure function, no DB access -- independently unit-testable (mirrors
 * firm-billing-service.ts's resolveBillableRate design). Resolves the
 * applicable rate for a user as of a given date -- most-recent
 * validFrom <= asOf, falling back to the org default (userId null) if no
 * per-user rate exists. Returns null (not 0) when nothing applies, so
 * callers that must never silently invoice at a zero rate (e.g.
 * pms-invoice-service.ts) can tell "no rate configured" apart from "a real
 * zero rate".
 */
export function resolvePmsBillableRatePure(rates: PmsBillableRateRow[], userId: string, asOf: string): number | null {
  const applicable = rates.filter((r) => r.validFrom <= asOf)
  const perUser = applicable.filter((r) => r.userId === userId).sort((a, b) => b.validFrom.localeCompare(a.validFrom))[0]
  if (perUser) return Number(perUser.hourlyRate)
  const orgDefault = applicable.filter((r) => r.userId === null).sort((a, b) => b.validFrom.localeCompare(a.validFrom))[0]
  return orgDefault ? Number(orgDefault.hourlyRate) : null
}

/** Resolves the applicable rate for a user as of a given date, defaulting to 0 when unconfigured -- used for internal cost-vs-budget estimates (pms-budget-service.ts), where a missing rate should not block the read. Real invoicing must not use this 0-fallback -- see resolvePmsBillableRatePure. */
export async function resolveBillableRate(ctx: { orgId: string }, userId: string, asOf: string): Promise<number> {
  return withTenantContext({ orgId: ctx.orgId }, async (db) => {
    const rates = await db.query.pmsBillableRates.findMany({ where: eq(pmsBillableRates.orgId, ctx.orgId) })
    return resolvePmsBillableRatePure(rates, userId, asOf) ?? 0
  })
}
