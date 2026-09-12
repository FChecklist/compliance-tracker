// Minimal list-only service backing the Wave 52 Credit Notes UI's supplier
// picker -- erpSuppliers has existed since Wave 49 but had no service layer
// consumer until now.
import { erpSuppliers, erpPurchaseOrders, erpPurchaseOrderItems, erpPurchaseReceipts, erpPurchaseReturns, erpCurrencies, users } from "@/lib/db"
import { withTenantContext, type TenantDb } from "@/lib/db/tenant-scoped"
import { eq, and, ne, sql } from "drizzle-orm"
import { ServiceError } from "./compliance-service"
export { ServiceError }
import { logActivity } from "@/lib/audit"
import { requireErpEnabled } from "./erp-enablement-service"
import { ErpContext, ActorCtx } from "./actor-context"


// Priority 17 Wave 1 (PROJEXA Procurement workflow exposure): widened to the
// same dbUser-or-apiKey actor union already precedented by erp-invoicing-
// service.ts's createSalesInvoice -- PROJEXA's callVeridian() proxy always
// calls server-to-server with a shared Bearer API key, never a session
// cookie.

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
export type SupplierInput = { supplierName: string; supplierType?: string; gstin?: string; panNumber?: string; defaultPaymentTermsDays?: number; creditLimit?: number; trade?: string; projectId?: string; isActive?: boolean }

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

// Real-screen conversion (2026-08-30): single-supplier lookup for the
// Vendor Object Page -- never existed, the same class of gap
// getMaterial()/getRosterEntry() closed earlier this session (list-and-
// update existed, single-item read never did).
export async function getSupplier(ctx: { orgId: string }, supplierId: string) {
  await requireErpEnabled(ctx.orgId)
  return withTenantContext({ orgId: ctx.orgId }, async (db) => {
    const supplier = await db.query.erpSuppliers.findFirst({ where: and(eq(erpSuppliers.id, supplierId), eq(erpSuppliers.orgId, ctx.orgId)) })
    if (!supplier) throw new ServiceError("Supplier not found", 404)
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
      ...(input.isActive !== undefined ? { isActive: input.isActive } : {}),
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
export async function listPurchaseOrders(ctx: { orgId: string }, filters?: { companyId?: string }) {
  await requireErpEnabled(ctx.orgId)
  return withTenantContext({ orgId: ctx.orgId }, (db) => {
    const conditions = [eq(erpPurchaseOrders.orgId, ctx.orgId)]
    if (filters?.companyId) conditions.push(eq(erpPurchaseOrders.companyId, filters.companyId))
    return db.query.erpPurchaseOrders.findMany({
      where: and(...conditions),
      orderBy: (t, { desc }) => desc(t.orderDate),
      with: { items: true },
    })
  })
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

// R80 GAP-6 (PROJEXA R80_PART5_ERP_SCREEN_GAP_AUDIT.md): a purchase order --
// a core ERP document -- had no update and no cancel at ANY layer.
// PurchaseOrderObjectClient.tsx said so about itself in a comment ("No
// generic Edit/Delete -- no updatePurchaseOrder() exists") and
// /api/v1/projexa/procurement/purchase-orders/[id] exported GET only, so a PO
// raised against the wrong vendor or with the wrong delivery date could only
// ever be abandoned in place.
//
// THE RULE THESE TWO FUNCTIONS ENFORCE, and where each half of it comes from.
//
// (1) DRAFT ONLY. submitPurchaseOrder() directly above already refuses
//     anything but a draft with a 409, and cancelSalesInvoice() in
//     erp-invoicing-service.ts uses the identical draft-only shape for the
//     same reason: once a document leaves draft it is a commitment something
//     downstream has already acted on. For a PO that "something" is the
//     supplier and the goods-receipt chain.
//
// (2) NOTHING RECEIVED AGAINST IT. submitPurchaseReceipt() in
//     erp-goods-receipt-service.ts writes receivedQuantity back onto
//     erp_purchase_order_items and rolls the parent PO's status up to
//     partially_received/completed, and getThreeWayMatchReport() reconciles
//     PO vs receipt vs invoice off exactly those rows. Editing the header or
//     cancelling the order underneath that silently invalidates the match.
//     The status check ALONE does not cover this: createPurchaseReceipt()
//     only checks that the PO exists, never that it is submitted, so a draft
//     receipt can legitimately already point at a draft PO.
//
// CANCEL, NOT DESTROY. 'cancelled' is already in the documented status
// vocabulary of erp_purchase_orders (schema.ts) with nothing writing it until
// now, and erp_purchase_receipts.purchaseOrderId is bare text with no
// DB-level FK -- a row delete would leave dangling references with nothing to
// catch them. Same soft end-state cancelSalesInvoice() settled on.
export type PurchaseOrderUpdateInput = {
  supplierId?: string
  orderDate?: string
  expectedDeliveryDate?: string | null
  companyId?: string | null
  projectId?: string | null
  currencyId?: string | null
  exchangeRate?: number
}

/**
 * Loads a PO for mutation, or refuses it. `verb` is the past participle used
 * in the refusal ("edited", "cancelled") so one guard produces a sentence that
 * says what was actually attempted.
 */
async function loadMutablePurchaseOrder(db: TenantDb, orgId: string, purchaseOrderId: string, verb: string) {
  const po = await db.query.erpPurchaseOrders.findFirst({
    where: and(eq(erpPurchaseOrders.id, purchaseOrderId), eq(erpPurchaseOrders.orgId, orgId)),
    with: { items: true },
  })
  if (!po) throw new ServiceError("Purchase order not found", 404)
  if (po.status !== "draft") throw new ServiceError(`Only draft purchase orders can be ${verb} -- this one is ${po.status.replace(/_/g, " ")}`, 409)
  if (po.items.some((i) => Number(i.receivedQuantity) > 0)) {
    throw new ServiceError(`This purchase order already has goods received against it, so it can no longer be ${verb}`, 409)
  }
  const receipt = await db.query.erpPurchaseReceipts.findFirst({
    where: and(
      eq(erpPurchaseReceipts.purchaseOrderId, purchaseOrderId),
      eq(erpPurchaseReceipts.orgId, orgId),
      ne(erpPurchaseReceipts.status, "cancelled")
    ),
  })
  if (receipt) throw new ServiceError(`A goods receipt already references this purchase order, so it can no longer be ${verb}`, 409)
  return po
}

/**
 * Header-only update of a draft purchase order. Line items are deliberately
 * NOT editable here: grandTotal is derived from them at create time and the
 * receipt/invoice chain matches on erp_purchase_order_items.id, so a line
 * editor is its own piece of work (R80 GAP-7), not a side effect of this one.
 */
export async function updatePurchaseOrder(ctx: ActorCtx, purchaseOrderId: string, input: PurchaseOrderUpdateInput) {
  await requireErpEnabled(ctx.orgId)
  return withTenantContext({ orgId: ctx.orgId, userId: ctx.userId }, async (db) => {
    await loadMutablePurchaseOrder(db, ctx.orgId, purchaseOrderId, "edited")

    if (input.orderDate !== undefined && !input.orderDate) throw new ServiceError("orderDate cannot be cleared", 400)
    if (input.supplierId !== undefined) {
      if (!input.supplierId) throw new ServiceError("supplierId cannot be cleared", 400)
      const supplier = await db.query.erpSuppliers.findFirst({ where: and(eq(erpSuppliers.id, input.supplierId), eq(erpSuppliers.orgId, ctx.orgId)) })
      if (!supplier) throw new ServiceError("Supplier not found", 404)
    }
    // Identical optional-pair validation to createPurchaseOrder's: an explicit
    // positive rate is required whenever a currency is set, never guessed.
    const currency = input.currencyId !== undefined
      ? await resolvePoCurrency(db, ctx.orgId, input.currencyId ?? undefined, input.exchangeRate)
      : null

    const [updated] = await db.update(erpPurchaseOrders).set({
      ...(input.supplierId !== undefined ? { supplierId: input.supplierId } : {}),
      ...(input.orderDate !== undefined ? { orderDate: input.orderDate } : {}),
      ...(input.expectedDeliveryDate !== undefined ? { expectedDeliveryDate: input.expectedDeliveryDate } : {}),
      ...(input.companyId !== undefined ? { companyId: input.companyId } : {}),
      ...(input.projectId !== undefined ? { projectId: input.projectId } : {}),
      ...(currency ? { currencyId: currency.currencyId, exchangeRate: currency.exchangeRate.toString() } : {}),
      updatedAt: new Date(),
    }).where(eq(erpPurchaseOrders.id, purchaseOrderId)).returning()

    await logActivity({ tx: db, orgId: ctx.orgId, ...(ctx.dbUser ? { dbUser: ctx.dbUser } : { apiKey: ctx.apiKey! }), action: "erp_purchase_order.updated", entityType: "erp_purchase_order", entityId: purchaseOrderId })
    return updated
  })
}

/** Cancels a DRAFT purchase order with nothing received against it -- the soft lifecycle end-state, never a row delete. See the block comment above updatePurchaseOrder for why. */
export async function cancelPurchaseOrder(ctx: ActorCtx, purchaseOrderId: string) {
  await requireErpEnabled(ctx.orgId)
  return withTenantContext({ orgId: ctx.orgId, userId: ctx.userId }, async (db) => {
    await loadMutablePurchaseOrder(db, ctx.orgId, purchaseOrderId, "cancelled")
    const [updated] = await db.update(erpPurchaseOrders).set({ status: "cancelled", updatedAt: new Date() }).where(eq(erpPurchaseOrders.id, purchaseOrderId)).returning()
    await logActivity({ tx: db, orgId: ctx.orgId, ...(ctx.dbUser ? { dbUser: ctx.dbUser } : { apiKey: ctx.apiKey! }), action: "erp_purchase_order.cancelled", entityType: "erp_purchase_order", entityId: purchaseOrderId })
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

// Pure -- no DB access -- the aggregation math both getSupplierScorecard
// (one supplier, rows already filtered to it) and listSupplierScorecards
// (every supplier, rows grouped in memory -- see that function's own note
// on why) share, so the two can never compute this differently.
export function computeSupplierScorecardFromRows(
  supplierId: string,
  orders: (typeof erpPurchaseOrders.$inferSelect)[],
  receipts: (typeof erpPurchaseReceipts.$inferSelect)[],
  returns: (typeof erpPurchaseReturns.$inferSelect)[]
): SupplierScorecard {
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

    return computeSupplierScorecardFromRows(supplierId, orders, receipts, returns)
  })
}

// V2-17 load-test finding (2026-07-26): this previously called
// getSupplierScorecard() in a loop -- N suppliers meant N sequential round
// trips of 3 queries each (3N total), every one re-fetching the FULL
// org-wide purchase-order/receipt/return tables filtered down to one
// supplier at a time. Rewritten to fetch each of the 3 tables ONCE for the
// whole org, then group in memory and reuse the same pure
// computeSupplierScorecardFromRows() math per supplier -- 3 queries total
// regardless of supplier count, not 3N.
export async function listSupplierScorecards(ctx: { orgId: string }): Promise<SupplierScorecard[]> {
  await requireErpEnabled(ctx.orgId)
  const suppliers = await listSuppliers(ctx)
  if (suppliers.length === 0) return []

  return withTenantContext({ orgId: ctx.orgId }, async (db) => {
    const [allOrders, allReceipts, allReturns] = await Promise.all([
      db.query.erpPurchaseOrders.findMany({
        where: and(eq(erpPurchaseOrders.orgId, ctx.orgId), ne(erpPurchaseOrders.status, "draft"), ne(erpPurchaseOrders.status, "cancelled")),
      }),
      db.query.erpPurchaseReceipts.findMany({
        where: and(eq(erpPurchaseReceipts.orgId, ctx.orgId), eq(erpPurchaseReceipts.status, "submitted")),
      }),
      db.query.erpPurchaseReturns.findMany({ where: eq(erpPurchaseReturns.orgId, ctx.orgId) }),
    ])

    const ordersBySupplier = new Map<string, typeof allOrders>()
    for (const o of allOrders) ordersBySupplier.set(o.supplierId, [...(ordersBySupplier.get(o.supplierId) ?? []), o])
    const receiptsBySupplier = new Map<string, typeof allReceipts>()
    for (const r of allReceipts) receiptsBySupplier.set(r.supplierId, [...(receiptsBySupplier.get(r.supplierId) ?? []), r])
    const returnsBySupplier = new Map<string, typeof allReturns>()
    for (const r of allReturns) returnsBySupplier.set(r.supplierId, [...(returnsBySupplier.get(r.supplierId) ?? []), r])

    return suppliers.map((s) => computeSupplierScorecardFromRows(
      s.id, ordersBySupplier.get(s.id) ?? [], receiptsBySupplier.get(s.id) ?? [], returnsBySupplier.get(s.id) ?? []
    ))
  })
}
