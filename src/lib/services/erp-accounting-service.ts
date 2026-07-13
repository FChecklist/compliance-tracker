// Wave 50 (VERI ERP gap-fill): the first real service-layer consumer of
// both the accounting-period lock and the shared Approval Workflow Engine
// -- journal entries were schema-only since Wave 49, and per this
// codebase's own discipline (matching pms-issue-service.ts etc.), a
// gap-filling schema is only proven real once something actually posts
// through it. Submitting a journal entry now (a) refuses to post into a
// closed accounting period, and (b) starts an approval-workflow instance
// if the org has configured one for 'erp_journal_entry' -- if not, it
// posts immediately, matching every other module's current no-approval
// default behavior.
import { erpJournalEntries, erpJournalEntryLines, erpAccounts, erpCostCenters, erpBankAccounts, erpCurrencies, erpExchangeRates, erpCompanies, erpTaxWithholdingCategories, erpTaxWithholdingRates, erpFiscalYears, users } from "@/lib/db"
import { withTenantContext } from "@/lib/db/tenant-scoped"
import { and, eq, sql, desc, lte } from "drizzle-orm"
import { ServiceError } from "./compliance-service"
export { ServiceError }
import { isPeriodOpenForDate } from "./erp-financial-report-service"
import { startApprovalWorkflow } from "./approval-workflow-service"
import { logActivity } from "@/lib/audit"
import { requireErpEnabled } from "./erp-enablement-service"

export type ErpContext = { orgId: string; userId: string; dbUser: typeof users.$inferSelect }

export type JournalEntryLineInput = {
  accountId: string
  debit?: number
  credit?: number
  partyType?: "customer" | "supplier"
  partyId?: string
  costCenter?: string
  costCenterId?: string
  clientId?: string
  remark?: string
  // Wave 66: debit/credit above are ALWAYS the base-currency amount, and
  // remain mandatory -- this codebase never lets the caller skip supplying
  // the base amount, matching the "automate what's safely automatable,
  // require explicit input for what's genuinely ambiguous" discipline (an
  // FX rate can't be safely inferred). These 4 fields are an optional
  // transaction-currency audit trail only; the caller (UI) is responsible
  // for having already computed debit/credit = debitInCurrency/
  // creditInCurrency * exchangeRate before calling this service.
  currencyId?: string
  exchangeRate?: number
  debitInCurrency?: number
  creditInCurrency?: number
}

export type JournalEntryInput = {
  postingDate: string
  userRemark?: string
  referenceType?: string
  referenceId?: string
  companyId?: string // Wave 67: nullable -- omitted means "no company subdivision", unchanged behavior for single-entity orgs
  lines: JournalEntryLineInput[]
}

function validateBalanced(lines: JournalEntryLineInput[]): { totalDebit: number; totalCredit: number } {
  if (!lines || lines.length < 2) throw new ServiceError("A journal entry needs at least 2 lines", 400)
  const totalDebit = lines.reduce((sum, l) => sum + (l.debit ?? 0), 0)
  const totalCredit = lines.reduce((sum, l) => sum + (l.credit ?? 0), 0)
  if (Math.abs(totalDebit - totalCredit) > 0.01) {
    throw new ServiceError(`Debit (${totalDebit.toFixed(2)}) must equal credit (${totalCredit.toFixed(2)})`, 400)
  }
  return { totalDebit, totalCredit }
}

export async function listAccounts(ctx: { orgId: string }) {
  await requireErpEnabled(ctx.orgId)
  return withTenantContext({ orgId: ctx.orgId }, async (db) => {
    return db.query.erpAccounts.findMany({ where: eq(erpAccounts.orgId, ctx.orgId), orderBy: (t, { asc }) => asc(t.accountNumber) })
  })
}

export type AccountInput = {
  accountName: string
  accountNumber?: string
  rootType: "asset" | "liability" | "equity" | "income" | "expense"
  accountType?: string
  parentAccountId?: string
  isGroup?: boolean
}

export async function createAccount(ctx: ErpContext, input: AccountInput) {
  await requireErpEnabled(ctx.orgId)
  if (!input.accountName?.trim()) throw new ServiceError("accountName is required", 400)
  if (!input.rootType) throw new ServiceError("rootType is required", 400)

  return withTenantContext({ orgId: ctx.orgId, userId: ctx.userId }, async (db) => {
    const [account] = await db.insert(erpAccounts).values({
      orgId: ctx.orgId,
      accountName: input.accountName,
      accountNumber: input.accountNumber,
      rootType: input.rootType,
      accountType: input.accountType,
      parentAccountId: input.parentAccountId,
      isGroup: input.isGroup ?? false,
    }).returning()
    await logActivity({ tx: db, orgId: ctx.orgId, dbUser: ctx.dbUser, action: "erp_account.created", entityType: "erp_account", entityId: account.id })
    return account
  })
}

// Wave 52 (Tier 2 #4): upgrades the free-text costCenter tag on journal
// entry lines into a real dimension. listAccounts/createAccount above is
// the direct template.
export async function listCostCenters(ctx: { orgId: string }) {
  await requireErpEnabled(ctx.orgId)
  return withTenantContext({ orgId: ctx.orgId }, async (db) => {
    return db.query.erpCostCenters.findMany({ where: eq(erpCostCenters.orgId, ctx.orgId), orderBy: (t, { asc }) => asc(t.name) })
  })
}

export type CostCenterInput = { name: string; parentCostCenterId?: string; isGroup?: boolean; departmentId?: string; projectId?: string }

export async function createCostCenter(ctx: ErpContext, input: CostCenterInput) {
  await requireErpEnabled(ctx.orgId)
  if (!input.name?.trim()) throw new ServiceError("name is required", 400)
  return withTenantContext({ orgId: ctx.orgId, userId: ctx.userId }, async (db) => {
    const [cc] = await db.insert(erpCostCenters).values({
      orgId: ctx.orgId, name: input.name, parentCostCenterId: input.parentCostCenterId,
      isGroup: input.isGroup ?? false, departmentId: input.departmentId, projectId: input.projectId,
    }).returning()
    await logActivity({ tx: db, orgId: ctx.orgId, dbUser: ctx.dbUser, action: "erp_cost_center.created", entityType: "erp_cost_center", entityId: cc.id })
    return cc
  })
}

// Wave 70 (Budgeting): erp_fiscal_years has existed since Wave 49 (read by
// erp-financial-report-service.ts's period generator) but had no
// list/create service or route -- there was genuinely no way for an org to
// create one through the app. listCostCenters/createCostCenter above is
// the direct template.
export async function listFiscalYears(ctx: { orgId: string }) {
  await requireErpEnabled(ctx.orgId)
  return withTenantContext({ orgId: ctx.orgId }, async (db) => {
    return db.query.erpFiscalYears.findMany({ where: eq(erpFiscalYears.orgId, ctx.orgId), orderBy: (t, { desc }) => desc(t.startDate) })
  })
}

export type FiscalYearInput = { yearName: string; startDate: string; endDate: string }

export async function createFiscalYear(ctx: ErpContext, input: FiscalYearInput) {
  await requireErpEnabled(ctx.orgId)
  if (!input.yearName?.trim()) throw new ServiceError("yearName is required", 400)
  if (!input.startDate || !input.endDate) throw new ServiceError("startDate and endDate are required", 400)
  if (input.endDate <= input.startDate) throw new ServiceError("endDate must be after startDate", 400)
  return withTenantContext({ orgId: ctx.orgId, userId: ctx.userId }, async (db) => {
    const [fy] = await db.insert(erpFiscalYears).values({ orgId: ctx.orgId, yearName: input.yearName, startDate: input.startDate, endDate: input.endDate }).returning()
    await logActivity({ tx: db, orgId: ctx.orgId, dbUser: ctx.dbUser, action: "erp_fiscal_year.created", entityType: "erp_fiscal_year", entityId: fy.id })
    return fy
  })
}

// Wave 54: backs the Bank Reconciliation UI's bank-account picker --
// erpBankAccounts has existed since Wave 49 with no service-layer
// consumer until now.
export async function listBankAccounts(ctx: { orgId: string }) {
  await requireErpEnabled(ctx.orgId)
  return withTenantContext({ orgId: ctx.orgId }, async (db) => {
    return db.query.erpBankAccounts.findMany({ where: eq(erpBankAccounts.orgId, ctx.orgId), orderBy: (t, { asc }) => asc(t.accountName) })
  })
}

export async function listJournalEntries(ctx: { orgId: string }, filters: { status?: string } = {}) {
  await requireErpEnabled(ctx.orgId)
  return withTenantContext({ orgId: ctx.orgId }, async (db) => {
    return db.query.erpJournalEntries.findMany({
      where: filters.status
        ? and(eq(erpJournalEntries.orgId, ctx.orgId), eq(erpJournalEntries.status, filters.status as typeof erpJournalEntries.$inferSelect.status))
        : eq(erpJournalEntries.orgId, ctx.orgId),
      orderBy: (t, { desc }) => desc(t.postingDate),
    })
  })
}

export async function getJournalEntry(ctx: { orgId: string }, entryId: string) {
  await requireErpEnabled(ctx.orgId)
  return withTenantContext({ orgId: ctx.orgId }, async (db) => {
    const entry = await db.query.erpJournalEntries.findFirst({ where: and(eq(erpJournalEntries.id, entryId), eq(erpJournalEntries.orgId, ctx.orgId)) })
    if (!entry) throw new ServiceError("Journal entry not found", 404)
    const lines = await db.query.erpJournalEntryLines.findMany({ where: eq(erpJournalEntryLines.journalEntryId, entryId) })
    return { ...entry, lines }
  })
}

export async function createJournalEntry(ctx: ErpContext, input: JournalEntryInput) {
  await requireErpEnabled(ctx.orgId)
  if (!input.postingDate) throw new ServiceError("postingDate is required", 400)
  const { totalDebit, totalCredit } = validateBalanced(input.lines)

  return withTenantContext({ orgId: ctx.orgId, userId: ctx.userId }, async (db) => {
    // Confirm every account referenced actually belongs to this org (cheap
    // guard against a stale/foreign accountId slipping through).
    const accountIds = [...new Set(input.lines.map((l) => l.accountId))]
    const accounts = await db.query.erpAccounts.findMany({ where: and(eq(erpAccounts.orgId, ctx.orgId)) })
    const validIds = new Set(accounts.filter((a) => accountIds.includes(a.id)).map((a) => a.id))
    if (validIds.size !== accountIds.length) throw new ServiceError("One or more accounts were not found in this organisation", 400)

    if (input.companyId) {
      const company = await db.query.erpCompanies.findFirst({ where: and(eq(erpCompanies.id, input.companyId), eq(erpCompanies.orgId, ctx.orgId)) })
      if (!company) throw new ServiceError("Company not found", 404)
    }

    // Per-org sequential entry number -- MAX+1 within this transaction,
    // matching this schema's own "per-org sequence" comment from Wave 49;
    // same lightweight approach every other ERP document number
    // (poNumber, orderNumber, receiptNumber) still uses since none of
    // them have a dedicated atomic counter yet either.
    const [{ maxNumber }] = await db.select({ maxNumber: sql<number>`coalesce(max(${erpJournalEntries.entryNumber}), 0)` }).from(erpJournalEntries).where(eq(erpJournalEntries.orgId, ctx.orgId))

    const [entry] = await db.insert(erpJournalEntries).values({
      orgId: ctx.orgId,
      entryNumber: Number(maxNumber) + 1,
      postingDate: input.postingDate,
      referenceType: input.referenceType,
      referenceId: input.referenceId,
      userRemark: input.userRemark,
      companyId: input.companyId,
      totalDebit: totalDebit.toString(),
      totalCredit: totalCredit.toString(),
      createdById: ctx.userId,
    }).returning()

    await db.insert(erpJournalEntryLines).values(
      input.lines.map((l) => ({
        journalEntryId: entry.id,
        accountId: l.accountId,
        debit: (l.debit ?? 0).toString(),
        credit: (l.credit ?? 0).toString(),
        partyType: l.partyType,
        partyId: l.partyId,
        costCenter: l.costCenter,
        costCenterId: l.costCenterId,
        clientId: l.clientId,
        remark: l.remark,
        currencyId: l.currencyId,
        exchangeRate: l.exchangeRate?.toString(),
        debitInCurrency: l.debitInCurrency?.toString(),
        creditInCurrency: l.creditInCurrency?.toString(),
      }))
    )

    await logActivity({ tx: db, orgId: ctx.orgId, dbUser: ctx.dbUser, action: "erp_journal_entry.created", entityType: "erp_journal_entry", entityId: entry.id })
    return entry
  })
}

/**
 * Submits a draft journal entry: refuses to post into a closed accounting
 * period, then either posts immediately (no workflow configured for this
 * org/entityType) or starts an approval-workflow instance and leaves the
 * entry in 'draft' until every step is approved (see
 * markJournalEntrySubmittedFromApproval, called from the approval-decide
 * route once an instance completes).
 */
export async function submitJournalEntry(ctx: ErpContext, entryId: string) {
  await requireErpEnabled(ctx.orgId)
  const entry = await getJournalEntry(ctx, entryId)
  if (entry.status !== "draft") throw new ServiceError("Only draft entries can be submitted", 409)

  const periodOpen = await isPeriodOpenForDate(ctx, entry.postingDate)
  if (!periodOpen) throw new ServiceError(`The accounting period covering ${entry.postingDate} is closed`, 409)

  const instance = await startApprovalWorkflow(ctx, {
    entityType: "erp_journal_entry",
    entityId: entryId,
    entityData: { totalDebit: Number(entry.totalDebit) },
  })

  if (!instance) {
    return withTenantContext({ orgId: ctx.orgId, userId: ctx.userId }, async (db) => {
      const [updated] = await db.update(erpJournalEntries).set({ status: "submitted", submittedAt: new Date() }).where(eq(erpJournalEntries.id, entryId)).returning()
      await logActivity({ tx: db, orgId: ctx.orgId, dbUser: ctx.dbUser, action: "erp_journal_entry.submitted", entityType: "erp_journal_entry", entityId: entryId })
      return { ...updated, pendingApproval: false }
    })
  }
  return { ...entry, pendingApproval: true, approvalInstanceId: instance.id }
}

/** Called from the approval-decide route once a journal entry's workflow instance reaches 'approved'. */
export async function markJournalEntrySubmittedFromApproval(ctx: { orgId: string; userId: string; dbUser: typeof users.$inferSelect }, entryId: string) {
  await requireErpEnabled(ctx.orgId)
  return withTenantContext({ orgId: ctx.orgId, userId: ctx.userId }, async (db) => {
    const [updated] = await db.update(erpJournalEntries).set({ status: "submitted", submittedAt: new Date() }).where(and(eq(erpJournalEntries.id, entryId), eq(erpJournalEntries.orgId, ctx.orgId))).returning()
    await logActivity({ tx: db, orgId: ctx.orgId, dbUser: ctx.dbUser, action: "erp_journal_entry.approved_and_submitted", entityType: "erp_journal_entry", entityId: entryId })
    return updated
  })
}

// ============================================================
// Wave 66: Currencies + Exchange Rates -- erp_currencies/erp_exchange_rates
// have existed since Wave 49 with zero service-layer consumer until now.
// An org must set up its currency list here before any invoice/journal
// entry line can reference a non-base currency.
// ============================================================

export async function listCurrencies(ctx: { orgId: string }) {
  await requireErpEnabled(ctx.orgId)
  return withTenantContext({ orgId: ctx.orgId }, async (db) => {
    return db.query.erpCurrencies.findMany({ where: eq(erpCurrencies.orgId, ctx.orgId), orderBy: (t, { asc }) => asc(t.code) })
  })
}

export type CurrencyInput = { code: string; name: string; symbol?: string; isBaseCurrency?: boolean }

export async function createCurrency(ctx: ErpContext, input: CurrencyInput) {
  await requireErpEnabled(ctx.orgId)
  if (!input.code?.trim()) throw new ServiceError("code is required", 400)
  if (!input.name?.trim()) throw new ServiceError("name is required", 400)

  return withTenantContext({ orgId: ctx.orgId, userId: ctx.userId }, async (db) => {
    // Only one base currency per org -- unset any existing one first,
    // rather than leaving two rows both claiming isBaseCurrency=true.
    if (input.isBaseCurrency) {
      await db.update(erpCurrencies).set({ isBaseCurrency: false }).where(and(eq(erpCurrencies.orgId, ctx.orgId), eq(erpCurrencies.isBaseCurrency, true)))
    }
    const [currency] = await db.insert(erpCurrencies).values({
      orgId: ctx.orgId, code: input.code.toUpperCase(), name: input.name, symbol: input.symbol,
      isBaseCurrency: input.isBaseCurrency ?? false,
    }).returning()
    await logActivity({ tx: db, orgId: ctx.orgId, dbUser: ctx.dbUser, action: "erp_currency.created", entityType: "erp_currency", entityId: currency.id })
    return currency
  })
}

export async function listExchangeRates(ctx: { orgId: string }) {
  await requireErpEnabled(ctx.orgId)
  return withTenantContext({ orgId: ctx.orgId }, async (db) => {
    return db.query.erpExchangeRates.findMany({ where: eq(erpExchangeRates.orgId, ctx.orgId), orderBy: (t, { desc }) => desc(t.rateDate) })
  })
}

export type ExchangeRateInput = { fromCurrencyId: string; toCurrencyId: string; rate: number; rateDate: string }

export async function createExchangeRate(ctx: ErpContext, input: ExchangeRateInput) {
  await requireErpEnabled(ctx.orgId)
  if (!input.fromCurrencyId || !input.toCurrencyId) throw new ServiceError("fromCurrencyId and toCurrencyId are required", 400)
  if (!input.rate || input.rate <= 0) throw new ServiceError("rate must be a positive number", 400)
  if (!input.rateDate) throw new ServiceError("rateDate is required", 400)

  return withTenantContext({ orgId: ctx.orgId, userId: ctx.userId }, async (db) => {
    const [rate] = await db.insert(erpExchangeRates).values({
      orgId: ctx.orgId, fromCurrencyId: input.fromCurrencyId, toCurrencyId: input.toCurrencyId,
      rate: input.rate.toString(), rateDate: input.rateDate,
    }).returning()
    await logActivity({ tx: db, orgId: ctx.orgId, dbUser: ctx.dbUser, action: "erp_exchange_rate.created", entityType: "erp_exchange_rate", entityId: rate.id })
    return rate
  })
}

/**
 * Convenience lookup for the invoicing/journal-entry UI to suggest a
 * starting rate -- the most recent rate on or before the given date. Never
 * auto-applied to a document; createSalesInvoice/createPurchaseInvoice/
 * createJournalEntry always require an explicit exchangeRate, since a
 * stale or wrong suggested rate silently accepted would be a real risk.
 */
export async function getLatestExchangeRate(ctx: { orgId: string }, fromCurrencyId: string, toCurrencyId: string, asOfDate: string) {
  await requireErpEnabled(ctx.orgId)
  return withTenantContext({ orgId: ctx.orgId }, async (db) => {
    return db.query.erpExchangeRates.findFirst({
      where: and(eq(erpExchangeRates.orgId, ctx.orgId), eq(erpExchangeRates.fromCurrencyId, fromCurrencyId), eq(erpExchangeRates.toCurrencyId, toCurrencyId), lte(erpExchangeRates.rateDate, asOfDate)),
      orderBy: (t, { desc }) => desc(t.rateDate),
    })
  })
}

// ============================================================
// Wave 68: Tax Withholding Categories (vendor-payment TDS) -- admin-
// editable master data assigned to a supplier (erp_suppliers.
// taxWithholdingCategoryId), applied by erp-invoicing-service.ts at
// purchase-invoice-submit time. No structured "section code" field
// (194C/194J etc.) -- handled via free-text categoryName, matching
// ERPNext's own Tax Withholding Category shape.
// ============================================================

export async function listTaxWithholdingCategories(ctx: { orgId: string }) {
  await requireErpEnabled(ctx.orgId)
  return withTenantContext({ orgId: ctx.orgId }, async (db) => {
    const categories = await db.query.erpTaxWithholdingCategories.findMany({ where: eq(erpTaxWithholdingCategories.orgId, ctx.orgId), orderBy: (t, { asc }) => asc(t.categoryName) })
    const allRates = await db.query.erpTaxWithholdingRates.findMany({ where: sql`${erpTaxWithholdingRates.categoryId} IN (SELECT id FROM compliance.erp_tax_withholding_categories WHERE org_id = ${ctx.orgId})` })
    return categories.map((c) => ({ ...c, rates: allRates.filter((r) => r.categoryId === c.id).sort((a, b) => a.fromDate.localeCompare(b.fromDate)) }))
  })
}

export async function createTaxWithholdingCategory(
  ctx: ErpContext,
  input: { categoryName: string; taxDeductionBasis?: "gross_total" | "net_total"; rates: { fromDate: string; toDate?: string; rate: number; singleThreshold?: number; cumulativeThreshold?: number }[] }
) {
  await requireErpEnabled(ctx.orgId)
  if (!input.categoryName?.trim()) throw new ServiceError("categoryName is required", 400)
  if (!input.rates?.length) throw new ServiceError("At least one withholding rate is required", 400)
  return withTenantContext({ orgId: ctx.orgId, userId: ctx.userId }, async (db) => {
    const [category] = await db.insert(erpTaxWithholdingCategories).values({
      orgId: ctx.orgId, categoryName: input.categoryName, taxDeductionBasis: input.taxDeductionBasis ?? "net_total",
    }).returning()
    await db.insert(erpTaxWithholdingRates).values(
      input.rates.map((r) => ({
        categoryId: category.id, fromDate: r.fromDate, toDate: r.toDate, rate: r.rate.toString(),
        singleThreshold: r.singleThreshold?.toString(), cumulativeThreshold: r.cumulativeThreshold?.toString(),
      }))
    )
    await logActivity({ tx: db, orgId: ctx.orgId, dbUser: ctx.dbUser, action: "erp_tax_withholding_category.created", entityType: "erp_tax_withholding_category", entityId: category.id })
    return category
  })
}
