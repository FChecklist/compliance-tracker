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
  erpPricingRules, erpItems, erpCustomers, erpSuppliers, erpAccounts, erpCurrencies, erpCompanies,
  erpSalesInvoices, erpSalesInvoiceItems, erpPurchaseInvoices, erpPurchaseInvoiceItems,
  erpTaxTemplates, erpTaxTemplateItems, erpJournalEntries, erpJournalEntryLines,
  erpTaxWithholdingCategories, erpTaxWithholdingRates,
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

// Wave 66: currencyId/exchangeRate are optional together -- omitting both
// means "org base currency", exactly matching every invoice created before
// this wave (exchangeRate stored as 1). Supplying currencyId without an
// exchangeRate is refused rather than guessed, since an FX rate can't be
// safely inferred (the same "require explicit input for what's genuinely
// ambiguous" discipline as Wave 56's PF/ESI/PT vs. TDS boundary).
async function resolveInvoiceCurrency(db: TenantDb, orgId: string, currencyId: string | undefined, exchangeRate: number | undefined): Promise<{ currencyId: string | null; exchangeRate: number }> {
  if (!currencyId) return { currencyId: null, exchangeRate: 1 }
  if (!exchangeRate || exchangeRate <= 0) throw new ServiceError("exchangeRate is required (and must be positive) when currencyId is set", 400)
  const currency = await db.query.erpCurrencies.findFirst({ where: and(eq(erpCurrencies.id, currencyId), eq(erpCurrencies.orgId, orgId)) })
  if (!currency) throw new ServiceError("Currency not found", 404)
  return { currencyId, exchangeRate }
}

// Wave 67: nullable companyId is validated the same "explicit, never
// guessed" way as currencyId above -- if the caller supplies one, it must
// actually belong to this org; omitting it means "no company subdivision".
async function resolveInvoiceCompany(db: TenantDb, orgId: string, companyId: string | undefined): Promise<string | null> {
  if (!companyId) return null
  const company = await db.query.erpCompanies.findFirst({ where: and(eq(erpCompanies.id, companyId), eq(erpCompanies.orgId, orgId)) })
  if (!company) throw new ServiceError("Company not found", 404)
  return companyId
}

/**
 * Wave 68 (vendor-payment TDS): if this supplier has a tax withholding
 * category assigned, finds the rate valid for postingDate and compares
 * this invoice's taxable basis (and this supplier's already-submitted
 * prior invoices' cumulative basis this calendar year, a deliberate
 * simplification vs. ERPNext's own fiscal-year scoping) against the
 * category's thresholds. Withholds on the FULL basis when a threshold is
 * crossed, not just the excess over it -- a documented simplification,
 * same "automate what's safely automatable" spirit as the rest of this
 * codebase's TDS work. Returns 0 if no category is assigned or no rate
 * covers postingDate -- never guessed.
 */
async function computeVendorTds(db: TenantDb, orgId: string, supplierId: string, postingDate: string, baseSubtotal: number, baseGrandTotal: number, excludeInvoiceId: string): Promise<number> {
  const supplier = await db.query.erpSuppliers.findFirst({ where: and(eq(erpSuppliers.id, supplierId), eq(erpSuppliers.orgId, orgId)) })
  if (!supplier?.taxWithholdingCategoryId) return 0

  const category = await db.query.erpTaxWithholdingCategories.findFirst({ where: and(eq(erpTaxWithholdingCategories.id, supplier.taxWithholdingCategoryId), eq(erpTaxWithholdingCategories.orgId, orgId)) })
  if (!category) return 0

  const rates = await db.query.erpTaxWithholdingRates.findMany({
    where: and(eq(erpTaxWithholdingRates.categoryId, category.id), lte(erpTaxWithholdingRates.fromDate, postingDate), or(isNull(erpTaxWithholdingRates.toDate), gte(erpTaxWithholdingRates.toDate, postingDate))),
    orderBy: (t, { desc }) => desc(t.fromDate),
  })
  const applicableRate = rates[0]
  if (!applicableRate) return 0

  const thisBasis = category.taxDeductionBasis === "gross_total" ? baseGrandTotal : baseSubtotal

  let cumulativeBasis = thisBasis
  if (applicableRate.cumulativeThreshold) {
    const yearStart = `${postingDate.slice(0, 4)}-01-01`
    const yearEnd = `${postingDate.slice(0, 4)}-12-31`
    const priorInvoices = await db.query.erpPurchaseInvoices.findMany({
      where: and(eq(erpPurchaseInvoices.orgId, orgId), eq(erpPurchaseInvoices.supplierId, supplierId), eq(erpPurchaseInvoices.status, "submitted"), gte(erpPurchaseInvoices.postingDate, yearStart), lte(erpPurchaseInvoices.postingDate, yearEnd)),
    })
    for (const prior of priorInvoices.filter((p) => p.id !== excludeInvoiceId)) {
      const priorRate = Number(prior.exchangeRate)
      cumulativeBasis += category.taxDeductionBasis === "gross_total" ? Number(prior.grandTotal) * priorRate : Number(prior.subtotal) * priorRate
    }
  }

  const singleCrossed = applicableRate.singleThreshold != null && thisBasis > Number(applicableRate.singleThreshold)
  const cumulativeCrossed = applicableRate.cumulativeThreshold != null && cumulativeBasis > Number(applicableRate.cumulativeThreshold)
  if (!singleCrossed && !cumulativeCrossed) return 0

  return thisBasis * (Number(applicableRate.rate) / 100)
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

export async function createSalesInvoice(ctx: ErpContext, input: { customerId: string; postingDate: string; dueDate?: string; currencyId?: string; exchangeRate?: number; companyId?: string; items: SalesInvoiceItemInput[] }) {
  if (!input.customerId) throw new ServiceError("customerId is required", 400)
  if (!input.items?.length) throw new ServiceError("At least one line item is required", 400)

  return withTenantContext({ orgId: ctx.orgId, userId: ctx.userId }, async (db) => {
    const customer = await db.query.erpCustomers.findFirst({ where: and(eq(erpCustomers.id, input.customerId), eq(erpCustomers.orgId, ctx.orgId)) })
    if (!customer) throw new ServiceError("Customer not found", 404)
    const { currencyId, exchangeRate } = await resolveInvoiceCurrency(db, ctx.orgId, input.currencyId, input.exchangeRate)
    const companyId = await resolveInvoiceCompany(db, ctx.orgId, input.companyId)

    const resolvedItems: (SalesInvoiceItemInput & { quantity: number; rate: number; hsnSacCode: string | null })[] = []
    for (const item of input.items) {
      const quantity = item.quantity ?? 1
      const rate = item.rate ?? (await resolveItemPrice(db, ctx.orgId, item.itemId, input.customerId, quantity, input.postingDate)).rate
      // Wave 65: snapshot the item's current HSN/SAC code onto the invoice
      // line -- never looked up live at report time, so a later change to
      // the item's code doesn't silently rewrite a past invoice's GST
      // classification (matching ERPNext's own copy-at-transaction-time
      // convention for HSN/SAC).
      const hsnSacCode = item.itemId ? (await db.query.erpItems.findFirst({ where: and(eq(erpItems.id, item.itemId), eq(erpItems.orgId, ctx.orgId)) }))?.hsnSacCode ?? null : null
      resolvedItems.push({ ...item, quantity, rate, hsnSacCode })
    }

    const { subtotal, taxAmount, grandTotal } = await computeInvoiceTotals(db, resolvedItems)
    const [{ maxNumber }] = await db.select({ maxNumber: sql<number>`coalesce(max(${erpSalesInvoices.invoiceNumber}), 0)` }).from(erpSalesInvoices).where(eq(erpSalesInvoices.orgId, ctx.orgId))

    const [invoice] = await db.insert(erpSalesInvoices).values({
      orgId: ctx.orgId, customerId: input.customerId, invoiceNumber: Number(maxNumber) + 1,
      postingDate: input.postingDate, dueDate: input.dueDate, currencyId, exchangeRate: exchangeRate.toString(), companyId,
      subtotal: subtotal.toString(), taxAmount: taxAmount.toString(), grandTotal: grandTotal.toString(), outstandingAmount: grandTotal.toString(),
      createdById: ctx.userId,
    }).returning()

    await db.insert(erpSalesInvoiceItems).values(
      resolvedItems.map((i) => ({ invoiceId: invoice.id, itemId: i.itemId, description: i.description, quantity: i.quantity.toString(), rate: i.rate.toString(), amount: (i.quantity * i.rate).toString(), taxTemplateId: i.taxTemplateId, hsnSacCode: i.hsnSacCode }))
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

    // Wave 66: invoice.subtotal/taxAmount/grandTotal are transaction-currency
    // amounts (base currency when invoice.currencyId is null, exchangeRate
    // 1 -- unchanged behavior for every invoice created before this wave).
    // The GL always posts in base currency, using the exchangeRate
    // snapshotted at invoice-creation time -- never re-fetched here.
    const rate = Number(invoice.exchangeRate)
    const baseGrandTotal = Number(invoice.grandTotal) * rate
    const baseSubtotal = Number(invoice.subtotal) * rate
    const currencyAudit = invoice.currencyId ? { currencyId: invoice.currencyId, exchangeRate: invoice.exchangeRate } : {}

    // Wave 84 (COMPARISON_CSV_GAP_ANALYSIS.md backlog #5): a real credit-
    // limit gate, checked in base currency (each open invoice's own
    // snapshotted exchangeRate, same conversion the GL posting below uses)
    // rather than face-value transaction amounts. No-op when the customer
    // has no creditLimit set (every customer seeded before this wave).
    const customer = await db.query.erpCustomers.findFirst({ where: and(eq(erpCustomers.id, invoice.customerId), eq(erpCustomers.orgId, ctx.orgId)) })
    if (customer?.creditLimit != null) {
      const openInvoices = await db.select({ outstandingAmount: erpSalesInvoices.outstandingAmount, exchangeRate: erpSalesInvoices.exchangeRate })
        .from(erpSalesInvoices)
        .where(and(eq(erpSalesInvoices.orgId, ctx.orgId), eq(erpSalesInvoices.customerId, invoice.customerId), eq(erpSalesInvoices.status, "submitted")))
      const existingOutstandingBase = openInvoices.reduce((sum, inv) => sum + Number(inv.outstandingAmount) * Number(inv.exchangeRate), 0)
      const projectedOutstandingBase = existingOutstandingBase + baseGrandTotal
      if (projectedOutstandingBase > Number(customer.creditLimit)) {
        throw new ServiceError(`Submitting this invoice would put ${customer.customerName}'s outstanding balance (${projectedOutstandingBase.toFixed(2)}) over their credit limit (${customer.creditLimit})`, 409)
      }
    }

    const [{ maxNumber }] = await db.select({ maxNumber: sql<number>`coalesce(max(${erpJournalEntries.entryNumber}), 0)` }).from(erpJournalEntries).where(eq(erpJournalEntries.orgId, ctx.orgId))
    const [je] = await db.insert(erpJournalEntries).values({
      orgId: ctx.orgId, entryNumber: Number(maxNumber) + 1, postingDate: invoice.postingDate,
      referenceType: "sales_invoice", referenceId: invoiceId, userRemark: `Sales Invoice #${invoice.invoiceNumber}`,
      companyId: invoice.companyId,
      status: "submitted", totalDebit: baseGrandTotal.toString(), totalCredit: baseGrandTotal.toString(), createdById: ctx.userId, submittedAt: new Date(),
    }).returning()

    const lines = [
      { journalEntryId: je.id, accountId: receivableAccount.id, partyType: "customer" as const, partyId: invoice.customerId, debit: baseGrandTotal.toString(), credit: "0", debitInCurrency: invoice.currencyId ? invoice.grandTotal : undefined, ...currencyAudit },
      { journalEntryId: je.id, accountId: input.revenueAccountId, debit: "0", credit: baseSubtotal.toString(), creditInCurrency: invoice.currencyId ? invoice.subtotal : undefined, ...currencyAudit },
      ...Array.from(taxByAccount.entries()).map(([accountId, amount]) => ({ journalEntryId: je.id, accountId, debit: "0", credit: (amount * rate).toString(), creditInCurrency: invoice.currencyId ? amount.toString() : undefined, ...currencyAudit })),
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

export async function createPurchaseInvoice(ctx: ErpContext, input: { supplierId: string; postingDate: string; dueDate?: string; currencyId?: string; exchangeRate?: number; companyId?: string; items: PurchaseInvoiceItemInput[] }) {
  if (!input.supplierId) throw new ServiceError("supplierId is required", 400)
  if (!input.items?.length) throw new ServiceError("At least one line item is required", 400)

  return withTenantContext({ orgId: ctx.orgId, userId: ctx.userId }, async (db) => {
    const supplier = await db.query.erpSuppliers.findFirst({ where: and(eq(erpSuppliers.id, input.supplierId), eq(erpSuppliers.orgId, ctx.orgId)) })
    if (!supplier) throw new ServiceError("Supplier not found", 404)
    const { currencyId, exchangeRate } = await resolveInvoiceCurrency(db, ctx.orgId, input.currencyId, input.exchangeRate)
    const companyId = await resolveInvoiceCompany(db, ctx.orgId, input.companyId)

    const resolvedItems: (PurchaseInvoiceItemInput & { quantity: number; hsnSacCode: string | null })[] = []
    for (const item of input.items) {
      const hsnSacCode = item.itemId ? (await db.query.erpItems.findFirst({ where: and(eq(erpItems.id, item.itemId), eq(erpItems.orgId, ctx.orgId)) }))?.hsnSacCode ?? null : null
      resolvedItems.push({ ...item, quantity: item.quantity ?? 1, hsnSacCode })
    }
    const { subtotal, taxAmount, grandTotal } = await computeInvoiceTotals(db, resolvedItems)
    const [{ maxNumber }] = await db.select({ maxNumber: sql<number>`coalesce(max(${erpPurchaseInvoices.invoiceNumber}), 0)` }).from(erpPurchaseInvoices).where(eq(erpPurchaseInvoices.orgId, ctx.orgId))

    const [invoice] = await db.insert(erpPurchaseInvoices).values({
      orgId: ctx.orgId, supplierId: input.supplierId, invoiceNumber: Number(maxNumber) + 1,
      postingDate: input.postingDate, dueDate: input.dueDate, currencyId, exchangeRate: exchangeRate.toString(), companyId,
      subtotal: subtotal.toString(), taxAmount: taxAmount.toString(), grandTotal: grandTotal.toString(), outstandingAmount: grandTotal.toString(),
      createdById: ctx.userId,
    }).returning()

    await db.insert(erpPurchaseInvoiceItems).values(
      resolvedItems.map((i) => ({ invoiceId: invoice.id, itemId: i.itemId, description: i.description, quantity: i.quantity.toString(), rate: i.rate.toString(), amount: (i.quantity * i.rate).toString(), taxTemplateId: i.taxTemplateId, hsnSacCode: i.hsnSacCode }))
    )

    await logActivity({ tx: db, orgId: ctx.orgId, dbUser: ctx.dbUser, action: "erp_purchase_invoice.created", entityType: "erp_purchase_invoice", entityId: invoice.id })
    return invoice
  })
}

export async function submitPurchaseInvoice(ctx: ErpContext, invoiceId: string, input: { expenseAccountId: string; tdsPayableAccountId?: string }) {
  if (!input.expenseAccountId) throw new ServiceError("expenseAccountId is required", 400)

  return withTenantContext({ orgId: ctx.orgId, userId: ctx.userId }, async (db) => {
    const invoice = await db.query.erpPurchaseInvoices.findFirst({ where: and(eq(erpPurchaseInvoices.id, invoiceId), eq(erpPurchaseInvoices.orgId, ctx.orgId)), with: { items: true } })
    if (!invoice) throw new ServiceError("Purchase invoice not found", 404)
    if (invoice.status !== "draft") throw new ServiceError("Only draft invoices can be submitted", 409)

    const periodOpen = await isPeriodOpenForDate(ctx, invoice.postingDate)
    if (!periodOpen) throw new ServiceError(`The accounting period covering ${invoice.postingDate} is closed`, 409)

    const payableAccount = await findControlAccount(db, ctx.orgId, "payable")
    const { taxByAccount } = await computeInvoiceTotals(db, invoice.items.map((i) => ({ quantity: Number(i.quantity), rate: Number(i.rate), taxTemplateId: i.taxTemplateId ?? undefined })))

    // See submitSalesInvoice's identical Wave 66 comment -- same base-
    // currency conversion using the invoice's snapshotted exchangeRate.
    const rate = Number(invoice.exchangeRate)
    const baseGrandTotal = Number(invoice.grandTotal) * rate
    const baseSubtotal = Number(invoice.subtotal) * rate
    const currencyAudit = invoice.currencyId ? { currencyId: invoice.currencyId, exchangeRate: invoice.exchangeRate } : {}

    const tdsAmount = await computeVendorTds(db, ctx.orgId, invoice.supplierId, invoice.postingDate, baseSubtotal, baseGrandTotal, invoiceId)
    if (tdsAmount > 0 && !input.tdsPayableAccountId) throw new ServiceError("This supplier's TDS threshold was crossed -- tdsPayableAccountId is required to post the withholding liability", 400)
    const netPayable = baseGrandTotal - tdsAmount

    // Wave 84: symmetric credit-limit gate -- the credit line this supplier
    // extends to us. See submitSalesInvoice's identical comment.
    const supplier = await db.query.erpSuppliers.findFirst({ where: and(eq(erpSuppliers.id, invoice.supplierId), eq(erpSuppliers.orgId, ctx.orgId)) })
    if (supplier?.creditLimit != null) {
      const openInvoices = await db.select({ outstandingAmount: erpPurchaseInvoices.outstandingAmount, exchangeRate: erpPurchaseInvoices.exchangeRate })
        .from(erpPurchaseInvoices)
        .where(and(eq(erpPurchaseInvoices.orgId, ctx.orgId), eq(erpPurchaseInvoices.supplierId, invoice.supplierId), eq(erpPurchaseInvoices.status, "submitted")))
      const existingOutstandingBase = openInvoices.reduce((sum, inv) => sum + Number(inv.outstandingAmount) * Number(inv.exchangeRate), 0)
      const projectedOutstandingBase = existingOutstandingBase + baseGrandTotal
      if (projectedOutstandingBase > Number(supplier.creditLimit)) {
        throw new ServiceError(`Submitting this invoice would put outstanding payables to ${supplier.supplierName} (${projectedOutstandingBase.toFixed(2)}) over their credit limit (${supplier.creditLimit})`, 409)
      }
    }

    const [{ maxNumber }] = await db.select({ maxNumber: sql<number>`coalesce(max(${erpJournalEntries.entryNumber}), 0)` }).from(erpJournalEntries).where(eq(erpJournalEntries.orgId, ctx.orgId))
    const [je] = await db.insert(erpJournalEntries).values({
      orgId: ctx.orgId, entryNumber: Number(maxNumber) + 1, postingDate: invoice.postingDate,
      referenceType: "purchase_invoice", referenceId: invoiceId, userRemark: `Purchase Invoice #${invoice.invoiceNumber}`,
      companyId: invoice.companyId,
      status: "submitted", totalDebit: baseGrandTotal.toString(), totalCredit: baseGrandTotal.toString(), createdById: ctx.userId, submittedAt: new Date(),
    }).returning()

    const lines = [
      { journalEntryId: je.id, accountId: input.expenseAccountId, debit: baseSubtotal.toString(), credit: "0", debitInCurrency: invoice.currencyId ? invoice.subtotal : undefined, ...currencyAudit },
      ...Array.from(taxByAccount.entries()).map(([accountId, amount]) => ({ journalEntryId: je.id, accountId, debit: (amount * rate).toString(), credit: "0", debitInCurrency: invoice.currencyId ? amount.toString() : undefined, ...currencyAudit })), // input tax recoverable -- debited
      { journalEntryId: je.id, accountId: payableAccount.id, partyType: "supplier" as const, partyId: invoice.supplierId, debit: "0", credit: netPayable.toString(), creditInCurrency: invoice.currencyId ? invoice.grandTotal : undefined, ...currencyAudit },
      ...(tdsAmount > 0 ? [{ journalEntryId: je.id, accountId: input.tdsPayableAccountId!, debit: "0", credit: tdsAmount.toString() }] : []),
    ]
    await db.insert(erpJournalEntryLines).values(lines)

    const [updated] = await db.update(erpPurchaseInvoices).set({ status: "submitted", journalEntryId: je.id, tdsAmount: tdsAmount.toString() }).where(eq(erpPurchaseInvoices.id, invoiceId)).returning()
    await logActivity({ tx: db, orgId: ctx.orgId, dbUser: ctx.dbUser, action: "erp_purchase_invoice.submitted", entityType: "erp_purchase_invoice", entityId: invoiceId })
    return updated
  })
}
