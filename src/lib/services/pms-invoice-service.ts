// Gap closure (2026-07-27, DEEP_ERP_FUNCTIONALITY_COMPLETION_VIA_ODOO_ERPNEXT_REFERENCE):
// "PMS timesheet -> client invoice". pms_time_entries + resolveBillableRate
// (pms-time-service.ts) already existed, but were only ever consumed
// internally by pms-budget-service.ts's cost-vs-budget math -- never wired
// to emit a real client invoice. Modeled directly on
// firm-billing-service.ts's generateInvoiceFromUnbilledTime() (the CA-firm
// module's real, working pattern): reuses the existing
// erp_sales_invoices/erp_sales_invoice_items schema/tables (Wave 49/60,
// erp-invoicing-service.ts) rather than inventing a parallel invoice table.
// The anti-double-billing mechanism is identical to the firm module's: only
// pms_time_entries rows with invoiceItemId IS NULL are selected, and that
// column is back-filled inside the SAME transaction that creates the
// invoice + line items, so a re-run for the same project/date-range always
// finds zero remaining unbilled rows.
import {
  pmsIssues, pmsTimeEntries, pmsBillableRates, projects,
  erpCustomers, erpCurrencies, erpCompanies, erpSalesInvoices, erpSalesInvoiceItems,
  users,
} from "@/lib/db"
import { withTenantContext } from "@/lib/db/tenant-scoped"
import { and, eq, isNull, lte, inArray, sql } from "drizzle-orm"
import { ServiceError } from "./compliance-service"
export { ServiceError }
import { logActivity } from "@/lib/audit"
import { requireErpEnabled } from "./erp-enablement-service"
import { resolvePmsBillableRatePure, type PmsBillableRateRow } from "./pms-time-service"

export type PmsContext = { orgId: string; userId: string; dbUser: typeof users.$inferSelect }

export type PmsUnbilledEntry = { id: string; issueId: string; userId: string; hours: string | number; spentOn: string; comments: string | null }
export type PmsIssueRef = { id: string; number: number; title: string }
export type PmsInvoiceLine = { entryId: string; description: string; hours: number; rate: number; amount: number }

/**
 * Pure function, no DB access -- independently unit-testable. Turns a set
 * of unbilled time entries + the org's billable-rate rows into invoice
 * line items, throwing (not silently zero-billing) when an entry's
 * (user, date) has no applicable rate at all.
 */
export function buildInvoiceLinesFromTimeEntries(
  entries: PmsUnbilledEntry[],
  rates: PmsBillableRateRow[],
  issuesById: Map<string, PmsIssueRef>
): PmsInvoiceLine[] {
  return entries.map((entry) => {
    const rate = resolvePmsBillableRatePure(rates, entry.userId, entry.spentOn)
    if (rate == null) throw new ServiceError(`No billable rate found for user ${entry.userId} as of ${entry.spentOn}`, 400)
    const hours = Number(entry.hours)
    const amount = Math.round(hours * rate * 100) / 100
    const issue = issuesById.get(entry.issueId)
    const description = `${issue ? `#${issue.number} ${issue.title}` : entry.issueId}${entry.comments ? ` -- ${entry.comments}` : ""}`
    return { entryId: entry.id, description, hours, rate, amount }
  })
}

export type GenerateProjectInvoiceInput = {
  projectId: string
  customerId: string
  throughDate: string
  postingDate: string
  dueDate?: string | null
  currencyId?: string | null
  exchangeRate?: number | null
  companyId?: string | null
  taxRatePercent?: number | null
}

export async function generateInvoiceFromUnbilledProjectTime(ctx: PmsContext, input: GenerateProjectInvoiceInput) {
  await requireErpEnabled(ctx.orgId)
  if (!input.projectId) throw new ServiceError("projectId is required", 400)
  if (!input.customerId) throw new ServiceError("customerId is required", 400)
  if (!input.throughDate) throw new ServiceError("throughDate is required", 400)
  if (!input.postingDate) throw new ServiceError("postingDate is required", 400)

  return withTenantContext({ orgId: ctx.orgId, userId: ctx.userId }, async (db) => {
    const project = await db.query.projects.findFirst({ where: and(eq(projects.id, input.projectId), eq(projects.orgId, ctx.orgId)) })
    if (!project) throw new ServiceError("Project not found", 404)

    const customer = await db.query.erpCustomers.findFirst({ where: and(eq(erpCustomers.id, input.customerId), eq(erpCustomers.orgId, ctx.orgId)) })
    if (!customer) throw new ServiceError("Customer not found", 404)

    // Same "explicit, never guessed" validation as erp-invoicing-service.ts's
    // resolveInvoiceCurrency/resolveInvoiceCompany -- not reused directly
    // since they're private to that module, but the rule is identical.
    let exchangeRate = 1
    if (input.currencyId) {
      const currency = await db.query.erpCurrencies.findFirst({ where: and(eq(erpCurrencies.id, input.currencyId), eq(erpCurrencies.orgId, ctx.orgId)) })
      if (!currency) throw new ServiceError("Currency not found", 404)
      if (!input.exchangeRate || input.exchangeRate <= 0) throw new ServiceError("exchangeRate is required (and must be positive) when currencyId is set", 400)
      exchangeRate = input.exchangeRate
    }
    let companyId: string | null = null
    if (input.companyId) {
      const company = await db.query.erpCompanies.findFirst({ where: and(eq(erpCompanies.id, input.companyId), eq(erpCompanies.orgId, ctx.orgId)) })
      if (!company) throw new ServiceError("Company not found", 404)
      companyId = input.companyId
    }

    const issues = await db.query.pmsIssues.findMany({
      where: and(eq(pmsIssues.orgId, ctx.orgId), eq(pmsIssues.projectId, input.projectId)),
      columns: { id: true, number: true, title: true },
    })
    const issueIds = issues.map((i) => i.id)
    const issuesById = new Map(issues.map((i) => [i.id, i]))
    if (issueIds.length === 0) throw new ServiceError("This project has no issues to bill time against", 400)

    const unbilledEntries = await db.query.pmsTimeEntries.findMany({
      where: and(
        inArray(pmsTimeEntries.issueId, issueIds),
        eq(pmsTimeEntries.billable, true),
        isNull(pmsTimeEntries.invoiceItemId),
        lte(pmsTimeEntries.spentOn, input.throughDate),
      ),
    })
    if (unbilledEntries.length === 0) throw new ServiceError("No unbilled billable time entries found for this project through the given date", 400)

    const rateRows = await db.query.pmsBillableRates.findMany({ where: eq(pmsBillableRates.orgId, ctx.orgId) })
    const lines = buildInvoiceLinesFromTimeEntries(unbilledEntries, rateRows, issuesById)

    const subtotal = lines.reduce((sum, l) => sum + l.amount, 0)
    const taxAmount = input.taxRatePercent ? Math.round(subtotal * (input.taxRatePercent / 100) * 100) / 100 : 0
    const grandTotal = Math.round((subtotal + taxAmount) * 100) / 100

    const [{ maxNumber }] = await db.select({ maxNumber: sql<number>`coalesce(max(${erpSalesInvoices.invoiceNumber}), 0)` }).from(erpSalesInvoices).where(eq(erpSalesInvoices.orgId, ctx.orgId))

    const [invoice] = await db.insert(erpSalesInvoices).values({
      orgId: ctx.orgId,
      customerId: input.customerId,
      projectId: input.projectId,
      invoiceNumber: Number(maxNumber) + 1,
      postingDate: input.postingDate,
      dueDate: input.dueDate ?? null,
      currencyId: input.currencyId ?? null,
      exchangeRate: String(exchangeRate),
      subtotal: String(subtotal),
      taxAmount: String(taxAmount),
      grandTotal: String(grandTotal),
      outstandingAmount: String(grandTotal),
      companyId,
      createdById: ctx.userId,
    }).returning()

    for (const line of lines) {
      const [item] = await db.insert(erpSalesInvoiceItems).values({
        invoiceId: invoice.id,
        description: line.description,
        quantity: String(line.hours),
        rate: String(line.rate),
        amount: String(line.amount),
      }).returning()
      await db.update(pmsTimeEntries).set({
        invoiceItemId: item.id,
        hourlyRateSnapshot: String(line.rate),
      }).where(eq(pmsTimeEntries.id, line.entryId))
    }

    await logActivity({ tx: db, orgId: ctx.orgId, dbUser: ctx.dbUser, action: "erp_sales_invoice.created", entityType: "erp_sales_invoice", entityId: invoice.id })

    return invoice
  })
}
