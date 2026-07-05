// Wave 50 (VERI ERP gap-fill, Tier 1 #2): financial reporting service
// layer. Per ERP_BENCHMARK_COMPARISON.md this is the single highest-value
// fix in the whole platform -- it closes Finance's #1 gap (no Trial
// Balance/P&L/Balance Sheet at all) AND Reporting & BI's #1 gap
// (RPT001) simultaneously, since the schema (erpAccounts,
// erpJournalEntryLines) already exists from Wave 49 -- this is pure
// aggregation, not new tables. Also owns isPeriodOpenForDate(), the
// Tier 1 #3 fix (erp_accounting_periods) that gates journal-entry
// posting so these reports stay trustworthy in production.
import { erpAccounts, erpJournalEntries, erpJournalEntryLines, erpAccountingPeriods, erpFiscalYears } from "@/lib/db"
import { withTenantContext } from "@/lib/db/tenant-scoped"
import { and, eq, lte, gte, sql, inArray } from "drizzle-orm"
import { ServiceError } from "./compliance-service"
export { ServiceError }
import { getCompanyDescendantIds } from "./erp-company-service"

/** Generates one open period per calendar month spanning the fiscal year -- the concrete, usable starting point an org needs before any period-lock control means anything. */
export async function generatePeriodsForFiscalYear(ctx: { orgId: string }, fiscalYearId: string) {
  return withTenantContext({ orgId: ctx.orgId }, async (db) => {
    const fy = await db.query.erpFiscalYears.findFirst({ where: and(eq(erpFiscalYears.id, fiscalYearId), eq(erpFiscalYears.orgId, ctx.orgId)) })
    if (!fy) throw new ServiceError("Fiscal year not found", 404)

    const existing = await db.query.erpAccountingPeriods.findMany({ where: eq(erpAccountingPeriods.fiscalYearId, fiscalYearId) })
    if (existing.length > 0) throw new ServiceError("Periods already exist for this fiscal year", 409)

    const start = new Date(fy.startDate)
    const end = new Date(fy.endDate)
    const rows: (typeof erpAccountingPeriods.$inferInsert)[] = []
    let cursor = new Date(start.getFullYear(), start.getMonth(), 1)
    while (cursor <= end) {
      const periodStart = new Date(cursor.getFullYear(), cursor.getMonth(), 1)
      const periodEnd = new Date(cursor.getFullYear(), cursor.getMonth() + 1, 0)
      const clampedStart = periodStart < start ? start : periodStart
      const clampedEnd = periodEnd > end ? end : periodEnd
      rows.push({
        orgId: ctx.orgId,
        fiscalYearId,
        periodName: cursor.toLocaleString("en-US", { month: "short", year: "numeric" }),
        startDate: clampedStart.toISOString().slice(0, 10),
        endDate: clampedEnd.toISOString().slice(0, 10),
      })
      cursor = new Date(cursor.getFullYear(), cursor.getMonth() + 1, 1)
    }

    return db.insert(erpAccountingPeriods).values(rows).returning()
  })
}

/**
 * A period is "open for posting" on `date` if either (a) no period row
 * exists at all for that date (fail-open, matching this codebase's own
 * precedent of treating an absent enablement/config row as "not yet
 * configured" rather than "blocked" -- see orgProductBranchEnablements),
 * or (b) a period row exists and its status is 'open'. Once an org
 * starts using periods, closing one is an explicit act (closedAt set).
 */
export async function isPeriodOpenForDate(ctx: { orgId: string }, isoDate: string): Promise<boolean> {
  return withTenantContext({ orgId: ctx.orgId }, async (db) => {
    const period = await db.query.erpAccountingPeriods.findFirst({
      where: and(eq(erpAccountingPeriods.orgId, ctx.orgId), lte(erpAccountingPeriods.startDate, isoDate), gte(erpAccountingPeriods.endDate, isoDate)),
    })
    if (!period) return true
    return period.status === "open"
  })
}

export async function listPeriods(ctx: { orgId: string }, fiscalYearId?: string) {
  return withTenantContext({ orgId: ctx.orgId }, async (db) => {
    return db.query.erpAccountingPeriods.findMany({
      where: fiscalYearId
        ? and(eq(erpAccountingPeriods.orgId, ctx.orgId), eq(erpAccountingPeriods.fiscalYearId, fiscalYearId))
        : eq(erpAccountingPeriods.orgId, ctx.orgId),
      orderBy: (t, { asc }) => asc(t.startDate),
    })
  })
}

export async function closePeriod(ctx: { orgId: string; userId: string }, periodId: string) {
  return withTenantContext({ orgId: ctx.orgId, userId: ctx.userId }, async (db) => {
    const period = await db.query.erpAccountingPeriods.findFirst({ where: and(eq(erpAccountingPeriods.id, periodId), eq(erpAccountingPeriods.orgId, ctx.orgId)) })
    if (!period) throw new ServiceError("Period not found", 404)
    if (period.status === "closed") throw new ServiceError("Period is already closed", 409)
    const [updated] = await db.update(erpAccountingPeriods).set({ status: "closed", closedById: ctx.userId, closedAt: new Date() }).where(eq(erpAccountingPeriods.id, periodId)).returning()
    return updated
  })
}

export async function reopenPeriod(ctx: { orgId: string; userId: string }, periodId: string) {
  return withTenantContext({ orgId: ctx.orgId, userId: ctx.userId }, async (db) => {
    const period = await db.query.erpAccountingPeriods.findFirst({ where: and(eq(erpAccountingPeriods.id, periodId), eq(erpAccountingPeriods.orgId, ctx.orgId)) })
    if (!period) throw new ServiceError("Period not found", 404)
    const [updated] = await db.update(erpAccountingPeriods).set({ status: "open", closedById: null, closedAt: null }).where(eq(erpAccountingPeriods.id, periodId)).returning()
    return updated
  })
}

type AccountBalance = {
  accountId: string
  accountName: string
  accountNumber: string | null
  rootType: string
  totalDebit: number
  totalCredit: number
  netBalance: number
}

/** Sums submitted journal-entry-line debit/credit by account, in a date range. */
async function accountBalancesInRange(orgId: string, fromDate: string | null, toDate: string, companyIds?: string[]): Promise<AccountBalance[]> {
  return withTenantContext({ orgId }, async (db) => {
    const conditions = [eq(erpJournalEntries.orgId, orgId), eq(erpJournalEntries.status, "submitted"), lte(erpJournalEntries.postingDate, toDate)]
    if (fromDate) conditions.push(gte(erpJournalEntries.postingDate, fromDate))
    if (companyIds) conditions.push(inArray(erpJournalEntries.companyId, companyIds))

    const rows = await db
      .select({
        accountId: erpAccounts.id,
        accountName: erpAccounts.accountName,
        accountNumber: erpAccounts.accountNumber,
        rootType: erpAccounts.rootType,
        totalDebit: sql<string>`coalesce(sum(${erpJournalEntryLines.debit}), 0)`,
        totalCredit: sql<string>`coalesce(sum(${erpJournalEntryLines.credit}), 0)`,
      })
      .from(erpJournalEntryLines)
      .innerJoin(erpJournalEntries, eq(erpJournalEntryLines.journalEntryId, erpJournalEntries.id))
      .innerJoin(erpAccounts, eq(erpJournalEntryLines.accountId, erpAccounts.id))
      .where(and(...conditions))
      .groupBy(erpAccounts.id, erpAccounts.accountName, erpAccounts.accountNumber, erpAccounts.rootType)

    return rows.map((r) => {
      const totalDebit = Number(r.totalDebit)
      const totalCredit = Number(r.totalCredit)
      return { accountId: r.accountId, accountName: r.accountName, accountNumber: r.accountNumber, rootType: r.rootType, totalDebit, totalCredit, netBalance: totalDebit - totalCredit }
    })
  })
}

export type CompanyScope = { companyId?: string; consolidate?: boolean }

/**
 * Wave 67: resolves an optional company filter into the concrete set of
 * companyIds a report should aggregate. No companyId -> no filter at all
 * (unchanged behavior for every report run before this wave -- aggregates
 * every journal entry regardless of company). A companyId with
 * consolidate=true walks the company tree (getCompanyDescendantIds) and
 * includes every descendant's postings -- a genuine group consolidation,
 * computed live at report-runtime rather than a stored "group GL", per
 * ERPNext's own approach. consolidate=false (or omitted) scopes to just
 * that one company's own postings.
 */
async function resolveCompanyScope(ctx: { orgId: string }, scope?: CompanyScope): Promise<string[] | undefined> {
  if (!scope?.companyId) return undefined
  if (scope.consolidate) return getCompanyDescendantIds(ctx, scope.companyId)
  return [scope.companyId]
}

/** Trial Balance: every account's cumulative debit/credit as of a date, from inception. */
export async function trialBalance(ctx: { orgId: string }, asOfDate: string, scope?: CompanyScope) {
  const companyIds = await resolveCompanyScope(ctx, scope)
  const balances = await accountBalancesInRange(ctx.orgId, null, asOfDate, companyIds)
  const totalDebit = balances.reduce((sum, b) => sum + b.totalDebit, 0)
  const totalCredit = balances.reduce((sum, b) => sum + b.totalCredit, 0)
  return { asOfDate, accounts: balances.sort((a, b) => (a.accountNumber ?? "").localeCompare(b.accountNumber ?? "")), totalDebit, totalCredit, isBalanced: Math.abs(totalDebit - totalCredit) < 0.01 }
}

/** Profit & Loss: income/expense accounts only, over a period (not cumulative from inception). */
export async function profitAndLoss(ctx: { orgId: string }, fromDate: string, toDate: string, scope?: CompanyScope) {
  const companyIds = await resolveCompanyScope(ctx, scope)
  const balances = await accountBalancesInRange(ctx.orgId, fromDate, toDate, companyIds)
  const income = balances.filter((b) => b.rootType === "income")
  const expense = balances.filter((b) => b.rootType === "expense")
  // Income accounts are credit-natured (netBalance is debit-credit, so flip sign); expense accounts are debit-natured.
  const totalIncome = income.reduce((sum, b) => sum + -b.netBalance, 0)
  const totalExpense = expense.reduce((sum, b) => sum + b.netBalance, 0)
  return { fromDate, toDate, income, expense, totalIncome, totalExpense, netProfit: totalIncome - totalExpense }
}

/** Balance Sheet: asset/liability/equity accounts, cumulative as of a date. */
export async function balanceSheet(ctx: { orgId: string }, asOfDate: string, scope?: CompanyScope) {
  const companyIds = await resolveCompanyScope(ctx, scope)
  const balances = await accountBalancesInRange(ctx.orgId, null, asOfDate, companyIds)
  const assets = balances.filter((b) => b.rootType === "asset")
  const liabilities = balances.filter((b) => b.rootType === "liability")
  const equity = balances.filter((b) => b.rootType === "equity")
  const totalAssets = assets.reduce((sum, b) => sum + b.netBalance, 0)
  // Liability/equity accounts are credit-natured -- flip sign so they display as positive balances.
  const totalLiabilities = liabilities.reduce((sum, b) => sum + -b.netBalance, 0)
  const totalEquity = equity.reduce((sum, b) => sum + -b.netBalance, 0)
  return { asOfDate, assets, liabilities, equity, totalAssets, totalLiabilities, totalEquity, isBalanced: Math.abs(totalAssets - (totalLiabilities + totalEquity)) < 0.01 }
}
