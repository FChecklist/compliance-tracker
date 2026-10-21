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
import { and, eq, inArray, sql } from "drizzle-orm"
import { ServiceError } from "./compliance-service"
import { foldProgressAcrossRevisions, loadProgressSourceRows } from "./construction-reports-service"
import { createSalesInvoice } from "./erp-invoicing-service"
import { auditActorOf } from "@/lib/audit"
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
  previousBilledByLineItem: Map<string, number>,
  // R-95 (2026-10-22): progress logged through Work Progress is recorded against
  // the BOQ LINE (boq_line_item_id, carried across revisions by item code) and
  // its activity_id is only a placeholder, so the activity-keyed lookup alone
  // never saw it and Invoice said "No new progress to bill" with real progress
  // on file. When a line has such measured progress it wins; the activity path
  // stays the fallback so every pre-existing caller computes exactly as before.
  measuredByLineItem?: Map<string, { cumulativeAmount: number; percentComplete: number }>
): InterimBillLine[] {
  const lines: InterimBillLine[] = []
  for (const item of lineItems) {
    const measured = measuredByLineItem?.get(item.id)
    let percentComplete: number
    let cumulativeAmount: number
    if (measured) {
      percentComplete = measured.percentComplete
      cumulativeAmount = measured.cumulativeAmount
    } else {
      if (!item.activityId) continue
      const pc = percentCompleteByActivity.get(item.activityId)
      if (pc == null) continue
      percentComplete = pc
      cumulativeAmount = Number(item.amount) * (percentComplete / 100)
    }
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

export type MeasurableLine = {
  id: string
  parentLineItemId: string | null
  rate: string | number
  amount: string | number
  breakdownPercentage: string | number | null
}

/**
 * Pure. Cumulative value of work done per BOQ line from line-level progress
 * (summed DELTA quantity x rate, else latest percent x line value) -- the same
 * per-line rule as computeEarnedValue (construction-reports-service.ts), so the
 * bill and the dashboard's earned value can never disagree. A weighted child's
 * rate/value come from its root (rootRate x breakdown %), as there.
 */
export function computeMeasuredLineCumulatives(
  items: MeasurableLine[],
  qtyByItem: Map<string, number>,
  latestPercentByItem: Map<string, number>
): Map<string, { cumulativeAmount: number; percentComplete: number }> {
  const byId = new Map(items.map((i) => [i.id, i]))
  const out = new Map<string, { cumulativeAmount: number; percentComplete: number }>()
  for (const item of items) {
    const parent = item.parentLineItemId ? byId.get(item.parentLineItemId) : undefined
    const rate = parent ? Number(parent.rate) * (Number(item.breakdownPercentage ?? 0) / 100) : Number(item.rate)
    const lineValue = Number(item.amount)
    const qty = qtyByItem.get(item.id) ?? 0
    const pct = latestPercentByItem.get(item.id)
    let amount: number | null = null
    if (qty > 0) amount = qty * rate
    else if (pct) amount = (pct / 100) * lineValue
    if (amount == null) continue
    out.set(item.id, { cumulativeAmount: amount, percentComplete: lineValue > 0 ? Math.round((amount / lineValue) * 10000) / 100 : (pct ?? 0) })
  }
  return out
}

async function loadMeasuredLineCumulatives(
  db: TenantDb, orgId: string, projectId: string, boqId: string,
  lineItems: (MeasurableLine & { boqId: string; itemCode: string | null })[]
) {
  const boqs = await db.query.constructionBoqs.findMany({ where: and(eq(constructionBoqs.orgId, orgId), eq(constructionBoqs.projectId, projectId)) })
  const otherIds = boqs.filter((b) => b.id !== boqId && b.status === "superseded").map((b) => b.id)
  const prior = otherIds.length > 0 ? await db.query.constructionBoqLineItems.findMany({ where: inArray(constructionBoqLineItems.boqId, otherIds) }) : []
  const refs = [...lineItems, ...prior].map((i) => ({ id: i.id, boqId: i.boqId, itemCode: i.itemCode ?? null }))
  const rows = await loadProgressSourceRows(db, refs)
  const { qtyByItem, latestPercentByItem } = foldProgressAcrossRevisions(lineItems.map((i) => ({ id: i.id, boqId: i.boqId, itemCode: i.itemCode ?? null })), rows)
  const latestDate = rows.reduce<string | null>((m, r) => (r.percentDate && (!m || r.percentDate > m) ? r.percentDate : m), null)
  return { measured: computeMeasuredLineCumulatives(lineItems, qtyByItem, latestPercentByItem), latestDate, prior }
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
// dbUser is nullable -- a PROJEXA server-to-server call (requireAuthOrApiKey's
// API-key branch) has none. apiKey carries that same call's real identity for
// the one place this function needs it: createSalesInvoice()'s own
// dbUser-or-apiKey discriminated union (Wave 9), reconstructed below at that
// exact call site the same way sales-invoices/route.ts's POST handler
// already does at its own route layer.
export async function generateInterimBill(
  ctx: ValuationContext & { dbUser: typeof users.$inferSelect | null; apiKey?: { id: string; name: string }; actingViaApiKey?: true },
  input: GenerateInterimBillInput
) {
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
    // Bills raised on an earlier revision of the same project count against the
    // same item code here, so carrying progress across revisions never re-bills it.
    const carried = (await db.execute(sql`
      SELECT lower(trim(li.item_code)) AS code, coalesce(sum(bl.current_bill_amount), 0)::float AS total
      FROM compliance.construction_interim_bill_line_items bl
      JOIN compliance.construction_interim_bills b ON b.id = bl.interim_bill_id
      JOIN compliance.construction_boq_line_items li ON li.id = bl.boq_line_item_id
      WHERE b.project_id = ${input.projectId} AND b.org_id = ${ctx.orgId} AND b.boq_id <> ${input.boqId} AND li.item_code IS NOT NULL
      GROUP BY 1
    `)) as { code: string; total: number }[]
    const carriedByCode = new Map(carried.map((r) => [r.code, Number(r.total)]))
    for (const li of lineItems) {
      const code = (li.itemCode ?? "").trim().toLowerCase()
      if (code && carriedByCode.has(code)) previousBilled.set(li.id, (previousBilled.get(li.id) ?? 0) + (carriedByCode.get(code) ?? 0))
    }
    const { measured, latestDate } = await loadMeasuredLineCumulatives(db, ctx.orgId, input.projectId, input.boqId, lineItems)

    const lines = computeInterimBillLines(lineItems, percentByActivity, previousBilled, measured)
    const billableLines = lines.filter((l) => l.currentBillAmount > 0)
    if (billableLines.length === 0) {
      throw new ServiceError(
        `No new progress to bill -- progress counts when it is logged in Work Progress against a line of this BOQ (or the same item code on an earlier revision), and only the part above what earlier bills already claimed is billed. ` +
        `${lines.length} line(s) have progress on file${latestDate ? `, latest entry dated ${latestDate}` : ""}; every one is already billed up to that point. Log new progress in Work Progress, then invoice again.`,
        400
      )
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

    // R81_F26 (2026-09-08): every statement in this callback runs inside the
    // withTenantContext opened at the top of generateInterimBill, and
    // createSalesInvoice used to open a second one. assertNotNested only THROWS
    // in development and test (tenant-scoped.ts:188-192) -- in PRODUCTION it
    // console.warn()s and lets the request proceed, which is the dangerous
    // outcome here: the interim bill header, its line items and the sales
    // invoice would commit in two different transactions, and a failure between
    // them leaves a certified interim bill row with salesInvoiceId null -- work
    // certified to the client with no invoice raised against it, and the
    // constructionInterimBills.billNumber sequence already advanced. Passing
    // the open handle makes bill + lines + invoice + back-reference one atomic
    // unit. createSalesInvoice's own requireErpEnabled gate honours the handle
    // as well (isErpEnabledForOrgWithDb), so the gate cannot open a second
    // transaction before the body is reached.
    const invoice = await createSalesInvoice(
      // U-20b: auditActorOf keeps the key id when a route passed the acting
      // person AND the key (actingViaApiKey), instead of dropping it.
      ctx.dbUser
        ? { orgId: ctx.orgId, userId: ctx.userId, ...auditActorOf(ctx) }
        : { orgId: ctx.orgId, userId: ctx.userId, apiKey: ctx.apiKey ?? { id: ctx.userId, name: "api-key" } },
      { customerId: input.customerId, projectId: input.projectId, postingDate: input.billDate, items: invoiceItems },
      db
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
