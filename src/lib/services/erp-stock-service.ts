// Minimal service layer for erpItems/erpWarehouses (Wave 49 schema, no
// service-layer consumer until now) -- backs the Wave 53 Inventory UI's
// item/warehouse pickers and quick-add.
import { erpItems, erpWarehouses, users } from "@/lib/db"
import { withTenantContext } from "@/lib/db/tenant-scoped"
import { eq } from "drizzle-orm"
import { ServiceError } from "./compliance-service"
export { ServiceError }
import { logActivity } from "@/lib/audit"

export type ErpContext = { orgId: string; userId: string; dbUser: typeof users.$inferSelect }

export async function listItems(ctx: { orgId: string }) {
  return withTenantContext({ orgId: ctx.orgId }, async (db) => {
    return db.query.erpItems.findMany({ where: eq(erpItems.orgId, ctx.orgId), orderBy: (t, { asc }) => asc(t.itemName) })
  })
}

export async function createItem(ctx: ErpContext, input: { itemCode: string; itemName: string; uom?: string; standardBuyingRate?: number; standardSellingRate?: number; hasBatchNo?: boolean; hasSerialNo?: boolean }) {
  if (!input.itemCode?.trim() || !input.itemName?.trim()) throw new ServiceError("itemCode and itemName are required", 400)
  return withTenantContext({ orgId: ctx.orgId, userId: ctx.userId }, async (db) => {
    const [item] = await db.insert(erpItems).values({
      orgId: ctx.orgId, itemCode: input.itemCode, itemName: input.itemName, uom: input.uom,
      standardBuyingRate: input.standardBuyingRate?.toString(), standardSellingRate: input.standardSellingRate?.toString(),
      hasBatchNo: input.hasBatchNo ?? false, hasSerialNo: input.hasSerialNo ?? false,
    }).returning()
    await logActivity({ tx: db, orgId: ctx.orgId, dbUser: ctx.dbUser, action: "erp_item.created", entityType: "erp_item", entityId: item.id })
    return item
  })
}

export async function listWarehouses(ctx: { orgId: string }) {
  return withTenantContext({ orgId: ctx.orgId }, async (db) => {
    return db.query.erpWarehouses.findMany({ where: eq(erpWarehouses.orgId, ctx.orgId), orderBy: (t, { asc }) => asc(t.warehouseName) })
  })
}

export async function createWarehouse(ctx: ErpContext, input: { warehouseName: string; parentWarehouseId?: string }) {
  if (!input.warehouseName?.trim()) throw new ServiceError("warehouseName is required", 400)
  return withTenantContext({ orgId: ctx.orgId, userId: ctx.userId }, async (db) => {
    const [wh] = await db.insert(erpWarehouses).values({ orgId: ctx.orgId, warehouseName: input.warehouseName, parentWarehouseId: input.parentWarehouseId }).returning()
    await logActivity({ tx: db, orgId: ctx.orgId, dbUser: ctx.dbUser, action: "erp_warehouse.created", entityType: "erp_warehouse", entityId: wh.id })
    return wh
  })
}
