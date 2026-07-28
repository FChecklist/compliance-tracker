// Interim/RA (Running Account) billing + retention (Owner directive,
// PROJEXA_ERP_END_TO_END_REQUIREMENT_ANALYSIS_GAP_FILL_AND_IMPLEMENTATION,
// 2026-07-27). Computes each BoQ line item's cumulative work-done value from
// constructionWorkProgressEntries.percentComplete (already real, Wave 115),
// bills only the increment over what earlier interim bills already claimed,
// applies a configurable retention %, and emits the net-payable amount as a
// real erp_sales_invoices row via erp-invoicing-service.ts's
// createSalesInvoice -- NOT a new invoice table, same "reuse the existing
// invoice mechanism" discipline as firm-billing-service.ts's
// generateInvoiceFromUnbilledTime. erpSalesInvoices.projectId (added Wave
// 120 PROJEXA Revenue Report) is exactly what makes this the right invoice
// table for construction billing, not firm_invoices (a different,
// CA-firm-billing-specific table).
import {
  constructionBoqs, constructionBoqLineItems,
  constructionInterimBills, constructionInterimBillLineItems, erpTaxTemplates, users,
} from "@/lib/db"
import { withTenantContext, type TenantDb } from "@/lib/db/tenant-scoped"
import { and, eq, sql } from "drizzle-orm"
import { ServiceError } from "./compliance-service"
import { createSalesInvoice } from "./erp-invoicing-service"
export { ServiceError }

export type ValuationContext = { orgId: string; userId: string }

export type BillableLineItem = { id: string; amount: string | number; activityId: string | null; description: string }

export type InterimBillLine = {
  boqLineItemId: string
  description: string
  cumulativePercentComplete: number
  cumulativeAmount: number
  previousBilledAmount: number
  currentBillAmount: number
}

/**
 * Pure, no DB access -- independently unit-testable (matching this repo's
 * convention, e.g. firm-billing-service.ts's resolveBillableRate). For each
 * line item with a tracked activity, cumulativeAmount = lineItem.amount *
 * percentComplete/100 (percentComplete is already cumulative-as-of-date per
 * constructionWorkProgressEntries' own schema comment); currentBillAmount is
 * the increment over previousBilledAmount, floored at 0 so a data
 * correction that lowers percentComplete never produces a negative bill
 * line. Line items with no activityId (nothing to track progress against)
 * or no progress entry yet are skipped entirely -- nothing to bill.
 */
export function computeInterimBillLines(
  lineItems: BillableLineItem[],
  percentCompleteByActivity: Map<string, number>,
  previousBilledByLineItem: Map<string, number>
): InterimBillLine[] {
  const lines: InterimBillLine[] = []
  for (const item of lineItems) {
    if (!item.activityId) continue
    const percentComplete = percentCompleteByActivity.get(item.activityId)
    if (percentComplete == null) continue

    const cumulativeAmount = Number(item.amount) * (percentComplete / 100)
    const previousBilledAmount = previousBilledByLineItem.get(item.id) ?? 0
    const currentBillAmount = Math.max(0, Math.round((cumulativeAmount - previousBilledAmount) * 100) / 100)

    lines.push({
      boqLineItemId: item.id, description: item.description,
      cumulativePercentComplete: percentComplete, cumulativeAmount, previousBilledAmount, currentBillAmount,
    })
  }
  return lines
}

/** Pure. Retention is always computed on the gross (pre-retention) bill amount, never compounded across bills. */
export function applyRetention(grossAmount: number, retentionPercent: number): { retentionAmount: number; netPayable: number } {
  const retentionAmount = Math.round(grossAmount * (retentionPercent / 100) * 100) / 100
  return { retentionAmount, netPayable: Math.round((grossAmount - retentionAmount) * 100) / 100 }
}

/**
 * Pure. Builds the sales-invoice line items for a set of billable interim-
 * bill lines. GST is due on the full value of work certified, not the
 * retention-reduced amount -- retention is a payment-term holdback tracked
 * separately on constructionInterimBills.retentionAmount/netPayable, NOT a
 * discount on what's taxable. So every line goes onto the invoice at its
 * full currentBillAmount, carrying the real taxTemplateId the caller
 * resolved -- no negative "Retention held" line is added here (that used to
 * reduce the invoice's own taxable subtotal, silently understating GST by
 * the retention percentage on top of the separate zero-tax bug).
 */
export function buildInterimBillInvoiceItems(
  billableLines: InterimBillLine[],
  taxTemplateId: string
): { description: string; quantity: number; rate: number; taxTemplateId: string }[] {
  return billableLines.map((l) => ({ description: l.description, quantity: 1, rate: l.currentBillAmount, taxTemplateId }))
}

async function latestPercentCompleteByActivity(db: TenantDb, orgId: string, projectId: string): Promise<Map<string, number>> {
  // DISTINCT ON (activity_id) ... ORDER BY entry_date DESC -- one row per
  // activity, the most recent entry, matching percentComplete's own
  // "cumulative for the activity as of entryDate" schema comment (Wave 115).
  const rows = (await db.execute(sql`
    SELECT DISTINCT ON (activity_id) activity_id, percent_complete
    FROM compliance.construction_work_progress_entries
    WHERE org_id = ${orgId} AND project_id = ${projectId}
    ORDER BY activity_id, entry_date DESC
  `)) as { activity_id: string; percent_complete: number }[]
  return new Map(rows.map((r) => [r.activity_id, Number(r.percent_complete)]))
}

async function previousBilledAmountsByLineItem(db: TenantDb, boqId: string): Promise<Map<string, number>> {
  const rows = await db.select({
    boqLineItemId: constructionInterimBillLineItems.boqLineItemId,
    total: sql<string>`coalesce(sum(${constructionInterimBillLineItems.currentBillAmount}), 0)`,
  })
    .from(constructionInterimBillLineItems)
    .innerJoin(constructionInterimBills, eq(constructionInterimBills.id, constructionInterimBillLineItems.interimBillId))
    .where(eq(constructionInterimBills.boqId, boqId))
    .groupBy(constructionInterimBillLineItems.boqLineItemId)

  return new Map(rows.map((r) => [r.boqLineItemId, Number(r.total)]))
}

export type GenerateInterimBillInput = {
  projectId: string
  boqId: string
  customerId: string
  billDate: string
  retentionPercent: number
  // Required, not defaulted: this codebase has no company/customer-level
  // default tax template to fall back to (checked erp-invoicing-service.ts
  // and erpCustomers/erpCompanies -- neither carries one), and silently
  // defaulting to zero tax is exactly the correctness gap this field closes.
  // The caller must resolve/select a real erp_tax_templates row (e.g. an 18%
  // GST template) same as any other GST-compliance invoice on this platform.
  taxTemplateId: string
}

/**
 * Generates one interim/RA bill from the BoQ's current work-progress %,
 * inserts its line items, then emits a real erp_sales_invoices row for the
 * FULL gross (pre-retention) value of work certified, with real GST/tax
 * computed on that same gross value -- one invoice line per billed BoQ line
 * item at its currentBillAmount, each carrying input.taxTemplateId. GST is
 * due on the full value of work certified regardless of retention terms, so
 * retention is never applied as an invoice line; it stays what it already
 * is elsewhere in this function -- a payment-term holdback tracked on
 * constructionInterimBills.retentionAmount/netPayable, entirely separate
 * from the invoice's own taxable subtotal.
 */
export async function generateInterimBill(ctx: ValuationContext & { dbUser: typeof users.$inferSelect }, input: GenerateInterimBillInput) {
  if (!input.boqId) throw new ServiceError("boqId is required", 400)
  if (!input.customerId) throw new ServiceError("customerId is required", 400)
  if (!input.billDate) throw new ServiceError("billDate is required", 400)
  if (input.retentionPercent < 0 || input.retentionPercent > 100) throw new ServiceError("retentionPercent must be between 0 and 100", 400)
  if (!input.taxTemplateId) throw new ServiceError("taxTemplateId is required", 400)

  return withTenantContext({ orgId: ctx.orgId, userId: ctx.userId }, async (db) => {
    const taxTemplate = await db.query.erpTaxTemplates.findFirst({ where: and(eq(erpTaxTemplates.id, input.taxTemplateId), eq(erpTaxTemplates.orgId, ctx.orgId)) })
    if (!taxTemplate) throw new ServiceError("Tax template not found", 404)

    const boq = await db.query.constructionBoqs.findFirst({ where: and(eq(constructionBoqs.id, input.boqId), eq(constructionBoqs.orgId, ctx.orgId)) })
    if (!boq) throw new ServiceError("BOQ not found", 404)
    if (boq.projectId !== input.projectId) throw new ServiceError("boqId does not belong to projectId", 400)

    const lineItems = await db.query.constructionBoqLineItems.findMany({ where: eq(constructionBoqLineItems.boqId, input.boqId) })
    const percentByActivity = await latestPercentCompleteByActivity(db, ctx.orgId, input.projectId)
    const previousBilled = await previousBilledAmountsByLineItem(db, input.boqId)

    const lines = computeInterimBillLines(lineItems, percentByActivity, previousBilled)
    const billableLines = lines.filter((l) => l.currentBillAmount > 0)
    if (billableLines.length === 0) {
      throw new ServiceError("No new progress to bill -- every tracked line item is already billed up to its current percent complete", 400)
    }

    const grossAmount = Math.round(billableLines.reduce((sum, l) => sum + l.currentBillAmount, 0) * 100) / 100
    const { retentionAmount, netPayable } = applyRetention(grossAmount, input.retentionPercent)

    const [{ maxNumber }] = await db.select({ maxNumber: sql<number>`coalesce(max(${constructionInterimBills.billNumber}), 0)` })
      .from(constructionInterimBills).where(eq(constructionInterimBills.projectId, input.projectId))

    const [bill] = await db.insert(constructionInterimBills).values({
      orgId: ctx.orgId, projectId: input.projectId, boqId: input.boqId,
      billNumber: Number(maxNumber) + 1, billDate: input.billDate,
      retentionPercent: String(input.retentionPercent), grossAmount: String(grossAmount),
      retentionAmount: String(retentionAmount), netPayable: String(netPayable),
      createdById: ctx.userId,
    }).returning()

    await db.insert(constructionInterimBillLineItems).values(
      lines.map((l) => ({
        interimBillId: bill.id, boqLineItemId: l.boqLineItemId,
        cumulativePercentComplete: l.cumulativePercentComplete, cumulativeAmount: String(l.cumulativeAmount),
        previousBilledAmount: String(l.previousBilledAmount), currentBillAmount: String(l.currentBillAmount),
      }))
    )

    const invoiceItems = buildInterimBillInvoiceItems(billableLines, input.taxTemplateId)

    const invoice = await createSalesInvoice(
      { orgId: ctx.orgId, userId: ctx.userId, dbUser: ctx.dbUser },
      { customerId: input.customerId, projectId: input.projectId, postingDate: input.billDate, items: invoiceItems }
    )

    const [updatedBill] = await db.update(constructionInterimBills)
      .set({ salesInvoiceId: invoice.id })
      .where(eq(constructionInterimBills.id, bill.id))
      .returning()

    return { bill: updatedBill, lineItems: lines, invoice }
  })
}

export async function listInterimBills(ctx: { orgId: string }, projectId: string) {
  return withTenantContext({ orgId: ctx.orgId }, (db) =>
    db.query.constructionInterimBills.findMany({
      where: and(eq(constructionInterimBills.orgId, ctx.orgId), eq(constructionInterimBills.projectId, projectId)),
      orderBy: (t, { desc }) => desc(t.billNumber),
    })
  )
}

export async function getInterimBill(ctx: { orgId: string }, billId: string) {
  return withTenantContext({ orgId: ctx.orgId }, async (db) => {
    const bill = await db.query.constructionInterimBills.findFirst({ where: and(eq(constructionInterimBills.id, billId), eq(constructionInterimBills.orgId, ctx.orgId)) })
    if (!bill) throw new ServiceError("Interim bill not found", 404)
    const lineItems = await db.query.constructionInterimBillLineItems.findMany({ where: eq(constructionInterimBillLineItems.interimBillId, billId) })
    return { ...bill, lineItems }
  })
}
