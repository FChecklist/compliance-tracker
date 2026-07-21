// VERIDIAN CRM Wave 1 (2026-07-21). Real gap confirmed by reading this
// schema fresh before writing this file: crm_stage_history establishes a
// polymorphic entityType+entityId pattern for lead/opportunity history, but
// nothing in this codebase tracked Tasks/Meetings/Calls against a CRM
// record at all (Zoho has this -- Activities > Tasks with Subject/Due
// Date/Status/Priority, see zoho-reverse-engineering/docs/crm/fields.md's
// addendum). This file reuses that same entityType+entityId pattern,
// extended to also cover account/contact (crm_stage_history itself only
// ever needed lead/opportunity, since accounts/contacts have no "stage").
// Own dedicated file, not folded into crm-service.ts, matching this
// codebase's own precedent (crm-accounts-service.ts, bcm-service.ts,
// access-review-service.ts each own a single bounded concern).
import { crmActivities } from "@/lib/db"
import { withTenantContext } from "@/lib/db/tenant-scoped"
import { eq, and } from "drizzle-orm"
import { ServiceError } from "./compliance-service"
import { requireSalesEnabled } from "./crm-enablement-service"

export type CrmActivityContext = { orgId: string; userId: string }
export type CrmActivityEntityType = "lead" | "opportunity" | "account" | "contact"

export type CreateActivityInput = {
  entityType: CrmActivityEntityType
  entityId: string
  activityType: "task" | "meeting" | "call"
  subject: string
  dueDate?: string
  priority?: "low" | "normal" | "high"
  notes?: string
  assignedToId?: string
}

export async function createActivity(ctx: CrmActivityContext, input: CreateActivityInput) {
  await requireSalesEnabled(ctx.orgId)
  const subject = input.subject?.trim()
  if (!subject) throw new ServiceError("subject is required", 400)
  if (!input.entityType || !input.entityId) throw new ServiceError("entityType and entityId are required", 400)

  return withTenantContext({ orgId: ctx.orgId, userId: ctx.userId }, async (db) => {
    const [activity] = await db.insert(crmActivities).values({
      orgId: ctx.orgId,
      entityType: input.entityType,
      entityId: input.entityId,
      activityType: input.activityType,
      subject,
      dueDate: input.dueDate || null,
      priority: input.priority || "normal",
      notes: input.notes || null,
      assignedToId: input.assignedToId || null,
      createdById: ctx.userId,
    }).returning()
    return activity
  })
}

export async function listActivitiesForEntity(ctx: { orgId: string }, entityType: CrmActivityEntityType, entityId: string) {
  await requireSalesEnabled(ctx.orgId)
  return withTenantContext({ orgId: ctx.orgId }, (db) =>
    db.query.crmActivities.findMany({
      where: and(eq(crmActivities.orgId, ctx.orgId), eq(crmActivities.entityType, entityType), eq(crmActivities.entityId, entityId)),
      orderBy: (t, { desc }) => desc(t.createdAt),
    })
  )
}

export async function getActivity(ctx: { orgId: string }, activityId: string) {
  await requireSalesEnabled(ctx.orgId)
  return withTenantContext({ orgId: ctx.orgId }, (db) =>
    db.query.crmActivities.findFirst({ where: and(eq(crmActivities.id, activityId), eq(crmActivities.orgId, ctx.orgId)) })
  )
}

export async function updateActivity(
  ctx: CrmActivityContext,
  activityId: string,
  patch: Partial<{ subject: string; dueDate: string | null; status: string; priority: string; notes: string | null; assignedToId: string | null }>
) {
  await requireSalesEnabled(ctx.orgId)
  return withTenantContext({ orgId: ctx.orgId, userId: ctx.userId }, async (db) => {
    const existing = await db.query.crmActivities.findFirst({ where: and(eq(crmActivities.id, activityId), eq(crmActivities.orgId, ctx.orgId)) })
    if (!existing) throw new ServiceError("Activity not found", 404)
    const [updated] = await db.update(crmActivities)
      .set({ ...patch, updatedAt: new Date(), completedAt: patch.status === "completed" ? new Date() : existing.completedAt })
      .where(eq(crmActivities.id, activityId)).returning()
    return updated
  })
}

export async function completeActivity(ctx: CrmActivityContext, activityId: string) {
  return updateActivity(ctx, activityId, { status: "completed" })
}

export async function deleteActivity(ctx: { orgId: string }, activityId: string) {
  await requireSalesEnabled(ctx.orgId)
  return withTenantContext({ orgId: ctx.orgId }, async (db) => {
    const existing = await db.query.crmActivities.findFirst({ where: and(eq(crmActivities.id, activityId), eq(crmActivities.orgId, ctx.orgId)) })
    if (!existing) throw new ServiceError("Activity not found", 404)
    await db.delete(crmActivities).where(eq(crmActivities.id, activityId))
    return { id: activityId }
  })
}
