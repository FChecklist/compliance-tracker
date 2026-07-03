// Wave 28 (VERIDIAN AI PMS) service layer -- time tracking + billable
// rates (OpenProject's unique contribution among the 3 studied tools).
// Callers must have already passed requirePmsEnabled() (enforced at the
// route layer).
import { pmsTimeEntries, pmsBillableRates, pmsIssues } from "@/lib/db"
import { withTenantContext } from "@/lib/db/tenant-scoped"
import { and, eq } from "drizzle-orm"
import { ServiceError } from "./compliance-service"
export { ServiceError }
import type { users } from "@/lib/db"

export type PmsContext = { orgId: string; userId: string; dbUser: typeof users.$inferSelect }

export async function listTimeEntriesForIssue(ctx: { orgId: string }, issueId: string) {
  return withTenantContext({ orgId: ctx.orgId }, (db) =>
    db.query.pmsTimeEntries.findMany({ where: and(eq(pmsTimeEntries.orgId, ctx.orgId), eq(pmsTimeEntries.issueId, issueId)), orderBy: (t, { desc }) => desc(t.spentOn) })
  )
}

export async function listTimeEntriesForProject(ctx: { orgId: string }, projectId: string) {
  return withTenantContext({ orgId: ctx.orgId }, async (db) => {
    const issues = await db.query.pmsIssues.findMany({ where: and(eq(pmsIssues.orgId, ctx.orgId), eq(pmsIssues.projectId, projectId)), columns: { id: true, number: true, title: true } })
    const issueIds = issues.map((i) => i.id)
    if (issueIds.length === 0) return []
    const entries = await db.query.pmsTimeEntries.findMany({
      where: (t, { inArray }) => inArray(t.issueId, issueIds),
      orderBy: (t, { desc }) => desc(t.spentOn),
    })
    const issueById = new Map(issues.map((i) => [i.id, i]))
    return entries.map((e) => ({ ...e, issue: issueById.get(e.issueId) ?? null }))
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

/** Resolves the applicable rate for a user as of a given date -- most-recent validFrom <= asOf, falling back to the org default (userId null) if no per-user rate exists. */
export async function resolveBillableRate(ctx: { orgId: string }, userId: string, asOf: string): Promise<number> {
  return withTenantContext({ orgId: ctx.orgId }, async (db) => {
    const rates = await db.query.pmsBillableRates.findMany({ where: eq(pmsBillableRates.orgId, ctx.orgId) })
    const applicable = rates.filter((r) => r.validFrom <= asOf)
    const perUser = applicable.filter((r) => r.userId === userId).sort((a, b) => b.validFrom.localeCompare(a.validFrom))[0]
    if (perUser) return Number(perUser.hourlyRate)
    const orgDefault = applicable.filter((r) => r.userId === null).sort((a, b) => b.validFrom.localeCompare(a.validFrom))[0]
    return orgDefault ? Number(orgDefault.hourlyRate) : 0
  })
}
