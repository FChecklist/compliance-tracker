// Wave 55 (VERI ERP gap-fill, Tier 3 #10): Procurement Workflow above the
// PO -- Purchase Requisition + RFQ + Supplier Quotation. Every PO was
// previously a standalone document with no upstream authorization trail.
// Submitting a requisition is deliberately wired to the shared Approval
// Workflow Engine (see approval-workflow-service.ts) as its SECOND real
// consumer after erp_journal_entry -- proving the engine generalizes
// rather than being a single-use abstraction disguised as generic.
import {
  erpPurchaseRequisitions, erpPurchaseRequisitionItems,
  erpRfqs, erpRfqItems, erpRfqSuppliers,
  erpSupplierQuotations, erpSupplierQuotationItems,
  erpSuppliers, users,
} from "@/lib/db"
import { withTenantContext } from "@/lib/db/tenant-scoped"
import { and, eq, sql } from "drizzle-orm"
import { ServiceError } from "./compliance-service"
export { ServiceError }
import { logActivity } from "@/lib/audit"
import { startApprovalWorkflow } from "./approval-workflow-service"

export type ErpContext = { orgId: string; userId: string; dbUser: typeof users.$inferSelect }

type RequisitionItemInput = { itemId?: string; description: string; quantity?: number; estimatedRate?: number }

// ============================================================
// Purchase Requisitions
// ============================================================

export async function listPurchaseRequisitions(ctx: { orgId: string }) {
  return withTenantContext({ orgId: ctx.orgId }, async (db) => {
    return db.query.erpPurchaseRequisitions.findMany({
      where: eq(erpPurchaseRequisitions.orgId, ctx.orgId),
      orderBy: (t, { desc }) => desc(t.postingDate),
      with: { items: true },
    })
  })
}

export async function getPurchaseRequisition(ctx: { orgId: string }, requisitionId: string) {
  return withTenantContext({ orgId: ctx.orgId }, async (db) => {
    const req = await db.query.erpPurchaseRequisitions.findFirst({
      where: and(eq(erpPurchaseRequisitions.id, requisitionId), eq(erpPurchaseRequisitions.orgId, ctx.orgId)),
      with: { items: true },
    })
    if (!req) throw new ServiceError("Purchase requisition not found", 404)
    return req
  })
}

export async function createPurchaseRequisition(
  ctx: ErpContext,
  input: { departmentId?: string; purpose?: string; postingDate: string; items: RequisitionItemInput[] }
) {
  if (!input.items?.length) throw new ServiceError("At least one line item is required", 400)

  return withTenantContext({ orgId: ctx.orgId, userId: ctx.userId }, async (db) => {
    const [{ maxNumber }] = await db.select({ maxNumber: sql<number>`coalesce(max(${erpPurchaseRequisitions.requisitionNumber}), 0)` })
      .from(erpPurchaseRequisitions).where(eq(erpPurchaseRequisitions.orgId, ctx.orgId))

    const [req] = await db.insert(erpPurchaseRequisitions).values({
      orgId: ctx.orgId, requisitionNumber: Number(maxNumber) + 1, requestedById: ctx.userId,
      departmentId: input.departmentId, purpose: input.purpose, postingDate: input.postingDate,
    }).returning()

    await db.insert(erpPurchaseRequisitionItems).values(
      input.items.map((i) => ({
        requisitionId: req.id, itemId: i.itemId, description: i.description,
        quantity: (i.quantity ?? 1).toString(), estimatedRate: i.estimatedRate?.toString(),
      }))
    )

    await logActivity({ tx: db, orgId: ctx.orgId, dbUser: ctx.dbUser, action: "erp_purchase_requisition.created", entityType: "erp_purchase_requisition", entityId: req.id })
    return req
  })
}

/**
 * Submits a draft requisition: starts an approval-workflow instance if the
 * org has configured one for 'erp_purchase_requisition', otherwise moves
 * straight to 'approved' -- matching the no-approval-configured default
 * behavior established by submitJournalEntry.
 */
export async function submitPurchaseRequisition(ctx: ErpContext, requisitionId: string) {
  const req = await getPurchaseRequisition(ctx, requisitionId)
  if (req.status !== "draft") throw new ServiceError("Only draft requisitions can be submitted", 409)

  const estimatedTotal = req.items.reduce((sum, i) => sum + Number(i.quantity) * Number(i.estimatedRate ?? 0), 0)

  const instance = await startApprovalWorkflow(ctx, {
    entityType: "erp_purchase_requisition",
    entityId: requisitionId,
    entityData: { estimatedTotal },
  })

  if (!instance) {
    return withTenantContext({ orgId: ctx.orgId, userId: ctx.userId }, async (db) => {
      const [updated] = await db.update(erpPurchaseRequisitions).set({ status: "approved" }).where(eq(erpPurchaseRequisitions.id, requisitionId)).returning()
      await logActivity({ tx: db, orgId: ctx.orgId, dbUser: ctx.dbUser, action: "erp_purchase_requisition.approved", entityType: "erp_purchase_requisition", entityId: requisitionId })
      return { ...updated, pendingApproval: false }
    })
  }

  return withTenantContext({ orgId: ctx.orgId, userId: ctx.userId }, async (db) => {
    const [updated] = await db.update(erpPurchaseRequisitions).set({ status: "submitted" }).where(eq(erpPurchaseRequisitions.id, requisitionId)).returning()
    await logActivity({ tx: db, orgId: ctx.orgId, dbUser: ctx.dbUser, action: "erp_purchase_requisition.submitted", entityType: "erp_purchase_requisition", entityId: requisitionId })
    return { ...updated, pendingApproval: true, approvalInstanceId: instance.id }
  })
}

/** Called from the approval-decide route once a requisition's workflow instance reaches 'approved'. */
export async function markPurchaseRequisitionApprovedFromApproval(ctx: { orgId: string; userId: string; dbUser: typeof users.$inferSelect }, requisitionId: string) {
  return withTenantContext({ orgId: ctx.orgId, userId: ctx.userId }, async (db) => {
    const [updated] = await db.update(erpPurchaseRequisitions).set({ status: "approved" }).where(eq(erpPurchaseRequisitions.id, requisitionId)).returning()
    await logActivity({ tx: db, orgId: ctx.orgId, dbUser: ctx.dbUser, action: "erp_purchase_requisition.approved", entityType: "erp_purchase_requisition", entityId: requisitionId })
    return updated
  })
}

// ============================================================
// RFQs
// ============================================================

export async function listRfqs(ctx: { orgId: string }) {
  return withTenantContext({ orgId: ctx.orgId }, async (db) => {
    return db.query.erpRfqs.findMany({
      where: eq(erpRfqs.orgId, ctx.orgId),
      orderBy: (t, { desc }) => desc(t.postingDate),
      with: { items: true, suppliers: true },
    })
  })
}

export async function createRfq(
  ctx: ErpContext,
  input: { requisitionId?: string; postingDate: string; items: { itemId?: string; description: string; quantity?: number }[]; supplierIds: string[] }
) {
  if (!input.items?.length) throw new ServiceError("At least one line item is required", 400)
  if (!input.supplierIds?.length) throw new ServiceError("At least one supplier is required", 400)

  return withTenantContext({ orgId: ctx.orgId, userId: ctx.userId }, async (db) => {
    if (input.requisitionId) {
      const req = await db.query.erpPurchaseRequisitions.findFirst({ where: and(eq(erpPurchaseRequisitions.id, input.requisitionId), eq(erpPurchaseRequisitions.orgId, ctx.orgId)) })
      if (!req) throw new ServiceError("Purchase requisition not found", 404)
    }

    const [{ maxNumber }] = await db.select({ maxNumber: sql<number>`coalesce(max(${erpRfqs.rfqNumber}), 0)` })
      .from(erpRfqs).where(eq(erpRfqs.orgId, ctx.orgId))

    const [rfq] = await db.insert(erpRfqs).values({
      orgId: ctx.orgId, rfqNumber: Number(maxNumber) + 1, requisitionId: input.requisitionId,
      postingDate: input.postingDate, createdById: ctx.userId,
    }).returning()

    await db.insert(erpRfqItems).values(
      input.items.map((i) => ({ rfqId: rfq.id, itemId: i.itemId, description: i.description, quantity: (i.quantity ?? 1).toString() }))
    )
    await db.insert(erpRfqSuppliers).values(input.supplierIds.map((supplierId) => ({ rfqId: rfq.id, supplierId })))

    await logActivity({ tx: db, orgId: ctx.orgId, dbUser: ctx.dbUser, action: "erp_rfq.created", entityType: "erp_rfq", entityId: rfq.id })
    return rfq
  })
}

export async function sendRfq(ctx: ErpContext, rfqId: string) {
  return withTenantContext({ orgId: ctx.orgId, userId: ctx.userId }, async (db) => {
    const rfq = await db.query.erpRfqs.findFirst({ where: and(eq(erpRfqs.id, rfqId), eq(erpRfqs.orgId, ctx.orgId)) })
    if (!rfq) throw new ServiceError("RFQ not found", 404)
    if (rfq.status !== "draft") throw new ServiceError("Only draft RFQs can be sent", 409)
    const [updated] = await db.update(erpRfqs).set({ status: "sent" }).where(eq(erpRfqs.id, rfqId)).returning()
    await logActivity({ tx: db, orgId: ctx.orgId, dbUser: ctx.dbUser, action: "erp_rfq.sent", entityType: "erp_rfq", entityId: rfqId })
    return updated
  })
}

// ============================================================
// Supplier Quotations
// ============================================================

export async function listSupplierQuotations(ctx: { orgId: string }, rfqId?: string) {
  return withTenantContext({ orgId: ctx.orgId }, async (db) => {
    return db.query.erpSupplierQuotations.findMany({
      where: rfqId
        ? and(eq(erpSupplierQuotations.orgId, ctx.orgId), eq(erpSupplierQuotations.rfqId, rfqId))
        : eq(erpSupplierQuotations.orgId, ctx.orgId),
      orderBy: (t, { desc }) => desc(t.postingDate),
      with: { items: true, supplier: true },
    })
  })
}

export async function createSupplierQuotation(
  ctx: ErpContext,
  input: { rfqId?: string; supplierId: string; postingDate: string; validTill?: string; items: { itemId?: string; description: string; quantity?: number; rate?: number }[] }
) {
  if (!input.supplierId) throw new ServiceError("supplierId is required", 400)
  if (!input.items?.length) throw new ServiceError("At least one line item is required", 400)

  return withTenantContext({ orgId: ctx.orgId, userId: ctx.userId }, async (db) => {
    const supplier = await db.query.erpSuppliers.findFirst({ where: and(eq(erpSuppliers.id, input.supplierId), eq(erpSuppliers.orgId, ctx.orgId)) })
    if (!supplier) throw new ServiceError("Supplier not found", 404)

    const [{ maxNumber }] = await db.select({ maxNumber: sql<number>`coalesce(max(${erpSupplierQuotations.quotationNumber}), 0)` })
      .from(erpSupplierQuotations).where(eq(erpSupplierQuotations.orgId, ctx.orgId))

    const [quotation] = await db.insert(erpSupplierQuotations).values({
      orgId: ctx.orgId, rfqId: input.rfqId, supplierId: input.supplierId,
      quotationNumber: Number(maxNumber) + 1, postingDate: input.postingDate, validTill: input.validTill,
      createdById: ctx.userId,
    }).returning()

    await db.insert(erpSupplierQuotationItems).values(
      input.items.map((i) => ({ quotationId: quotation.id, itemId: i.itemId, description: i.description, quantity: (i.quantity ?? 1).toString(), rate: (i.rate ?? 0).toString() }))
    )

    await logActivity({ tx: db, orgId: ctx.orgId, dbUser: ctx.dbUser, action: "erp_supplier_quotation.created", entityType: "erp_supplier_quotation", entityId: quotation.id })
    return quotation
  })
}

/** Side-by-side comparison of all quotations received against one RFQ, ranked by total. */
export async function compareQuotationsForRfq(ctx: { orgId: string }, rfqId: string) {
  const quotations = await listSupplierQuotations(ctx, rfqId)
  return quotations
    .map((q) => ({
      ...q,
      total: q.items.reduce((sum, i) => sum + Number(i.quantity) * Number(i.rate), 0),
    }))
    .sort((a, b) => a.total - b.total)
}
