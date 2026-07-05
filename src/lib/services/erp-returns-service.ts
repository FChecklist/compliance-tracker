// Wave 63 (RMA/Returns Workflow, ERP benchmark Tier 3 #11 remainder).
// ERPNext itself only flags returns with no real workflow -- this is a
// genuine in-house design. Deliberately reuses existing infrastructure:
// physical stock movement goes through the same recordStockReceipt/
// recordStockIssue FIFO engine every other stock movement uses (Wave
// 53/57), and the financial side reuses the existing sales/purchase
// credit note documents (Wave 52) via an explicit admin link -- never
// auto-created, matching Wave 60's "require explicit input for what's
// genuinely ambiguous" discipline (picking the right revenue/expense
// account can't be safely guessed).
import {
  erpSalesReturns, erpSalesReturnItems, erpPurchaseReturns, erpPurchaseReturnItems,
  erpCustomers, erpSuppliers, erpSalesCreditNotes, erpPurchaseCreditNotes,
} from "@/lib/db"
import { withTenantContext, type TenantDb } from "@/lib/db/tenant-scoped"
import { and, eq } from "drizzle-orm"
import { ServiceError } from "./compliance-service"
export { ServiceError }
import { recordStockReceipt, recordStockIssue, type ErpContext } from "./erp-inventory-service"

type ReturnItemInput = { itemId: string; quantity: number; rate?: number; reason?: string }

// ============================================================
// Sales Returns
// ============================================================

export async function listSalesReturns(ctx: { orgId: string }) {
  return withTenantContext({ orgId: ctx.orgId }, async (db) => {
    const returns = await db.query.erpSalesReturns.findMany({ where: eq(erpSalesReturns.orgId, ctx.orgId), orderBy: (t, { desc }) => desc(t.createdAt) })
    const allItems = await db.query.erpSalesReturnItems.findMany()
    return returns.map((r) => ({ ...r, items: allItems.filter((i) => i.returnId === r.id) }))
  })
}

export async function createSalesReturn(
  ctx: ErpContext,
  input: { customerId: string; salesInvoiceId?: string; warehouseId: string; reason?: string; items: ReturnItemInput[] }
) {
  if (!input.items?.length) throw new ServiceError("At least one return line is required", 400)

  return withTenantContext({ orgId: ctx.orgId, userId: ctx.userId }, async (db) => {
    const customer = await db.query.erpCustomers.findFirst({ where: and(eq(erpCustomers.id, input.customerId), eq(erpCustomers.orgId, ctx.orgId)) })
    if (!customer) throw new ServiceError("Customer not found", 404)

    const [created] = await db.insert(erpSalesReturns).values({
      orgId: ctx.orgId, customerId: input.customerId, salesInvoiceId: input.salesInvoiceId || null,
      warehouseId: input.warehouseId, reason: input.reason || null, requestedById: ctx.userId,
    }).returning()

    await db.insert(erpSalesReturnItems).values(
      input.items.map((i) => ({ returnId: created.id, itemId: i.itemId, quantity: String(i.quantity), rate: String(i.rate ?? 0), reason: i.reason || null }))
    )
    return created
  })
}

export async function approveSalesReturn(ctx: ErpContext, returnId: string) {
  return withTenantContext({ orgId: ctx.orgId, userId: ctx.userId }, async (db) => {
    const existing = await getSalesReturnOrThrow(db, ctx.orgId, returnId)
    if (existing.status !== "requested") throw new ServiceError("Only a requested return can be approved", 400)

    const [updated] = await db.update(erpSalesReturns).set({ status: "approved", approvedById: ctx.userId, updatedAt: new Date() }).where(eq(erpSalesReturns.id, returnId)).returning()
    return updated
  })
}

export async function rejectSalesReturn(ctx: ErpContext, returnId: string) {
  return withTenantContext({ orgId: ctx.orgId, userId: ctx.userId }, async (db) => {
    const existing = await getSalesReturnOrThrow(db, ctx.orgId, returnId)
    if (existing.status !== "requested") throw new ServiceError("Only a requested return can be rejected", 400)

    const [updated] = await db.update(erpSalesReturns).set({ status: "rejected", approvedById: ctx.userId, updatedAt: new Date() }).where(eq(erpSalesReturns.id, returnId)).returning()
    return updated
  })
}

// Receiving the physical goods back into stock is the real event this
// workflow exists to gate -- it posts through the exact same FIFO engine
// every other receipt uses, opening a new valuation layer per item.
export async function receiveSalesReturn(ctx: ErpContext, returnId: string) {
  return withTenantContext({ orgId: ctx.orgId, userId: ctx.userId }, async (db) => {
    const existing = await getSalesReturnOrThrow(db, ctx.orgId, returnId)
    if (existing.status !== "approved") throw new ServiceError("Only an approved return can be received", 400)

    const items = await db.query.erpSalesReturnItems.findMany({ where: eq(erpSalesReturnItems.returnId, returnId) })
    for (const item of items) {
      await recordStockReceipt(ctx, {
        itemId: item.itemId, warehouseId: existing.warehouseId, quantity: Number(item.quantity), rate: Number(item.rate),
        postingDate: new Date().toISOString().slice(0, 10), voucherType: "sales_return", voucherId: returnId,
      })
    }

    const [updated] = await db.update(erpSalesReturns).set({ status: "received", updatedAt: new Date() }).where(eq(erpSalesReturns.id, returnId)).returning()
    return updated
  })
}

// Explicit, admin-linked -- never auto-creates a credit note, since the
// correct revenue account isn't reliably derivable (same reasoning as
// Wave 60's invoicing submission).
export async function linkSalesReturnCreditNote(ctx: ErpContext, returnId: string, creditNoteId: string) {
  return withTenantContext({ orgId: ctx.orgId, userId: ctx.userId }, async (db) => {
    const existing = await getSalesReturnOrThrow(db, ctx.orgId, returnId)
    const creditNote = await db.query.erpSalesCreditNotes.findFirst({ where: and(eq(erpSalesCreditNotes.id, creditNoteId), eq(erpSalesCreditNotes.orgId, ctx.orgId)) })
    if (!creditNote) throw new ServiceError("Credit note not found", 404)

    const [updated] = await db.update(erpSalesReturns).set({ creditNoteId, updatedAt: new Date() }).where(eq(erpSalesReturns.id, existing.id)).returning()
    return updated
  })
}

async function getSalesReturnOrThrow(db: TenantDb, orgId: string, returnId: string) {
  const existing = await db.query.erpSalesReturns.findFirst({ where: and(eq(erpSalesReturns.id, returnId), eq(erpSalesReturns.orgId, orgId)) })
  if (!existing) throw new ServiceError("Sales return not found", 404)
  return existing
}

// ============================================================
// Purchase Returns
// ============================================================

export async function listPurchaseReturns(ctx: { orgId: string }) {
  return withTenantContext({ orgId: ctx.orgId }, async (db) => {
    const returns = await db.query.erpPurchaseReturns.findMany({ where: eq(erpPurchaseReturns.orgId, ctx.orgId), orderBy: (t, { desc }) => desc(t.createdAt) })
    const allItems = await db.query.erpPurchaseReturnItems.findMany()
    return returns.map((r) => ({ ...r, items: allItems.filter((i) => i.returnId === r.id) }))
  })
}

export async function createPurchaseReturn(
  ctx: ErpContext,
  input: { supplierId: string; purchaseInvoiceId?: string; warehouseId: string; reason?: string; items: ReturnItemInput[] }
) {
  if (!input.items?.length) throw new ServiceError("At least one return line is required", 400)

  return withTenantContext({ orgId: ctx.orgId, userId: ctx.userId }, async (db) => {
    const supplier = await db.query.erpSuppliers.findFirst({ where: and(eq(erpSuppliers.id, input.supplierId), eq(erpSuppliers.orgId, ctx.orgId)) })
    if (!supplier) throw new ServiceError("Supplier not found", 404)

    const [created] = await db.insert(erpPurchaseReturns).values({
      orgId: ctx.orgId, supplierId: input.supplierId, purchaseInvoiceId: input.purchaseInvoiceId || null,
      warehouseId: input.warehouseId, reason: input.reason || null, requestedById: ctx.userId,
    }).returning()

    await db.insert(erpPurchaseReturnItems).values(
      input.items.map((i) => ({ returnId: created.id, itemId: i.itemId, quantity: String(i.quantity), rate: String(i.rate ?? 0), reason: i.reason || null }))
    )
    return created
  })
}

export async function approvePurchaseReturn(ctx: ErpContext, returnId: string) {
  return withTenantContext({ orgId: ctx.orgId, userId: ctx.userId }, async (db) => {
    const existing = await getPurchaseReturnOrThrow(db, ctx.orgId, returnId)
    if (existing.status !== "requested") throw new ServiceError("Only a requested return can be approved", 400)

    const [updated] = await db.update(erpPurchaseReturns).set({ status: "approved", approvedById: ctx.userId, updatedAt: new Date() }).where(eq(erpPurchaseReturns.id, returnId)).returning()
    return updated
  })
}

export async function rejectPurchaseReturn(ctx: ErpContext, returnId: string) {
  return withTenantContext({ orgId: ctx.orgId, userId: ctx.userId }, async (db) => {
    const existing = await getPurchaseReturnOrThrow(db, ctx.orgId, returnId)
    if (existing.status !== "requested") throw new ServiceError("Only a requested return can be rejected", 400)

    const [updated] = await db.update(erpPurchaseReturns).set({ status: "rejected", approvedById: ctx.userId, updatedAt: new Date() }).where(eq(erpPurchaseReturns.id, returnId)).returning()
    return updated
  })
}

// Dispatching the goods back to the supplier issues stock through the
// exact same FIFO engine every other issue uses -- consuming layers
// oldest-first, computing the true weighted-average cost of what left.
export async function dispatchPurchaseReturn(ctx: ErpContext, returnId: string) {
  return withTenantContext({ orgId: ctx.orgId, userId: ctx.userId }, async (db) => {
    const existing = await getPurchaseReturnOrThrow(db, ctx.orgId, returnId)
    if (existing.status !== "approved") throw new ServiceError("Only an approved return can be dispatched", 400)

    const items = await db.query.erpPurchaseReturnItems.findMany({ where: eq(erpPurchaseReturnItems.returnId, returnId) })
    for (const item of items) {
      await recordStockIssue(ctx, {
        itemId: item.itemId, warehouseId: existing.warehouseId, quantity: Number(item.quantity),
        postingDate: new Date().toISOString().slice(0, 10), voucherType: "purchase_return", voucherId: returnId,
      })
    }

    const [updated] = await db.update(erpPurchaseReturns).set({ status: "dispatched", updatedAt: new Date() }).where(eq(erpPurchaseReturns.id, returnId)).returning()
    return updated
  })
}

export async function linkPurchaseReturnCreditNote(ctx: ErpContext, returnId: string, creditNoteId: string) {
  return withTenantContext({ orgId: ctx.orgId, userId: ctx.userId }, async (db) => {
    const existing = await getPurchaseReturnOrThrow(db, ctx.orgId, returnId)
    const creditNote = await db.query.erpPurchaseCreditNotes.findFirst({ where: and(eq(erpPurchaseCreditNotes.id, creditNoteId), eq(erpPurchaseCreditNotes.orgId, ctx.orgId)) })
    if (!creditNote) throw new ServiceError("Credit note not found", 404)

    const [updated] = await db.update(erpPurchaseReturns).set({ creditNoteId, updatedAt: new Date() }).where(eq(erpPurchaseReturns.id, existing.id)).returning()
    return updated
  })
}

async function getPurchaseReturnOrThrow(db: TenantDb, orgId: string, returnId: string) {
  const existing = await db.query.erpPurchaseReturns.findFirst({ where: and(eq(erpPurchaseReturns.id, returnId), eq(erpPurchaseReturns.orgId, orgId)) })
  if (!existing) throw new ServiceError("Purchase return not found", 404)
  return existing
}
