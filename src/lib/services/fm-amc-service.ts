// Wave 107 (VERI FM & CS AI OS) -- AMC (Annual Maintenance Contract)
// CRUD. Reuses the existing erp_suppliers vendor master for the contract
// vendor -- no new FM-specific vendor table, per the design decision.
import { fmAmcContracts, erpSuppliers, fmAssets } from "@/lib/db"
import { withTenantContext } from "@/lib/db/tenant-scoped"
import { and, eq, lte, gte } from "drizzle-orm"
import { requireFmEnabled } from "./fm-enablement-service"
import { ServiceError } from "./compliance-service"
export { ServiceError }
import type { users } from "@/lib/db"

export type FmAmcContext = { orgId: string; userId: string; dbUser: typeof users.$inferSelect }

export type FmAmcContractInput = {
  assetId: string
  vendorId: string
  contractStartDate: string
  contractEndDate: string
  paymentFrequency: string
  contractedYearlyServiceCount: number
  firstServiceDate?: string | null
  contractValue?: number | null
  notes?: string | null
}

export async function createAmcContract(ctx: FmAmcContext, input: FmAmcContractInput) {
  await requireFmEnabled(ctx.orgId)
  if (!input.contractStartDate || !input.contractEndDate) throw new ServiceError("contractStartDate and contractEndDate are required", 400)
  if (!input.contractedYearlyServiceCount || input.contractedYearlyServiceCount < 1) throw new ServiceError("contractedYearlyServiceCount must be at least 1", 400)

  return withTenantContext({ orgId: ctx.orgId, userId: ctx.userId }, async (db) => {
    const vendor = await db.query.erpSuppliers.findFirst({ where: and(eq(erpSuppliers.id, input.vendorId), eq(erpSuppliers.orgId, ctx.orgId)) })
    if (!vendor) throw new ServiceError("Vendor not found", 404)
    const asset = await db.query.fmAssets.findFirst({ where: and(eq(fmAssets.id, input.assetId), eq(fmAssets.orgId, ctx.orgId)) })
    if (!asset) throw new ServiceError("Asset not found", 404)

    const [contract] = await db.insert(fmAmcContracts).values({
      orgId: ctx.orgId,
      assetId: input.assetId,
      vendorId: input.vendorId,
      contractStartDate: input.contractStartDate,
      contractEndDate: input.contractEndDate,
      paymentFrequency: input.paymentFrequency as typeof fmAmcContracts.$inferSelect["paymentFrequency"],
      contractedYearlyServiceCount: input.contractedYearlyServiceCount,
      firstServiceDate: input.firstServiceDate ?? null,
      contractValue: input.contractValue != null ? String(input.contractValue) : null,
      notes: input.notes ?? null,
      createdById: ctx.userId,
    }).returning()

    // Maintain the denormalized "current AMC" cache on the asset -- same
    // cached-pointer convention erpSuppliers' qualification-status columns
    // already use, updated by the service layer, not a DB trigger.
    await db.update(fmAssets).set({ amcContractId: contract.id, updatedAt: new Date() }).where(eq(fmAssets.id, input.assetId))

    return contract
  })
}

export async function listAmcContractsForAsset(ctx: { orgId: string }, assetId: string) {
  await requireFmEnabled(ctx.orgId)
  return withTenantContext({ orgId: ctx.orgId }, async (db) => {
    return db.query.fmAmcContracts.findMany({
      where: and(eq(fmAmcContracts.assetId, assetId), eq(fmAmcContracts.orgId, ctx.orgId)),
      orderBy: (t, { desc }) => desc(t.contractStartDate),
    })
  })
}

/** Contracts expiring within `withinDays` (default 30) -- the query an
 *  expiry-alert notification (future wave) would run. */
export async function listExpiringAmcContracts(ctx: { orgId: string }, withinDays = 30) {
  await requireFmEnabled(ctx.orgId)
  return withTenantContext({ orgId: ctx.orgId }, async (db) => {
    const today = new Date().toISOString().slice(0, 10)
    const cutoff = new Date(Date.now() + withinDays * 24 * 60 * 60 * 1000).toISOString().slice(0, 10)
    return db.query.fmAmcContracts.findMany({
      where: and(
        eq(fmAmcContracts.orgId, ctx.orgId),
        eq(fmAmcContracts.status, "active"),
        gte(fmAmcContracts.contractEndDate, today),
        lte(fmAmcContracts.contractEndDate, cutoff)
      ),
      orderBy: (t, { asc }) => asc(t.contractEndDate),
    })
  })
}
