// Minimal list-only service backing the Wave 52 Credit Notes UI's supplier
// picker -- erpSuppliers has existed since Wave 49 but had no service layer
// consumer until now.
import { erpSuppliers, erpPurchaseOrders, erpPurchaseReceipts, erpPurchaseReturns } from "@/lib/db"
import { withTenantContext } from "@/lib/db/tenant-scoped"
import { eq, and, ne } from "drizzle-orm"
import { ServiceError } from "./compliance-service"
export { ServiceError }

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
