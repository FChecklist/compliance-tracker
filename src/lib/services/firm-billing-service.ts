// Wave 108 (THE FIRM AI OS) -- billable-rate resolution and invoice
// generation from unbilled time. The core anti-double-billing mechanism:
// generateInvoiceFromUnbilledTime only ever selects firm_time_entries
// rows with invoiceLineItemId IS NULL, and back-fills that column inside
// the same transaction that creates the invoice + line items -- a re-run
// for the same client/range always finds zero remaining unbilled rows.
import { firmInvoices, firmInvoiceLineItems, firmTimeEntries, firmBillableRates, clients } from "@/lib/db"
import { type TenantDb } from "@/lib/db/tenant-scoped"
import { and, eq, isNull, lte } from "drizzle-orm"
import { requireFirmEnabled, withFirmTenantContext, type FirmServiceContext } from "./firm-enablement-service"
import { ServiceError } from "./compliance-service"
export { ServiceError }

async function assertClientBelongsToOrg(db: TenantDb, clientId: string, orgId: string) {
  const client = await db.query.clients.findFirst({ where: and(eq(clients.id, clientId), eq(clients.orgId, orgId)) })
  if (!client) throw new ServiceError("Client not found", 404)
}

export type SetBillableRateInput = {
  userId?: string | null
  clientId?: string | null
  hourlyRate: number
  validFrom: string
}

export async function setBillableRate(ctx: FirmServiceContext, input: SetBillableRateInput) {
  await requireFirmEnabled(ctx.orgId)
  if (!input.hourlyRate || input.hourlyRate <= 0) throw new ServiceError("hourlyRate must be a positive number", 400)
  if (!input.validFrom) throw new ServiceError("validFrom is required", 400)

  return withFirmTenantContext(ctx, async (db) => {
    const [rate] = await db.insert(firmBillableRates).values({
      orgId: ctx.orgId,
      userId: input.userId ?? null,
      clientId: input.clientId ?? null,
      hourlyRate: String(input.hourlyRate),
      validFrom: input.validFrom,
    }).returning()
    return rate
  })
}

export type FirmBillableRateRow = { userId: string | null; clientId: string | null; hourlyRate: string | number; validFrom: string }

/**
 * Pure function, no DB access -- independently unit-testable. Resolves the
 * hourly rate for (userId, clientId, asOfDate) via a 4-tier precedence,
 * most specific wins: (user,client) > (user,null) > (null,client) >
 * (null,null firm-wide default). Among ties within a tier, the row with
 * the latest validFrom <= asOfDate wins.
 */
export function resolveBillableRate(rates: FirmBillableRateRow[], params: { userId: string; clientId: string; asOfDate: string }): number | null {
  const applicable = rates.filter((r) => r.validFrom <= params.asOfDate)
  const tiers: Array<(r: FirmBillableRateRow) => boolean> = [
    (r) => r.userId === params.userId && r.clientId === params.clientId,
    (r) => r.userId === params.userId && r.clientId === null,
    (r) => r.userId === null && r.clientId === params.clientId,
    (r) => r.userId === null && r.clientId === null,
  ]
  for (const matchesTier of tiers) {
    const matches = applicable.filter(matchesTier)
    if (matches.length > 0) {
      const best = matches.reduce((a, b) => (b.validFrom > a.validFrom ? b : a))
      return Number(best.hourlyRate)
    }
  }
  return null
}

export type GenerateInvoiceInput = {
  clientId: string
  engagementId?: string | null
  throughDate: string
  invoiceNumber: string
  issueDate: string
  dueDate?: string | null
  taxRatePercent?: number | null
  fixedFeeLine?: { description: string; amount: number } | null
}

export async function generateInvoiceFromUnbilledTime(ctx: FirmServiceContext, input: GenerateInvoiceInput) {
  await requireFirmEnabled(ctx.orgId)
  if (!input.invoiceNumber?.trim()) throw new ServiceError("invoiceNumber is required", 400)
  if (!input.issueDate) throw new ServiceError("issueDate is required", 400)

  return withFirmTenantContext(ctx, async (db) => {
    await assertClientBelongsToOrg(db, input.clientId, ctx.orgId)

    const rateRows = await db.query.firmBillableRates.findMany({ where: eq(firmBillableRates.orgId, ctx.orgId) })

    const conditions = [
      eq(firmTimeEntries.orgId, ctx.orgId),
      eq(firmTimeEntries.clientId, input.clientId),
      eq(firmTimeEntries.billable, true),
      isNull(firmTimeEntries.invoiceLineItemId),
      lte(firmTimeEntries.spentOn, input.throughDate),
    ]
    if (input.engagementId) conditions.push(eq(firmTimeEntries.engagementId, input.engagementId))
    const unbilledEntries = await db.query.firmTimeEntries.findMany({ where: and(...conditions) })

    let subtotal = 0
    const resolvedLines: Array<{ entryId: string; taskDescription: string; hours: string; rate: number; amount: number }> = []
    for (const entry of unbilledEntries) {
      const rate = resolveBillableRate(rateRows, { userId: entry.userId, clientId: entry.clientId, asOfDate: entry.spentOn })
      if (rate == null) throw new ServiceError(`No billable rate found for staff member on client ${entry.clientId} as of ${entry.spentOn}`, 400)
      const hours = Number(entry.hours)
      const amount = Math.round(hours * rate * 100) / 100
      subtotal += amount
      resolvedLines.push({ entryId: entry.id, taskDescription: entry.taskDescription, hours: entry.hours, rate, amount })
    }

    if (input.fixedFeeLine) subtotal += input.fixedFeeLine.amount

    const taxAmount = input.taxRatePercent ? Math.round(subtotal * (input.taxRatePercent / 100) * 100) / 100 : 0
    const totalAmount = Math.round((subtotal + taxAmount) * 100) / 100

    const [invoice] = await db.insert(firmInvoices).values({
      orgId: ctx.orgId,
      clientId: input.clientId,
      engagementId: input.engagementId ?? null,
      invoiceNumber: input.invoiceNumber.trim(),
      issueDate: input.issueDate,
      dueDate: input.dueDate ?? null,
      subtotal: String(subtotal),
      taxAmount: String(taxAmount),
      totalAmount: String(totalAmount),
      createdById: ctx.userId,
    }).returning()

    for (const line of resolvedLines) {
      const [lineItem] = await db.insert(firmInvoiceLineItems).values({
        orgId: ctx.orgId,
        invoiceId: invoice.id,
        description: line.taskDescription,
        quantityHours: line.hours,
        rate: String(line.rate),
        amount: String(line.amount),
        timeEntryId: line.entryId,
      }).returning()
      await db.update(firmTimeEntries).set({
        invoiceLineItemId: lineItem.id,
        hourlyRateSnapshot: String(line.rate),
        updatedAt: new Date(),
      }).where(eq(firmTimeEntries.id, line.entryId))
    }

    if (input.fixedFeeLine) {
      await db.insert(firmInvoiceLineItems).values({
        orgId: ctx.orgId,
        invoiceId: invoice.id,
        description: input.fixedFeeLine.description,
        amount: String(input.fixedFeeLine.amount),
      })
    }

    return invoice
  })
}

export async function addFixedFeeLineToInvoice(ctx: FirmServiceContext, invoiceId: string, input: { description: string; amount: number }) {
  await requireFirmEnabled(ctx.orgId)
  if (!input.description?.trim()) throw new ServiceError("description is required", 400)
  if (!input.amount || input.amount <= 0) throw new ServiceError("amount must be a positive number", 400)

  return withFirmTenantContext(ctx, async (db) => {
    const invoice = await db.query.firmInvoices.findFirst({ where: and(eq(firmInvoices.id, invoiceId), eq(firmInvoices.orgId, ctx.orgId)) })
    if (!invoice) throw new ServiceError("Invoice not found", 404)
    if (invoice.status !== "draft") throw new ServiceError("Only draft invoices can be modified", 409)

    const [lineItem] = await db.insert(firmInvoiceLineItems).values({
      orgId: ctx.orgId,
      invoiceId,
      description: input.description.trim(),
      amount: String(input.amount),
    }).returning()

    const newSubtotal = Number(invoice.subtotal) + input.amount
    const newTotal = Math.round((newSubtotal + Number(invoice.taxAmount)) * 100) / 100
    await db.update(firmInvoices).set({ subtotal: String(newSubtotal), totalAmount: String(newTotal), updatedAt: new Date() }).where(eq(firmInvoices.id, invoiceId))

    return lineItem
  })
}

async function transitionInvoiceStatus(ctx: FirmServiceContext, invoiceId: string, from: Array<typeof firmInvoices.$inferSelect["status"]>, to: typeof firmInvoices.$inferSelect["status"]) {
  await requireFirmEnabled(ctx.orgId)
  return withFirmTenantContext(ctx, async (db) => {
    const invoice = await db.query.firmInvoices.findFirst({ where: and(eq(firmInvoices.id, invoiceId), eq(firmInvoices.orgId, ctx.orgId)) })
    if (!invoice) throw new ServiceError("Invoice not found", 404)
    if (!from.includes(invoice.status)) throw new ServiceError(`Cannot transition invoice from '${invoice.status}' to '${to}'`, 409)

    const [updated] = await db.update(firmInvoices).set({ status: to, updatedAt: new Date() }).where(eq(firmInvoices.id, invoiceId)).returning()
    return updated
  })
}

export async function markInvoiceSent(ctx: FirmServiceContext, invoiceId: string) {
  return transitionInvoiceStatus(ctx, invoiceId, ["draft"], "sent")
}

export async function markInvoicePaid(ctx: FirmServiceContext, invoiceId: string) {
  return transitionInvoiceStatus(ctx, invoiceId, ["sent", "overdue"], "paid")
}

export async function voidInvoice(ctx: FirmServiceContext, invoiceId: string) {
  return transitionInvoiceStatus(ctx, invoiceId, ["draft", "sent", "overdue"], "void")
}

export async function listInvoicesForClient(ctx: FirmServiceContext, clientId: string) {
  await requireFirmEnabled(ctx.orgId)
  return withFirmTenantContext(ctx, async (db) => {
    return db.query.firmInvoices.findMany({
      where: and(eq(firmInvoices.clientId, clientId), eq(firmInvoices.orgId, ctx.orgId)),
      with: { lineItems: true },
      orderBy: (t, { desc }) => desc(t.issueDate),
    })
  })
}
