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
  erpTaxWithholdingCategories, erpTaxWithholdingRates, erpSalesOrders,
  users, projects,
} from "@/lib/db"
import { withTenantContext, type TenantDb } from "@/lib/db/tenant-scoped"
import { and, eq, or, isNull, lte, gte, sql, inArray } from "drizzle-orm"
import { ServiceError } from "./compliance-service"
export { ServiceError }
import { logActivity } from "@/lib/audit"
import { isPeriodOpenForDate, trialBalance, profitAndLoss } from "./erp-financial-report-service"
import { didRevenuePost, recordAuditTrigger } from "@/lib/audit-event-triggers"
import { requireErpEnabled } from "./erp-enablement-service"

export type ErpContext = { orgId: string; userId: string; dbUser: typeof users.$inferSelect }

// ============================================================
// Tax Templates (Wave 49 schema, no consumer until now -- invoicing needs
// somewhere to create these, so a minimal CRUD is added here rather than
// leaving invoicing as a half-feature with no way to set up GST templates)
// ============================================================

export async function listTaxTemplates(ctx: { orgId: string }) {
  await requireErpEnabled(ctx.orgId)
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
  await requireErpEnabled(ctx.orgId)
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
  await requireErpEnabled(ctx.orgId)
  return withTenantContext({ orgId: ctx.orgId }, async (db) => {
    return db.query.erpPricingRules.findMany({ where: eq(erpPricingRules.orgId, ctx.orgId), orderBy: (t, { desc }) => desc(t.priority) })
  })
}

export async function createPricingRule(
  ctx: ErpContext,
  input: { name: string; appliesTo: "all" | "customer" | "item"; targetId?: string; discountType: "percentage" | "flat"; discountValue: number; minQty?: number; validFrom: string; validTo?: string; priority?: number }
) {
  await requireErpEnabled(ctx.orgId)
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

// Exported (Wave B) for erp-payment-entries-service.ts to reuse the exact
// same control-account resolution rather than re-implementing it.
export async function findControlAccount(db: TenantDb, orgId: string, accountType: "receivable" | "payable") {
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
  await requireErpEnabled(ctx.orgId)
  return withTenantContext({ orgId: ctx.orgId }, async (db) => {
    return db.query.erpSalesInvoices.findMany({ where: eq(erpSalesInvoices.orgId, ctx.orgId), orderBy: (t, { desc }) => desc(t.postingDate), with: { items: true, customer: true } })
  })
}

export type SalesInvoiceListFilters = { status?: string; customerId?: string; fromDate?: string; toDate?: string; page?: number; limit?: number }

/**
 * Priority 15 (PROJEXA Invoicing depth, 500-project scale): a real, paged/
 * filtered variant of listSalesInvoices above -- kept additive (not a
 * breaking rewrite) so every existing caller of the plain array-returning
 * function is unaffected. PROJEXA's alias route uses this one.
 */
export async function listSalesInvoicesPaged(ctx: { orgId: string }, filters: SalesInvoiceListFilters = {}) {
  await requireErpEnabled(ctx.orgId)
  const page = Math.max(1, filters.page ?? 1)
  const limit = Math.min(200, Math.max(1, filters.limit ?? 25))
  const offset = (page - 1) * limit

  return withTenantContext({ orgId: ctx.orgId }, async (db) => {
    const conditions = [eq(erpSalesInvoices.orgId, ctx.orgId)]
    if (filters.status) conditions.push(eq(erpSalesInvoices.status, filters.status as typeof erpSalesInvoices.$inferSelect.status))
    if (filters.customerId) conditions.push(eq(erpSalesInvoices.customerId, filters.customerId))
    if (filters.fromDate) conditions.push(gte(erpSalesInvoices.postingDate, filters.fromDate))
    if (filters.toDate) conditions.push(lte(erpSalesInvoices.postingDate, filters.toDate))
    const where = and(...conditions)

    const [invoices, [{ count }]] = await Promise.all([
      db.query.erpSalesInvoices.findMany({ where, orderBy: (t, { desc }) => desc(t.postingDate), limit, offset, with: { items: true, customer: true } }),
      db.select({ count: sql<number>`count(*)::int` }).from(erpSalesInvoices).where(where),
    ])

    return { invoices, total: count, page, limit, totalPages: Math.ceil(count / limit) }
  })
}

// Priority 13 (PROJEXA sales-invoice creation): ctx is intentionally NOT
// ErpContext here (unlike submitSalesInvoice/createPurchaseInvoice below) --
// this is the one write in this file a Bearer-API-key caller legitimately
// needs (PROJEXA's callVeridian() never carries a session cookie, so
// ctx.dbUser is always null on that path per requireAuthOrApiKey's
// discriminated CombinedAuthContext). logActivity already has a proper
// dbUser-or-apiKey discriminated union for exactly this case (Wave 9); this
// function was just never wired to use the apiKey branch, which would have
// silently made "PROJEXA can create/link an invoice" impossible to actually
// call. Every other ErpContext-typed function in this file keeps requiring
// a real dbUser unchanged.
export async function createSalesInvoice(
  ctx: { orgId: string; userId: string } & ({ dbUser: typeof users.$inferSelect; apiKey?: never } | { dbUser?: never; apiKey: { id: string; name: string } }),
  input: { customerId: string; salesOrderId?: string; projectId?: string; postingDate: string; dueDate?: string; currencyId?: string; exchangeRate?: number; companyId?: string; items: SalesInvoiceItemInput[] }
) {
  await requireErpEnabled(ctx.orgId)
  if (!input.customerId) throw new ServiceError("customerId is required", 400)
  if (!input.items?.length) throw new ServiceError("At least one line item is required", 400)

  return withTenantContext({ orgId: ctx.orgId, userId: ctx.userId }, async (db) => {
    const customer = await db.query.erpCustomers.findFirst({ where: and(eq(erpCustomers.id, input.customerId), eq(erpCustomers.orgId, ctx.orgId)) })
    if (!customer) throw new ServiceError("Customer not found", 404)
    // Priority 15 (Sales & CRM depth wave): erp_sales_invoices.salesOrderId
    // has existed since Wave 60 with nothing ever setting it -- this closes
    // the loop from erp-selling-service.ts's sales orders through to
    // invoicing, so a construction PM can see "this invoice came from that
    // order" instead of the two documents being invisibly disconnected.
    if (input.salesOrderId) {
      const salesOrder = await db.query.erpSalesOrders.findFirst({ where: and(eq(erpSalesOrders.id, input.salesOrderId), eq(erpSalesOrders.orgId, ctx.orgId)) })
      if (!salesOrder) throw new ServiceError("Sales order not found", 404)
    }
    // Wave 120 (PROJEXA Revenue Report) added this column specifically so a
    // sales invoice could be attributed to a construction project, but
    // nothing ever actually set it -- caught live while seeding real demo
    // data: construction-dashboard-service.ts's getOrgDashboard() filters
    // its revenue-by-project query to `inArray(projectId, ids)`, so every
    // invoice created through this endpoint was silently excluded from both
    // per-project AND org-wide Total Revenue, regardless of how many real
    // invoices existed.
    if (input.projectId) {
      const project = await db.query.projects.findFirst({ where: and(eq(projects.id, input.projectId), eq(projects.orgId, ctx.orgId)) })
      if (!project) throw new ServiceError("Project not found", 404)
    }
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
      orgId: ctx.orgId, customerId: input.customerId, salesOrderId: input.salesOrderId ?? null, projectId: input.projectId ?? null, invoiceNumber: Number(maxNumber) + 1,
      postingDate: input.postingDate, dueDate: input.dueDate, currencyId, exchangeRate: exchangeRate.toString(), companyId,
      subtotal: subtotal.toString(), taxAmount: taxAmount.toString(), grandTotal: grandTotal.toString(), outstandingAmount: grandTotal.toString(),
      createdById: ctx.userId,
    }).returning()

    await db.insert(erpSalesInvoiceItems).values(
      resolvedItems.map((i) => ({ invoiceId: invoice.id, itemId: i.itemId, description: i.description, quantity: i.quantity.toString(), rate: i.rate.toString(), amount: (i.quantity * i.rate).toString(), taxTemplateId: i.taxTemplateId, hsnSacCode: i.hsnSacCode }))
    )

    await logActivity(
      ctx.dbUser
        ? { tx: db, orgId: ctx.orgId, dbUser: ctx.dbUser, action: "erp_sales_invoice.created", entityType: "erp_sales_invoice", entityId: invoice.id }
        : { tx: db, orgId: ctx.orgId, apiKey: ctx.apiKey, action: "erp_sales_invoice.created", entityType: "erp_sales_invoice", entityId: invoice.id }
    )
    return invoice
  })
}

export async function submitSalesInvoice(ctx: ErpContext, invoiceId: string, input: { revenueAccountId: string }) {
  await requireErpEnabled(ctx.orgId)
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

    // D15.B2.S1 named event #5, "Revenue Posted -> Revenue Audit" -- this is
    // the real journal-entry posting (the GL lines inserted just above), not
    // merely a status label change. didRevenuePost() gates on the real
    // draft->submitted transition rather than assuming every call here is one
    // (defensive, matches this file's own "never assume" discipline
    // elsewhere), even though the draft-only check above makes it true today.
    if (didRevenuePost(invoice.status, updated.status)) {
      await recordAuditTrigger({
        tx: db, event: "revenue_posted", entityType: "erp_sales_invoice", entityId: invoiceId, orgId: ctx.orgId,
        dbUser: ctx.dbUser, details: `Sales Invoice #${invoice.invoiceNumber} posted (journal entry #${je.entryNumber}, ${baseGrandTotal.toFixed(2)}).`,
      }).catch((err) => console.error(`[audit-trigger] failed to record revenue_posted for invoice ${invoiceId}:`, err))
    }

    return updated
  })
}

// ============================================================
// Purchase Invoices
// ============================================================

export type PurchaseInvoiceItemInput = { itemId?: string; description: string; quantity?: number; rate: number; taxTemplateId?: string; purchaseOrderItemId?: string }

export async function listPurchaseInvoices(ctx: { orgId: string }) {
  await requireErpEnabled(ctx.orgId)
  return withTenantContext({ orgId: ctx.orgId }, async (db) => {
    return db.query.erpPurchaseInvoices.findMany({ where: eq(erpPurchaseInvoices.orgId, ctx.orgId), orderBy: (t, { desc }) => desc(t.postingDate), with: { items: true, supplier: true } })
  })
}

// Wave 85: purchaseOrderId/each item's purchaseOrderItemId are nullable --
// a purchase invoice can still be logged standalone, unchanged behavior for
// every invoice created before this wave. Linking them is what lets
// erp-goods-receipt-service.ts's getThreeWayMatchReport compare this
// invoice's lines against the same PO's receipt lines.
export async function createPurchaseInvoice(ctx: ErpContext, input: { supplierId: string; purchaseOrderId?: string; postingDate: string; dueDate?: string; currencyId?: string; exchangeRate?: number; companyId?: string; items: PurchaseInvoiceItemInput[] }) {
  await requireErpEnabled(ctx.orgId)
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
      orgId: ctx.orgId, supplierId: input.supplierId, purchaseOrderId: input.purchaseOrderId, invoiceNumber: Number(maxNumber) + 1,
      postingDate: input.postingDate, dueDate: input.dueDate, currencyId, exchangeRate: exchangeRate.toString(), companyId,
      subtotal: subtotal.toString(), taxAmount: taxAmount.toString(), grandTotal: grandTotal.toString(), outstandingAmount: grandTotal.toString(),
      createdById: ctx.userId,
    }).returning()

    await db.insert(erpPurchaseInvoiceItems).values(
      resolvedItems.map((i) => ({ invoiceId: invoice.id, itemId: i.itemId, description: i.description, quantity: i.quantity.toString(), rate: i.rate.toString(), amount: (i.quantity * i.rate).toString(), taxTemplateId: i.taxTemplateId, hsnSacCode: i.hsnSacCode, purchaseOrderItemId: i.purchaseOrderItemId }))
    )

    await logActivity({ tx: db, orgId: ctx.orgId, dbUser: ctx.dbUser, action: "erp_purchase_invoice.created", entityType: "erp_purchase_invoice", entityId: invoice.id })
    return invoice
  })
}

export async function submitPurchaseInvoice(ctx: ErpContext, invoiceId: string, input: { expenseAccountId: string; tdsPayableAccountId?: string }) {
  await requireErpEnabled(ctx.orgId)
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

// ============================================================
// Priority 15 (PROJEXA Invoicing depth): full invoice lifecycle beyond
// draft->submitted. erp_payment_entries (Wave 49 schema) has no invoiceId
// column and no service-layer consumer anywhere in this codebase -- rather
// than force-fit a generic, un-invoice-scoped payment-entry record, this
// posts a real, direct, invoice-scoped receipt (mirrors erp-cash-service.ts's
// own "post immediately, no draft state" convention for cash-like
// instruments) and reduces THIS invoice's own outstandingAmount/status,
// which is what "record a payment against an invoice" concretely needs.
// A generic multi-invoice payment-allocation engine (one receipt applied
// across several invoices) is a real, larger feature left for a follow-up.
// ============================================================

export type RecordPaymentActorCtx = { orgId: string; userId: string } & ({ dbUser: typeof users.$inferSelect; apiKey?: never } | { dbUser?: never; apiKey: { id: string; name: string } })

export async function recordSalesInvoicePayment(
  ctx: RecordPaymentActorCtx,
  invoiceId: string,
  input: { amount: number; bankOrCashAccountId: string; postingDate: string; referenceNo?: string }
) {
  await requireErpEnabled(ctx.orgId)
  if (!input.amount || input.amount <= 0) throw new ServiceError("amount must be positive", 400)
  if (!input.bankOrCashAccountId) throw new ServiceError("bankOrCashAccountId is required", 400)
  if (!input.postingDate) throw new ServiceError("postingDate is required", 400)

  const periodOpen = await isPeriodOpenForDate(ctx, input.postingDate)
  if (!periodOpen) throw new ServiceError(`The accounting period covering ${input.postingDate} is closed`, 409)

  return withTenantContext({ orgId: ctx.orgId, userId: ctx.userId }, async (db) => {
    const invoice = await db.query.erpSalesInvoices.findFirst({ where: and(eq(erpSalesInvoices.id, invoiceId), eq(erpSalesInvoices.orgId, ctx.orgId)) })
    if (!invoice) throw new ServiceError("Sales invoice not found", 404)
    if (!["submitted", "partially_paid", "overdue"].includes(invoice.status)) throw new ServiceError(`Cannot record a payment against an invoice in '${invoice.status}' status`, 409)

    const outstanding = Number(invoice.outstandingAmount)
    if (input.amount > outstanding + 0.01) throw new ServiceError(`Payment amount (${input.amount}) exceeds the outstanding balance (${outstanding})`, 400)

    const receivableAccount = await findControlAccount(db, ctx.orgId, "receivable")

    const [{ maxNumber }] = await db.select({ maxNumber: sql<number>`coalesce(max(${erpJournalEntries.entryNumber}), 0)` }).from(erpJournalEntries).where(eq(erpJournalEntries.orgId, ctx.orgId))
    const [je] = await db.insert(erpJournalEntries).values({
      orgId: ctx.orgId, entryNumber: Number(maxNumber) + 1, postingDate: input.postingDate,
      referenceType: "sales_invoice_payment", referenceId: invoiceId,
      userRemark: `Payment received against Sales Invoice #${invoice.invoiceNumber}${input.referenceNo ? ` (Ref: ${input.referenceNo})` : ""}`,
      companyId: invoice.companyId, status: "submitted",
      totalDebit: input.amount.toString(), totalCredit: input.amount.toString(),
      createdById: ctx.userId, submittedAt: new Date(),
    }).returning()

    await db.insert(erpJournalEntryLines).values([
      { journalEntryId: je.id, accountId: input.bankOrCashAccountId, debit: input.amount.toString(), credit: "0", partyType: "customer", partyId: invoice.customerId, remark: input.referenceNo },
      { journalEntryId: je.id, accountId: receivableAccount.id, debit: "0", credit: input.amount.toString(), partyType: "customer", partyId: invoice.customerId },
    ])

    const newOutstanding = Math.max(0, outstanding - input.amount)
    const newStatus = newOutstanding <= 0.01 ? "paid" : "partially_paid"
    const [updated] = await db.update(erpSalesInvoices).set({ outstandingAmount: newOutstanding.toString(), status: newStatus }).where(eq(erpSalesInvoices.id, invoiceId)).returning()

    await logActivity(
      ctx.dbUser
        ? { tx: db, orgId: ctx.orgId, dbUser: ctx.dbUser, action: "erp_sales_invoice.payment_recorded", entityType: "erp_sales_invoice", entityId: invoiceId, details: JSON.stringify({ amount: input.amount, journalEntryId: je.id }) }
        : { tx: db, orgId: ctx.orgId, apiKey: ctx.apiKey, action: "erp_sales_invoice.payment_recorded", entityType: "erp_sales_invoice", entityId: invoiceId, details: JSON.stringify({ amount: input.amount, journalEntryId: je.id }) }
    )
    return updated
  })
}

/** Cancels a DRAFT invoice only -- a submitted invoice has already posted a real GL entry, so cancelling it safely needs a reversing entry (a real feature, left for a follow-up rather than silently leaving the ledger unbalanced). */
export async function cancelSalesInvoice(ctx: { orgId: string; userId: string }, invoiceId: string) {
  await requireErpEnabled(ctx.orgId)
  return withTenantContext({ orgId: ctx.orgId, userId: ctx.userId }, async (db) => {
    const invoice = await db.query.erpSalesInvoices.findFirst({ where: and(eq(erpSalesInvoices.id, invoiceId), eq(erpSalesInvoices.orgId, ctx.orgId)) })
    if (!invoice) throw new ServiceError("Sales invoice not found", 404)
    if (invoice.status !== "draft") throw new ServiceError("Only draft invoices can be cancelled directly -- a submitted invoice needs a reversing credit note instead", 409)
    const [updated] = await db.update(erpSalesInvoices).set({ status: "cancelled" }).where(eq(erpSalesInvoices.id, invoiceId)).returning()
    return updated
  })
}

/**
 * AR Aging report: every non-fully-paid sales invoice bucketed by days past
 * due (current / 1-30 / 31-60 / 61-90 / 90+), the standard AR aging shape
 * used across every benchmarked ERP. Pure aggregation over erp_sales_invoices'
 * own outstandingAmount/dueDate -- no new schema.
 */
export async function arAgingReport(ctx: { orgId: string }, asOfDate?: string) {
  await requireErpEnabled(ctx.orgId)
  const asOf = asOfDate ?? new Date().toISOString().slice(0, 10)
  const asOfMs = new Date(asOf).getTime()

  return withTenantContext({ orgId: ctx.orgId }, async (db) => {
    const invoices = await db.query.erpSalesInvoices.findMany({
      where: and(eq(erpSalesInvoices.orgId, ctx.orgId), inArray(erpSalesInvoices.status, ["submitted", "partially_paid", "overdue"])),
      with: { customer: true },
    })

    const buckets = { current: 0, d1_30: 0, d31_60: 0, d61_90: 0, d90Plus: 0 }
    const rows = invoices
      .filter((inv) => Number(inv.outstandingAmount) > 0.01)
      .map((inv) => {
        const dueMs = new Date(inv.dueDate ?? inv.postingDate).getTime()
        const daysOverdue = Math.floor((asOfMs - dueMs) / 86400000)
        const outstanding = Number(inv.outstandingAmount)
        let bucket: "current" | "1-30" | "31-60" | "61-90" | "90+"
        if (daysOverdue <= 0) { bucket = "current"; buckets.current += outstanding }
        else if (daysOverdue <= 30) { bucket = "1-30"; buckets.d1_30 += outstanding }
        else if (daysOverdue <= 60) { bucket = "31-60"; buckets.d31_60 += outstanding }
        else if (daysOverdue <= 90) { bucket = "61-90"; buckets.d61_90 += outstanding }
        else { bucket = "90+"; buckets.d90Plus += outstanding }
        return {
          invoiceId: inv.id, invoiceNumber: inv.invoiceNumber, customerId: inv.customerId,
          customerName: inv.customer?.customerName ?? null, dueDate: inv.dueDate, postingDate: inv.postingDate,
          outstandingAmount: inv.outstandingAmount, daysOverdue: Math.max(0, daysOverdue), bucket, status: inv.status,
        }
      })
      .sort((a, b) => b.daysOverdue - a.daysOverdue)

    const totalOutstanding = buckets.current + buckets.d1_30 + buckets.d31_60 + buckets.d61_90 + buckets.d90Plus
    return { asOfDate: asOf, buckets, totalOutstanding, invoices: rows }
  })
}

/**
 * Finance dashboard rollup for PROJEXA's Finance overview: cash/bank
 * position (sum of bank+cash account balances from the GL, as of today),
 * AR aging summary + the 5 most-overdue invoices, and this-month vs
 * last-month revenue (reuses profitAndLoss's own totalIncome, not a
 * reimplementation). Pure composition of existing report functions --
 * no new aggregation logic beyond the cash-position query.
 */
export async function getFinanceDashboard(ctx: { orgId: string }) {
  await requireErpEnabled(ctx.orgId)
  const today = new Date()
  const todayIso = today.toISOString().slice(0, 10)
  const thisMonthStart = new Date(today.getFullYear(), today.getMonth(), 1).toISOString().slice(0, 10)
  const lastMonthStart = new Date(today.getFullYear(), today.getMonth() - 1, 1).toISOString().slice(0, 10)
  const lastMonthEnd = new Date(today.getFullYear(), today.getMonth(), 0).toISOString().slice(0, 10)

  const [tb, aging, thisMonthPnl, lastMonthPnl] = await Promise.all([
    trialBalance(ctx, todayIso),
    arAgingReport(ctx, todayIso),
    profitAndLoss(ctx, thisMonthStart, todayIso),
    profitAndLoss(ctx, lastMonthStart, lastMonthEnd),
  ])

  const cashPosition = tb.accounts
    .filter((a) => a.accountType === "bank" || a.accountType === "cash")
    .reduce((sum, a) => sum + a.netBalance, 0)

  return {
    asOfDate: todayIso,
    cashPosition,
    arAging: { totalOutstanding: aging.totalOutstanding, buckets: aging.buckets },
    topOverdueInvoices: aging.invoices.filter((i) => i.daysOverdue > 0).slice(0, 5),
    revenue: { thisMonth: thisMonthPnl.totalIncome, lastMonth: lastMonthPnl.totalIncome },
  }
}
