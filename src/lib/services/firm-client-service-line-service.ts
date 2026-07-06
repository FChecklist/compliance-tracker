// Wave 108 (THE FIRM AI OS) -- per-client toggle for which of the 5
// service lines (CA/CS/Legal/GRC/Audit) a client actually receives.
import { firmClientServiceLines, clients } from "@/lib/db"
import { withTenantContext, type TenantDb } from "@/lib/db/tenant-scoped"
import { and, eq } from "drizzle-orm"
import { requireFirmEnabled } from "./firm-enablement-service"
import { ServiceError } from "./compliance-service"
export { ServiceError }

export type FirmServiceLine = typeof firmClientServiceLines.$inferSelect["serviceLine"]

async function assertClientBelongsToOrg(db: TenantDb, clientId: string, orgId: string) {
  const client = await db.query.clients.findFirst({ where: and(eq(clients.id, clientId), eq(clients.orgId, orgId)) })
  if (!client) throw new ServiceError("Client not found", 404)
}

export type SetServiceLineInput = {
  isEnabled?: boolean
  leadStaffUserId?: string | null
  notes?: string | null
}

export async function setServiceLineForClient(ctx: { orgId: string }, clientId: string, serviceLine: FirmServiceLine, input: SetServiceLineInput) {
  await requireFirmEnabled(ctx.orgId)
  return withTenantContext({ orgId: ctx.orgId }, async (db) => {
    await assertClientBelongsToOrg(db, clientId, ctx.orgId)

    const existing = await db.query.firmClientServiceLines.findFirst({
      where: and(eq(firmClientServiceLines.clientId, clientId), eq(firmClientServiceLines.serviceLine, serviceLine)),
    })

    if (existing) {
      const [updated] = await db.update(firmClientServiceLines).set({
        isEnabled: input.isEnabled ?? existing.isEnabled,
        leadStaffUserId: input.leadStaffUserId !== undefined ? input.leadStaffUserId : existing.leadStaffUserId,
        notes: input.notes !== undefined ? input.notes : existing.notes,
        updatedAt: new Date(),
      }).where(eq(firmClientServiceLines.id, existing.id)).returning()
      return updated
    }

    const [created] = await db.insert(firmClientServiceLines).values({
      orgId: ctx.orgId,
      clientId,
      serviceLine,
      isEnabled: input.isEnabled ?? true,
      leadStaffUserId: input.leadStaffUserId ?? null,
      notes: input.notes ?? null,
    }).returning()
    return created
  })
}

export async function listServiceLinesForClient(ctx: { orgId: string }, clientId: string) {
  await requireFirmEnabled(ctx.orgId)
  return withTenantContext({ orgId: ctx.orgId }, async (db) => {
    return db.query.firmClientServiceLines.findMany({
      where: and(eq(firmClientServiceLines.clientId, clientId), eq(firmClientServiceLines.orgId, ctx.orgId)),
    })
  })
}

export async function listClientsForServiceLine(ctx: { orgId: string }, serviceLine: FirmServiceLine) {
  await requireFirmEnabled(ctx.orgId)
  return withTenantContext({ orgId: ctx.orgId }, async (db) => {
    return db.query.firmClientServiceLines.findMany({
      where: and(eq(firmClientServiceLines.orgId, ctx.orgId), eq(firmClientServiceLines.serviceLine, serviceLine), eq(firmClientServiceLines.isEnabled, true)),
      with: { client: true },
    })
  })
}
