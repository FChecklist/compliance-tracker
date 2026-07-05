// Wave 52 (VERI ERP gap-fill, Tier 3 #11): Sales/Purchase Credit Notes --
// zero schema on either side before this wave, per
// ERP_BENCHMARK_COMPARISON.md (even ERPNext under-serves this with a
// flag-based approach, not a real document/workflow). Modeled as real
// documents with their own numbering, matching Wave 49's invoice pattern.
import {
  erpSalesCreditNotes, erpSalesCreditNoteItems, erpPurchaseCreditNotes, erpPurchaseCreditNoteItems,
  erpCustomers, erpSuppliers, users,
} from "@/lib/db"
import { withTenantContext } from "@/lib/db/tenant-scoped"
import { and, eq, sql } from "drizzle-orm"
import { ServiceError } from "./compliance-service"
export { ServiceError }
import { logActivity } from "@/lib/audit"

export type ErpContext = { orgId: string; userId: string; dbUser: typeof users.$inferSelect }

type CreditNoteItemInput = { itemId?: string; description: string; quantity?: number; rate?: number }

function computeTotal(items: CreditNoteItemInput[]): number {
  return items.reduce((sum, i) => sum + (i.quantity ?? 1) * (i.rate ?? 0), 0)
}

export async function listSalesCreditNotes(ctx: { orgId: string }) {
  return withTenantContext({ orgId: ctx.orgId }, async (db) => {
    return db.query.erpSalesCreditNotes.findMany({ where: eq(erpSalesCreditNotes.orgId, ctx.orgId), orderBy: (t, { desc }) => desc(t.postingDate) })
  })
}

export async function createSalesCreditNote(
  ctx: ErpContext,
  input: { customerId: string; salesInvoiceId?: string; postingDate: string; reason?: string; items: CreditNoteItemInput[] }
) {
  if (!input.customerId) throw new ServiceError("customerId is required", 400)
  if (!input.items?.length) throw new ServiceError("At least one line item is required", 400)

  return withTenantContext({ orgId: ctx.orgId, userId: ctx.userId }, async (db) => {
    const customer = await db.query.erpCustomers.findFirst({ where: and(eq(erpCustomers.id, input.customerId), eq(erpCustomers.orgId, ctx.orgId)) })
    if (!customer) throw new ServiceError("Customer not found", 404)

    const [{ maxNumber }] = await db.select({ maxNumber: sql<number>`coalesce(max(${erpSalesCreditNotes.creditNoteNumber}), 0)` }).from(erpSalesCreditNotes).where(eq(erpSalesCreditNotes.orgId, ctx.orgId))
    const totalAmount = computeTotal(input.items)

    const [note] = await db.insert(erpSalesCreditNotes).values({
      orgId: ctx.orgId, customerId: input.customerId, salesInvoiceId: input.salesInvoiceId,
      creditNoteNumber: Number(maxNumber) + 1, postingDate: input.postingDate, reason: input.reason,
      totalAmount: totalAmount.toString(), createdById: ctx.userId,
    }).returning()

    await db.insert(erpSalesCreditNoteItems).values(
      input.items.map((i) => ({
        creditNoteId: note.id, itemId: i.itemId, description: i.description,
        quantity: (i.quantity ?? 1).toString(), rate: (i.rate ?? 0).toString(), amount: ((i.quantity ?? 1) * (i.rate ?? 0)).toString(),
      }))
    )

    await logActivity({ tx: db, orgId: ctx.orgId, dbUser: ctx.dbUser, action: "erp_sales_credit_note.created", entityType: "erp_sales_credit_note", entityId: note.id })
    return note
  })
}

export async function submitSalesCreditNote(ctx: ErpContext, noteId: string) {
  return withTenantContext({ orgId: ctx.orgId, userId: ctx.userId }, async (db) => {
    const note = await db.query.erpSalesCreditNotes.findFirst({ where: and(eq(erpSalesCreditNotes.id, noteId), eq(erpSalesCreditNotes.orgId, ctx.orgId)) })
    if (!note) throw new ServiceError("Sales credit note not found", 404)
    if (note.status !== "draft") throw new ServiceError("Only draft credit notes can be submitted", 409)
    const [updated] = await db.update(erpSalesCreditNotes).set({ status: "submitted" }).where(eq(erpSalesCreditNotes.id, noteId)).returning()
    await logActivity({ tx: db, orgId: ctx.orgId, dbUser: ctx.dbUser, action: "erp_sales_credit_note.submitted", entityType: "erp_sales_credit_note", entityId: noteId })
    return updated
  })
}

export async function listPurchaseCreditNotes(ctx: { orgId: string }) {
  return withTenantContext({ orgId: ctx.orgId }, async (db) => {
    return db.query.erpPurchaseCreditNotes.findMany({ where: eq(erpPurchaseCreditNotes.orgId, ctx.orgId), orderBy: (t, { desc }) => desc(t.postingDate) })
  })
}

export async function createPurchaseCreditNote(
  ctx: ErpContext,
  input: { supplierId: string; purchaseInvoiceId?: string; postingDate: string; reason?: string; items: CreditNoteItemInput[] }
) {
  if (!input.supplierId) throw new ServiceError("supplierId is required", 400)
  if (!input.items?.length) throw new ServiceError("At least one line item is required", 400)

  return withTenantContext({ orgId: ctx.orgId, userId: ctx.userId }, async (db) => {
    const supplier = await db.query.erpSuppliers.findFirst({ where: and(eq(erpSuppliers.id, input.supplierId), eq(erpSuppliers.orgId, ctx.orgId)) })
    if (!supplier) throw new ServiceError("Supplier not found", 404)

    const [{ maxNumber }] = await db.select({ maxNumber: sql<number>`coalesce(max(${erpPurchaseCreditNotes.creditNoteNumber}), 0)` }).from(erpPurchaseCreditNotes).where(eq(erpPurchaseCreditNotes.orgId, ctx.orgId))
    const totalAmount = computeTotal(input.items)

    const [note] = await db.insert(erpPurchaseCreditNotes).values({
      orgId: ctx.orgId, supplierId: input.supplierId, purchaseInvoiceId: input.purchaseInvoiceId,
      creditNoteNumber: Number(maxNumber) + 1, postingDate: input.postingDate, reason: input.reason,
      totalAmount: totalAmount.toString(), createdById: ctx.userId,
    }).returning()

    await db.insert(erpPurchaseCreditNoteItems).values(
      input.items.map((i) => ({
        creditNoteId: note.id, itemId: i.itemId, description: i.description,
        quantity: (i.quantity ?? 1).toString(), rate: (i.rate ?? 0).toString(), amount: ((i.quantity ?? 1) * (i.rate ?? 0)).toString(),
      }))
    )

    await logActivity({ tx: db, orgId: ctx.orgId, dbUser: ctx.dbUser, action: "erp_purchase_credit_note.created", entityType: "erp_purchase_credit_note", entityId: note.id })
    return note
  })
}

export async function submitPurchaseCreditNote(ctx: ErpContext, noteId: string) {
  return withTenantContext({ orgId: ctx.orgId, userId: ctx.userId }, async (db) => {
    const note = await db.query.erpPurchaseCreditNotes.findFirst({ where: and(eq(erpPurchaseCreditNotes.id, noteId), eq(erpPurchaseCreditNotes.orgId, ctx.orgId)) })
    if (!note) throw new ServiceError("Purchase credit note not found", 404)
    if (note.status !== "draft") throw new ServiceError("Only draft credit notes can be submitted", 409)
    const [updated] = await db.update(erpPurchaseCreditNotes).set({ status: "submitted" }).where(eq(erpPurchaseCreditNotes.id, noteId)).returning()
    await logActivity({ tx: db, orgId: ctx.orgId, dbUser: ctx.dbUser, action: "erp_purchase_credit_note.submitted", entityType: "erp_purchase_credit_note", entityId: noteId })
    return updated
  })
}
