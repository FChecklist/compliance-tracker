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
  erpTaxWithholdingCategories, erpTaxWithholdingRates, erpSalesOrders, erpPaymentEntries,
  users, projects,
} from "@/lib/db"
import { withTenantContext, type TenantDb } from "@/lib/db/tenant-scoped"
import { and, eq, or, isNull, lte, gte, gt, sql, inArray } from "drizzle-orm"
import { ServiceError } from "./compliance-service"
export { ServiceError }
import { logActivity } from "@/lib/audit"
import { isPeriodOpenForDate, trialBalance, profitAndLoss } from "./erp-financial-report-service"
import { didRevenuePost, recordAuditTrigger } from "@/lib/audit-event-triggers"
import { requireErpEnabled } from "./erp-enablement-service"
import { listBankAccounts } from "./erp-vendor-master-service"

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

/**
 * Pure -- independently unit-testable without a DB, matching this repo's
 * convention (e.g. construction-valuation-service.ts's
 * computeInterimBillLines). Takes already-resolved tax-template rates so the
 * only DB-touching part is the thin computeInvoiceTotals wrapper below.
 */
export function computeInvoiceTaxTotals(items: { quantity: number; rate: number; taxLines: { taxAccountId: string; rate: number }[] }[]) {
  let subtotal = 0
  let taxAmount = 0
  const taxByAccount = new Map<string, number>()

  for (const item of items) {
    const lineAmount = item.quantity * item.rate
    subtotal += lineAmount
    for (const t of item.taxLines) {
      const lineTax = lineAmount * (t.rate / 100)
      taxAmount += lineTax
      taxByAccount.set(t.taxAccountId, (taxByAccount.get(t.taxAccountId) ?? 0) + lineTax)
    }
  }
  return { subtotal, taxAmount, grandTotal: subtotal + taxAmount, taxByAccount }
}

async function computeInvoiceTotals(db: TenantDb, items: { quantity: number; rate: number; taxTemplateId?: string }[]) {
  const resolvedItems: { quantity: number; rate: number; taxLines: { taxAccountId: string; rate: number }[] }[] = []
  for (const item of items) {
    const taxLines = item.taxTemplateId
      ? (await db.query.erpTaxTemplateItems.findMany({ where: eq(erpTaxTemplateItems.taxTemplateId, item.taxTemplateId) })).map((t) => ({ taxAccountId: t.taxAccountId, rate: Number(t.rate) }))
      : []
    resolvedItems.push({ quantity: item.quantity, rate: item.rate, taxLines })
  }
  return computeInvoiceTaxTotals(resolvedItems)
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

// Real-screen conversion (2026-08-30): single-invoice lookup for the Object
// Page -- listSalesInvoicesPaged already eager-loads items/customer per row,
// this just does the same `with` for one id instead of forcing the Object
// Page to page through the whole list client-side to find one row.
export async function getSalesInvoice(ctx: { orgId: string }, invoiceId: string) {
  await requireErpEnabled(ctx.orgId)
  return withTenantContext({ orgId: ctx.orgId }, async (db) => {
    const invoice = await db.query.erpSalesInvoices.findFirst({ where: and(eq(erpSalesInvoices.id, invoiceId), eq(erpSalesInvoices.orgId, ctx.orgId)), with: { items: true, customer: true } })
    if (!invoice) throw new ServiceError("Sales invoice not found", 404)
    return invoice
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

// Real-screen conversion (2026-08-30): widened from ErpContext (real dbUser
// only) to the same dbUser-or-apiKey actor union createSalesInvoice above
// already uses -- this function had zero PROJEXA-reachable route despite
// existing since Wave 60, so every invoice PROJEXA created stayed "draft"
// forever (recordSalesInvoicePayment only accepts submitted/
// partially_paid/overdue, so it could never actually be paid either). See
// PROJEXA_REAL_SCREEN_CONVERSION_TRACKER.md module #13 for the full finding.
export async function submitSalesInvoice(
  ctx: { orgId: string; userId: string } & ({ dbUser: typeof users.$inferSelect; apiKey?: never } | { dbUser?: never; apiKey: { id: string; name: string } }),
  invoiceId: string, input: { revenueAccountId: string }
) {
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
    await logActivity(
      ctx.dbUser
        ? { tx: db, orgId: ctx.orgId, dbUser: ctx.dbUser, action: "erp_sales_invoice.submitted", entityType: "erp_sales_invoice", entityId: invoiceId }
        : { tx: db, orgId: ctx.orgId, apiKey: ctx.apiKey, action: "erp_sales_invoice.submitted", entityType: "erp_sales_invoice", entityId: invoiceId }
    )

    // D15.B2.S1 named event #5, "Revenue Posted -> Revenue Audit" -- this is
    // the real journal-entry posting (the GL lines inserted just above), not
    // merely a status label change. didRevenuePost() gates on the real
    // draft->submitted transition rather than assuming every call here is one
    // (defensive, matches this file's own "never assume" discipline
    // elsewhere), even though the draft-only check above makes it true today.
    if (didRevenuePost(invoice.status, updated.status)) {
      await recordAuditTrigger(
        ctx.dbUser
          ? { tx: db, event: "revenue_posted", entityType: "erp_sales_invoice", entityId: invoiceId, orgId: ctx.orgId, dbUser: ctx.dbUser, details: `Sales Invoice #${invoice.invoiceNumber} posted (journal entry #${je.entryNumber}, ${baseGrandTotal.toFixed(2)}).` }
          : { tx: db, event: "revenue_posted", entityType: "erp_sales_invoice", entityId: invoiceId, orgId: ctx.orgId, apiKey: ctx.apiKey, details: `Sales Invoice #${invoice.invoiceNumber} posted (journal entry #${je.entryNumber}, ${baseGrandTotal.toFixed(2)}).` }
      ).catch((err) => console.error(`[audit-trigger] failed to record revenue_posted for invoice ${invoiceId}:`, err))
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
export async function createPurchaseInvoice(ctx: ErpContext, input: { supplierId: string; purchaseOrderId?: string; postingDate: string; dueDate?: string; currencyId?: string; exchangeRate?: number; companyId?: string; retentionPercent?: number; items: PurchaseInvoiceItemInput[] }) {
  await requireErpEnabled(ctx.orgId)
  if (!input.supplierId) throw new ServiceError("supplierId is required", 400)
  if (!input.items?.length) throw new ServiceError("At least one line item is required", 400)
  if (input.retentionPercent != null && (input.retentionPercent < 0 || input.retentionPercent > 100)) {
    throw new ServiceError("retentionPercent must be between 0 and 100", 400)
  }

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

    // FI-AP-007: retention is a subcontractor-billing holdback tracked as a
    // pure informational/reporting snapshot on the invoice -- it does NOT
    // reduce subtotal/taxAmount/grandTotal/outstandingAmount or the journal
    // entry posted at submit time, mirroring constructionInterimBills' own
    // real behavior (construction-valuation-service.ts's generateInterimBill
    // never adjusts erpSalesInvoices' totals for retention either -- GST/GL
    // stay on the full value; retention is a separate payment-term figure
    // tracked alongside, not a discount). See computeRetentionAmount below.
    const retentionPercent = input.retentionPercent ?? 0
    const retentionAmount = computeRetentionAmount(grandTotal, retentionPercent)

    const [invoice] = await db.insert(erpPurchaseInvoices).values({
      orgId: ctx.orgId, supplierId: input.supplierId, purchaseOrderId: input.purchaseOrderId, invoiceNumber: Number(maxNumber) + 1,
      postingDate: input.postingDate, dueDate: input.dueDate, currencyId, exchangeRate: exchangeRate.toString(), companyId,
      subtotal: subtotal.toString(), taxAmount: taxAmount.toString(), grandTotal: grandTotal.toString(), outstandingAmount: grandTotal.toString(),
      retentionPercent: retentionPercent.toString(), retentionAmount: retentionAmount.toString(),
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
// FI-AP-007 (SAP-equivalent "Subcontractor Retention Summary", sap_mapping.
// sqlite gap analysis, BUILD_NEW/HIGH, Owner directive 2026-07-30):
// construction contracts commonly withhold a retention % from each
// subcontractor bill, released later (partially at practical completion,
// fully after the defects-liability period). This summarizes, per
// subcontractor, how much has been withheld to date, how much has been
// released, and how much remains held.
//
// IMPORTANT, independently re-verified 2026-07-30: this row's own gap_notes
// cited a function (applyRetention) and file (construction-valuation-
// service.ts) plus a constructionInterimBills.retentionAmount field that
// were flagged earlier the same day as fabricated/non-existent evidence.
// Re-checked directly against this branch's own base -- all three now DO
// genuinely exist (merged via PRs earlier in
// PROJEXA_ERP_END_TO_END_REQUIREMENT_ANALYSIS_GAP_FILL_AND_IMPLEMENTATION),
// but only for AR/client-billing retention (constructionInterimBills,
// generateInterimBill) -- that is a different table, a different service
// file, and a different party (the client withholding from what they owe
// the firm) than this report's actual subject (a subcontractor being paid
// by the firm, erp_purchase_invoices/erp_suppliers). erp_purchase_invoices
// had ZERO retention tracking before this change -- confirmed by grep
// across schema.ts/services/*.ts/engines/*.ts. This is a genuine, real
// BUILD_NEW gap on the AP side; the gap_notes' citations just happened to
// coincidentally name real code that exists for the wrong (AR) side. This
// should be corrected in sap_mapping.sqlite's gap_notes for this row --
// flagged, not fixed here (out of this PR's scope).
//
// Design mirrors constructionInterimBills' real behavior, not just its
// header comments: retention is tracked as a pure informational/reporting
// snapshot on the invoice (retentionPercent/retentionAmount, computed and
// snapshotted at creation time, same discipline as tdsAmount's snapshot-at-
// submit-time above) and is deliberately NOT posted to a separate
// "retention payable" GL control account, nor excluded from the invoice's
// own grandTotal/outstandingAmount/journal entry -- exactly like
// generateInterimBill never adjusts erpSalesInvoices' own totals for
// retention either. A dedicated retention-payable GL account is a real,
// separate feature (this schema has no such account type/control-account
// resolution today, on either the AP or AR side) -- deliberately not
// invented here, matching the "don't over-build" scope for this report.
// ============================================================

/**
 * Pure. Kept as an independent duplicate of construction-valuation-
 * service.ts's applyRetention (same rounding convention: retention computed
 * on the gross amount, rounded to 2dp), rather than a cross-import, since
 * that file already imports FROM this one (createSalesInvoice) -- importing
 * back would be circular. erp-invoicing-service.ts is platform-wide/
 * non-construction-specific, so it owns its own small pure helper here.
 */
export function computeRetentionAmount(grandTotal: number, retentionPercent: number): number {
  return Math.round(grandTotal * (retentionPercent / 100) * 100) / 100
}

export type RetentionBearingInvoice = {
  id: string; invoiceNumber: number; supplierId: string; supplierName: string | null
  postingDate: string; grandTotal: string | number; status: string
  retentionPercent: string | number; retentionAmount: string | number; retentionReleasedAmount: string | number
}

/**
 * Pure core: filters to retention-bearing bills, computes each one's
 * still-held amount, and groups by subcontractor (supplier) with running
 * totals -- independently unit-testable without a DB, same convention as
 * this file's computePaymentProposal (FI-AP-005, above).
 */
export function computeRetentionPosition(invoices: RetentionBearingInvoice[]) {
  const bearing = invoices.filter((inv) => Number(inv.retentionAmount) > 0.001)

  const bills = bearing
    .map((inv) => {
      const retentionAmount = Number(inv.retentionAmount)
      const retentionReleased = Number(inv.retentionReleasedAmount)
      const retentionHeld = Math.round((retentionAmount - retentionReleased) * 100) / 100
      return {
        invoiceId: inv.id, invoiceNumber: inv.invoiceNumber,
        supplierId: inv.supplierId, supplierName: inv.supplierName,
        postingDate: inv.postingDate, grandTotal: inv.grandTotal, status: inv.status,
        retentionPercent: inv.retentionPercent, retentionAmount, retentionReleased, retentionHeld,
      }
    })
    .sort((a, b) => b.retentionHeld - a.retentionHeld)

  const bySupplier = new Map<string, { supplierId: string; supplierName: string | null; totalRetentionAmount: number; totalRetentionReleased: number; totalRetentionHeld: number; bills: typeof bills }>()
  for (const bill of bills) {
    if (!bySupplier.has(bill.supplierId)) {
      bySupplier.set(bill.supplierId, { supplierId: bill.supplierId, supplierName: bill.supplierName, totalRetentionAmount: 0, totalRetentionReleased: 0, totalRetentionHeld: 0, bills: [] })
    }
    const group = bySupplier.get(bill.supplierId)!
    group.bills.push(bill)
    group.totalRetentionAmount = Math.round((group.totalRetentionAmount + bill.retentionAmount) * 100) / 100
    group.totalRetentionReleased = Math.round((group.totalRetentionReleased + bill.retentionReleased) * 100) / 100
    group.totalRetentionHeld = Math.round((group.totalRetentionHeld + bill.retentionHeld) * 100) / 100
  }

  const subcontractors = [...bySupplier.values()].sort((a, b) => b.totalRetentionHeld - a.totalRetentionHeld)
  const totalRetentionWithheld = Math.round(subcontractors.reduce((sum, s) => sum + s.totalRetentionAmount, 0) * 100) / 100
  const totalRetentionReleased = Math.round(subcontractors.reduce((sum, s) => sum + s.totalRetentionReleased, 0) * 100) / 100
  const totalRetentionHeld = Math.round(subcontractors.reduce((sum, s) => sum + s.totalRetentionHeld, 0) * 100) / 100

  return { subcontractorCount: subcontractors.length, billCount: bills.length, totalRetentionWithheld, totalRetentionReleased, totalRetentionHeld, subcontractors }
}

/**
 * FI-AP-007 real report: every retention-bearing erp_purchase_invoices row
 * (retentionAmount > 0) for this org, optionally scoped to one supplier,
 * grouped by subcontractor. Honest, disclosed gap: this groups by
 * supplier (the real party retention is withheld from), not by "contract" --
 * erp_contracts (Wave 71) is Sales/customer-side only (contract.customerId),
 * there is no real subcontractor-contract table in this schema to group by
 * instead. A supplier working multiple projects is only discoverable per-bill
 * (each bill's own project isn't tracked on erp_purchase_invoices either --
 * a further, separate gap, not fabricated around here).
 */
export async function subcontractorRetentionSummary(ctx: { orgId: string }, filters: { supplierId?: string } = {}) {
  await requireErpEnabled(ctx.orgId)
  return withTenantContext({ orgId: ctx.orgId }, async (db) => {
    const invoices = await db.query.erpPurchaseInvoices.findMany({
      where: and(
        eq(erpPurchaseInvoices.orgId, ctx.orgId),
        gt(erpPurchaseInvoices.retentionAmount, "0"),
        ...(filters.supplierId ? [eq(erpPurchaseInvoices.supplierId, filters.supplierId)] : []),
      ),
      with: { supplier: true },
    })

    const bearing: RetentionBearingInvoice[] = invoices.map((inv) => ({
      id: inv.id, invoiceNumber: inv.invoiceNumber, supplierId: inv.supplierId, supplierName: inv.supplier?.supplierName ?? null,
      postingDate: inv.postingDate, grandTotal: inv.grandTotal, status: inv.status,
      retentionPercent: inv.retentionPercent, retentionAmount: inv.retentionAmount, retentionReleasedAmount: inv.retentionReleasedAmount,
    }))

    return computeRetentionPosition(bearing)
  })
}

/**
 * The real "release retention" action -- records that some or all of one
 * bill's still-held retention is now released back to the subcontractor.
 * Deliberately NOT a full retention-release-approval-workflow (no analogous
 * multi-stage approval pattern exists anywhere else in this codebase to
 * follow, per this PR's own scope) -- just the real, minimal state change:
 * bump retentionReleasedAmount, validated against what's actually still
 * held. No journal entry is posted (consistent with retention never having
 * been posted to a separate GL line at creation time either, see this
 * section's header comment) -- releasing it does not itself move cash; an
 * actual payment of the released amount uses this codebase's normal AP
 * payment path once one exists (recordSalesInvoicePayment's AP-side
 * equivalent does not exist yet -- a separate, real, pre-existing gap, not
 * one this PR invents or silently works around).
 */
export async function releaseSubcontractorRetention(
  ctx: RecordPaymentActorCtx,
  invoiceId: string,
  input: { amount: number }
) {
  await requireErpEnabled(ctx.orgId)
  if (!input.amount || input.amount <= 0) throw new ServiceError("amount must be positive", 400)

  return withTenantContext({ orgId: ctx.orgId, userId: ctx.userId }, async (db) => {
    const invoice = await db.query.erpPurchaseInvoices.findFirst({ where: and(eq(erpPurchaseInvoices.id, invoiceId), eq(erpPurchaseInvoices.orgId, ctx.orgId)) })
    if (!invoice) throw new ServiceError("Purchase invoice not found", 404)
    if (invoice.status === "draft") throw new ServiceError("Cannot release retention on a draft invoice -- submit it first", 409)

    const retentionAmount = Number(invoice.retentionAmount)
    const alreadyReleased = Number(invoice.retentionReleasedAmount)
    const stillHeld = Math.round((retentionAmount - alreadyReleased) * 100) / 100
    if (stillHeld <= 0) throw new ServiceError("This invoice has no retention amount, or it has already been fully released", 409)
    if (input.amount > stillHeld + 0.01) {
      throw new ServiceError(`Release amount (${input.amount}) exceeds the retention still held (${stillHeld})`, 400)
    }

    const newReleased = Math.round((alreadyReleased + input.amount) * 100) / 100
    const [updated] = await db.update(erpPurchaseInvoices)
      .set({ retentionReleasedAmount: newReleased.toString() })
      .where(eq(erpPurchaseInvoices.id, invoiceId))
      .returning()

    await logActivity(
      ctx.dbUser
        ? { tx: db, orgId: ctx.orgId, dbUser: ctx.dbUser, action: "erp_purchase_invoice.retention_released", entityType: "erp_purchase_invoice", entityId: invoiceId, details: JSON.stringify({ amountReleased: input.amount, newReleasedTotal: newReleased, retentionAmount }) }
        : { tx: db, orgId: ctx.orgId, apiKey: ctx.apiKey, action: "erp_purchase_invoice.retention_released", entityType: "erp_purchase_invoice", entityId: invoiceId, details: JSON.stringify({ amountReleased: input.amount, newReleasedTotal: newReleased, retentionAmount }) }
    )
    return updated
  })
}

// ─── FI-AP-006: Vendor Payment History / Payment Behavior Analysis ────────
// SAP gap analysis (sap_mapping.sqlite/sap_reports, id='FI-AP-006', module
// FI-AP, priority MEDIUM, veridian_mapping_status='BUILD_NEW'). The row's
// own veridian_gap_notes says this "mirrors the equally-absent FI-AR-006"
// (Customer Payment Behavior / DSO) -- as of this writing FI-AR-006 is a
// separate, still-OPEN sibling PR (#645, not yet merged into main), so the
// functions below are a fresh implementation that mirrors that PR's
// calculation SHAPE (days-to-pay / a DSO-style ratio / a fixed reliability
// classification) adapted customer->vendor and DSO->DPO (Days Payable
// Outstanding), rather than importing its not-yet-merged code directly --
// importing across two concurrently-open branches touching the same file
// would create a guaranteed rebase collision the moment either merges
// first. Distinct top-level names (vendorDaysToPay/computeDpoFormula/
// classifyVendorPaymentReliability/vendorPaymentBehaviorReport, vs. that
// PR's daysToPay/computeDsoFormula/classifyPaymentReliability/
// customerPaymentBehaviorReport) are deliberate for the same reason.
//
// Real finding, genuinely DIFFERENT from the AR side (checked directly
// against this repo, not assumed): the AR side has TWO independent real
// payment-recording paths (recordSalesInvoicePayment's direct posting, and
// the erp_payment_entries approval workflow). The AP/vendor side only has
// ONE: erp_payment_entries with paymentType='pay',
// invoiceType='purchase_invoice' (see erp-payment-entries-service.ts).
// There is no recordPurchaseInvoicePayment direct-posting equivalent
// anywhere in this codebase -- releaseSubcontractorRetention's own header
// comment above already flags this same gap ("recordSalesInvoicePayment's
// AP-side equivalent does not exist yet"). So this report reads ONLY the
// erp_payment_entries path, not a UNION of two.
//
// Honest, VERIFIED gap (checked directly via the Supabase MCP against the
// live project pcrjmlpuqsbocqfwoxod, 2026-07-30, real SELECTs, not
// assumed): this org has 1 real 'paid' purchase invoice (demo_pi_2001,
// supplier SteelCorp India Ltd., posting_date=2026-05-15,
// due_date=2026-06-14, a real 30-day term, grand_total=20060) and 2
// 'overdue' + 2 'submitted' invoices, but erp_payment_entries has ZERO
// rows total (of ANY invoice_type/status) and erp_journal_entries has ZERO
// rows with reference_type IN ('purchase_invoice_payment', 'payment_entry')
// anywhere in the live database -- the 'paid' status on demo_pi_2001 was
// set directly by a seed script, bypassing the only real payment-recording
// path. avgDaysToPay/paymentReliability are therefore honestly "n/a"/
// "unknown" for every supplier today (never fabricated as 0 or silently
// hidden), same disclosure as FI-AR-006's own honest-gap writeup.
//
// category='software_analysis' (not 'software_report'): the core
// deliverable is a calculated ratio/index (DPO), matching the SPI/CPI
// precedent in report-taxonomy.ts's CATEGORY 2 -- same classification
// FI-AR-006 used for the identically-shaped DSO metric.

/** Real days from a real purchase invoice postingDate to a real discovered payment-completion date. Not clamped to >= 0 -- a negative result would mean the payment predates the invoice, a real data bug that should stay visible rather than be hidden by clamping. */
export function vendorDaysToPay(postingDate: string, paymentDate: string): number {
  return Math.round((new Date(paymentDate).getTime() - new Date(postingDate).getTime()) / 86400000)
}

export type VendorPaymentReliability = "consistently_early" | "on_time" | "late" | "chronically_late"

/**
 * Classifies how reliably the firm pays a given vendor by comparing real
 * average days-to-pay against the vendor's real average agreed credit
 * period (derived per-invoice from dueDate - postingDate when dueDate is
 * set, falling back to erpSuppliers.defaultPaymentTermsDays -- see
 * caller). Fixed, honest thresholds (this schema has no configurable
 * tolerance-band concept) -- same bands as FI-AR-006's
 * classifyPaymentReliability, since "5 days early/late is still on-time,
 * 30+ days late is chronic" is a symmetric judgment call, not something
 * that should differ by AR vs AP direction without a real reason to.
 */
export function classifyVendorPaymentReliability(avgDaysToPay: number, avgCreditDays: number): VendorPaymentReliability {
  const delta = avgDaysToPay - avgCreditDays
  if (delta <= -5) return "consistently_early"
  if (delta <= 5) return "on_time"
  if (delta <= 30) return "late"
  return "chronically_late"
}

/**
 * Days Payable Outstanding (DPO) -- the AP-side mirror of FI-AR-006's DSO
 * formula (SAP FBL1N-adjacent): (total outstanding AP / total credit
 * purchases in the period) * period length in days. A POINT-IN-TIME
 * aggregate, distinct from (and complementary to) the per-supplier average
 * real days-to-pay above -- this can be computed even for a supplier with
 * zero fully-paid invoices yet, as long as they have real outstanding AP
 * and real credit purchases in the period. Returns null (never 0 or
 * Infinity) when totalCreditPurchasesInPeriod is 0 -- an honest "cannot
 * compute", not a misleading number.
 */
export function computeDpoFormula(totalOutstandingAP: number, totalCreditPurchasesInPeriod: number, periodDays: number): number | null {
  if (totalCreditPurchasesInPeriod <= 0) return null
  return (totalOutstandingAP / totalCreditPurchasesInPeriod) * periodDays
}

/**
 * Vendor Payment History / Payment Behavior Analysis (FI-AP-006): per real
 * supplier, a historical BEHAVIOR metric across ALL their invoices (paid
 * and unpaid) -- real average days-to-pay for invoices with a discoverable
 * real payment-completion date (via the erp_payment_entries approval
 * workflow, the only real payment-recording path on this side -- see
 * header), the DPO formula, and a fixed payment-reliability classification
 * derived from comparing the two against the supplier's real agreed
 * terms. periodDays (default 90) bounds both the DPO formula's "credit
 * purchases in period" window and the as-of date for outstanding AP;
 * asOfDate defaults to today.
 */
export async function vendorPaymentBehaviorReport(
  ctx: { orgId: string },
  params: { periodDays?: number; asOfDate?: string } = {}
) {
  await requireErpEnabled(ctx.orgId)
  const periodDays = params.periodDays && params.periodDays > 0 ? params.periodDays : 90
  const asOf = params.asOfDate ?? new Date().toISOString().slice(0, 10)
  const asOfMs = new Date(asOf).getTime()
  const periodStartMs = asOfMs - periodDays * 86400000

  return withTenantContext({ orgId: ctx.orgId }, async (db) => {
    const invoices = await db.query.erpPurchaseInvoices.findMany({
      where: and(eq(erpPurchaseInvoices.orgId, ctx.orgId), inArray(erpPurchaseInvoices.status, ["submitted", "partially_paid", "overdue", "paid"])),
      with: { supplier: true },
    })

    // Real payment-completion dates -- the ONLY real recording path on the
    // AP side (see header): erp_payment_entries, paymentType='pay',
    // invoiceType='purchase_invoice', status='approved'.
    const approvedPaymentEntries = await db
      .select({ invoiceId: erpPaymentEntries.invoiceId, lastPostingDate: sql<string>`max(${erpPaymentEntries.postingDate})` })
      .from(erpPaymentEntries)
      .where(and(
        eq(erpPaymentEntries.orgId, ctx.orgId),
        eq(erpPaymentEntries.invoiceType, "purchase_invoice"),
        eq(erpPaymentEntries.paymentType, "pay"),
        eq(erpPaymentEntries.status, "approved"),
      ))
      .groupBy(erpPaymentEntries.invoiceId)

    const paymentDateByInvoiceId = new Map<string, string>()
    for (const row of approvedPaymentEntries) {
      if (!row.invoiceId || !row.lastPostingDate) continue
      paymentDateByInvoiceId.set(row.invoiceId, row.lastPostingDate)
    }

    type SupplierAgg = {
      supplierId: string; supplierName: string; defaultPaymentTermsDays: number | null
      invoiceCount: number
      paidWithKnownDateCount: number; paidMissingDateCount: number
      sumDaysToPay: number
      sumCreditDays: number; creditDaysCount: number
      outstandingAP: number; creditPurchasesInPeriod: number
    }
    const bySupplier = new Map<string, SupplierAgg>()

    for (const inv of invoices) {
      const supplierId = inv.supplierId
      if (!bySupplier.has(supplierId)) {
        bySupplier.set(supplierId, {
          supplierId, supplierName: inv.supplier?.supplierName ?? "Unknown",
          defaultPaymentTermsDays: inv.supplier?.defaultPaymentTermsDays ?? null,
          invoiceCount: 0, paidWithKnownDateCount: 0, paidMissingDateCount: 0,
          sumDaysToPay: 0, sumCreditDays: 0, creditDaysCount: 0, outstandingAP: 0, creditPurchasesInPeriod: 0,
        })
      }
      const agg = bySupplier.get(supplierId)!
      agg.invoiceCount += 1
      agg.outstandingAP += Number(inv.outstandingAmount)

      const postingMs = new Date(inv.postingDate).getTime()
      if (postingMs >= periodStartMs && postingMs <= asOfMs) agg.creditPurchasesInPeriod += Number(inv.grandTotal)

      if (inv.dueDate) {
        agg.sumCreditDays += vendorDaysToPay(inv.postingDate, inv.dueDate)
        agg.creditDaysCount += 1
      }

      if (inv.status === "paid") {
        const paymentDate = paymentDateByInvoiceId.get(inv.id)
        if (paymentDate) {
          agg.sumDaysToPay += vendorDaysToPay(inv.postingDate, paymentDate)
          agg.paidWithKnownDateCount += 1
        } else {
          agg.paidMissingDateCount += 1
        }
      }
    }

    const suppliers = Array.from(bySupplier.values())
      .map((agg) => {
        const avgDaysToPay = agg.paidWithKnownDateCount > 0 ? agg.sumDaysToPay / agg.paidWithKnownDateCount : null
        const avgCreditDays = agg.creditDaysCount > 0 ? agg.sumCreditDays / agg.creditDaysCount : (agg.defaultPaymentTermsDays ?? 30)
        const dpo = computeDpoFormula(agg.outstandingAP, agg.creditPurchasesInPeriod, periodDays)
        const paymentReliability = avgDaysToPay !== null ? classifyVendorPaymentReliability(avgDaysToPay, avgCreditDays) : null
        return {
          supplierId: agg.supplierId, supplierName: agg.supplierName,
          invoiceCount: agg.invoiceCount,
          paidInvoiceCountWithKnownPaymentDate: agg.paidWithKnownDateCount,
          paidInvoiceCountMissingPaymentDate: agg.paidMissingDateCount,
          avgDaysToPay: avgDaysToPay !== null ? Math.round(avgDaysToPay * 10) / 10 : null,
          avgCreditDays: Math.round(avgCreditDays * 10) / 10,
          dpo: dpo !== null ? Math.round(dpo * 10) / 10 : null,
          outstandingAP: Math.round(agg.outstandingAP * 100) / 100,
          creditPurchasesInPeriod: Math.round(agg.creditPurchasesInPeriod * 100) / 100,
          paymentReliability,
          dataGap: agg.paidWithKnownDateCount === 0 && agg.paidMissingDateCount > 0
            ? "Every 'paid' invoice for this supplier is missing a real, discoverable payment-completion date (the erp_payment_entries approval workflow was never used for it) -- avgDaysToPay/paymentReliability cannot be computed honestly and are null, not fabricated."
            : null,
        }
      })
      .sort((a, b) => (b.dpo ?? 0) - (a.dpo ?? 0))

    return { asOfDate: asOf, periodDays, suppliers }
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

// ─── FI-AR-004: Dunning List ───────────────────────────────────────────────
// SAP F150's dunning run groups overdue customer invoices by dunning level
// (how many reminder cycles have passed) to decide who gets the next
// payment-reminder letter. This schema had zero dunning-level/reminder
// concept before this wave (confirmed by reading erpSalesInvoices in
// schema.ts directly, not assumed) -- genuinely distinct from arAgingReport
// above, which is a pure snapshot with no workflow state. dunningLevel/
// lastDunningSentAt (schema.ts) are the new, minimal, additive columns;
// dunningList() below reuses arAgingReport's own bucket boundaries for
// consistency but drops the "current" bucket (a dunning run only concerns
// invoices actually past due) and layers dunning-workflow state on top.
// recordDunningAction() is the only mutation -- it does NOT send an actual
// letter/email (no such channel exists in this codebase), matching the
// same verification-boundary honesty as this file's e-invoicing IRN
// fields: the mechanism and tracking are real; actual delivery is a human/
// external-system action this records after the fact.

/** Dunning bucket for a strictly-overdue invoice (daysOverdue must be > 0). Same day boundaries as arAgingReport for consistency. */
export function dunningBucketForDaysOverdue(daysOverdue: number): "1-30" | "31-60" | "61-90" | "90+" {
  if (daysOverdue <= 30) return "1-30"
  if (daysOverdue <= 60) return "31-60"
  if (daysOverdue <= 90) return "61-90"
  return "90+"
}

/** dunningLevel integer -> label, matching schema.ts's column comment. */
export const DUNNING_LEVEL_LABELS: Record<number, string> = {
  0: "No reminder sent",
  1: "Friendly Reminder",
  2: "Formal Notice",
  3: "Final Demand",
}

/**
 * Suggests the dunning level an overdue invoice's aging bucket implies --
 * SAP F150's own dunning-level-by-age idea, simplified to 3 levels (this
 * schema has no per-org configurable dunning procedure like SAP's, so this
 * is a fixed, honest default, not a configurable rule engine). 90+ maxes
 * out at level 3 (Final Demand) rather than inventing a 4th tier no one
 * asked for.
 */
export function suggestedDunningLevel(bucket: "1-30" | "31-60" | "61-90" | "90+"): 1 | 2 | 3 {
  if (bucket === "1-30") return 1
  if (bucket === "31-60") return 2
  return 3
}

/**
 * Dunning List (FI-AR-004): every overdue (daysOverdue > 0), non-fully-paid
 * sales invoice, bucketed by days past due (1-30/31-60/61-90/90+, dropping
 * arAgingReport's "current" bucket since dunning only concerns invoices
 * actually past due), each row carrying its real dunningLevel/
 * lastDunningSentAt plus a suggestedDunningLevel derived from its bucket --
 * `needsAction` flags rows where the suggested level has moved past what
 * was actually last sent, so a collections user can see at a glance who's
 * due for the next reminder cycle without recomputing it by hand. This is
 * the "surface the list" v1 deliverable -- no letter/email is generated or
 * sent by this function.
 */
export async function dunningList(ctx: { orgId: string }, asOfDate?: string) {
  await requireErpEnabled(ctx.orgId)
  const asOf = asOfDate ?? new Date().toISOString().slice(0, 10)
  const asOfMs = new Date(asOf).getTime()

  return withTenantContext({ orgId: ctx.orgId }, async (db) => {
    const invoices = await db.query.erpSalesInvoices.findMany({
      where: and(eq(erpSalesInvoices.orgId, ctx.orgId), inArray(erpSalesInvoices.status, ["submitted", "partially_paid", "overdue"])),
      with: { customer: true },
    })

    const buckets = { d1_30: 0, d31_60: 0, d61_90: 0, d90Plus: 0 }
    const counts = { d1_30: 0, d31_60: 0, d61_90: 0, d90Plus: 0 }
    const rows = invoices
      .filter((inv) => Number(inv.outstandingAmount) > 0.01)
      .map((inv) => {
        const dueMs = new Date(inv.dueDate ?? inv.postingDate).getTime()
        return { inv, daysOverdue: Math.floor((asOfMs - dueMs) / 86400000), outstanding: Number(inv.outstandingAmount) }
      })
      .filter(({ daysOverdue }) => daysOverdue > 0)
      .map(({ inv, daysOverdue, outstanding }) => {
        const bucket = dunningBucketForDaysOverdue(daysOverdue)
        const suggested = suggestedDunningLevel(bucket)
        const currentLevel = inv.dunningLevel ?? 0
        if (bucket === "1-30") { buckets.d1_30 += outstanding; counts.d1_30 += 1 }
        else if (bucket === "31-60") { buckets.d31_60 += outstanding; counts.d31_60 += 1 }
        else if (bucket === "61-90") { buckets.d61_90 += outstanding; counts.d61_90 += 1 }
        else { buckets.d90Plus += outstanding; counts.d90Plus += 1 }
        return {
          invoiceId: inv.id, invoiceNumber: inv.invoiceNumber, customerId: inv.customerId,
          customerName: inv.customer?.customerName ?? null, dueDate: inv.dueDate, postingDate: inv.postingDate,
          outstandingAmount: inv.outstandingAmount, daysOverdue, bucket,
          dunningLevel: currentLevel, dunningLevelLabel: DUNNING_LEVEL_LABELS[currentLevel] ?? String(currentLevel),
          lastDunningSentAt: inv.lastDunningSentAt, suggestedDunningLevel: suggested,
          needsAction: suggested > currentLevel,
        }
      })
      .sort((a, b) => b.daysOverdue - a.daysOverdue)

    const totalOutstanding = buckets.d1_30 + buckets.d31_60 + buckets.d61_90 + buckets.d90Plus
    return { asOfDate: asOf, buckets, counts, totalOutstanding, invoices: rows }
  })
}

/**
 * Records that a dunning notice (Friendly Reminder / Formal Notice / Final
 * Demand) was sent for an invoice -- the minimal reminder-tracking write
 * this report needs to be more than a frozen snapshot. Does NOT send an
 * actual letter/email itself; see this section's header comment.
 */
export async function recordDunningAction(ctx: RecordPaymentActorCtx, invoiceId: string, level: number) {
  await requireErpEnabled(ctx.orgId)
  if (!Number.isInteger(level) || level < 0 || level > 3) {
    throw new ServiceError("level must be an integer 0-3 (0=none, 1=Friendly Reminder, 2=Formal Notice, 3=Final Demand)", 400)
  }

  return withTenantContext({ orgId: ctx.orgId, userId: ctx.userId }, async (db) => {
    const invoice = await db.query.erpSalesInvoices.findFirst({ where: and(eq(erpSalesInvoices.id, invoiceId), eq(erpSalesInvoices.orgId, ctx.orgId)) })
    if (!invoice) throw new ServiceError("Sales invoice not found", 404)
    if (!["submitted", "partially_paid", "overdue"].includes(invoice.status)) throw new ServiceError(`Cannot record a dunning action against an invoice in '${invoice.status}' status`, 409)
    if (Number(invoice.outstandingAmount) <= 0.01) throw new ServiceError("Invoice has no outstanding balance -- nothing to dun", 409)

    const [updated] = await db.update(erpSalesInvoices)
      .set({ dunningLevel: level, lastDunningSentAt: new Date() })
      .where(eq(erpSalesInvoices.id, invoiceId)).returning()

    await logActivity(
      ctx.dbUser
        ? { tx: db, orgId: ctx.orgId, dbUser: ctx.dbUser, action: "erp_sales_invoice.dunning_recorded", entityType: "erp_sales_invoice", entityId: invoiceId, details: JSON.stringify({ level }) }
        : { tx: db, orgId: ctx.orgId, apiKey: ctx.apiKey, action: "erp_sales_invoice.dunning_recorded", entityType: "erp_sales_invoice", entityId: invoiceId, details: JSON.stringify({ level }) }
    )
    return updated
  })
}

// ─── FI-AR-006: Customer Payment Behavior / DSO ────────────────────────────
// SAP gap analysis (sap_mapping.sqlite/sap_reports, id='FI-AR-006', module
// FI, priority HIGH, veridian_mapping_status='BUILD_NEW' -- re-verified
// directly against this repo and the live Supabase project
// (pcrjmlpuqsbocqfwoxod), not trusted blindly from the gap-analysis file's
// own citations (a same-day spot-check found at least one other row,
// FI-AP-007, with a stale/fabricated citation).
//
// Genuinely distinct from the two functions above: arAgingReport is a
// point-in-time snapshot of currently-outstanding invoices only (it never
// looks at a 'paid' invoice); dunningList is an active overdue-workflow
// tool. Neither has any historical concept of "how fast did this customer
// actually pay in the past." This is the only one of the three that reads
// PAID invoices' real payment-completion dates.
//
// Real finding: this schema has TWO independent, real code paths that can
// bring a sales invoice to status='paid', and NEITHER writes a `paidDate`
// column directly onto erp_sales_invoices --
//   1. recordSalesInvoicePayment (above): posts a journal entry directly,
//      erp_journal_entries.reference_type='sales_invoice_payment',
//      reference_id=invoice.id, posting_date=the real payment date. Does
//      NOT create an erp_payment_entries row.
//   2. erp-payment-entries-service.ts's approval workflow
//      (createPaymentEntry -> submitPaymentEntry -> decidePaymentEntry):
//      posts its OWN journal entry (reference_type='payment_entry') AND
//      leaves a real row on erp_payment_entries itself with
//      invoice_type='sales_invoice'/invoice_id/posting_date/status='approved'.
// A fully-paid invoice's real payment-completion date can only be found by
// checking BOTH tables (an invoice may have had multiple partial payments
// across either or both paths; the LATEST posting_date among all of them
// is the date it actually reached zero outstanding) -- this report UNIONs
// both rather than assuming one, since assuming only path 1 (the more
// "obvious" one, since it lives in this same file) would silently miss
// every invoice paid via the approval workflow instead.
//
// Honest, VERIFIED gap (checked directly via Supabase MCP against the live
// project pcrjmlpuqsbocqfwoxod, the same day this PR was built, real SELECTs, not assumed):
// this org has 5 real invoices at status='paid' and 6 at
// 'partially_paid', but erp_payment_entries has ZERO rows total, and
// erp_journal_entries has ZERO rows with reference_type IN
// ('sales_invoice_payment', 'payment_entry') anywhere in the live
// database. Every one of those paid/partially_paid statuses was set
// directly by a seed script, bypassing both real payment-recording code
// paths -- so as of this PR, NO organisation in the live database has a
// single real, discoverable payment-completion date. The code below is
// real and correct (it will compute a genuine days-to-pay/DSO the moment
// any org starts using either real payment-recording path), but its
// real-world usefulness TODAY is honestly zero: every currently-'paid'
// invoice reports paymentDateSource: "unavailable" and is excluded from
// the average (never fabricated as 0 or silently dropped from the
// customer's row entirely). See this PR's description for the same
// disclosure.

/** Real days from a real invoice posting_date to a real discovered payment-completion date. Not clamped to >= 0 -- a negative result would mean the payment predates the invoice, a real data bug that should stay visible rather than be hidden by clamping. */
export function daysToPay(postingDate: string, paymentDate: string): number {
  return Math.round((new Date(paymentDate).getTime() - new Date(postingDate).getTime()) / 86400000)
}

export type PaymentReliability = "consistently_early" | "on_time" | "late" | "chronically_late"

/**
 * Classifies a customer's payment reliability by comparing their real
 * average days-to-pay against their real average agreed credit period
 * (derived per-invoice from dueDate - postingDate when dueDate is set,
 * falling back to erp_customers.defaultPaymentTermsDays -- see caller).
 * Fixed, honest thresholds (this schema has no configurable tolerance-band
 * concept), same "fixed default, not a rule engine" precedent as
 * suggestedDunningLevel above.
 */
export function classifyPaymentReliability(avgDaysToPay: number, avgCreditDays: number): PaymentReliability {
  const delta = avgDaysToPay - avgCreditDays
  if (delta <= -5) return "consistently_early"
  if (delta <= 5) return "on_time"
  if (delta <= 30) return "late"
  return "chronically_late"
}

/**
 * Industry-standard aggregate DSO -- the count-back/balance-sheet formula
 * (SAP FBL5N-adjacent): (total outstanding AR / total credit sales in the
 * period) * period length in days. A POINT-IN-TIME aggregate, distinct
 * from (and complementary to) the per-customer average real days-to-pay
 * above -- this can be computed even for a customer with zero fully-paid
 * invoices yet (as long as they have real outstanding AR and real credit
 * sales in the period), while average-days-to-pay needs at least one real
 * paid invoice with a discoverable payment date. Returns null (never 0 or
 * Infinity) when totalCreditSalesInPeriod is 0 -- an honest "cannot
 * compute", not a misleading number.
 */
export function computeDsoFormula(totalOutstandingAR: number, totalCreditSalesInPeriod: number, periodDays: number): number | null {
  if (totalCreditSalesInPeriod <= 0) return null
  return (totalOutstandingAR / totalCreditSalesInPeriod) * periodDays
}

/**
 * Customer Payment Behavior / DSO (FI-AR-006): per real customer, a
 * historical BEHAVIOR metric across ALL their invoices (paid and unpaid) --
 * real average days-to-pay for invoices that have actually been paid (both
 * real payment-recording paths UNIONed, see header above), the
 * industry-standard aggregate DSO formula, and a payment-reliability
 * classification derived from comparing the two. periodDays (default 90)
 * bounds both the DSO formula's "credit sales in period" window and the
 * as-of date for outstanding AR; asOfDate defaults to today.
 */
export async function customerPaymentBehaviorReport(
  ctx: { orgId: string },
  params: { periodDays?: number; asOfDate?: string } = {}
) {
  await requireErpEnabled(ctx.orgId)
  const periodDays = params.periodDays && params.periodDays > 0 ? params.periodDays : 90
  const asOf = params.asOfDate ?? new Date().toISOString().slice(0, 10)
  const asOfMs = new Date(asOf).getTime()
  const periodStartMs = asOfMs - periodDays * 86400000

  return withTenantContext({ orgId: ctx.orgId }, async (db) => {
    const invoices = await db.query.erpSalesInvoices.findMany({
      where: and(eq(erpSalesInvoices.orgId, ctx.orgId), inArray(erpSalesInvoices.status, ["submitted", "partially_paid", "overdue", "paid"])),
      with: { customer: true },
    })

    // Real payment-completion dates -- UNION of both real recording paths (see header).
    const directPayments = await db
      .select({ invoiceId: erpJournalEntries.referenceId, lastPostingDate: sql<string>`max(${erpJournalEntries.postingDate})` })
      .from(erpJournalEntries)
      .where(and(eq(erpJournalEntries.orgId, ctx.orgId), eq(erpJournalEntries.referenceType, "sales_invoice_payment")))
      .groupBy(erpJournalEntries.referenceId)

    const approvedPaymentEntries = await db
      .select({ invoiceId: erpPaymentEntries.invoiceId, lastPostingDate: sql<string>`max(${erpPaymentEntries.postingDate})` })
      .from(erpPaymentEntries)
      .where(and(eq(erpPaymentEntries.orgId, ctx.orgId), eq(erpPaymentEntries.invoiceType, "sales_invoice"), eq(erpPaymentEntries.status, "approved")))
      .groupBy(erpPaymentEntries.invoiceId)

    const paymentDateByInvoiceId = new Map<string, string>()
    for (const row of [...directPayments, ...approvedPaymentEntries]) {
      if (!row.invoiceId || !row.lastPostingDate) continue
      const existing = paymentDateByInvoiceId.get(row.invoiceId)
      if (!existing || row.lastPostingDate > existing) paymentDateByInvoiceId.set(row.invoiceId, row.lastPostingDate)
    }

    type CustomerAgg = {
      customerId: string; customerName: string; defaultPaymentTermsDays: number | null
      invoiceCount: number
      paidWithKnownDateCount: number; paidMissingDateCount: number
      sumDaysToPay: number
      sumCreditDays: number; creditDaysCount: number
      outstandingAR: number; creditSalesInPeriod: number
    }
    const byCustomer = new Map<string, CustomerAgg>()

    for (const inv of invoices) {
      const customerId = inv.customerId
      if (!byCustomer.has(customerId)) {
        byCustomer.set(customerId, {
          customerId, customerName: inv.customer?.customerName ?? "Unknown",
          defaultPaymentTermsDays: inv.customer?.defaultPaymentTermsDays ?? null,
          invoiceCount: 0, paidWithKnownDateCount: 0, paidMissingDateCount: 0,
          sumDaysToPay: 0, sumCreditDays: 0, creditDaysCount: 0, outstandingAR: 0, creditSalesInPeriod: 0,
        })
      }
      const agg = byCustomer.get(customerId)!
      agg.invoiceCount += 1
      agg.outstandingAR += Number(inv.outstandingAmount)

      const postingMs = new Date(inv.postingDate).getTime()
      if (postingMs >= periodStartMs && postingMs <= asOfMs) agg.creditSalesInPeriod += Number(inv.grandTotal)

      if (inv.dueDate) {
        agg.sumCreditDays += daysToPay(inv.postingDate, inv.dueDate)
        agg.creditDaysCount += 1
      }

      if (inv.status === "paid") {
        const paymentDate = paymentDateByInvoiceId.get(inv.id)
        if (paymentDate) {
          agg.sumDaysToPay += daysToPay(inv.postingDate, paymentDate)
          agg.paidWithKnownDateCount += 1
        } else {
          agg.paidMissingDateCount += 1
        }
      }
    }

    const customers = Array.from(byCustomer.values())
      .map((agg) => {
        const avgDaysToPay = agg.paidWithKnownDateCount > 0 ? agg.sumDaysToPay / agg.paidWithKnownDateCount : null
        const avgCreditDays = agg.creditDaysCount > 0 ? agg.sumCreditDays / agg.creditDaysCount : (agg.defaultPaymentTermsDays ?? 30)
        const dso = computeDsoFormula(agg.outstandingAR, agg.creditSalesInPeriod, periodDays)
        const paymentReliability = avgDaysToPay !== null ? classifyPaymentReliability(avgDaysToPay, avgCreditDays) : null
        return {
          customerId: agg.customerId, customerName: agg.customerName,
          invoiceCount: agg.invoiceCount,
          paidInvoiceCountWithKnownPaymentDate: agg.paidWithKnownDateCount,
          paidInvoiceCountMissingPaymentDate: agg.paidMissingDateCount,
          avgDaysToPay: avgDaysToPay !== null ? Math.round(avgDaysToPay * 10) / 10 : null,
          avgCreditDays: Math.round(avgCreditDays * 10) / 10,
          dso: dso !== null ? Math.round(dso * 10) / 10 : null,
          outstandingAR: Math.round(agg.outstandingAR * 100) / 100,
          creditSalesInPeriod: Math.round(agg.creditSalesInPeriod * 100) / 100,
          paymentReliability,
          dataGap: agg.paidWithKnownDateCount === 0 && agg.paidMissingDateCount > 0
            ? "Every 'paid' invoice for this customer is missing a real, discoverable payment-completion date (neither recordSalesInvoicePayment's direct posting nor the erp_payment_entries approval workflow was ever used) -- avgDaysToPay/paymentReliability cannot be computed honestly and are null, not fabricated."
            : null,
        }
      })
      .sort((a, b) => (b.dso ?? 0) - (a.dso ?? 0))

    return { asOfDate: asOf, periodDays, customers }
  })
}

/**
 * FI-AP-005 (SAP F110 "Payment Proposal List" equivalent, sap_mapping.sqlite
 * gap analysis, BUILD_NEW/HIGH): every vendor bill that is due or already
 * overdue as of asOfDate, grouped by vendor with a total-per-vendor, the
 * review worklist a finance user checks *before* actually paying (converting
 * the proposal into a real payment run is a separate, later feature -- this
 * is deliberately review-only, matching F110's own propose-then-run split).
 * Pure aggregation over erp_purchase_invoices' own outstandingAmount/dueDate
 * -- no new schema, mirroring arAgingReport's identical precedent for the AR
 * side (this file, above).
 *
 * Real, honest gap: SAP F110 proposals also show an early-payment cash
 * discount (e.g. "2% 10 Net 30") per line, computed from the vendor's
 * payment terms. Neither erp_suppliers nor erp_purchase_invoices has any
 * discount-percent/discount-days field -- erp_suppliers.defaultPaymentTermsDays
 * is a plain net-due-in-N-days figure, not a discount schedule. Rather than
 * fabricate a discount column with a made-up rate, this omits it entirely;
 * see this PR's description for the same note.
 *
 * Bank details (for "payment method and bank details" in the SAP concept)
 * reuse the real erp_supplier_bank_accounts row via erp-vendor-master-
 * service.ts's existing listBankAccounts() -- never the raw encrypted
 * account number, same masking that function already enforces.
 */
export type PaymentProposalBill = {
  id: string; invoiceNumber: number; supplierId: string; supplierName: string | null
  postingDate: string; dueDate: string | null; outstandingAmount: string | number; status: string
}
export type PaymentProposalBankAccount = { bankName: string; accountNumberMasked: string; ifscCode: string | null } | null

/**
 * Pure core: due/overdue computation + vendor grouping, extracted so it's
 * independently unit-testable without a DB, matching this repo's established
 * .test.ts convention (e.g. this same file's computeInvoiceTaxTotals, PR #596).
 * bankAccountsBySupplier is precomputed by the caller (a DB-touching lookup)
 * and merged in here as plain data.
 */
export function computePaymentProposal(
  bills: PaymentProposalBill[],
  asOfDate: string,
  bankAccountsBySupplier: Map<string, PaymentProposalBankAccount>,
  minAmount?: number
) {
  const asOfMs = new Date(asOfDate).getTime()

  // A payment PROPOSAL is for bills that need paying now -- due today or
  // already overdue -- not every future-dated bill still on credit terms,
  // matching F110's own "invoices due by the next payment run date" scope.
  const dueBills = bills
    .filter((inv) => Number(inv.outstandingAmount) > 0.01)
    .filter((inv) => new Date(inv.dueDate ?? inv.postingDate).getTime() <= asOfMs)
    .filter((inv) => minAmount == null || Number(inv.outstandingAmount) >= minAmount)

  const lines = dueBills
    .map((inv) => {
      const dueMs = new Date(inv.dueDate ?? inv.postingDate).getTime()
      const daysOverdue = Math.max(0, Math.floor((asOfMs - dueMs) / 86400000))
      const bankAccount = bankAccountsBySupplier.get(inv.supplierId) ?? null
      return {
        invoiceId: inv.id, invoiceNumber: inv.invoiceNumber,
        supplierId: inv.supplierId, supplierName: inv.supplierName,
        postingDate: inv.postingDate, dueDate: inv.dueDate ?? inv.postingDate,
        daysOverdue, isOverdue: daysOverdue > 0,
        outstandingAmount: inv.outstandingAmount, status: inv.status,
        bankAccount,
      }
    })
    .sort((a, b) => b.daysOverdue - a.daysOverdue)

  const bySupplier = new Map<string, { supplierId: string; supplierName: string | null; totalAmount: number; lines: typeof lines }>()
  for (const line of lines) {
    if (!bySupplier.has(line.supplierId)) bySupplier.set(line.supplierId, { supplierId: line.supplierId, supplierName: line.supplierName, totalAmount: 0, lines: [] })
    const group = bySupplier.get(line.supplierId)!
    group.lines.push(line)
    group.totalAmount += Number(line.outstandingAmount)
  }

  const suppliers = [...bySupplier.values()].sort((a, b) => b.totalAmount - a.totalAmount)
  const totalProposedAmount = suppliers.reduce((sum, s) => sum + s.totalAmount, 0)

  return { asOfDate, totalProposedAmount, supplierCount: suppliers.length, lineCount: lines.length, suppliers }
}

export async function paymentProposalList(
  ctx: { orgId: string },
  filters: { asOfDate?: string; supplierId?: string; minAmount?: number } = {}
) {
  await requireErpEnabled(ctx.orgId)
  const asOf = filters.asOfDate ?? new Date().toISOString().slice(0, 10)

  return withTenantContext({ orgId: ctx.orgId }, async (db) => {
    const invoices = await db.query.erpPurchaseInvoices.findMany({
      where: and(
        eq(erpPurchaseInvoices.orgId, ctx.orgId),
        inArray(erpPurchaseInvoices.status, ["submitted", "partially_paid", "overdue"]),
        ...(filters.supplierId ? [eq(erpPurchaseInvoices.supplierId, filters.supplierId)] : []),
      ),
      with: { supplier: true },
    })

    const bills: PaymentProposalBill[] = invoices.map((inv) => ({
      id: inv.id, invoiceNumber: inv.invoiceNumber, supplierId: inv.supplierId, supplierName: inv.supplier?.supplierName ?? null,
      postingDate: inv.postingDate, dueDate: inv.dueDate, outstandingAmount: inv.outstandingAmount, status: inv.status,
    }))

    const supplierIds = [...new Set(bills.map((inv) => inv.supplierId))]
    const bankAccountsBySupplier = new Map<string, PaymentProposalBankAccount>()
    for (const supplierId of supplierIds) {
      const accounts = await listBankAccounts({ orgId: ctx.orgId }, supplierId)
      const primary = accounts.find((a) => a.isPrimary) ?? accounts[0] ?? null
      bankAccountsBySupplier.set(supplierId, primary ? { bankName: primary.bankName, accountNumberMasked: primary.accountNumberMasked, ifscCode: primary.ifscCode } : null)
    }

    return computePaymentProposal(bills, asOf, bankAccountsBySupplier, filters.minAmount)
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
