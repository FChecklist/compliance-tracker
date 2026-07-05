// Wave 53 (VERI ERP gap-fill, Tier 1 #4): the FIFO valuation engine
// erp_stock_ledger_entries lacked since Wave 49 -- per
// ERP_BENCHMARK_COMPARISON.md, its valuation_rate was a raw stored number
// with no layer/queue logic, so COGS and balance-sheet inventory value
// weren't trustworthy. recordStockReceipt creates a new FIFO layer;
// recordStockIssue consumes layers oldest-first (matching ERPNext's own
// stock_queue approach) and computes the true weighted cost of the
// consumed quantity as this issue's valuation_rate, rather than
// accepting an arbitrary caller-supplied number.
import { erpItems, erpWarehouses, erpStockLedgerEntries, erpStockValuationLayers, erpItemBatches, users } from "@/lib/db"
import { withTenantContext, type TenantDb } from "@/lib/db/tenant-scoped"
import { and, eq, asc, sql } from "drizzle-orm"
import { ServiceError } from "./compliance-service"
export { ServiceError }
import { logActivity } from "@/lib/audit"
import { convertToStockUom } from "./erp-uom-batch-service"

export type ErpContext = { orgId: string; userId: string; dbUser: typeof users.$inferSelect }

async function currentBalance(db: TenantDb, itemId: string, warehouseId: string): Promise<{ qty: number; value: number }> {
  const [row] = await db
    .select({
      qty: sql<string>`coalesce(sum(${erpStockLedgerEntries.quantityChange}), 0)`,
      value: sql<string>`coalesce(sum(${erpStockLedgerEntries.quantityChange} * ${erpStockLedgerEntries.valuationRate}), 0)`,
    })
    .from(erpStockLedgerEntries)
    .where(and(eq(erpStockLedgerEntries.itemId, itemId), eq(erpStockLedgerEntries.warehouseId, warehouseId)))
  return { qty: Number(row?.qty ?? 0), value: Number(row?.value ?? 0) }
}

export type StockReceiptInput = {
  itemId: string; warehouseId: string; quantity: number; rate: number; postingDate: string; voucherType: string; voucherId: string
  // Wave 57: optional alternate-UOM entry (converted to stock UOM before
  // posting) and batch metadata -- both purely additive, existing callers
  // that omit them behave exactly as before.
  uom?: string; batchNumber?: string; expiryDate?: string
}

/** Records a stock receipt and opens a new FIFO layer for it. */
export async function recordStockReceipt(ctx: ErpContext, input: StockReceiptInput) {
  if (input.quantity <= 0) throw new ServiceError("quantity must be positive", 400)
  if (input.rate < 0) throw new ServiceError("rate cannot be negative", 400)

  return withTenantContext({ orgId: ctx.orgId, userId: ctx.userId }, async (db) => {
    const item = await db.query.erpItems.findFirst({ where: and(eq(erpItems.id, input.itemId), eq(erpItems.orgId, ctx.orgId)) })
    if (!item) throw new ServiceError("Item not found", 404)
    const warehouse = await db.query.erpWarehouses.findFirst({ where: and(eq(erpWarehouses.id, input.warehouseId), eq(erpWarehouses.orgId, ctx.orgId)) })
    if (!warehouse) throw new ServiceError("Warehouse not found", 404)

    const stockQty = await convertToStockUom(db, ctx.orgId, input.itemId, input.uom, input.quantity)

    let batchId: string | undefined
    if (item.hasBatchNo) {
      if (!input.batchNumber?.trim()) throw new ServiceError("This item requires a batch number", 400)
      const [batch] = await db.insert(erpItemBatches).values({
        orgId: ctx.orgId, itemId: input.itemId, batchNumber: input.batchNumber, expiryDate: input.expiryDate,
      }).returning()
      batchId = batch.id
    }

    const before = await currentBalance(db, input.itemId, input.warehouseId)
    const newQty = before.qty + stockQty
    const newValue = before.value + stockQty * input.rate

    const [entry] = await db.insert(erpStockLedgerEntries).values({
      orgId: ctx.orgId, itemId: input.itemId, warehouseId: input.warehouseId, postingDate: input.postingDate,
      voucherType: input.voucherType, voucherId: input.voucherId,
      quantityChange: stockQty.toString(), valuationRate: input.rate.toString(),
      balanceQty: newQty.toString(), balanceValue: newValue.toString(),
      transactionUom: input.uom, transactionQty: input.uom ? input.quantity.toString() : undefined, batchId,
    }).returning()

    await db.insert(erpStockValuationLayers).values({
      orgId: ctx.orgId, itemId: input.itemId, warehouseId: input.warehouseId, stockLedgerEntryId: entry.id,
      receiptDate: input.postingDate, originalQty: stockQty.toString(), remainingQty: stockQty.toString(), rate: input.rate.toString(),
    })

    await logActivity({ tx: db, orgId: ctx.orgId, dbUser: ctx.dbUser, action: "erp_stock.received", entityType: "erp_stock_ledger_entry", entityId: entry.id })
    return entry
  })
}

export type StockIssueInput = {
  itemId: string; warehouseId: string; quantity: number; postingDate: string; voucherType: string; voucherId: string
  uom?: string // Wave 57: optional alternate-UOM entry, converted to stock UOM before posting
}

/**
 * Records a stock issue, consuming FIFO layers oldest-first. The
 * valuation_rate on the resulting ledger entry is the true weighted
 * average cost of what was actually consumed, not an arbitrary number --
 * this is the core fix: previously nothing computed this at all.
 */
export async function recordStockIssue(ctx: ErpContext, input: StockIssueInput) {
  if (input.quantity <= 0) throw new ServiceError("quantity must be positive", 400)

  return withTenantContext({ orgId: ctx.orgId, userId: ctx.userId }, async (db) => {
    const issueQty = await convertToStockUom(db, ctx.orgId, input.itemId, input.uom, input.quantity)

    const layers = await db.query.erpStockValuationLayers.findMany({
      where: and(
        eq(erpStockValuationLayers.orgId, ctx.orgId),
        eq(erpStockValuationLayers.itemId, input.itemId),
        eq(erpStockValuationLayers.warehouseId, input.warehouseId),
        sql`${erpStockValuationLayers.remainingQty} > 0`
      ),
      orderBy: asc(erpStockValuationLayers.receiptDate),
    })

    const available = layers.reduce((sum, l) => sum + Number(l.remainingQty), 0)
    if (available < issueQty) {
      throw new ServiceError(`Insufficient stock: ${available} available, ${issueQty} requested`, 409)
    }

    let remainingToConsume = issueQty
    let totalCost = 0
    for (const layer of layers) {
      if (remainingToConsume <= 0) break
      const layerQty = Number(layer.remainingQty)
      const consumeQty = Math.min(layerQty, remainingToConsume)
      totalCost += consumeQty * Number(layer.rate)
      remainingToConsume -= consumeQty
      await db.update(erpStockValuationLayers).set({ remainingQty: (layerQty - consumeQty).toString() }).where(eq(erpStockValuationLayers.id, layer.id))
    }

    const weightedRate = totalCost / issueQty

    const before = await currentBalance(db, input.itemId, input.warehouseId)
    const newQty = before.qty - issueQty
    const newValue = before.value - totalCost

    const [entry] = await db.insert(erpStockLedgerEntries).values({
      orgId: ctx.orgId, itemId: input.itemId, warehouseId: input.warehouseId, postingDate: input.postingDate,
      voucherType: input.voucherType, voucherId: input.voucherId,
      quantityChange: (-issueQty).toString(), valuationRate: weightedRate.toString(),
      balanceQty: newQty.toString(), balanceValue: newValue.toString(),
      transactionUom: input.uom, transactionQty: input.uom ? input.quantity.toString() : undefined,
    }).returning()

    await logActivity({ tx: db, orgId: ctx.orgId, dbUser: ctx.dbUser, action: "erp_stock.issued", entityType: "erp_stock_ledger_entry", entityId: entry.id })
    return entry
  })
}

export async function getItemValuation(ctx: { orgId: string }, itemId: string, warehouseId: string) {
  return withTenantContext({ orgId: ctx.orgId }, async (db) => {
    const { qty, value } = await currentBalance(db, itemId, warehouseId)
    return { qty, value, averageCost: qty > 0 ? value / qty : 0 }
  })
}

export async function listStockLedger(ctx: { orgId: string }, filters: { itemId?: string; warehouseId?: string } = {}) {
  return withTenantContext({ orgId: ctx.orgId }, async (db) => {
    const conditions = [eq(erpStockLedgerEntries.orgId, ctx.orgId)]
    if (filters.itemId) conditions.push(eq(erpStockLedgerEntries.itemId, filters.itemId))
    if (filters.warehouseId) conditions.push(eq(erpStockLedgerEntries.warehouseId, filters.warehouseId))
    return db.query.erpStockLedgerEntries.findMany({ where: and(...conditions), orderBy: (t, { desc }) => desc(t.postingDate) })
  })
}
