// Wave 117 (PROJEXA foundation) service layer -- KPI definitions + entries.
// Designer-fills / manager-approves workflow: submit is the "member" rank,
// approve requires "manager"+ (enforced at the route layer via requireRole),
// reusing the existing admin/manager/member rank system rather than
// introducing construction-specific role labels.
import { constructionKpiDefinitions, constructionKpiEntries } from "@/lib/db"
import { withTenantContext } from "@/lib/db/tenant-scoped"
import { and, eq } from "drizzle-orm"
import { ServiceError } from "./compliance-service"
export { ServiceError }

export type KpiDefinitionInput = {
  projectId?: string
  metricName: string
  targetValue?: number
  unit?: string
  period?: string
  ownerId?: string
}

export async function listKpiDefinitions(ctx: { orgId: string }, projectId?: string) {
  return withTenantContext({ orgId: ctx.orgId }, (db) => {
    const conditions = [eq(constructionKpiDefinitions.orgId, ctx.orgId)]
    if (projectId) conditions.push(eq(constructionKpiDefinitions.projectId, projectId))
    return db.query.constructionKpiDefinitions.findMany({ where: and(...conditions) })
  })
}

export async function createKpiDefinition(ctx: { orgId: string }, input: KpiDefinitionInput) {
  const metricName = input.metricName?.trim()
  if (!metricName) throw new ServiceError("metricName is required", 400)

  return withTenantContext({ orgId: ctx.orgId }, async (db) => {
    const [row] = await db.insert(constructionKpiDefinitions).values({
      orgId: ctx.orgId, projectId: input.projectId || null, metricName,
      targetValue: input.targetValue !== undefined ? String(input.targetValue) : null,
      unit: input.unit || null,
      period: (input.period as typeof constructionKpiDefinitions.$inferInsert.period) || "monthly",
      ownerId: input.ownerId || null,
    }).returning()
    return row
  })
}

export async function listKpiEntries(ctx: { orgId: string }, kpiDefinitionId: string) {
  return withTenantContext({ orgId: ctx.orgId }, async (db) => {
    const definition = await db.query.constructionKpiDefinitions.findFirst({ where: and(eq(constructionKpiDefinitions.id, kpiDefinitionId), eq(constructionKpiDefinitions.orgId, ctx.orgId)) })
    if (!definition) throw new ServiceError("KPI definition not found", 404)
    return db.query.constructionKpiEntries.findMany({ where: eq(constructionKpiEntries.kpiDefinitionId, kpiDefinitionId), orderBy: (t, { desc }) => desc(t.createdAt) })
  })
}

export async function submitKpiEntry(ctx: { orgId: string; userId: string }, input: { kpiDefinitionId: string; period: string; actualValue: number }) {
  if (!input.kpiDefinitionId) throw new ServiceError("kpiDefinitionId is required", 400)
  if (!input.period) throw new ServiceError("period is required", 400)

  return withTenantContext({ orgId: ctx.orgId, userId: ctx.userId }, async (db) => {
    const definition = await db.query.constructionKpiDefinitions.findFirst({ where: and(eq(constructionKpiDefinitions.id, input.kpiDefinitionId), eq(constructionKpiDefinitions.orgId, ctx.orgId)) })
    if (!definition) throw new ServiceError("KPI definition not found", 404)

    const [row] = await db.insert(constructionKpiEntries).values({
      kpiDefinitionId: input.kpiDefinitionId, period: input.period, actualValue: String(input.actualValue),
      filledById: ctx.userId, approvalStatus: "submitted",
    }).returning()
    return row
  })
}

export async function approveKpiEntry(ctx: { orgId: string; userId: string }, entryId: string) {
  return withTenantContext({ orgId: ctx.orgId, userId: ctx.userId }, async (db) => {
    const entry = await db.query.constructionKpiEntries.findFirst({
      where: eq(constructionKpiEntries.id, entryId),
      with: { definition: true },
    })
    if (!entry || entry.definition.orgId !== ctx.orgId) throw new ServiceError("KPI entry not found", 404)
    if (entry.approvalStatus !== "submitted") throw new ServiceError("Only a submitted KPI entry can be approved", 400)
    if (entry.filledById === ctx.userId) throw new ServiceError("The submitter cannot approve their own KPI entry", 403)

    const [row] = await db.update(constructionKpiEntries)
      .set({ approvalStatus: "approved", approvedById: ctx.userId, approvedAt: new Date() })
      .where(eq(constructionKpiEntries.id, entryId)).returning()
    return row
  })
}
