// Minimal list-only service backing the Wave 52 Credit Notes UI's supplier
// picker -- erpSuppliers has existed since Wave 49 but had no service layer
// consumer until now.
import { erpSuppliers, erpPurchaseOrders, erpPurchaseOrderItems, erpPurchaseReceipts, erpPurchaseReturns, users } from "@/lib/db"
import { withTenantContext } from "@/lib/db/tenant-scoped"
import { eq, and, ne, sql } from "drizzle-orm"
import { ServiceError } from "./compliance-service"
export { ServiceError }
import { logActivity } from "@/lib/audit"

export type ErpContext = { orgId: string; userId: string; dbUser: typeof users.$inferSelect }

export async function listSuppliers(ctx: { orgId: string }) {
  return withTenantContext({ orgId: ctx.orgId }, async (db) => {
    return db.query.erpSuppliers.findMany({ where: eq(erpSuppliers.orgId, ctx.orgId), orderBy: (t, { asc }) => asc(t.supplierName) })
  })
}

// Wave 84 (COMPARISON_CSV_GAP_ANALYSIS.md backlog #5): create/update --
// nothing had ever inserted a row into erp_suppliers outside of seed data,
// which made credit limits (this wave's actual goal) impossible to manage
// without a way to create/edit a supplier at all.
export type SupplierInput = { supplierName: string; supplierType?: string; gstin?: string; panNumber?: string; defaultPaymentTermsDays?: number; creditLimit?: number }

export async function createSupplier(ctx: { orgId: string }, input: SupplierInput) {
  if (!input.supplierName?.trim()) throw new ServiceError("supplierName is required", 400)
  return withTenantContext({ orgId: ctx.orgId }, async (db) => {
    const [supplier] = await db.insert(erpSuppliers).values({
      orgId: ctx.orgId, supplierName: input.supplierName, supplierType: input.supplierType,
      gstin: input.gstin, panNumber: input.panNumber, defaultPaymentTermsDays: input.defaultPaymentTermsDays,
      creditLimit: input.creditLimit?.toString(),
    }).returning()
    return supplier
  })
}

export async function updateSupplier(ctx: { orgId: string }, supplierId: string, input: Partial<SupplierInput>) {
  return withTenantContext({ orgId: ctx.orgId }, async (db) => {
    const supplier = await db.query.erpSuppliers.findFirst({ where: and(eq(erpSuppliers.id, supplierId), eq(erpSuppliers.orgId, ctx.orgId)) })
    if (!supplier) throw new ServiceError("Supplier not found", 404)
    const [updated] = await db.update(erpSuppliers).set({
      ...(input.supplierName !== undefined ? { supplierName: input.supplierName } : {}),
      ...(input.supplierType !== undefined ? { supplierType: input.supplierType } : {}),
      ...(input.gstin !== undefined ? { gstin: input.gstin } : {}),
      ...(input.panNumber !== undefined ? { panNumber: input.panNumber } : {}),
      ...(input.defaultPaymentTermsDays !== undefined ? { defaultPaymentTermsDays: input.defaultPaymentTermsDays } : {}),
      ...(input.creditLimit !== undefined ? { creditLimit: input.creditLimit === null ? null : input.creditLimit.toString() } : {}),
    }).where(eq(erpSuppliers.id, supplierId)).returning()
    return updated
  })
}

// Wave 85 (COMPARISON_CSV_GAP_ANALYSIS.md backlog #6): erp_purchase_orders
// has existed since Wave 49 with zero create/submit service consumer --
// only ever read for Wave 64's scorecard. The three-way-match/landed-cost/
// putaway enhancements this wave targets need a real PO to attach to, so
// this makes the base PO workflow (and the goods-receipt chain it feeds,
// see erp-goods-receipt-service.ts) genuinely functional, not just the
// three named enhancements.
export type PurchaseOrderItemInput = { itemId?: string; description: string; quantity?: number; rate?: number }

export async function listPurchaseOrders(ctx: { orgId: string }) {
  return withTenantContext({ orgId: ctx.orgId }, (db) =>
    db.query.erpPurchaseOrders.findMany({
      where: eq(erpPurchaseOrders.orgId, ctx.orgId),
      orderBy: (t, { desc }) => desc(t.orderDate),
      with: { items: true },
    })
  )
}

export async function getPurchaseOrder(ctx: { orgId: string }, purchaseOrderId: string) {
  return withTenantContext({ orgId: ctx.orgId }, async (db) => {
    const po = await db.query.erpPurchaseOrders.findFirst({
      where: and(eq(erpPurchaseOrders.id, purchaseOrderId), eq(erpPurchaseOrders.orgId, ctx.orgId)),
      with: { items: true },
    })
    if (!po) throw new ServiceError("Purchase order not found", 404)
    return po
  })
}

export async function createPurchaseOrder(
  ctx: ErpContext,
  input: { supplierId: string; orderDate: string; expectedDeliveryDate?: string; items: PurchaseOrderItemInput[] }
) {
  if (!input.supplierId) throw new ServiceError("supplierId is required", 400)
  if (!input.items?.length) throw new ServiceError("At least one line item is required", 400)

  return withTenantContext({ orgId: ctx.orgId, userId: ctx.userId }, async (db) => {
    const supplier = await db.query.erpSuppliers.findFirst({ where: and(eq(erpSuppliers.id, input.supplierId), eq(erpSuppliers.orgId, ctx.orgId)) })
    if (!supplier) throw new ServiceError("Supplier not found", 404)

    const [{ maxNumber }] = await db.select({ maxNumber: sql<number>`coalesce(max(${erpPurchaseOrders.poNumber}), 0)` })
      .from(erpPurchaseOrders).where(eq(erpPurchaseOrders.orgId, ctx.orgId))

    const grandTotal = input.items.reduce((sum, i) => sum + (i.quantity ?? 1) * (i.rate ?? 0), 0)

    const [po] = await db.insert(erpPurchaseOrders).values({
      orgId: ctx.orgId, supplierId: input.supplierId, poNumber: Number(maxNumber) + 1,
      orderDate: input.orderDate, expectedDeliveryDate: input.expectedDeliveryDate, grandTotal: grandTotal.toString(),
      createdById: ctx.userId,
    }).returning()

    await db.insert(erpPurchaseOrderItems).values(
      input.items.map((i) => ({
        purchaseOrderId: po.id, itemId: i.itemId, description: i.description,
        quantity: (i.quantity ?? 1).toString(), rate: (i.rate ?? 0).toString(), amount: ((i.quantity ?? 1) * (i.rate ?? 0)).toString(),
      }))
    )

    await logActivity({ tx: db, orgId: ctx.orgId, dbUser: ctx.dbUser, action: "erp_purchase_order.created", entityType: "erp_purchase_order", entityId: po.id })
    return po
  })
}

export async function submitPurchaseOrder(ctx: ErpContext, purchaseOrderId: string) {
  return withTenantContext({ orgId: ctx.orgId, userId: ctx.userId }, async (db) => {
    const po = await db.query.erpPurchaseOrders.findFirst({ where: and(eq(erpPurchaseOrders.id, purchaseOrderId), eq(erpPurchaseOrders.orgId, ctx.orgId)) })
    if (!po) throw new ServiceError("Purchase order not found", 404)
    if (po.status !== "draft") throw new ServiceError("Only draft purchase orders can be submitted", 409)
    const [updated] = await db.update(erpPurchaseOrders).set({ status: "submitted", updatedAt: new Date() }).where(eq(erpPurchaseOrders.id, purchaseOrderId)).returning()
    await logActivity({ tx: db, orgId: ctx.orgId, dbUser: ctx.dbUser, action: "erp_purchase_order.submitted", entityType: "erp_purchase_order", entityId: purchaseOrderId })
    return updated
  })
}

/** Wave 68: assigns (or clears, if categoryId is undefined) a supplier's default Tax Withholding Category -- the opt-in switch for vendor-payment TDS auto-computation at invoice-submit time. */
export async function updateSupplierTaxWithholding(ctx: { orgId: string }, supplierId: string, categoryId: string | undefined) {
  return withTenantContext({ orgId: ctx.orgId }, async (db) => {
    const supplier = await db.query.erpSuppliers.findFirst({ where: and(eq(erpSuppliers.id, supplierId), eq(erpSuppliers.orgId, ctx.orgId)) })
    if (!supplier) throw new ServiceError("Supplier not found", 404)
    const [updated] = await db.update(erpSuppliers).set({ taxWithholdingCategoryId: categoryId ?? null }).where(eq(erpSuppliers.id, supplierId)).returning()
    return updated
  })
}

// Wave 64 (Vendor Scorecarding, ERP benchmark Tier 4 #19). Read-time
// aggregation over existing purchase order/receipt/return data -- matching
// the same discipline as Wave 50/51's financial reports and Wave 28's
// budget-actuals view: never a duplicated ledger, always computed live off
// the transactional tables that are the actual source of truth.
export type SupplierScorecard = {
  supplierId: string
  totalOrders: number
  totalSpend: number
  onTimeDeliveryRate: number | null // null when there's no dated PO to measure against
  returnRate: number | null // returns per receipt
}

export async function getSupplierScorecard(ctx: { orgId: string }, supplierId: string): Promise<SupplierScorecard> {
  return withTenantContext({ orgId: ctx.orgId }, async (db) => {
    const supplier = await db.query.erpSuppliers.findFirst({ where: and(eq(erpSuppliers.id, supplierId), eq(erpSuppliers.orgId, ctx.orgId)) })
    if (!supplier) throw new ServiceError("Supplier not found", 404)

    const orders = await db.query.erpPurchaseOrders.findMany({
      where: and(eq(erpPurchaseOrders.orgId, ctx.orgId), eq(erpPurchaseOrders.supplierId, supplierId), ne(erpPurchaseOrders.status, "draft"), ne(erpPurchaseOrders.status, "cancelled")),
    })
    const receipts = await db.query.erpPurchaseReceipts.findMany({
      where: and(eq(erpPurchaseReceipts.orgId, ctx.orgId), eq(erpPurchaseReceipts.supplierId, supplierId), eq(erpPurchaseReceipts.status, "submitted")),
    })
    const returns = await db.query.erpPurchaseReturns.findMany({
      where: and(eq(erpPurchaseReturns.orgId, ctx.orgId), eq(erpPurchaseReturns.supplierId, supplierId)),
    })

    const totalSpend = orders.reduce((sum, o) => sum + Number(o.grandTotal), 0)

    // On-time delivery: for each receipt linked to a PO with an expected
    // delivery date, compare the receipt's posting date against it.
    const ordersById = new Map(orders.map((o) => [o.id, o]))
    let measurable = 0
    let onTime = 0
    for (const receipt of receipts) {
      const po = receipt.purchaseOrderId ? ordersById.get(receipt.purchaseOrderId) : undefined
      if (!po?.expectedDeliveryDate) continue
      measurable++
      if (receipt.postingDate <= po.expectedDeliveryDate) onTime++
    }

    const dispatchedOrRejectedReturns = returns.length
    const returnRate = receipts.length > 0 ? dispatchedOrRejectedReturns / receipts.length : null

    return {
      supplierId,
      totalOrders: orders.length,
      totalSpend,
      onTimeDeliveryRate: measurable > 0 ? onTime / measurable : null,
      returnRate,
    }
  })
}

export async function listSupplierScorecards(ctx: { orgId: string }): Promise<SupplierScorecard[]> {
  const suppliers = await listSuppliers(ctx)
  const scorecards: SupplierScorecard[] = []
  for (const s of suppliers) {
    scorecards.push(await getSupplierScorecard(ctx, s.id))
  }
  return scorecards
}
