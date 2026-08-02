// Minimal service layer for erpItems/erpWarehouses (Wave 49 schema, no
// service-layer consumer until now) -- backs the Wave 53 Inventory UI's
// item/warehouse pickers and quick-add.
import { erpItems, erpWarehouses, users } from "@/lib/db"
import { withTenantContext } from "@/lib/db/tenant-scoped"
import { eq } from "drizzle-orm"
import { ServiceError } from "./compliance-service"
export { ServiceError }
import { logActivity } from "@/lib/audit"
import { requireErpEnabled } from "./erp-enablement-service"

export type ErpContext = { orgId: string; userId: string; dbUser: typeof users.$inferSelect }

// Priority 17 Wave 1 (PROJEXA Inventory/Stock exposure): widened to the same
// dbUser-or-apiKey actor union already precedented by erp-invoicing-
// service.ts's createSalesInvoice / erp-accounting-service.ts's
// createJournalEntry -- PROJEXA's callVeridian() proxy always calls
// server-to-server with a shared Bearer API key, never a session cookie.
export type ActorCtx = { orgId: string; userId: string } & (
  | { dbUser: typeof users.$inferSelect; apiKey?: never }
  | { dbUser?: never; apiKey: { id: string; name: string } }
)

export async function listItems(ctx: { orgId: string }) {
  await requireErpEnabled(ctx.orgId)
  return withTenantContext({ orgId: ctx.orgId }, async (db) => {
    return db.query.erpItems.findMany({ where: eq(erpItems.orgId, ctx.orgId), orderBy: (t, { asc }) => asc(t.itemName) })
  })
}

export async function createItem(ctx: ActorCtx, input: { itemCode: string; itemName: string; uom?: string; standardBuyingRate?: number; standardSellingRate?: number; hasBatchNo?: boolean; hasSerialNo?: boolean; hsnSacCode?: string }) {
  await requireErpEnabled(ctx.orgId)
  if (!input.itemCode?.trim() || !input.itemName?.trim()) throw new ServiceError("itemCode and itemName are required", 400)
  return withTenantContext({ orgId: ctx.orgId, userId: ctx.userId }, async (db) => {
    const [item] = await db.insert(erpItems).values({
      orgId: ctx.orgId, itemCode: input.itemCode, itemName: input.itemName, uom: input.uom,
      standardBuyingRate: input.standardBuyingRate?.toString(), standardSellingRate: input.standardSellingRate?.toString(),
      hasBatchNo: input.hasBatchNo ?? false, hasSerialNo: input.hasSerialNo ?? false,
      hsnSacCode: input.hsnSacCode?.trim() || null,
    }).returning()
    await logActivity({ tx: db, orgId: ctx.orgId, ...(ctx.dbUser ? { dbUser: ctx.dbUser } : { apiKey: ctx.apiKey! }), action: "erp_item.created", entityType: "erp_item", entityId: item.id })
    return item
  })
}

export async function listWarehouses(ctx: { orgId: string }) {
  await requireErpEnabled(ctx.orgId)
  return withTenantContext({ orgId: ctx.orgId }, async (db) => {
    return db.query.erpWarehouses.findMany({ where: eq(erpWarehouses.orgId, ctx.orgId), orderBy: (t, { asc }) => asc(t.warehouseName) })
  })
}

export async function createWarehouse(ctx: ActorCtx, input: { warehouseName: string; parentWarehouseId?: string }) {
  await requireErpEnabled(ctx.orgId)
  if (!input.warehouseName?.trim()) throw new ServiceError("warehouseName is required", 400)
  return withTenantContext({ orgId: ctx.orgId, userId: ctx.userId }, async (db) => {
    const [wh] = await db.insert(erpWarehouses).values({ orgId: ctx.orgId, warehouseName: input.warehouseName, parentWarehouseId: input.parentWarehouseId }).returning()
    await logActivity({ tx: db, orgId: ctx.orgId, ...(ctx.dbUser ? { dbUser: ctx.dbUser } : { apiKey: ctx.apiKey! }), action: "erp_warehouse.created", entityType: "erp_warehouse", entityId: wh.id })
    return wh
  })
}
