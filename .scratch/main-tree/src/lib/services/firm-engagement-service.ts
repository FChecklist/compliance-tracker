// Wave 108 (THE FIRM AI OS) -- engagement (scope-of-work + fee
// arrangement) and deliverable-checklist management. An engagement is the
// umbrella record tying a client's work under one fee arrangement;
// deliverables can polymorphically link to an existing per-client record
// (compliance_item/legal_matter/audit_engagement/firm_tax_case/notice) via
// the same linkedEntityType/linkedEntityId pattern `documents` already
// uses -- no duplication of what those modules already track.
import { db, firmEngagements, firmEngagementDeliverables, firmTimeEntries, clients, orgProductBranchEnablements } from "@/lib/db"
import { withTenantContext, type TenantDb } from "@/lib/db/tenant-scoped"
import { and, eq, lte, ne } from "drizzle-orm"
import { requireFirmEnabled, withFirmTenantContext, type FirmServiceContext } from "./firm-enablement-service"
import { ServiceError } from "./compliance-service"
export { ServiceError }

async function assertClientBelongsToOrg(db: TenantDb, clientId: string, orgId: string) {
  const client = await db.query.clients.findFirst({ where: and(eq(clients.id, clientId), eq(clients.orgId, orgId)) })
  if (!client) throw new ServiceError("Client not found", 404)
}

const RECURRENCE_MONTHS: Record<string, number> = { monthly: 1, quarterly: 3, half_yearly: 6, annually: 12 }

function addMonthsToDateStr(dateStr: string, months: number): string {
  const d = new Date(dateStr + "T00:00:00Z")
  d.setUTCMonth(d.getUTCMonth() + months)
  return d.toISOString().slice(0, 10)
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
  recurrenceType?: string | null // 'none'|'monthly'|'quarterly'|'half_yearly'|'annually' -- same enum values as complianceItems.recurrenceType
  budgetedHours?: number | null
}

export async function createEngagement(ctx: FirmServiceContext, input: FirmEngagementInput) {
  await requireFirmEnabled(ctx.orgId)
  if (!input.title?.trim()) throw new ServiceError("title is required", 400)
  if (!input.startDate) throw new ServiceError("startDate is required", 400)
  const recurrenceType = input.recurrenceType && input.recurrenceType !== "none" ? input.recurrenceType : "none"
  if (recurrenceType !== "none" && !RECURRENCE_MONTHS[recurrenceType]) throw new ServiceError("Invalid recurrenceType", 400)

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
      recurrenceType,
      nextOccurrenceDate: recurrenceType !== "none" ? addMonthsToDateStr(input.startDate, RECURRENCE_MONTHS[recurrenceType]) : null,
      budgetedHours: input.budgetedHours != null ? String(input.budgetedHours) : null,
      createdById: ctx.userId,
    }).returning()

    return engagement
  })
}

// Cron entrypoint (see src/app/api/internal/the-firm/recur-engagements/run/route.ts).
// Runs across every org with THE FIRM enabled, same raw-db-for-cross-org-scan
// convention as runFirmDeadlineDigest() in firm-practice-dashboard-service.ts.
// For each engagement whose nextOccurrenceDate has arrived: clones a fresh
// engagement for the new period (same client/serviceLine/feeType/feeAmount/
// budgetedHours/lead partner, startDate = today), then advances the SOURCE
// row's own nextOccurrenceDate forward by one interval -- the same row keeps
// being the generator indefinitely rather than each clone needing its own
// recurrence copy (which would let the chain silently fork/duplicate).
//
// Post-CRITICAL_GAPS.md #2: firm_engagements RLS now requires client_id =
// ANY(current_client_ids()), so this system-level job resolves every
// client in the org first and passes that as clientIds -- same "all"
// pattern runFirmDeadlineDigest() already established, since there is no
// real dbUser to resolve access for here.
export async function generateRecurringEngagements(): Promise<{ orgsScanned: number; engagementsGenerated: number }> {
  const enabledBranches = await db.query.orgProductBranchEnablements.findMany({
    where: eq(orgProductBranchEnablements.isEnabled, true),
    with: { productBranch: true },
  })
  const firmOrgIds = Array.from(new Set(enabledBranches.filter((e) => e.productBranch?.branchKey === "the_firm").map((e) => e.orgId)))

  const todayStr = new Date().toISOString().slice(0, 10)
  let engagementsGenerated = 0

  for (const orgId of firmOrgIds) {
    const allClientIds = await withTenantContext({ orgId }, async (db) => {
      const rows = await db.query.clients.findMany({ where: eq(clients.orgId, orgId), columns: { id: true } })
      return rows.map((c) => c.id)
    })
    if (allClientIds.length === 0) continue

    await withTenantContext({ orgId, clientIds: allClientIds }, async (tx) => {
      const due = await tx.query.firmEngagements.findMany({
        where: and(eq(firmEngagements.orgId, orgId), ne(firmEngagements.recurrenceType, "none"), lte(firmEngagements.nextOccurrenceDate, todayStr), ne(firmEngagements.status, "terminated")),
      })
      for (const source of due) {
        const monthsToAdd = RECURRENCE_MONTHS[source.recurrenceType]
        if (!monthsToAdd) continue

        await tx.insert(firmEngagements).values({
          orgId, clientId: source.clientId, serviceLine: source.serviceLine, title: source.title, scopeOfWork: source.scopeOfWork,
          feeType: source.feeType, feeAmount: source.feeAmount, billingFrequency: source.billingFrequency,
          startDate: todayStr, leadPartnerUserId: source.leadPartnerUserId, budgetedHours: source.budgetedHours,
          recurrenceType: "none", createdById: source.createdById,
        })
        await tx.update(firmEngagements).set({ nextOccurrenceDate: addMonthsToDateStr(source.nextOccurrenceDate!, monthsToAdd), updatedAt: new Date() }).where(eq(firmEngagements.id, source.id))
        engagementsGenerated++
      }
    })
  }

  return { orgsScanned: firmOrgIds.length, engagementsGenerated }
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

// Budget-vs-actual is computed at read time from firm_time_entries rather
// than a maintained running total, same rationale as getRealizationSummary()
// in firm-practice-dashboard-service.ts -- avoids a second source of truth
// that could drift from the underlying time entries.
export async function listEngagementsForClient(ctx: FirmServiceContext, clientId: string) {
  await requireFirmEnabled(ctx.orgId)
  return withFirmTenantContext(ctx, async (db) => {
    const rows = await db.query.firmEngagements.findMany({
      where: and(eq(firmEngagements.clientId, clientId), eq(firmEngagements.orgId, ctx.orgId)),
      orderBy: (t, { desc }) => desc(t.startDate),
    })

    const entries = await db.query.firmTimeEntries.findMany({
      where: and(eq(firmTimeEntries.orgId, ctx.orgId), eq(firmTimeEntries.clientId, clientId)),
    })
    const actualHoursByEngagement = new Map<string, number>()
    for (const entry of entries) {
      if (!entry.engagementId) continue
      actualHoursByEngagement.set(entry.engagementId, (actualHoursByEngagement.get(entry.engagementId) ?? 0) + Number(entry.hours))
    }

    return rows.map((r) => ({ ...r, actualHours: actualHoursByEngagement.get(r.id) ?? 0 }))
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
