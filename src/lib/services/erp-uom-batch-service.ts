// Wave 57 (VERI ERP gap-fill, Tier 3 #12): Multi-UOM conversion +
// batch/serial tracking. Batch/serial are traceability metadata on stock
// movements, not a per-batch FIFO redesign -- valuation continues at the
// item-warehouse level (see erp-inventory-service.ts's own FIFO layers).
import { erpItems, erpItemUomConversions, erpItemBatches, erpItemSerials, users } from "@/lib/db"
import { withTenantContext, type TenantDb } from "@/lib/db/tenant-scoped"
import { and, eq } from "drizzle-orm"
import { ServiceError } from "./compliance-service"
export { ServiceError }
import { logActivity } from "@/lib/audit"
import { requireErpEnabled } from "./erp-enablement-service"

export type ErpContext = { orgId: string; userId: string; dbUser: typeof users.$inferSelect }

// ============================================================
// UOM Conversions
// ============================================================

export async function listUomConversions(ctx: { orgId: string }, itemId?: string) {
  await requireErpEnabled(ctx.orgId)
  return withTenantContext({ orgId: ctx.orgId }, async (db) => {
    return db.query.erpItemUomConversions.findMany({
      where: itemId ? and(eq(erpItemUomConversions.orgId, ctx.orgId), eq(erpItemUomConversions.itemId, itemId)) : eq(erpItemUomConversions.orgId, ctx.orgId),
      with: { item: true },
    })
  })
}

export async function createUomConversion(ctx: ErpContext, input: { itemId: string; uom: string; conversionFactor: number }) {
  await requireErpEnabled(ctx.orgId)
  if (!input.uom?.trim()) throw new ServiceError("uom is required", 400)
  if (input.conversionFactor <= 0) throw new ServiceError("conversionFactor must be positive", 400)

  return withTenantContext({ orgId: ctx.orgId, userId: ctx.userId }, async (db) => {
    const item = await db.query.erpItems.findFirst({ where: and(eq(erpItems.id, input.itemId), eq(erpItems.orgId, ctx.orgId)) })
    if (!item) throw new ServiceError("Item not found", 404)

    const [conversion] = await db.insert(erpItemUomConversions).values({
      orgId: ctx.orgId, itemId: input.itemId, uom: input.uom, conversionFactor: input.conversionFactor.toString(),
    }).returning()

    await logActivity({ tx: db, orgId: ctx.orgId, dbUser: ctx.dbUser, action: "erp_item_uom_conversion.created", entityType: "erp_item_uom_conversion", entityId: conversion.id })
    return conversion
  })
}

/**
 * Converts a quantity entered in `uom` to the item's stock UOM. Returns the
 * qty unchanged if `uom` is missing or matches the item's own stock UOM --
 * the stock ledger's quantityChange is always in stock UOM, regardless of
 * what unit a receipt/issue was recorded in.
 */
export async function convertToStockUom(db: TenantDb, orgId: string, itemId: string, uom: string | undefined, qty: number): Promise<number> {
  if (!uom) return qty
  const item = await db.query.erpItems.findFirst({ where: and(eq(erpItems.id, itemId), eq(erpItems.orgId, orgId)) })
  if (item?.uom && uom.toLowerCase() === item.uom.toLowerCase()) return qty

  const conversion = await db.query.erpItemUomConversions.findFirst({
    where: and(eq(erpItemUomConversions.orgId, orgId), eq(erpItemUomConversions.itemId, itemId), eq(erpItemUomConversions.uom, uom)),
  })
  if (!conversion) throw new ServiceError(`No UOM conversion configured for '${uom}' on this item`, 400)
  return qty * Number(conversion.conversionFactor)
}

// ============================================================
// Batches
// ============================================================

export async function listBatches(ctx: { orgId: string }, itemId?: string) {
  await requireErpEnabled(ctx.orgId)
  return withTenantContext({ orgId: ctx.orgId }, async (db) => {
    return db.query.erpItemBatches.findMany({
      where: itemId ? and(eq(erpItemBatches.orgId, ctx.orgId), eq(erpItemBatches.itemId, itemId)) : eq(erpItemBatches.orgId, ctx.orgId),
      orderBy: (t, { asc }) => asc(t.expiryDate),
      with: { item: true },
    })
  })
}

export async function createBatch(ctx: ErpContext, input: { itemId: string; batchNumber: string; manufacturingDate?: string; expiryDate?: string }) {
  await requireErpEnabled(ctx.orgId)
  if (!input.batchNumber?.trim()) throw new ServiceError("batchNumber is required", 400)

  return withTenantContext({ orgId: ctx.orgId, userId: ctx.userId }, async (db) => {
    const item = await db.query.erpItems.findFirst({ where: and(eq(erpItems.id, input.itemId), eq(erpItems.orgId, ctx.orgId)) })
    if (!item) throw new ServiceError("Item not found", 404)

    const [batch] = await db.insert(erpItemBatches).values({
      orgId: ctx.orgId, itemId: input.itemId, batchNumber: input.batchNumber,
      manufacturingDate: input.manufacturingDate, expiryDate: input.expiryDate,
    }).returning()

    await logActivity({ tx: db, orgId: ctx.orgId, dbUser: ctx.dbUser, action: "erp_item_batch.created", entityType: "erp_item_batch", entityId: batch.id })
    return batch
  })
}

// ============================================================
// Serials
// ============================================================

export async function listSerials(ctx: { orgId: string }, itemId?: string) {
  await requireErpEnabled(ctx.orgId)
  return withTenantContext({ orgId: ctx.orgId }, async (db) => {
    return db.query.erpItemSerials.findMany({
      where: itemId ? and(eq(erpItemSerials.orgId, ctx.orgId), eq(erpItemSerials.itemId, itemId)) : eq(erpItemSerials.orgId, ctx.orgId),
      orderBy: (t, { desc }) => desc(t.createdAt),
      with: { item: true, warehouse: true },
    })
  })
}

export async function createSerials(ctx: ErpContext, input: { itemId: string; serialNumbers: string[]; warehouseId?: string }) {
  await requireErpEnabled(ctx.orgId)
  if (!input.serialNumbers?.length) throw new ServiceError("At least one serial number is required", 400)

  return withTenantContext({ orgId: ctx.orgId, userId: ctx.userId }, async (db) => {
    const item = await db.query.erpItems.findFirst({ where: and(eq(erpItems.id, input.itemId), eq(erpItems.orgId, ctx.orgId)) })
    if (!item) throw new ServiceError("Item not found", 404)

    const serials = await db.insert(erpItemSerials).values(
      input.serialNumbers.map((serialNumber) => ({ orgId: ctx.orgId, itemId: input.itemId, serialNumber, warehouseId: input.warehouseId }))
    ).returning()

    await logActivity({ tx: db, orgId: ctx.orgId, dbUser: ctx.dbUser, action: "erp_item_serial.created", entityType: "erp_item_serial", entityId: serials[0]?.id ?? "" })
    return serials
  })
}

export async function updateSerialStatus(ctx: ErpContext, serialId: string, status: "in_stock" | "delivered" | "returned") {
  await requireErpEnabled(ctx.orgId)
  return withTenantContext({ orgId: ctx.orgId, userId: ctx.userId }, async (db) => {
    const serial = await db.query.erpItemSerials.findFirst({ where: and(eq(erpItemSerials.id, serialId), eq(erpItemSerials.orgId, ctx.orgId)) })
    if (!serial) throw new ServiceError("Serial not found", 404)
    const [updated] = await db.update(erpItemSerials).set({ status }).where(eq(erpItemSerials.id, serialId)).returning()
    await logActivity({ tx: db, orgId: ctx.orgId, dbUser: ctx.dbUser, action: "erp_item_serial.status_updated", entityType: "erp_item_serial", entityId: serialId })
    return updated
  })
}
