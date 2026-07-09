// Wave 108 (THE FIRM AI OS) -- engagement (scope-of-work + fee
// arrangement) and deliverable-checklist management. An engagement is the
// umbrella record tying a client's work under one fee arrangement;
// deliverables can polymorphically link to an existing per-client record
// (compliance_item/legal_matter/audit_engagement/firm_tax_case/notice) via
// the same linkedEntityType/linkedEntityId pattern `documents` already
// uses -- no duplication of what those modules already track.
import { firmEngagements, firmEngagementDeliverables, clients } from "@/lib/db"
import { type TenantDb } from "@/lib/db/tenant-scoped"
import { and, eq } from "drizzle-orm"
import { requireFirmEnabled, withFirmTenantContext, type FirmServiceContext } from "./firm-enablement-service"
import { ServiceError } from "./compliance-service"
export { ServiceError }

async function assertClientBelongsToOrg(db: TenantDb, clientId: string, orgId: string) {
  const client = await db.query.clients.findFirst({ where: and(eq(clients.id, clientId), eq(clients.orgId, orgId)) })
  if (!client) throw new ServiceError("Client not found", 404)
}

export type FirmEngagementInput = {
  clientId: string
  serviceLine: typeof firmEngagements.$inferSelect["serviceLine"]
  title: string
  scopeOfWork?: string | null
  feeType?: typeof firmEngagements.$inferSelect["feeType"]
  feeAmount?: number | null
  billingFrequency?: string | null
  startDate: string
  endDate?: string | null
  leadPartnerUserId?: string | null
}

export async function createEngagement(ctx: FirmServiceContext, input: FirmEngagementInput) {
  await requireFirmEnabled(ctx.orgId)
  if (!input.title?.trim()) throw new ServiceError("title is required", 400)
  if (!input.startDate) throw new ServiceError("startDate is required", 400)

  return withFirmTenantContext(ctx, async (db) => {
    await assertClientBelongsToOrg(db, input.clientId, ctx.orgId)

    const [engagement] = await db.insert(firmEngagements).values({
      orgId: ctx.orgId,
      clientId: input.clientId,
      serviceLine: input.serviceLine,
      title: input.title.trim(),
      scopeOfWork: input.scopeOfWork ?? null,
      feeType: input.feeType ?? "fixed",
      feeAmount: input.feeAmount != null ? String(input.feeAmount) : null,
      billingFrequency: input.billingFrequency ?? "monthly",
      startDate: input.startDate,
      endDate: input.endDate ?? null,
      leadPartnerUserId: input.leadPartnerUserId ?? null,
      createdById: ctx.userId,
    }).returning()

    return engagement
  })
}

export type FirmEngagementPatch = Partial<Omit<FirmEngagementInput, "clientId">> & { status?: string }

export async function updateEngagement(ctx: FirmServiceContext, engagementId: string, patch: FirmEngagementPatch) {
  await requireFirmEnabled(ctx.orgId)
  return withFirmTenantContext(ctx, async (db) => {
    const existing = await db.query.firmEngagements.findFirst({ where: and(eq(firmEngagements.id, engagementId), eq(firmEngagements.orgId, ctx.orgId)) })
    if (!existing) throw new ServiceError("Engagement not found", 404)

    const [updated] = await db.update(firmEngagements).set({
      title: patch.title?.trim() ?? existing.title,
      scopeOfWork: patch.scopeOfWork !== undefined ? patch.scopeOfWork : existing.scopeOfWork,
      feeType: patch.feeType ?? existing.feeType,
      feeAmount: patch.feeAmount !== undefined ? (patch.feeAmount != null ? String(patch.feeAmount) : null) : existing.feeAmount,
      billingFrequency: patch.billingFrequency !== undefined ? patch.billingFrequency : existing.billingFrequency,
      endDate: patch.endDate !== undefined ? patch.endDate : existing.endDate,
      status: patch.status ?? existing.status,
      leadPartnerUserId: patch.leadPartnerUserId !== undefined ? patch.leadPartnerUserId : existing.leadPartnerUserId,
      updatedAt: new Date(),
    }).where(eq(firmEngagements.id, engagementId)).returning()

    return updated
  })
}

export async function listEngagementsForClient(ctx: FirmServiceContext, clientId: string) {
  await requireFirmEnabled(ctx.orgId)
  return withFirmTenantContext(ctx, async (db) => {
    return db.query.firmEngagements.findMany({
      where: and(eq(firmEngagements.clientId, clientId), eq(firmEngagements.orgId, ctx.orgId)),
      orderBy: (t, { desc }) => desc(t.startDate),
    })
  })
}

export type FirmDeliverableInput = {
  title: string
  dueDate?: string | null
  linkedEntityType?: string | null
  linkedEntityId?: string | null
  assignedToId?: string | null
}

export async function addDeliverable(ctx: FirmServiceContext, engagementId: string, input: FirmDeliverableInput) {
  await requireFirmEnabled(ctx.orgId)
  if (!input.title?.trim()) throw new ServiceError("title is required", 400)

  return withFirmTenantContext(ctx, async (db) => {
    const engagement = await db.query.firmEngagements.findFirst({ where: and(eq(firmEngagements.id, engagementId), eq(firmEngagements.orgId, ctx.orgId)) })
    if (!engagement) throw new ServiceError("Engagement not found", 404)

    const [deliverable] = await db.insert(firmEngagementDeliverables).values({
      orgId: ctx.orgId,
      engagementId,
      title: input.title.trim(),
      dueDate: input.dueDate ?? null,
      linkedEntityType: input.linkedEntityType ?? null,
      linkedEntityId: input.linkedEntityId ?? null,
      assignedToId: input.assignedToId ?? null,
    }).returning()

    return deliverable
  })
}

export async function completeDeliverable(ctx: FirmServiceContext, deliverableId: string) {
  await requireFirmEnabled(ctx.orgId)
  return withFirmTenantContext(ctx, async (db) => {
    const deliverable = await db.query.firmEngagementDeliverables.findFirst({
      where: and(eq(firmEngagementDeliverables.id, deliverableId), eq(firmEngagementDeliverables.orgId, ctx.orgId)),
    })
    if (!deliverable) throw new ServiceError("Deliverable not found", 404)
    if (deliverable.status === "done") throw new ServiceError("This deliverable is already done", 409)

    const [updated] = await db.update(firmEngagementDeliverables).set({
      status: "done",
      completedAt: new Date(),
      updatedAt: new Date(),
    }).where(eq(firmEngagementDeliverables.id, deliverableId)).returning()

    return updated
  })
}

export async function listUpcomingDeliverables(ctx: FirmServiceContext, filters?: { assignedToId?: string }) {
  await requireFirmEnabled(ctx.orgId)
  return withFirmTenantContext(ctx, async (db) => {
    const conditions = [eq(firmEngagementDeliverables.orgId, ctx.orgId)]
    if (filters?.assignedToId) conditions.push(eq(firmEngagementDeliverables.assignedToId, filters.assignedToId))
    return db.query.firmEngagementDeliverables.findMany({
      where: and(...conditions),
      orderBy: (t, { asc }) => asc(t.dueDate),
    })
  })
}
