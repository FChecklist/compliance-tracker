// Minimal list-only service backing the Wave 52 Credit Notes UI's supplier
// picker -- erpSuppliers has existed since Wave 49 but had no service layer
// consumer until now.
import { erpSuppliers, erpPurchaseOrders, erpPurchaseOrderItems, erpPurchaseReceipts, erpPurchaseReturns, erpPurchaseInvoices, erpCurrencies, users } from "@/lib/db"
import { withTenantContext, type TenantDb } from "@/lib/db/tenant-scoped"
import { eq, and, ne, sql, inArray } from "drizzle-orm"
import { ServiceError } from "./compliance-service"
export { ServiceError }
import { logActivity } from "@/lib/audit"
import { requireErpEnabled } from "./erp-enablement-service"

export type ErpContext = { orgId: string; userId: string; dbUser: typeof users.$inferSelect }

// Priority 17 Wave 1 (PROJEXA Procurement workflow exposure): widened to the
// same dbUser-or-apiKey actor union already precedented by erp-invoicing-
// service.ts's createSalesInvoice -- PROJEXA's callVeridian() proxy always
// calls server-to-server with a shared Bearer API key, never a session
// cookie.
export type ActorCtx = { orgId: string; userId: string } & (
  | { dbUser: typeof users.$inferSelect; apiKey?: never }
  | { dbUser?: never; apiKey: { id: string; name: string } }
)

// Priority 17 Wave 1 (multi-currency Selling & Buying): identical
// validation to erp-invoicing-service.ts's resolveInvoiceCurrency() (Wave
// 66) / erp-selling-service.ts's resolveDocumentCurrency() -- currencyId/
// exchangeRate optional together, an explicit positive rate required
// whenever a currency is set, never guessed.
async function resolvePoCurrency(db: TenantDb, orgId: string, currencyId: string | undefined, exchangeRate: number | undefined): Promise<{ currencyId: string | null; exchangeRate: number }> {
  if (!currencyId) return { currencyId: null, exchangeRate: 1 }
  if (!exchangeRate || exchangeRate <= 0) throw new ServiceError("exchangeRate is required (and must be positive) when currencyId is set", 400)
  const currency = await db.query.erpCurrencies.findFirst({ where: and(eq(erpCurrencies.id, currencyId), eq(erpCurrencies.orgId, orgId)) })
  if (!currency) throw new ServiceError("Currency not found", 404)
  return { currencyId, exchangeRate }
}

export async function listSuppliers(ctx: { orgId: string }) {
  await requireErpEnabled(ctx.orgId)
  return withTenantContext({ orgId: ctx.orgId }, async (db) => {
    return db.query.erpSuppliers.findMany({ where: eq(erpSuppliers.orgId, ctx.orgId), orderBy: (t, { asc }) => asc(t.supplierName) })
  })
}

// Wave 84 (COMPARISON_CSV_GAP_ANALYSIS.md backlog #5): create/update --
// nothing had ever inserted a row into erp_suppliers outside of seed data,
// which made credit limits (this wave's actual goal) impossible to manage
// without a way to create/edit a supplier at all.
// Wave 120 (PROJEXA Vendor Master enhancement): trade/projectId are
// optional on every existing call site -- unset by default, matching this
// wave's additive-column posture.
export type SupplierInput = { supplierName: string; supplierType?: string; gstin?: string; panNumber?: string; defaultPaymentTermsDays?: number; creditLimit?: number; trade?: string; projectId?: string }

export async function createSupplier(ctx: { orgId: string }, input: SupplierInput) {
  await requireErpEnabled(ctx.orgId)
  if (!input.supplierName?.trim()) throw new ServiceError("supplierName is required", 400)
  return withTenantContext({ orgId: ctx.orgId }, async (db) => {
    const [supplier] = await db.insert(erpSuppliers).values({
      orgId: ctx.orgId, supplierName: input.supplierName, supplierType: input.supplierType,
      gstin: input.gstin, panNumber: input.panNumber, defaultPaymentTermsDays: input.defaultPaymentTermsDays,
      creditLimit: input.creditLimit?.toString(), trade: input.trade, projectId: input.projectId,
    }).returning()
    return supplier
  })
}

export async function updateSupplier(ctx: { orgId: string }, supplierId: string, input: Partial<SupplierInput>) {
  await requireErpEnabled(ctx.orgId)
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
      ...(input.trade !== undefined ? { trade: input.trade } : {}),
      ...(input.projectId !== undefined ? { projectId: input.projectId } : {}),
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

// Priority 17 final gap: companyId is an optional equality filter -- same
// "omitted means no filter" convention as erp-budget-service.ts's
// listBudgets(ctx, filters) and erp-selling-service.ts's ListQuotationsOptions/
// ListSalesOrdersOptions companyId filters added alongside this one.
// MM-004 (calculation-track engine build/extend, EXTEND_EXISTING): projectId
// added the same way -- the SAP EKKN-equivalent account-assignment filter
// gap_notes confirmed was missing from this function.
export async function listPurchaseOrders(ctx: { orgId: string }, filters?: { companyId?: string; projectId?: string }) {
  await requireErpEnabled(ctx.orgId)
  return withTenantContext({ orgId: ctx.orgId }, (db) => {
    const conditions = [eq(erpPurchaseOrders.orgId, ctx.orgId)]
    if (filters?.companyId) conditions.push(eq(erpPurchaseOrders.companyId, filters.companyId))
    if (filters?.projectId) conditions.push(eq(erpPurchaseOrders.projectId, filters.projectId))
    return db.query.erpPurchaseOrders.findMany({
      where: and(...conditions),
      orderBy: (t, { desc }) => desc(t.orderDate),
      with: { items: true },
    })
  })
}

// MM-004 (BUILD on top of the projectId filter above): the "Project
// Purchases" commitment-status view impl_notes asks for -- per PO, how much
// is ordered vs received vs invoiced, so a PM can see at a glance what's
// still outstanding. Deliberately scoped to existing POs/receipts/invoices
// (no purchase-requisition integration -- a separate MM module, left for a
// follow-up same as this codebase's other documented scope boundaries).
export type ProjectCommitmentLine = {
  purchaseOrderId: string
  poNumber: number
  orderDate: string
  supplierId: string
  supplierName: string
  status: string
  orderedValue: number
  receivedValue: number
  invoicedValue: number
  outstandingCommitment: number
}

export async function purchaseOrdersByProjectSummary(ctx: { orgId: string }, projectId: string) {
  await requireErpEnabled(ctx.orgId)
  return withTenantContext({ orgId: ctx.orgId }, async (db) => {
    const orders = await db.query.erpPurchaseOrders.findMany({
      where: and(eq(erpPurchaseOrders.orgId, ctx.orgId), eq(erpPurchaseOrders.projectId, projectId), ne(erpPurchaseOrders.status, "cancelled")),
      with: { items: true, supplier: true },
    })
    const orderIds = orders.map((o) => o.id)
    const invoices = orderIds.length
      ? await db.query.erpPurchaseInvoices.findMany({ where: and(eq(erpPurchaseInvoices.orgId, ctx.orgId), inArray(erpPurchaseInvoices.purchaseOrderId, orderIds), ne(erpPurchaseInvoices.status, "cancelled")) })
      : []
    const invoicedByPo = new Map<string, number>()
    for (const inv of invoices) {
      if (!inv.purchaseOrderId) continue
      invoicedByPo.set(inv.purchaseOrderId, (invoicedByPo.get(inv.purchaseOrderId) ?? 0) + Number(inv.grandTotal))
    }

    const lines: ProjectCommitmentLine[] = orders.map((po) => {
      const orderedValue = Number(po.grandTotal)
      const receivedValue = po.items.reduce((sum, i) => sum + Number(i.receivedQuantity) * Number(i.rate), 0)
      const invoicedValue = invoicedByPo.get(po.id) ?? 0
      return {
        purchaseOrderId: po.id, poNumber: po.poNumber, orderDate: po.orderDate, supplierId: po.supplierId,
        supplierName: po.supplier?.supplierName ?? "", status: po.status,
        orderedValue, receivedValue, invoicedValue, outstandingCommitment: Math.max(0, orderedValue - invoicedValue),
      }
    })

    return {
      projectId,
      lines,
      totals: {
        committed: lines.reduce((s, l) => s + l.orderedValue, 0),
        received: lines.reduce((s, l) => s + l.receivedValue, 0),
        invoiced: lines.reduce((s, l) => s + l.invoicedValue, 0),
        outstanding: lines.reduce((s, l) => s + l.outstandingCommitment, 0),
      },
    }
  })
}

// PS-005 (BUILD_NEW-equivalent -- EXTEND_EXISTING per sap_mapping.sqlite,
// composes purchaseOrdersByProjectSummary above): the same open-commitment
// data grouped by supplier instead of by PO, which is the actual question a
// PM asks per impl_notes ("who have we ordered from, how much remains to be
// invoiced"). daysOpen/agingFlags surface impl_notes' ">60 days open may
// indicate a problem" signal without a separate aging subsystem.
export type ProjectCommitmentBySupplier = {
  supplierId: string
  supplierName: string
  totalOrdered: number
  totalInvoiced: number
  totalOutstanding: number
  oldestOpenOrderDate: string
  daysOpen: number
}

export async function projectCommitmentsReport(ctx: { orgId: string }, projectId: string, asOfDate?: string) {
  await requireErpEnabled(ctx.orgId)
  const asOf = asOfDate ?? new Date().toISOString().slice(0, 10)
  const asOfMs = new Date(asOf).getTime()
  const summary = await purchaseOrdersByProjectSummary(ctx, projectId)

  const bySupplier = new Map<string, ProjectCommitmentBySupplier>()
  for (const line of summary.lines) {
    if (line.outstandingCommitment <= 0.01) continue
    const existing = bySupplier.get(line.supplierId)
    if (existing) {
      existing.totalOrdered += line.orderedValue
      existing.totalInvoiced += line.invoicedValue
      existing.totalOutstanding += line.outstandingCommitment
      if (line.orderDate < existing.oldestOpenOrderDate) {
        existing.oldestOpenOrderDate = line.orderDate
        existing.daysOpen = Math.floor((asOfMs - new Date(line.orderDate).getTime()) / 86400000)
      }
    } else {
      bySupplier.set(line.supplierId, {
        supplierId: line.supplierId, supplierName: line.supplierName,
        totalOrdered: line.orderedValue, totalInvoiced: line.invoicedValue, totalOutstanding: line.outstandingCommitment,
        oldestOpenOrderDate: line.orderDate, daysOpen: Math.floor((asOfMs - new Date(line.orderDate).getTime()) / 86400000),
      })
    }
  }

  const bySupplierArr = Array.from(bySupplier.values()).sort((a, b) => b.totalOutstanding - a.totalOutstanding)
  return {
    projectId, asOfDate: asOf, bySupplier: bySupplierArr,
    totalOutstandingCommitment: bySupplierArr.reduce((s, r) => s + r.totalOutstanding, 0),
    agingFlags: bySupplierArr.filter((r) => r.daysOpen > 60).map((r) => r.supplierId),
  }
}

export async function getPurchaseOrder(ctx: { orgId: string }, purchaseOrderId: string) {
  await requireErpEnabled(ctx.orgId)
  return withTenantContext({ orgId: ctx.orgId }, async (db) => {
    const po = await db.query.erpPurchaseOrders.findFirst({
      where: and(eq(erpPurchaseOrders.id, purchaseOrderId), eq(erpPurchaseOrders.orgId, ctx.orgId)),
      with: { items: true },
    })
    if (!po) throw new ServiceError("Purchase order not found", 404)
    return po
  })
}

// Priority 17 Wave 1: createPurchaseOrder is the first caller of ActorCtx
// (above) that also needs multi-currency capture -- reuses the already-
// widened dbUser-or-apiKey union from PROJEXA Procurement workflow
// exposure rather than introducing a second, duplicate actor-union type.
export async function createPurchaseOrder(
  ctx: ActorCtx,
  input: { supplierId: string; orderDate: string; expectedDeliveryDate?: string; companyId?: string; currencyId?: string; exchangeRate?: number; items: PurchaseOrderItemInput[] }
) {
  await requireErpEnabled(ctx.orgId)
  if (!input.supplierId) throw new ServiceError("supplierId is required", 400)
  if (!input.items?.length) throw new ServiceError("At least one line item is required", 400)

  return withTenantContext({ orgId: ctx.orgId, userId: ctx.userId }, async (db) => {
    const supplier = await db.query.erpSuppliers.findFirst({ where: and(eq(erpSuppliers.id, input.supplierId), eq(erpSuppliers.orgId, ctx.orgId)) })
    if (!supplier) throw new ServiceError("Supplier not found", 404)
    const { currencyId, exchangeRate } = await resolvePoCurrency(db, ctx.orgId, input.currencyId, input.exchangeRate)

    const [{ maxNumber }] = await db.select({ maxNumber: sql<number>`coalesce(max(${erpPurchaseOrders.poNumber}), 0)` })
      .from(erpPurchaseOrders).where(eq(erpPurchaseOrders.orgId, ctx.orgId))

    const grandTotal = input.items.reduce((sum, i) => sum + (i.quantity ?? 1) * (i.rate ?? 0), 0)

    const [po] = await db.insert(erpPurchaseOrders).values({
      orgId: ctx.orgId, supplierId: input.supplierId, poNumber: Number(maxNumber) + 1,
      orderDate: input.orderDate, expectedDeliveryDate: input.expectedDeliveryDate,
      companyId: input.companyId ?? null,
      currencyId, exchangeRate: exchangeRate.toString(), grandTotal: grandTotal.toString(),
      createdById: ctx.userId,
    }).returning()

    await db.insert(erpPurchaseOrderItems).values(
      input.items.map((i) => ({
        purchaseOrderId: po.id, itemId: i.itemId, description: i.description,
        quantity: (i.quantity ?? 1).toString(), rate: (i.rate ?? 0).toString(), amount: ((i.quantity ?? 1) * (i.rate ?? 0)).toString(),
      }))
    )

    await logActivity({ tx: db, orgId: ctx.orgId, ...(ctx.dbUser ? { dbUser: ctx.dbUser } : { apiKey: ctx.apiKey! }), action: "erp_purchase_order.created", entityType: "erp_purchase_order", entityId: po.id })
    return po
  })
}

export async function submitPurchaseOrder(ctx: ActorCtx, purchaseOrderId: string) {
  await requireErpEnabled(ctx.orgId)
  return withTenantContext({ orgId: ctx.orgId, userId: ctx.userId }, async (db) => {
    const po = await db.query.erpPurchaseOrders.findFirst({ where: and(eq(erpPurchaseOrders.id, purchaseOrderId), eq(erpPurchaseOrders.orgId, ctx.orgId)) })
    if (!po) throw new ServiceError("Purchase order not found", 404)
    if (po.status !== "draft") throw new ServiceError("Only draft purchase orders can be submitted", 409)
    const [updated] = await db.update(erpPurchaseOrders).set({ status: "submitted", updatedAt: new Date() }).where(eq(erpPurchaseOrders.id, purchaseOrderId)).returning()
    await logActivity({ tx: db, orgId: ctx.orgId, ...(ctx.dbUser ? { dbUser: ctx.dbUser } : { apiKey: ctx.apiKey! }), action: "erp_purchase_order.submitted", entityType: "erp_purchase_order", entityId: purchaseOrderId })
    return updated
  })
}

/** Wave 68: assigns (or clears, if categoryId is undefined) a supplier's default Tax Withholding Category -- the opt-in switch for vendor-payment TDS auto-computation at invoice-submit time. */
export async function updateSupplierTaxWithholding(ctx: { orgId: string }, supplierId: string, categoryId: string | undefined) {
  await requireErpEnabled(ctx.orgId)
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
  await requireErpEnabled(ctx.orgId)
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
  await requireErpEnabled(ctx.orgId)
  const suppliers = await listSuppliers(ctx)
  const scorecards: SupplierScorecard[] = []
  for (const s of suppliers) {
    scorecards.push(await getSupplierScorecard(ctx, s.id))
  }
  return scorecards
}

// MM-008 (calculation-track engine build/extend, EXTEND_EXISTING per
// sap_mapping.sqlite -- "light composition of the two existing pieces"):
// getSupplierScorecard already has totalSpend/onTimeDeliveryRate; this adds
// the remaining SAP-report rollup fields (received/invoiced/open-PO value,
// average delivery delay in days) in one combined view, reusing the
// scorecard rather than re-deriving its fields.
export type VendorPurchasingHistory = {
  supplierId: string
  supplierName: string
  totalPoValue: number
  totalReceivedValue: number
  totalInvoicedValue: number
  openPoValue: number
  onTimeDeliveryRate: number | null
  avgDeliveryDelayDays: number | null
}

export async function vendorPurchasingHistoryReport(ctx: { orgId: string }, supplierId: string): Promise<VendorPurchasingHistory> {
  await requireErpEnabled(ctx.orgId)
  const scorecard = await getSupplierScorecard(ctx, supplierId)

  return withTenantContext({ orgId: ctx.orgId }, async (db) => {
    const supplier = await db.query.erpSuppliers.findFirst({ where: and(eq(erpSuppliers.id, supplierId), eq(erpSuppliers.orgId, ctx.orgId)) })
    if (!supplier) throw new ServiceError("Supplier not found", 404)

    const orders = await db.query.erpPurchaseOrders.findMany({
      where: and(eq(erpPurchaseOrders.orgId, ctx.orgId), eq(erpPurchaseOrders.supplierId, supplierId), ne(erpPurchaseOrders.status, "draft"), ne(erpPurchaseOrders.status, "cancelled")),
      with: { items: true },
    })
    const receipts = await db.query.erpPurchaseReceipts.findMany({
      where: and(eq(erpPurchaseReceipts.orgId, ctx.orgId), eq(erpPurchaseReceipts.supplierId, supplierId), eq(erpPurchaseReceipts.status, "submitted")),
      with: { items: true },
    })
    const invoices = await db.query.erpPurchaseInvoices.findMany({
      where: and(eq(erpPurchaseInvoices.orgId, ctx.orgId), eq(erpPurchaseInvoices.supplierId, supplierId), ne(erpPurchaseInvoices.status, "cancelled")),
    })

    // Falls back to the linked PO item's rate for a receipt line with no
    // rate of its own -- same fallback submitPurchaseReceipt itself applies.
    const poItemRateById = new Map(orders.flatMap((o) => o.items.map((i): [string, number] => [i.id, Number(i.rate)])))
    const totalPoValue = orders.reduce((sum, o) => sum + Number(o.grandTotal), 0)
    const totalReceivedValue = receipts.reduce(
      (sum, r) => sum + r.items.reduce((s, i) => s + Number(i.quantity) * (i.rate != null ? Number(i.rate) : (i.purchaseOrderItemId ? poItemRateById.get(i.purchaseOrderItemId) ?? 0 : 0)), 0),
      0
    )
    const totalInvoicedValue = invoices.reduce((sum, i) => sum + Number(i.grandTotal), 0)

    const ordersById = new Map(orders.map((o) => [o.id, o]))
    let delaySum = 0
    let delayCount = 0
    for (const r of receipts) {
      const po = r.purchaseOrderId ? ordersById.get(r.purchaseOrderId) : undefined
      if (!po?.expectedDeliveryDate) continue
      const delay = Math.floor((new Date(r.postingDate).getTime() - new Date(po.expectedDeliveryDate).getTime()) / 86400000)
      delaySum += Math.max(0, delay)
      delayCount++
    }

    return {
      supplierId,
      supplierName: supplier.supplierName,
      totalPoValue,
      totalReceivedValue,
      totalInvoicedValue,
      openPoValue: Math.max(0, totalPoValue - totalInvoicedValue),
      onTimeDeliveryRate: scorecard.onTimeDeliveryRate,
      avgDeliveryDelayDays: delayCount > 0 ? delaySum / delayCount : null,
    }
  })
}
