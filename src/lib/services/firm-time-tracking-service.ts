// Wave 108 (THE FIRM AI OS) -- client-billable time tracking. Deliberately
// parallel to, not reusing, pmsTimeEntries (see schema.ts's section header
// comment for why): this table is client/engagement-scoped, PMS's is
// project/issue-scoped, and conflating the two would give one table two
// incompatible meanings depending on which FK is populated.
import { firmTimeEntries, clients } from "@/lib/db"
import { type TenantDb } from "@/lib/db/tenant-scoped"
import { and, eq, isNull } from "drizzle-orm"
import { requireFirmEnabled, withFirmTenantContext, type FirmServiceContext } from "./firm-enablement-service"
import { ServiceError } from "./compliance-service"
export { ServiceError }

async function assertClientBelongsToOrg(db: TenantDb, clientId: string, orgId: string) {
  const client = await db.query.clients.findFirst({ where: and(eq(clients.id, clientId), eq(clients.orgId, orgId)) })
  if (!client) throw new ServiceError("Client not found", 404)
}

export type StartTimerInput = {
  clientId: string
  engagementId?: string | null
  taskDescription: string
}

export async function startTimer(ctx: FirmServiceContext, input: StartTimerInput) {
  await requireFirmEnabled(ctx.orgId)
  if (!input.taskDescription?.trim()) throw new ServiceError("taskDescription is required", 400)

  return withFirmTenantContext(ctx, async (db) => {
    await assertClientBelongsToOrg(db, input.clientId, ctx.orgId)

    const alreadyRunning = await db.query.firmTimeEntries.findFirst({
      where: and(eq(firmTimeEntries.userId, ctx.userId), eq(firmTimeEntries.orgId, ctx.orgId), eq(firmTimeEntries.isRunning, true)),
    })
    if (alreadyRunning) throw new ServiceError("You already have a running timer -- stop it before starting a new one", 409)

    const now = new Date()
    const [entry] = await db.insert(firmTimeEntries).values({
      orgId: ctx.orgId,
      clientId: input.clientId,
      engagementId: input.engagementId ?? null,
      userId: ctx.userId,
      taskDescription: input.taskDescription.trim(),
      hours: "0",
      spentOn: now.toISOString().slice(0, 10),
      isRunning: true,
      startedAt: now,
    }).returning()

    return entry
  })
}

export async function stopTimer(ctx: FirmServiceContext, timeEntryId: string) {
  await requireFirmEnabled(ctx.orgId)
  return withFirmTenantContext(ctx, async (db) => {
    const entry = await db.query.firmTimeEntries.findFirst({ where: and(eq(firmTimeEntries.id, timeEntryId), eq(firmTimeEntries.orgId, ctx.orgId)) })
    if (!entry) throw new ServiceError("Time entry not found", 404)
    if (!entry.isRunning || !entry.startedAt) throw new ServiceError("This time entry has no running timer", 409)

    // Flat pass-through of actual elapsed time this wave -- configurable
    // rounding rules (round up to nearest 6/15 min, a common professional-
    // billing convention) are a firm-preference feature, deferred.
    const elapsedMs = Date.now() - entry.startedAt.getTime()
    const hours = Math.round((elapsedMs / (1000 * 60 * 60)) * 100) / 100

    const [updated] = await db.update(firmTimeEntries).set({
      hours: String(Math.max(hours, 0.01)),
      isRunning: false,
      updatedAt: new Date(),
    }).where(eq(firmTimeEntries.id, timeEntryId)).returning()

    return updated
  })
}

export type FirmTimeEntryInput = {
  clientId: string
  engagementId?: string | null
  taskDescription: string
  hours: number
  spentOn: string
  billable?: boolean
}

export async function logManualTimeEntry(ctx: FirmServiceContext, input: FirmTimeEntryInput) {
  await requireFirmEnabled(ctx.orgId)
  if (!input.taskDescription?.trim()) throw new ServiceError("taskDescription is required", 400)
  if (!input.hours || input.hours <= 0) throw new ServiceError("hours must be a positive number", 400)
  if (!input.spentOn) throw new ServiceError("spentOn is required", 400)

  return withFirmTenantContext(ctx, async (db) => {
    await assertClientBelongsToOrg(db, input.clientId, ctx.orgId)

    const [entry] = await db.insert(firmTimeEntries).values({
      orgId: ctx.orgId,
      clientId: input.clientId,
      engagementId: input.engagementId ?? null,
      userId: ctx.userId,
      taskDescription: input.taskDescription.trim(),
      hours: String(input.hours),
      spentOn: input.spentOn,
      billable: input.billable ?? true,
    }).returning()

    return entry
  })
}

export async function listTimeEntries(ctx: FirmServiceContext, filters: { clientId?: string; engagementId?: string; userId?: string; billable?: boolean; unbilledOnly?: boolean }) {
  await requireFirmEnabled(ctx.orgId)
  return withFirmTenantContext(ctx, async (db) => {
    const conditions = [eq(firmTimeEntries.orgId, ctx.orgId)]
    if (filters.clientId) conditions.push(eq(firmTimeEntries.clientId, filters.clientId))
    if (filters.engagementId) conditions.push(eq(firmTimeEntries.engagementId, filters.engagementId))
    if (filters.userId) conditions.push(eq(firmTimeEntries.userId, filters.userId))
    if (filters.billable !== undefined) conditions.push(eq(firmTimeEntries.billable, filters.billable))
    if (filters.unbilledOnly) conditions.push(isNull(firmTimeEntries.invoiceLineItemId))
    return db.query.firmTimeEntries.findMany({
      where: and(...conditions),
      orderBy: (t, { desc }) => desc(t.spentOn),
    })
  })
}

export type FirmTimeEntryPatch = Partial<Pick<FirmTimeEntryInput, "taskDescription" | "hours" | "spentOn" | "billable">>

export async function updateTimeEntry(ctx: FirmServiceContext, timeEntryId: string, patch: FirmTimeEntryPatch) {
  await requireFirmEnabled(ctx.orgId)
  return withFirmTenantContext(ctx, async (db) => {
    const existing = await db.query.firmTimeEntries.findFirst({ where: and(eq(firmTimeEntries.id, timeEntryId), eq(firmTimeEntries.orgId, ctx.orgId)) })
    if (!existing) throw new ServiceError("Time entry not found", 404)
    if (existing.invoiceLineItemId) throw new ServiceError("This time entry has already been billed and cannot be edited", 409)

    const [updated] = await db.update(firmTimeEntries).set({
      taskDescription: patch.taskDescription?.trim() ?? existing.taskDescription,
      hours: patch.hours !== undefined ? String(patch.hours) : existing.hours,
      spentOn: patch.spentOn ?? existing.spentOn,
      billable: patch.billable ?? existing.billable,
      updatedAt: new Date(),
    }).where(eq(firmTimeEntries.id, timeEntryId)).returning()

    return updated
  })
}
