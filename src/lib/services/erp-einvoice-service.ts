// Wave 69 (e-invoicing/IRN, per resilient-tech/india-compliance's
// e_invoice_log doctype and IRP JSON schema as reference -- GPL-3.0, no
// code copied): generates the IRP-schema JSON payload for a submitted
// sales invoice and stores it in a separate log table (erp_e_invoice_logs),
// matching that project's own separate-log-doctype pattern rather than
// bolting full e-invoicing detail onto erp_sales_invoices directly.
//
// Real submission to the government IRP requires GSP (GST Suvidha
// Provider) credentials this environment doesn't have -- the same
// verification-boundary honesty as Wave 59's SSO. What this service
// proves: (a) the payload is generated correctly from real invoice data,
// (b) the log lifecycle (draft -> generated -> cancelled) works.
// markEInvoiceGenerated lets an admin record the IRP's actual response
// after submitting the payload through their own GSP integration.
import { erpEInvoiceLogs, erpSalesInvoices, erpSalesInvoiceItems, erpCustomers, organisations, users } from "@/lib/db"
import { withTenantContext } from "@/lib/db/tenant-scoped"
import { and, eq } from "drizzle-orm"
import { ServiceError } from "./compliance-service"
export { ServiceError }
import { logActivity } from "@/lib/audit"
import { requireErpEnabled } from "./erp-enablement-service"

export type ErpContext = { orgId: string; userId: string; dbUser: typeof users.$inferSelect }

export async function listEInvoiceLogs(ctx: { orgId: string }, invoiceId?: string) {
  await requireErpEnabled(ctx.orgId)
  return withTenantContext({ orgId: ctx.orgId }, async (db) => {
    return db.query.erpEInvoiceLogs.findMany({
      where: invoiceId
        ? and(eq(erpEInvoiceLogs.orgId, ctx.orgId), eq(erpEInvoiceLogs.referenceId, invoiceId))
        : eq(erpEInvoiceLogs.orgId, ctx.orgId),
      orderBy: (t, { desc }) => desc(t.createdAt),
    })
  })
}

/**
 * Builds the IRP-schema JSON payload (Version/TranDtls/DocDtls/SellerDtls/
 * BuyerDtls/ItemList/ValDtls) from a submitted sales invoice and creates a
 * 'draft' log row storing it -- the payload is never mutated after
 * creation (a later change to the invoice/item/customer master data must
 * never silently rewrite a generated payload's contents), matching this
 * codebase's snapshot-at-transaction-time discipline used everywhere else
 * (Wave 65's HSN/SAC, Wave 66's exchangeRate).
 */
export async function generateEInvoicePayload(ctx: ErpContext, invoiceId: string) {
  await requireErpEnabled(ctx.orgId)
  return withTenantContext({ orgId: ctx.orgId, userId: ctx.userId }, async (db) => {
    const invoice = await db.query.erpSalesInvoices.findFirst({ where: and(eq(erpSalesInvoices.id, invoiceId), eq(erpSalesInvoices.orgId, ctx.orgId)) })
    if (!invoice) throw new ServiceError("Sales invoice not found", 404)
    if (invoice.status !== "submitted") throw new ServiceError("Only submitted invoices can generate an e-invoice payload", 409)
    if (invoice.eInvoiceStatus === "generated") throw new ServiceError("An e-invoice has already been generated for this invoice", 409)

    const org = await db.query.organisations.findFirst({ where: eq(organisations.id, ctx.orgId) })
    if (!org?.gstin) throw new ServiceError("Your organisation's GSTIN is not set -- add it in Settings before generating an e-invoice", 400)

    const customer = await db.query.erpCustomers.findFirst({ where: and(eq(erpCustomers.id, invoice.customerId), eq(erpCustomers.orgId, ctx.orgId)) })
    if (!customer) throw new ServiceError("Customer not found", 404)
    if (!customer.gstin) throw new ServiceError("This customer has no GSTIN on file -- required for e-invoicing", 400)

    const items = await db.query.erpSalesInvoiceItems.findMany({ where: eq(erpSalesInvoiceItems.invoiceId, invoiceId) })

    const payload = {
      Version: "1.1",
      TranDtls: { TaxSch: "GST", SupTyp: "B2B" },
      DocDtls: { Typ: "INV", No: String(invoice.invoiceNumber), Dt: invoice.postingDate },
      SellerDtls: { Gstin: org.gstin, LglNm: org.name, Addr1: org.address ?? "" },
      BuyerDtls: { Gstin: customer.gstin, LglNm: customer.customerName, Pos: customer.gstin.slice(0, 2) },
      ItemList: items.map((item, i) => ({
        SlNo: String(i + 1),
        HsnCd: item.hsnSacCode ?? "",
        Qty: Number(item.quantity),
        Unit: "NOS",
        UnitPrice: Number(item.rate),
        TotAmt: Number(item.amount),
        AssAmt: Number(item.amount),
        GstRt: 0, // per-line GST rate isn't separately tracked -- see ValDtls for the invoice-level tax total
        TotItemVal: Number(item.amount),
      })),
      ValDtls: { AssVal: Number(invoice.subtotal), TotInvVal: Number(invoice.grandTotal), OthChrg: Number(invoice.taxAmount) },
    }

    const [log] = await db.insert(erpEInvoiceLogs).values({
      orgId: ctx.orgId, referenceType: "sales_invoice", referenceId: invoiceId, status: "draft",
      invoiceData: payload, createdById: ctx.userId,
    }).returning()
    await logActivity({ tx: db, orgId: ctx.orgId, dbUser: ctx.dbUser, action: "erp_e_invoice_log.payload_generated", entityType: "erp_e_invoice_log", entityId: log.id })
    return log
  })
}

/**
 * Records a real IRP response against a draft log -- an admin submits
 * the log's invoiceData payload through their own GSP integration
 * (outside this system, since real submission needs GSP credentials
 * this environment doesn't have) and pastes the response here.
 */
export async function markEInvoiceGenerated(
  ctx: ErpContext, logId: string,
  input: { irn: string; ackNumber: string; ackDate: string; signedInvoice?: string; signedQrCode?: string; isGeneratedInSandbox?: boolean }
) {
  await requireErpEnabled(ctx.orgId)
  if (!input.irn?.trim()) throw new ServiceError("irn is required", 400)
  if (!input.ackNumber?.trim()) throw new ServiceError("ackNumber is required", 400)
  return withTenantContext({ orgId: ctx.orgId, userId: ctx.userId }, async (db) => {
    const log = await db.query.erpEInvoiceLogs.findFirst({ where: and(eq(erpEInvoiceLogs.id, logId), eq(erpEInvoiceLogs.orgId, ctx.orgId)) })
    if (!log) throw new ServiceError("E-invoice log not found", 404)
    if (log.status !== "draft") throw new ServiceError("Only a draft log can be marked generated", 409)

    const [updated] = await db.update(erpEInvoiceLogs).set({
      status: "generated", irn: input.irn, ackNumber: input.ackNumber, ackDate: new Date(input.ackDate),
      signedInvoice: input.signedInvoice, signedQrCode: input.signedQrCode, isGeneratedInSandbox: input.isGeneratedInSandbox ?? true,
    }).where(eq(erpEInvoiceLogs.id, logId)).returning()

    await db.update(erpSalesInvoices).set({ irn: input.irn, eInvoiceStatus: "generated" }).where(and(eq(erpSalesInvoices.id, log.referenceId), eq(erpSalesInvoices.orgId, ctx.orgId)))
    await logActivity({ tx: db, orgId: ctx.orgId, dbUser: ctx.dbUser, action: "erp_e_invoice_log.generated", entityType: "erp_e_invoice_log", entityId: logId })
    return updated
  })
}

export async function cancelEInvoice(ctx: ErpContext, logId: string, input: { cancelReasonCode: string; cancelRemark?: string }) {
  await requireErpEnabled(ctx.orgId)
  if (!input.cancelReasonCode?.trim()) throw new ServiceError("cancelReasonCode is required", 400)
  return withTenantContext({ orgId: ctx.orgId, userId: ctx.userId }, async (db) => {
    const log = await db.query.erpEInvoiceLogs.findFirst({ where: and(eq(erpEInvoiceLogs.id, logId), eq(erpEInvoiceLogs.orgId, ctx.orgId)) })
    if (!log) throw new ServiceError("E-invoice log not found", 404)
    if (log.status !== "generated") throw new ServiceError("Only a generated e-invoice can be cancelled", 409)

    const [updated] = await db.update(erpEInvoiceLogs).set({
      status: "cancelled", isCancelled: true, cancelledAt: new Date(), cancelReasonCode: input.cancelReasonCode, cancelRemark: input.cancelRemark,
    }).where(eq(erpEInvoiceLogs.id, logId)).returning()

    await db.update(erpSalesInvoices).set({ eInvoiceStatus: "cancelled" }).where(and(eq(erpSalesInvoices.id, log.referenceId), eq(erpSalesInvoices.orgId, ctx.orgId)))
    await logActivity({ tx: db, orgId: ctx.orgId, dbUser: ctx.dbUser, action: "erp_e_invoice_log.cancelled", entityType: "erp_e_invoice_log", entityId: logId })
    return updated
  })
}
