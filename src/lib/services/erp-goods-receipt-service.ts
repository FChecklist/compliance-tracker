// Wave 85 (COMPARISON_CSV_GAP_ANALYSIS.md backlog #6, final backlog item):
// Goods Receipt three-way-match (PO/GRN/Invoice), landed-cost allocation,
// putaway confirmation. erp_purchase_receipts has existed since Wave 49
// with zero create/submit service consumer -- only ever read for Wave 64's
// scorecard -- so this also builds the base GRN workflow the three named
// enhancements need to attach to.
import {
  erpPurchaseOrders, erpPurchaseOrderItems, erpPurchaseReceipts, erpPurchaseReceiptItems,
  erpPurchaseInvoices, erpPurchaseInvoiceItems, erpSuppliers,
  erpLandedCostVouchers, erpLandedCostCharges, erpLandedCostAllocations,
  erpStockLedgerEntries, erpStockValuationLayers, users,
} from "@/lib/db"
import { withTenantContext } from "@/lib/db/tenant-scoped"
import { and, eq, sql } from "drizzle-orm"
import { ServiceError } from "./compliance-service"
export { ServiceError }
import { logActivity } from "@/lib/audit"
import { recordStockReceipt } from "./erp-inventory-service"

export type ErpContext = { orgId: string; userId: string; dbUser: typeof users.$inferSelect }

type ReceiptItemInput = { purchaseOrderItemId?: string; itemId?: string; quantity?: number; warehouseId: string; rate?: number }

// ============================================================
// Goods Receipt (GRN)
// ============================================================

export async function listPurchaseReceipts(ctx: { orgId: string }) {
  return withTenantContext({ orgId: ctx.orgId }, (db) =>
    db.query.erpPurchaseReceipts.findMany({
      where: eq(erpPurchaseReceipts.orgId, ctx.orgId),
      orderBy: (t, { desc }) => desc(t.postingDate),
      with: { items: true, supplier: true },
    })
  )
}

export async function getPurchaseReceipt(ctx: { orgId: string }, receiptId: string) {
  return withTenantContext({ orgId: ctx.orgId }, async (db) => {
    const receipt = await db.query.erpPurchaseReceipts.findFirst({
      where: and(eq(erpPurchaseReceipts.id, receiptId), eq(erpPurchaseReceipts.orgId, ctx.orgId)),
      with: { items: true, supplier: true },
    })
    if (!receipt) throw new ServiceError("Purchase receipt not found", 404)
    return receipt
  })
}

export async function createPurchaseReceipt(
  ctx: ErpContext,
  input: { supplierId: string; purchaseOrderId?: string; postingDate: string; items: ReceiptItemInput[] }
) {
  if (!input.supplierId) throw new ServiceError("supplierId is required", 400)
  if (!input.items?.length) throw new ServiceError("At least one line item is required", 400)
  if (input.items.some((i) => !i.warehouseId)) throw new ServiceError("Every line item requires a receiving warehouse", 400)

  return withTenantContext({ orgId: ctx.orgId, userId: ctx.userId }, async (db) => {
    const supplier = await db.query.erpSuppliers.findFirst({ where: and(eq(erpSuppliers.id, input.supplierId), eq(erpSuppliers.orgId, ctx.orgId)) })
    if (!supplier) throw new ServiceError("Supplier not found", 404)

    if (input.purchaseOrderId) {
      const po = await db.query.erpPurchaseOrders.findFirst({ where: and(eq(erpPurchaseOrders.id, input.purchaseOrderId), eq(erpPurchaseOrders.orgId, ctx.orgId)) })
      if (!po) throw new ServiceError("Purchase order not found", 404)
    }

    const [{ maxNumber }] = await db.select({ maxNumber: sql<number>`coalesce(max(${erpPurchaseReceipts.receiptNumber}), 0)` })
      .from(erpPurchaseReceipts).where(eq(erpPurchaseReceipts.orgId, ctx.orgId))

    const [receipt] = await db.insert(erpPurchaseReceipts).values({
      orgId: ctx.orgId, supplierId: input.supplierId, purchaseOrderId: input.purchaseOrderId,
      receiptNumber: Number(maxNumber) + 1, postingDate: input.postingDate, createdById: ctx.userId,
    }).returning()

    await db.insert(erpPurchaseReceiptItems).values(
      input.items.map((i) => ({
        receiptId: receipt.id, purchaseOrderItemId: i.purchaseOrderItemId, itemId: i.itemId,
        quantity: (i.quantity ?? 1).toString(), warehouseId: i.warehouseId, rate: i.rate?.toString(),
      }))
    )

    await logActivity({ tx: db, orgId: ctx.orgId, dbUser: ctx.dbUser, action: "erp_purchase_receipt.created", entityType: "erp_purchase_receipt", entityId: receipt.id })
    return receipt
  })
}

/**
 * Posts stock for every line (recordStockReceipt opens a new FIFO layer
 * each) and, for lines linked to a PO item, increments that PO item's
 * receivedQuantity + rolls the parent PO's status up to
 * partially_received/completed -- both previously dead columns with no
 * writer at all.
 */
export async function submitPurchaseReceipt(ctx: ErpContext, receiptId: string) {
  return withTenantContext({ orgId: ctx.orgId, userId: ctx.userId }, async (db) => {
    const receipt = await db.query.erpPurchaseReceipts.findFirst({
      where: and(eq(erpPurchaseReceipts.id, receiptId), eq(erpPurchaseReceipts.orgId, ctx.orgId)),
      with: { items: true },
    })
    if (!receipt) throw new ServiceError("Purchase receipt not found", 404)
    if (receipt.status !== "draft") throw new ServiceError("Only draft receipts can be submitted", 409)

    for (const item of receipt.items) {
      let rate = item.rate != null ? Number(item.rate) : undefined
      if (rate === undefined && item.purchaseOrderItemId) {
        const poItem = await db.query.erpPurchaseOrderItems.findFirst({ where: eq(erpPurchaseOrderItems.id, item.purchaseOrderItemId) })
        rate = poItem ? Number(poItem.rate) : 0
      }
      if (!item.itemId) continue // a free-text line (no stock item) has nothing to post
      await recordStockReceipt(ctx, {
        itemId: item.itemId, warehouseId: item.warehouseId!, quantity: Number(item.quantity), rate: rate ?? 0,
        postingDate: receipt.postingDate, voucherType: "purchase_receipt", voucherId: receipt.id,
      })

      if (item.purchaseOrderItemId) {
        await db.update(erpPurchaseOrderItems)
          .set({ receivedQuantity: sql`${erpPurchaseOrderItems.receivedQuantity} + ${item.quantity}` })
          .where(eq(erpPurchaseOrderItems.id, item.purchaseOrderItemId))
      }
    }

    if (receipt.purchaseOrderId) {
      const po = await db.query.erpPurchaseOrders.findFirst({ where: eq(erpPurchaseOrders.id, receipt.purchaseOrderId), with: { items: true } })
      if (po) {
        const fullyReceived = po.items.every((i) => Number(i.receivedQuantity) >= Number(i.quantity))
        const partiallyReceived = po.items.some((i) => Number(i.receivedQuantity) > 0)
        await db.update(erpPurchaseOrders)
          .set({ status: fullyReceived ? "completed" : partiallyReceived ? "partially_received" : po.status, updatedAt: new Date() })
          .where(eq(erpPurchaseOrders.id, po.id))
      }
    }

    const [updated] = await db.update(erpPurchaseReceipts).set({ status: "submitted" }).where(eq(erpPurchaseReceipts.id, receiptId)).returning()
    await logActivity({ tx: db, orgId: ctx.orgId, dbUser: ctx.dbUser, action: "erp_purchase_receipt.submitted", entityType: "erp_purchase_receipt", entityId: receiptId })
    return updated
  })
}

// ============================================================
// Putaway -- a separate confirmation step after physical receipt. Bins are
// leaf nodes in the existing erp_warehouses tree; re-binning (moving a
// received line to its final storage location) is just updating the
// receipt item's warehouseId before confirming.
// ============================================================

export async function updatePutawayLocation(ctx: { orgId: string }, receiptItemId: string, warehouseId: string) {
  return withTenantContext({ orgId: ctx.orgId }, async (db) => {
    const item = await db.query.erpPurchaseReceiptItems.findFirst({ where: eq(erpPurchaseReceiptItems.id, receiptItemId) })
    if (!item) throw new ServiceError("Receipt item not found", 404)
    const [updated] = await db.update(erpPurchaseReceiptItems).set({ warehouseId }).where(eq(erpPurchaseReceiptItems.id, receiptItemId)).returning()
    return updated
  })
}

export async function markPutawayComplete(ctx: ErpContext, receiptId: string) {
  return withTenantContext({ orgId: ctx.orgId, userId: ctx.userId }, async (db) => {
    const receipt = await db.query.erpPurchaseReceipts.findFirst({ where: and(eq(erpPurchaseReceipts.id, receiptId), eq(erpPurchaseReceipts.orgId, ctx.orgId)) })
    if (!receipt) throw new ServiceError("Purchase receipt not found", 404)
    if (receipt.status !== "submitted") throw new ServiceError("Only a submitted receipt's putaway can be completed", 409)
    const [updated] = await db.update(erpPurchaseReceipts).set({ putawayStatus: "completed" }).where(eq(erpPurchaseReceipts.id, receiptId)).returning()
    await logActivity({ tx: db, orgId: ctx.orgId, dbUser: ctx.dbUser, action: "erp_purchase_receipt.putaway_completed", entityType: "erp_purchase_receipt", entityId: receiptId })
    return updated
  })
}

// ============================================================
// Three-way match (PO vs GRN vs Invoice)
// ============================================================

export type ThreeWayMatchLine = {
  purchaseOrderItemId: string
  description: string
  orderedQty: number
  orderedRate: number
  receivedQty: number
  invoicedQty: number
  invoicedRateAvg: number | null
  qtyVariance: "matched" | "under_received" | "over_received" | "over_invoiced"
  rateVariance: "matched" | "rate_mismatch"
}

/** Reads three genuinely independent documents (never a duplicated reconciliation ledger) and reports variance per PO line. */
export async function getThreeWayMatchReport(ctx: { orgId: string }, purchaseOrderId: string): Promise<ThreeWayMatchLine[]> {
  return withTenantContext({ orgId: ctx.orgId }, async (db) => {
    const po = await db.query.erpPurchaseOrders.findFirst({
      where: and(eq(erpPurchaseOrders.id, purchaseOrderId), eq(erpPurchaseOrders.orgId, ctx.orgId)),
      with: { items: true },
    })
    if (!po) throw new ServiceError("Purchase order not found", 404)

    const receiptItems = await db.query.erpPurchaseReceiptItems.findMany({
      where: sql`${erpPurchaseReceiptItems.purchaseOrderItemId} IN (SELECT id FROM compliance.erp_purchase_order_items WHERE purchase_order_id = ${purchaseOrderId})`,
    })
    const invoiceItems = await db.query.erpPurchaseInvoiceItems.findMany({
      where: sql`${erpPurchaseInvoiceItems.purchaseOrderItemId} IN (SELECT id FROM compliance.erp_purchase_order_items WHERE purchase_order_id = ${purchaseOrderId})`,
    })

    return po.items.map((poItem): ThreeWayMatchLine => {
      const received = receiptItems.filter((r) => r.purchaseOrderItemId === poItem.id)
      const invoiced = invoiceItems.filter((i) => i.purchaseOrderItemId === poItem.id)

      const orderedQty = Number(poItem.quantity)
      const receivedQty = received.reduce((sum, r) => sum + Number(r.quantity), 0)
      const invoicedQty = invoiced.reduce((sum, i) => sum + Number(i.quantity), 0)
      const invoicedValue = invoiced.reduce((sum, i) => sum + Number(i.quantity) * Number(i.rate), 0)
      const invoicedRateAvg = invoicedQty > 0 ? invoicedValue / invoicedQty : null

      let qtyVariance: ThreeWayMatchLine["qtyVariance"] = "matched"
      if (invoicedQty > receivedQty) qtyVariance = "over_invoiced"
      else if (receivedQty > orderedQty) qtyVariance = "over_received"
      else if (receivedQty < orderedQty) qtyVariance = "under_received"

      const rateVariance: ThreeWayMatchLine["rateVariance"] =
        invoicedRateAvg !== null && Math.abs(invoicedRateAvg - Number(poItem.rate)) > 0.01 ? "rate_mismatch" : "matched"

      return {
        purchaseOrderItemId: poItem.id, description: poItem.description,
        orderedQty, orderedRate: Number(poItem.rate), receivedQty, invoicedQty, invoicedRateAvg, qtyVariance, rateVariance,
      }
    })
  })
}

// ============================================================
// Landed cost allocation
// ============================================================

export async function createLandedCostVoucher(
  ctx: ErpContext,
  purchaseReceiptId: string,
  input: { postingDate: string; charges: { expenseType: string; amount: number; description?: string }[] }
) {
  if (!input.charges?.length) throw new ServiceError("At least one charge is required", 400)

  return withTenantContext({ orgId: ctx.orgId, userId: ctx.userId }, async (db) => {
    const receipt = await db.query.erpPurchaseReceipts.findFirst({
      where: and(eq(erpPurchaseReceipts.id, purchaseReceiptId), eq(erpPurchaseReceipts.orgId, ctx.orgId)),
      with: { items: true },
    })
    if (!receipt) throw new ServiceError("Purchase receipt not found", 404)
    if (receipt.status !== "submitted") throw new ServiceError("Landed costs can only be allocated against a submitted receipt", 409)

    const [voucher] = await db.insert(erpLandedCostVouchers).values({
      orgId: ctx.orgId, purchaseReceiptId, postingDate: input.postingDate, createdById: ctx.userId,
    }).returning()

    await db.insert(erpLandedCostCharges).values(
      input.charges.map((c) => ({ orgId: ctx.orgId, voucherId: voucher.id, expenseType: c.expenseType, amount: c.amount.toString(), description: c.description }))
    )

    const totalCharges = input.charges.reduce((sum, c) => sum + c.amount, 0)
    const itemsWithValue = receipt.items.filter((i) => i.itemId).map((i) => ({ item: i, rate: Number(i.rate ?? 0), value: Number(i.quantity) * Number(i.rate ?? 0) }))
    const totalReceivedValue = itemsWithValue.reduce((sum, i) => sum + i.value, 0)

    // Allocation by received value (ERPNext's own default landed-cost
    // allocation method). Bumps each item's FIFO valuation layer rate --
    // future stock issues draw the true landed cost. Does NOT retroactively
    // rewrite erp_stock_ledger_entries' running balanceValue history (a
    // full revaluation cascade), see the schema.ts comment on this table.
    for (const { item, value } of itemsWithValue) {
      if (totalReceivedValue <= 0) continue
      const allocatedAmount = totalCharges * (value / totalReceivedValue)
      await db.insert(erpLandedCostAllocations).values({
        orgId: ctx.orgId, voucherId: voucher.id, receiptItemId: item.id, allocatedAmount: allocatedAmount.toString(),
      })

      const ledgerEntry = await db.query.erpStockLedgerEntries.findFirst({
        where: and(eq(erpStockLedgerEntries.voucherType, "purchase_receipt"), eq(erpStockLedgerEntries.voucherId, purchaseReceiptId), eq(erpStockLedgerEntries.itemId, item.itemId!)),
      })
      if (!ledgerEntry) continue
      const layer = await db.query.erpStockValuationLayers.findFirst({ where: eq(erpStockValuationLayers.stockLedgerEntryId, ledgerEntry.id) })
      if (!layer) continue
      const perUnitAddOn = allocatedAmount / Number(layer.originalQty)
      await db.update(erpStockValuationLayers).set({ rate: (Number(layer.rate) + perUnitAddOn).toString() }).where(eq(erpStockValuationLayers.id, layer.id))
    }

    await logActivity({ tx: db, orgId: ctx.orgId, dbUser: ctx.dbUser, action: "erp_landed_cost_voucher.created", entityType: "erp_landed_cost_voucher", entityId: voucher.id })
    return voucher
  })
}

export async function listLandedCostVouchers(ctx: { orgId: string }, purchaseReceiptId: string) {
  return withTenantContext({ orgId: ctx.orgId }, (db) =>
    db.query.erpLandedCostVouchers.findMany({
      where: and(eq(erpLandedCostVouchers.orgId, ctx.orgId), eq(erpLandedCostVouchers.purchaseReceiptId, purchaseReceiptId)),
      orderBy: (t, { desc }) => desc(t.createdAt),
      with: { charges: true, allocations: true },
    })
  )
}
