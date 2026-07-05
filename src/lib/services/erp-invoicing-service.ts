// Wave 60 (Tier 3 #11 remainder + real Buying/Selling document flow):
// erp_sales_invoices/erp_purchase_invoices have existed since Wave 49 with
// zero service-layer consumer until now -- a bigger, more fundamental gap
// than pricing rules alone. Pricing rules are deliberately narrow
// (all/customer/item scope) rather than reaching for json-rules-engine
// for three comparisons.
//
// Submitting either invoice type posts a real, balanced journal entry
// (matching Wave 50/51's accounting-period gate and Wave 52's cash-voucher
// immediate-posting precedent), using the org's `accountType='receivable'`
// / `'payable'` control account (auto-detected, matching ERPNext's own
// "Debtors"/"Creditors" default-account convention) but requiring an
// explicit revenue/expense account per submission -- there's no reliable
// per-item-group account mapping in this schema yet, so guessing which
// revenue/expense account applies would risk silently wrong postings.
// This mirrors the same "automate what's safely automatable, require
// explicit input for what's genuinely ambiguous" discipline used for
// PF/ESI/PT vs. TDS in Wave 56.
import {
  erpPricingRules, erpItems, erpCustomers, erpSuppliers, erpAccounts,
  erpSalesInvoices, erpSalesInvoiceItems, erpPurchaseInvoices, erpPurchaseInvoiceItems,
  erpTaxTemplates, erpTaxTemplateItems, erpJournalEntries, erpJournalEntryLines,
  users,
} from "@/lib/db"
import { withTenantContext, type TenantDb } from "@/lib/db/tenant-scoped"
import { and, eq, or, isNull, lte, gte, sql } from "drizzle-orm"
import { ServiceError } from "./compliance-service"
export { ServiceError }
import { logActivity } from "@/lib/audit"
import { isPeriodOpenForDate } from "./erp-financial-report-service"

export type ErpContext = { orgId: string; userId: string; dbUser: typeof users.$inferSelect }

// ============================================================
// Tax Templates (Wave 49 schema, no consumer until now -- invoicing needs
// somewhere to create these, so a minimal CRUD is added here rather than
// leaving invoicing as a half-feature with no way to set up GST templates)
// ============================================================

export async function listTaxTemplates(ctx: { orgId: string }) {
  return withTenantContext({ orgId: ctx.orgId }, async (db) => {
    const templates = await db.query.erpTaxTemplates.findMany({ where: eq(erpTaxTemplates.orgId, ctx.orgId), orderBy: (t, { asc }) => asc(t.name) })
    const allItems = await db.query.erpTaxTemplateItems.findMany({ where: sql`${erpTaxTemplateItems.taxTemplateId} IN (SELECT id FROM compliance.erp_tax_templates WHERE org_id = ${ctx.orgId})` })
    return templates.map((t) => ({ ...t, items: allItems.filter((i) => i.taxTemplateId === t.id) }))
  })
}

export async function createTaxTemplate(
  ctx: ErpContext,
  input: { name: string; isSalesTax?: boolean; isPurchaseTax?: boolean; items: { taxAccountId: string; rate: number; description?: string }[] }
) {
  if (!input.name?.trim()) throw new ServiceError("name is required", 400)
  if (!input.items?.length) throw new ServiceError("At least one tax line (e.g. CGST, SGST) is required", 400)

  return withTenantContext({ orgId: ctx.orgId, userId: ctx.userId }, async (db) => {
    const [template] = await db.insert(erpTaxTemplates).values({
      orgId: ctx.orgId, name: input.name, isSalesTax: input.isSalesTax ?? false, isPurchaseTax: input.isPurchaseTax ?? false,
    }).returning()
    await db.insert(erpTaxTemplateItems).values(
      input.items.map((i) => ({ taxTemplateId: template.id, taxAccountId: i.taxAccountId, rate: i.rate.toString(), description: i.description }))
    )
    await logActivity({ tx: db, orgId: ctx.orgId, dbUser: ctx.dbUser, action: "erp_tax_template.created", entityType: "erp_tax_template", entityId: template.id })
    return template
  })
}

// ============================================================
// Pricing Rules
// ============================================================

export async function listPricingRules(ctx: { orgId: string }) {
  return withTenantContext({ orgId: ctx.orgId }, async (db) => {
    return db.query.erpPricingRules.findMany({ where: eq(erpPricingRules.orgId, ctx.orgId), orderBy: (t, { desc }) => desc(t.priority) })
  })
}

export async function createPricingRule(
  ctx: ErpContext,
  input: { name: string; appliesTo: "all" | "customer" | "item"; targetId?: string; discountType: "percentage" | "flat"; discountValue: number; minQty?: number; validFrom: string; validTo?: string; priority?: number }
) {
  if (!input.name?.trim()) throw new ServiceError("name is required", 400)
  if (input.appliesTo !== "all" && !input.targetId) throw new ServiceError("targetId is required when appliesTo is not 'all'", 400)

  return withTenantContext({ orgId: ctx.orgId, userId: ctx.userId }, async (db) => {
    const [rule] = await db.insert(erpPricingRules).values({
      orgId: ctx.orgId, name: input.name, appliesTo: input.appliesTo, targetId: input.targetId,
      discountType: input.discountType, discountValue: input.discountValue.toString(),
      minQty: (input.minQty ?? 0).toString(), validFrom: input.validFrom, validTo: input.validTo,
      priority: input.priority ?? 0, createdById: ctx.userId,
    }).returning()
    await logActivity({ tx: db, orgId: ctx.orgId, dbUser: ctx.dbUser, action: "erp_pricing_rule.created", entityType: "erp_pricing_rule", entityId: rule.id })
    return rule
  })
}

/**
 * Resolves the effective rate for an item at a given quantity/date/customer,
 * applying the best-matching active pricing rule (item-specific rules beat
 * customer-specific rules beat 'all' rules; ties broken by priority desc).
 * Falls back to the item's own standardSellingRate if no rule matches.
 */
export async function resolveItemPrice(
  db: TenantDb, orgId: string, itemId: string | undefined, customerId: string | undefined, quantity: number, date: string
): Promise<{ rate: number; appliedRuleId: string | null }> {
  const baseRate = itemId ? Number((await db.query.erpItems.findFirst({ where: and(eq(erpItems.id, itemId), eq(erpItems.orgId, orgId)) }))?.standardSellingRate ?? 0) : 0

  const rules = await db.query.erpPricingRules.findMany({
    where: and(
      eq(erpPricingRules.orgId, orgId), eq(erpPricingRules.isActive, true),
      lte(erpPricingRules.validFrom, date), or(isNull(erpPricingRules.validTo), gte(erpPricingRules.validTo, date)),
      lte(erpPricingRules.minQty, quantity.toString())
    ),
    orderBy: (t, { desc }) => desc(t.priority),
  })

  const specificity = (r: typeof rules[number]) => {
    if (r.appliesTo === "item" && r.targetId === itemId) return 2
    if (r.appliesTo === "customer" && r.targetId === customerId) return 1
    if (r.appliesTo === "all") return 0
    return -1 // doesn't match this item/customer at all
  }

  const best = rules.filter((r) => specificity(r) >= 0).sort((a, b) => specificity(b) - specificity(a) || b.priority - a.priority)[0]
  if (!best) return { rate: baseRate, appliedRuleId: null }

  const discounted = best.discountType === "percentage" ? baseRate * (1 - Number(best.discountValue) / 100) : baseRate - Number(best.discountValue)
  return { rate: Math.max(discounted, 0), appliedRuleId: best.id }
}

async function findControlAccount(db: TenantDb, orgId: string, accountType: "receivable" | "payable") {
  const account = await db.query.erpAccounts.findFirst({ where: and(eq(erpAccounts.orgId, orgId), eq(erpAccounts.accountType, accountType)) })
  if (!account) throw new ServiceError(`No chart-of-accounts entry with accountType='${accountType}' found -- set one up in Journal Entries > Chart of Accounts first`, 409)
  return account
}

async function computeInvoiceTotals(db: TenantDb, items: { quantity: number; rate: number; taxTemplateId?: string }[]) {
  let subtotal = 0
  let taxAmount = 0
  const taxByAccount = new Map<string, number>()

  for (const item of items) {
    const lineAmount = item.quantity * item.rate
    subtotal += lineAmount
    if (item.taxTemplateId) {
      const taxLines = await db.query.erpTaxTemplateItems.findMany({ where: eq(erpTaxTemplateItems.taxTemplateId, item.taxTemplateId) })
      for (const t of taxLines) {
        const lineTax = lineAmount * (Number(t.rate) / 100)
        taxAmount += lineTax
        taxByAccount.set(t.taxAccountId, (taxByAccount.get(t.taxAccountId) ?? 0) + lineTax)
      }
    }
  }
  return { subtotal, taxAmount, grandTotal: subtotal + taxAmount, taxByAccount }
}

// ============================================================
// Sales Invoices
// ============================================================

export type SalesInvoiceItemInput = { itemId?: string; description: string; quantity?: number; rate?: number; taxTemplateId?: string }

export async function listSalesInvoices(ctx: { orgId: string }) {
  return withTenantContext({ orgId: ctx.orgId }, async (db) => {
    return db.query.erpSalesInvoices.findMany({ where: eq(erpSalesInvoices.orgId, ctx.orgId), orderBy: (t, { desc }) => desc(t.postingDate), with: { items: true, customer: true } })
  })
}

export async function createSalesInvoice(ctx: ErpContext, input: { customerId: string; postingDate: string; dueDate?: string; items: SalesInvoiceItemInput[] }) {
  if (!input.customerId) throw new ServiceError("customerId is required", 400)
  if (!input.items?.length) throw new ServiceError("At least one line item is required", 400)

  return withTenantContext({ orgId: ctx.orgId, userId: ctx.userId }, async (db) => {
    const customer = await db.query.erpCustomers.findFirst({ where: and(eq(erpCustomers.id, input.customerId), eq(erpCustomers.orgId, ctx.orgId)) })
    if (!customer) throw new ServiceError("Customer not found", 404)

    const resolvedItems: (SalesInvoiceItemInput & { quantity: number; rate: number })[] = []
    for (const item of input.items) {
      const quantity = item.quantity ?? 1
      const rate = item.rate ?? (await resolveItemPrice(db, ctx.orgId, item.itemId, input.customerId, quantity, input.postingDate)).rate
      resolvedItems.push({ ...item, quantity, rate })
    }

    const { subtotal, taxAmount, grandTotal } = await computeInvoiceTotals(db, resolvedItems)
    const [{ maxNumber }] = await db.select({ maxNumber: sql<number>`coalesce(max(${erpSalesInvoices.invoiceNumber}), 0)` }).from(erpSalesInvoices).where(eq(erpSalesInvoices.orgId, ctx.orgId))

    const [invoice] = await db.insert(erpSalesInvoices).values({
      orgId: ctx.orgId, customerId: input.customerId, invoiceNumber: Number(maxNumber) + 1,
      postingDate: input.postingDate, dueDate: input.dueDate, subtotal: subtotal.toString(),
      taxAmount: taxAmount.toString(), grandTotal: grandTotal.toString(), outstandingAmount: grandTotal.toString(),
      createdById: ctx.userId,
    }).returning()

    await db.insert(erpSalesInvoiceItems).values(
      resolvedItems.map((i) => ({ invoiceId: invoice.id, itemId: i.itemId, description: i.description, quantity: i.quantity.toString(), rate: i.rate.toString(), amount: (i.quantity * i.rate).toString(), taxTemplateId: i.taxTemplateId }))
    )

    await logActivity({ tx: db, orgId: ctx.orgId, dbUser: ctx.dbUser, action: "erp_sales_invoice.created", entityType: "erp_sales_invoice", entityId: invoice.id })
    return invoice
  })
}

export async function submitSalesInvoice(ctx: ErpContext, invoiceId: string, input: { revenueAccountId: string }) {
  if (!input.revenueAccountId) throw new ServiceError("revenueAccountId is required", 400)

  return withTenantContext({ orgId: ctx.orgId, userId: ctx.userId }, async (db) => {
    const invoice = await db.query.erpSalesInvoices.findFirst({ where: and(eq(erpSalesInvoices.id, invoiceId), eq(erpSalesInvoices.orgId, ctx.orgId)), with: { items: true } })
    if (!invoice) throw new ServiceError("Sales invoice not found", 404)
    if (invoice.status !== "draft") throw new ServiceError("Only draft invoices can be submitted", 409)

    const periodOpen = await isPeriodOpenForDate(ctx, invoice.postingDate)
    if (!periodOpen) throw new ServiceError(`The accounting period covering ${invoice.postingDate} is closed`, 409)

    const receivableAccount = await findControlAccount(db, ctx.orgId, "receivable")
    const { taxByAccount } = await computeInvoiceTotals(db, invoice.items.map((i) => ({ quantity: Number(i.quantity), rate: Number(i.rate), taxTemplateId: i.taxTemplateId ?? undefined })))

    const [{ maxNumber }] = await db.select({ maxNumber: sql<number>`coalesce(max(${erpJournalEntries.entryNumber}), 0)` }).from(erpJournalEntries).where(eq(erpJournalEntries.orgId, ctx.orgId))
    const [je] = await db.insert(erpJournalEntries).values({
      orgId: ctx.orgId, entryNumber: Number(maxNumber) + 1, postingDate: invoice.postingDate,
      referenceType: "sales_invoice", referenceId: invoiceId, userRemark: `Sales Invoice #${invoice.invoiceNumber}`,
      status: "submitted", totalDebit: invoice.grandTotal, totalCredit: invoice.grandTotal, createdById: ctx.userId, submittedAt: new Date(),
    }).returning()

    const lines = [
      { journalEntryId: je.id, accountId: receivableAccount.id, partyType: "customer" as const, partyId: invoice.customerId, debit: invoice.grandTotal, credit: "0" },
      { journalEntryId: je.id, accountId: input.revenueAccountId, debit: "0", credit: invoice.subtotal },
      ...Array.from(taxByAccount.entries()).map(([accountId, amount]) => ({ journalEntryId: je.id, accountId, debit: "0", credit: amount.toString() })),
    ]
    await db.insert(erpJournalEntryLines).values(lines)

    const [updated] = await db.update(erpSalesInvoices).set({ status: "submitted", journalEntryId: je.id }).where(eq(erpSalesInvoices.id, invoiceId)).returning()
    await logActivity({ tx: db, orgId: ctx.orgId, dbUser: ctx.dbUser, action: "erp_sales_invoice.submitted", entityType: "erp_sales_invoice", entityId: invoiceId })
    return updated
  })
}

// ============================================================
// Purchase Invoices
// ============================================================

export type PurchaseInvoiceItemInput = { itemId?: string; description: string; quantity?: number; rate: number; taxTemplateId?: string }

export async function listPurchaseInvoices(ctx: { orgId: string }) {
  return withTenantContext({ orgId: ctx.orgId }, async (db) => {
    return db.query.erpPurchaseInvoices.findMany({ where: eq(erpPurchaseInvoices.orgId, ctx.orgId), orderBy: (t, { desc }) => desc(t.postingDate), with: { items: true, supplier: true } })
  })
}

export async function createPurchaseInvoice(ctx: ErpContext, input: { supplierId: string; postingDate: string; dueDate?: string; items: PurchaseInvoiceItemInput[] }) {
  if (!input.supplierId) throw new ServiceError("supplierId is required", 400)
  if (!input.items?.length) throw new ServiceError("At least one line item is required", 400)

  return withTenantContext({ orgId: ctx.orgId, userId: ctx.userId }, async (db) => {
    const supplier = await db.query.erpSuppliers.findFirst({ where: and(eq(erpSuppliers.id, input.supplierId), eq(erpSuppliers.orgId, ctx.orgId)) })
    if (!supplier) throw new ServiceError("Supplier not found", 404)

    const resolvedItems = input.items.map((i) => ({ ...i, quantity: i.quantity ?? 1 }))
    const { subtotal, taxAmount, grandTotal } = await computeInvoiceTotals(db, resolvedItems)
    const [{ maxNumber }] = await db.select({ maxNumber: sql<number>`coalesce(max(${erpPurchaseInvoices.invoiceNumber}), 0)` }).from(erpPurchaseInvoices).where(eq(erpPurchaseInvoices.orgId, ctx.orgId))

    const [invoice] = await db.insert(erpPurchaseInvoices).values({
      orgId: ctx.orgId, supplierId: input.supplierId, invoiceNumber: Number(maxNumber) + 1,
      postingDate: input.postingDate, dueDate: input.dueDate, subtotal: subtotal.toString(),
      taxAmount: taxAmount.toString(), grandTotal: grandTotal.toString(), outstandingAmount: grandTotal.toString(),
      createdById: ctx.userId,
    }).returning()

    await db.insert(erpPurchaseInvoiceItems).values(
      resolvedItems.map((i) => ({ invoiceId: invoice.id, itemId: i.itemId, description: i.description, quantity: i.quantity.toString(), rate: i.rate.toString(), amount: (i.quantity * i.rate).toString(), taxTemplateId: i.taxTemplateId }))
    )

    await logActivity({ tx: db, orgId: ctx.orgId, dbUser: ctx.dbUser, action: "erp_purchase_invoice.created", entityType: "erp_purchase_invoice", entityId: invoice.id })
    return invoice
  })
}

export async function submitPurchaseInvoice(ctx: ErpContext, invoiceId: string, input: { expenseAccountId: string }) {
  if (!input.expenseAccountId) throw new ServiceError("expenseAccountId is required", 400)

  return withTenantContext({ orgId: ctx.orgId, userId: ctx.userId }, async (db) => {
    const invoice = await db.query.erpPurchaseInvoices.findFirst({ where: and(eq(erpPurchaseInvoices.id, invoiceId), eq(erpPurchaseInvoices.orgId, ctx.orgId)), with: { items: true } })
    if (!invoice) throw new ServiceError("Purchase invoice not found", 404)
    if (invoice.status !== "draft") throw new ServiceError("Only draft invoices can be submitted", 409)

    const periodOpen = await isPeriodOpenForDate(ctx, invoice.postingDate)
    if (!periodOpen) throw new ServiceError(`The accounting period covering ${invoice.postingDate} is closed`, 409)

    const payableAccount = await findControlAccount(db, ctx.orgId, "payable")
    const { taxByAccount } = await computeInvoiceTotals(db, invoice.items.map((i) => ({ quantity: Number(i.quantity), rate: Number(i.rate), taxTemplateId: i.taxTemplateId ?? undefined })))

    const [{ maxNumber }] = await db.select({ maxNumber: sql<number>`coalesce(max(${erpJournalEntries.entryNumber}), 0)` }).from(erpJournalEntries).where(eq(erpJournalEntries.orgId, ctx.orgId))
    const [je] = await db.insert(erpJournalEntries).values({
      orgId: ctx.orgId, entryNumber: Number(maxNumber) + 1, postingDate: invoice.postingDate,
      referenceType: "purchase_invoice", referenceId: invoiceId, userRemark: `Purchase Invoice #${invoice.invoiceNumber}`,
      status: "submitted", totalDebit: invoice.grandTotal, totalCredit: invoice.grandTotal, createdById: ctx.userId, submittedAt: new Date(),
    }).returning()

    const lines = [
      { journalEntryId: je.id, accountId: input.expenseAccountId, debit: invoice.subtotal, credit: "0" },
      ...Array.from(taxByAccount.entries()).map(([accountId, amount]) => ({ journalEntryId: je.id, accountId, debit: amount.toString(), credit: "0" })), // input tax recoverable -- debited
      { journalEntryId: je.id, accountId: payableAccount.id, partyType: "supplier" as const, partyId: invoice.supplierId, debit: "0", credit: invoice.grandTotal },
    ]
    await db.insert(erpJournalEntryLines).values(lines)

    const [updated] = await db.update(erpPurchaseInvoices).set({ status: "submitted", journalEntryId: je.id }).where(eq(erpPurchaseInvoices.id, invoiceId)).returning()
    await logActivity({ tx: db, orgId: ctx.orgId, dbUser: ctx.dbUser, action: "erp_purchase_invoice.submitted", entityType: "erp_purchase_invoice", entityId: invoiceId })
    return updated
  })
}
