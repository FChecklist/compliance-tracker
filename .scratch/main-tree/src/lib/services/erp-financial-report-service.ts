// Wave 50 (VERI ERP gap-fill, Tier 1 #2): financial reporting service
// layer. Per ERP_BENCHMARK_COMPARISON.md this is the single highest-value
// fix in the whole platform -- it closes Finance's #1 gap (no Trial
// Balance/P&L/Balance Sheet at all) AND Reporting & BI's #1 gap
// (RPT001) simultaneously, since the schema (erpAccounts,
// erpJournalEntryLines) already exists from Wave 49 -- this is pure
// aggregation, not new tables. Also owns isPeriodOpenForDate(), the
// Tier 1 #3 fix (erp_accounting_periods) that gates journal-entry
// posting so these reports stay trustworthy in production.
import { erpAccounts, erpJournalEntries, erpJournalEntryLines, erpAccountingPeriods, erpFiscalYears, erpPeriodClosingChecklistItems, erpCostCenters } from "@/lib/db"
import { withTenantContext } from "@/lib/db/tenant-scoped"
import { and, eq, lte, gte, sql, inArray, ne, isNotNull } from "drizzle-orm"
import { ServiceError } from "./compliance-service"
export { ServiceError }
import { getCompanyDescendantIds } from "./erp-company-service"
import { requireErpEnabled } from "./erp-enablement-service"

// Wave 82 (Period Closing checklist workflow, COMPARISON_CSV_GAP_ANALYSIS.md
// backlog #3): a real month-end close always needs the same handful of
// tasks -- seeded once per period on first checklist access, an org then
// edits/adds freely on top. Grounded in standard month-end-close practice
// (accrual/provision/reconciliation/review), not copied from any specific
// tool.
const DEFAULT_CHECKLIST_ITEMS: { title: string; taskType: string }[] = [
  { title: "Post accrued expenses", taskType: "accrual" },
  { title: "Post accrued revenue", taskType: "accrual" },
  { title: "Review and post provisions (bad debt, warranty, etc.)", taskType: "provision" },
  { title: "Reconcile bank accounts", taskType: "reconciliation" },
  { title: "Reconcile AR/AP subledgers to the GL", taskType: "reconciliation" },
  { title: "Review trial balance for unusual entries", taskType: "review" },
]

/** Generates one open period per calendar month spanning the fiscal year -- the concrete, usable starting point an org needs before any period-lock control means anything. */
export async function generatePeriodsForFiscalYear(ctx: { orgId: string }, fiscalYearId: string) {
  await requireErpEnabled(ctx.orgId)
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
  await requireErpEnabled(ctx.orgId)
  return withTenantContext({ orgId: ctx.orgId }, async (db) => {
    const period = await db.query.erpAccountingPeriods.findFirst({
      where: and(eq(erpAccountingPeriods.orgId, ctx.orgId), lte(erpAccountingPeriods.startDate, isoDate), gte(erpAccountingPeriods.endDate, isoDate)),
    })
    if (!period) return true
    return period.status === "open"
  })
}

export async function listPeriods(ctx: { orgId: string }, fiscalYearId?: string) {
  await requireErpEnabled(ctx.orgId)
  return withTenantContext({ orgId: ctx.orgId }, async (db) => {
    return db.query.erpAccountingPeriods.findMany({
      where: fiscalYearId
        ? and(eq(erpAccountingPeriods.orgId, ctx.orgId), eq(erpAccountingPeriods.fiscalYearId, fiscalYearId))
        : eq(erpAccountingPeriods.orgId, ctx.orgId),
      orderBy: (t, { asc }) => asc(t.startDate),
    })
  })
}

// Wave 82: closing gate -- both the checklist AND sign-off must be done
// before a period can close. Seeds the checklist on first access if none
// exists, so this never blocks an org that hasn't opted into using it yet
// on a period with zero items (empty checklist = vacuously "all complete").
export async function listChecklistItems(ctx: { orgId: string }, periodId: string) {
  await requireErpEnabled(ctx.orgId)
  return withTenantContext({ orgId: ctx.orgId }, async (db) => {
    const period = await db.query.erpAccountingPeriods.findFirst({ where: and(eq(erpAccountingPeriods.id, periodId), eq(erpAccountingPeriods.orgId, ctx.orgId)) })
    if (!period) throw new ServiceError("Period not found", 404)

    const existing = await db.query.erpPeriodClosingChecklistItems.findMany({
      where: eq(erpPeriodClosingChecklistItems.periodId, periodId),
      orderBy: (t, { asc }) => asc(t.sortOrder),
    })
    if (existing.length > 0) return existing

    const seeded = await db.insert(erpPeriodClosingChecklistItems).values(
      DEFAULT_CHECKLIST_ITEMS.map((item, i) => ({ orgId: ctx.orgId, periodId, title: item.title, taskType: item.taskType, sortOrder: i }))
    ).returning()
    return seeded
  })
}

export async function addChecklistItem(ctx: { orgId: string; userId: string }, periodId: string, input: { title: string; taskType?: string; assignedToId?: string }) {
  await requireErpEnabled(ctx.orgId)
  const title = input.title?.trim()
  if (!title) throw new ServiceError("title is required", 400)

  return withTenantContext({ orgId: ctx.orgId, userId: ctx.userId }, async (db) => {
    const period = await db.query.erpAccountingPeriods.findFirst({ where: and(eq(erpAccountingPeriods.id, periodId), eq(erpAccountingPeriods.orgId, ctx.orgId)) })
    if (!period) throw new ServiceError("Period not found", 404)

    const existing = await db.query.erpPeriodClosingChecklistItems.findMany({ where: eq(erpPeriodClosingChecklistItems.periodId, periodId) })
    const [item] = await db.insert(erpPeriodClosingChecklistItems).values({
      orgId: ctx.orgId, periodId, title, taskType: input.taskType || "other",
      assignedToId: input.assignedToId || null, sortOrder: existing.length,
    }).returning()
    return item
  })
}

export async function completeChecklistItem(ctx: { orgId: string; userId: string }, itemId: string, notes?: string) {
  await requireErpEnabled(ctx.orgId)
  return withTenantContext({ orgId: ctx.orgId, userId: ctx.userId }, async (db) => {
    const item = await db.query.erpPeriodClosingChecklistItems.findFirst({ where: and(eq(erpPeriodClosingChecklistItems.id, itemId), eq(erpPeriodClosingChecklistItems.orgId, ctx.orgId)) })
    if (!item) throw new ServiceError("Checklist item not found", 404)
    const [updated] = await db.update(erpPeriodClosingChecklistItems)
      .set({ status: "completed", completedById: ctx.userId, completedAt: new Date(), notes: notes ?? item.notes })
      .where(eq(erpPeriodClosingChecklistItems.id, itemId)).returning()
    return updated
  })
}

async function assertChecklistComplete(db: Parameters<Parameters<typeof withTenantContext>[1]>[0], periodId: string) {
  const incomplete = await db.query.erpPeriodClosingChecklistItems.findFirst({
    where: and(eq(erpPeriodClosingChecklistItems.periodId, periodId), ne(erpPeriodClosingChecklistItems.status, "completed")),
  })
  if (incomplete) throw new ServiceError(`Checklist item "${incomplete.title}" is still pending -- complete it before closing`, 409)
}

export async function signOffPeriod(ctx: { orgId: string; userId: string }, periodId: string) {
  await requireErpEnabled(ctx.orgId)
  return withTenantContext({ orgId: ctx.orgId, userId: ctx.userId }, async (db) => {
    const period = await db.query.erpAccountingPeriods.findFirst({ where: and(eq(erpAccountingPeriods.id, periodId), eq(erpAccountingPeriods.orgId, ctx.orgId)) })
    if (!period) throw new ServiceError("Period not found", 404)
    if (period.status === "closed") throw new ServiceError("Period is already closed", 409)

    await assertChecklistComplete(db, periodId)

    const [updated] = await db.update(erpAccountingPeriods).set({ signedOffById: ctx.userId, signedOffAt: new Date() }).where(eq(erpAccountingPeriods.id, periodId)).returning()
    return updated
  })
}

export async function closePeriod(ctx: { orgId: string; userId: string }, periodId: string) {
  await requireErpEnabled(ctx.orgId)
  return withTenantContext({ orgId: ctx.orgId, userId: ctx.userId }, async (db) => {
    const period = await db.query.erpAccountingPeriods.findFirst({ where: and(eq(erpAccountingPeriods.id, periodId), eq(erpAccountingPeriods.orgId, ctx.orgId)) })
    if (!period) throw new ServiceError("Period not found", 404)
    if (period.status === "closed") throw new ServiceError("Period is already closed", 409)

    await assertChecklistComplete(db, periodId)
    if (!period.signedOffAt) throw new ServiceError("This period needs a formal sign-off before it can be closed", 409)

    const [updated] = await db.update(erpAccountingPeriods).set({ status: "closed", closedById: ctx.userId, closedAt: new Date() }).where(eq(erpAccountingPeriods.id, periodId)).returning()
    return updated
  })
}

export async function reopenPeriod(ctx: { orgId: string; userId: string }, periodId: string) {
  await requireErpEnabled(ctx.orgId)
  return withTenantContext({ orgId: ctx.orgId, userId: ctx.userId }, async (db) => {
    const period = await db.query.erpAccountingPeriods.findFirst({ where: and(eq(erpAccountingPeriods.id, periodId), eq(erpAccountingPeriods.orgId, ctx.orgId)) })
    if (!period) throw new ServiceError("Period not found", 404)
    // Reopening also clears sign-off -- a reopened period genuinely needs a
    // fresh review/sign-off before it can close again, not a stale approval
    // carried over from before whatever prompted the reopen.
    const [updated] = await db.update(erpAccountingPeriods)
      .set({ status: "open", closedById: null, closedAt: null, signedOffById: null, signedOffAt: null })
      .where(eq(erpAccountingPeriods.id, periodId)).returning()
    return updated
  })
}

type AccountBalance = {
  accountId: string
  accountName: string
  accountNumber: string | null
  rootType: string
  accountType: string | null
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
        accountType: erpAccounts.accountType,
        totalDebit: sql<string>`coalesce(sum(${erpJournalEntryLines.debit}), 0)`,
        totalCredit: sql<string>`coalesce(sum(${erpJournalEntryLines.credit}), 0)`,
      })
      .from(erpJournalEntryLines)
      .innerJoin(erpJournalEntries, eq(erpJournalEntryLines.journalEntryId, erpJournalEntries.id))
      .innerJoin(erpAccounts, eq(erpJournalEntryLines.accountId, erpAccounts.id))
      .where(and(...conditions))
      .groupBy(erpAccounts.id, erpAccounts.accountName, erpAccounts.accountNumber, erpAccounts.rootType, erpAccounts.accountType)

    return rows.map((r) => {
      const totalDebit = Number(r.totalDebit)
      const totalCredit = Number(r.totalCredit)
      return { accountId: r.accountId, accountName: r.accountName, accountNumber: r.accountNumber, rootType: r.rootType, accountType: r.accountType, totalDebit, totalCredit, netBalance: totalDebit - totalCredit }
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
  await requireErpEnabled(ctx.orgId)
  const companyIds = await resolveCompanyScope(ctx, scope)
  const balances = await accountBalancesInRange(ctx.orgId, null, asOfDate, companyIds)
  const totalDebit = balances.reduce((sum, b) => sum + b.totalDebit, 0)
  const totalCredit = balances.reduce((sum, b) => sum + b.totalCredit, 0)
  return { asOfDate, accounts: balances.sort((a, b) => (a.accountNumber ?? "").localeCompare(b.accountNumber ?? "")), totalDebit, totalCredit, isBalanced: Math.abs(totalDebit - totalCredit) < 0.01 }
}

/** Profit & Loss: income/expense accounts only, over a period (not cumulative from inception). */
export async function profitAndLoss(ctx: { orgId: string }, fromDate: string, toDate: string, scope?: CompanyScope) {
  await requireErpEnabled(ctx.orgId)
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
  await requireErpEnabled(ctx.orgId)
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

/**
 * Cash Flow Statement (indirect method) -- Wave 70 addendum, per
 * COMPARISON_CSV_GAP_ANALYSIS.md (Financial Reporting had Trial Balance/P&L/
 * Balance Sheet but no Statement of Cash Flows). Deliberately does NOT do
 * the textbook "start from net profit, manually add back depreciation"
 * step: this schema already has direct GL access to every balance-sheet
 * account's actual period-over-period change (accountBalancesInRange
 * above), so depreciation and every other non-cash P&L adjustment is
 * already correctly reflected in the fixed_asset-tagged accounts' own
 * movement -- adding it back again would double-count. Instead this is
 * derived straight from the fundamental double-entry identity (every
 * balanced ledger satisfies delta-assets + delta-liabilities + delta-equity
 * = net profit for any period), which guarantees Operating+Investing+
 * Financing reconciles exactly to the ledger's own cash/bank account
 * movement -- no third-party code copied, this is a from-first-principles
 * derivation, not a ported ERPNext/Odoo cash-flow report.
 */
export async function cashFlowStatement(ctx: { orgId: string }, fromDate: string, toDate: string, scope?: CompanyScope) {
  await requireErpEnabled(ctx.orgId)
  const companyIds = await resolveCompanyScope(ctx, scope)
  const pnl = await profitAndLoss(ctx, fromDate, toDate, scope)

  const openingCursor = new Date(fromDate)
  openingCursor.setDate(openingCursor.getDate() - 1)
  const openingDate = openingCursor.toISOString().slice(0, 10)

  const [opening, closing] = await Promise.all([
    accountBalancesInRange(ctx.orgId, null, openingDate, companyIds),
    accountBalancesInRange(ctx.orgId, null, toDate, companyIds),
  ])
  const openingById = new Map(opening.map((b) => [b.accountId, b]))
  const closingById = new Map(closing.map((b) => [b.accountId, b]))
  const allIds = new Set([...openingById.keys(), ...closingById.keys()])

  let cashChange = 0, receivableChange = 0, stockChange = 0, payableChange = 0, fixedAssetChange = 0, otherAssetChange = 0, otherLiabilityEquityChange = 0

  for (const id of allIds) {
    const o = openingById.get(id)
    const c = closingById.get(id)
    const ref = c ?? o!
    if (ref.rootType !== "asset" && ref.rootType !== "liability" && ref.rootType !== "equity") continue // income/expense are already reflected in netProfit
    const change = (c?.netBalance ?? 0) - (o?.netBalance ?? 0)
    if (ref.accountType === "bank" || ref.accountType === "cash") cashChange += change
    else if (ref.accountType === "receivable") receivableChange += change
    else if (ref.accountType === "stock") stockChange += change
    else if (ref.accountType === "fixed_asset") fixedAssetChange += change
    else if (ref.accountType === "payable") payableChange += change
    else if (ref.rootType === "asset") otherAssetChange += change
    else otherLiabilityEquityChange += change
  }

  const operatingCashFlow = pnl.netProfit - receivableChange - stockChange - payableChange - otherAssetChange
  const investingCashFlow = -fixedAssetChange
  const financingCashFlow = -otherLiabilityEquityChange
  const netChangeInCash = operatingCashFlow + investingCashFlow + financingCashFlow

  return {
    fromDate,
    toDate,
    netProfit: pnl.netProfit,
    operating: { cashFlow: operatingCashFlow, receivableChange, stockChange, payableChange, otherWorkingCapitalChange: otherAssetChange },
    investing: { cashFlow: investingCashFlow, fixedAssetChange },
    financing: { cashFlow: financingCashFlow, otherLiabilityEquityChange },
    netChangeInCash,
    actualCashChange: cashChange,
    // Tautological by the double-entry identity above rather than an
    // independent audit signal like trialBalance/balanceSheet's own
    // isBalanced -- false here would indicate a real data problem (an
    // unbalanced ledger), not just a display rounding issue.
    isBalanced: Math.abs(netChangeInCash - cashChange) < 0.01,
  }
}

/**
 * Priority 15 (PROJEXA Accounting depth, per-project P&L): a construction/
 * interior-design firm running ~500 projects needs revenue/expense visible
 * PER PROJECT, not just company-wide -- profitAndLoss above already answers
 * "how is the company doing", this answers "how is THIS project doing".
 * erp_cost_centers.projectId (Wave 52/124) already links a cost center to a
 * construction project; every journal-entry LINE (not header) carries an
 * optional costCenterId (Wave 52). This groups submitted income/expense
 * postings by costCenterId over a date range -- pure aggregation over
 * existing columns, no new schema. Lines with no costCenterId at all are
 * excluded (an org that never tags cost centers on its postings gets an
 * empty list here, not a misleading "Unassigned" bucket that would imply
 * this report tried and failed to attribute them).
 *
 * Priority 17 Wave 1: gained the same optional CompanyScope every other
 * report in this file already supports -- erp_cost_centers itself carries
 * no companyId (a cost center/project is org-wide, not owned by one legal
 * entity), so scoping is applied the same way as accountBalancesInRange:
 * filtering the underlying erp_journal_entries.companyId, not the cost
 * center row.
 */
export async function profitAndLossByCostCenter(ctx: { orgId: string }, fromDate: string, toDate: string, scope?: CompanyScope) {
  await requireErpEnabled(ctx.orgId)
  const companyIds = await resolveCompanyScope(ctx, scope)
  return withTenantContext({ orgId: ctx.orgId }, async (db) => {
    const conditions = [
      eq(erpJournalEntries.orgId, ctx.orgId),
      eq(erpJournalEntries.status, "submitted"),
      gte(erpJournalEntries.postingDate, fromDate),
      lte(erpJournalEntries.postingDate, toDate),
      inArray(erpAccounts.rootType, ["income", "expense"]),
      isNotNull(erpJournalEntryLines.costCenterId),
    ]
    if (companyIds) conditions.push(inArray(erpJournalEntries.companyId, companyIds))

    const rows = await db
      .select({
        costCenterId: erpJournalEntryLines.costCenterId,
        rootType: erpAccounts.rootType,
        totalDebit: sql<string>`coalesce(sum(${erpJournalEntryLines.debit}), 0)`,
        totalCredit: sql<string>`coalesce(sum(${erpJournalEntryLines.credit}), 0)`,
      })
      .from(erpJournalEntryLines)
      .innerJoin(erpJournalEntries, eq(erpJournalEntryLines.journalEntryId, erpJournalEntries.id))
      .innerJoin(erpAccounts, eq(erpJournalEntryLines.accountId, erpAccounts.id))
      .where(and(...conditions))
      .groupBy(erpJournalEntryLines.costCenterId, erpAccounts.rootType)

    const costCenters = await db.query.erpCostCenters.findMany({ where: eq(erpCostCenters.orgId, ctx.orgId) })
    const costCenterById = new Map(costCenters.map((c) => [c.id, c]))

    const byCostCenter = new Map<string, { income: number; expense: number }>()
    for (const r of rows) {
      if (!r.costCenterId) continue
      const entry = byCostCenter.get(r.costCenterId) ?? { income: 0, expense: 0 }
      const debit = Number(r.totalDebit)
      const credit = Number(r.totalCredit)
      // Income accounts are credit-natured; expense accounts are debit-natured -- same sign convention as profitAndLoss above.
      if (r.rootType === "income") entry.income += credit - debit
      else entry.expense += debit - credit
      byCostCenter.set(r.costCenterId, entry)
    }

    const costCenterRollups = Array.from(byCostCenter.entries()).map(([costCenterId, v]) => {
      const cc = costCenterById.get(costCenterId)
      return {
        costCenterId,
        costCenterName: cc?.name ?? "Unknown cost center",
        projectId: cc?.projectId ?? null,
        income: v.income,
        expense: v.expense,
        netProfit: v.income - v.expense,
      }
    }).sort((a, b) => b.netProfit - a.netProfit)

    return {
      fromDate,
      toDate,
      costCenters: costCenterRollups,
      totalIncome: costCenterRollups.reduce((sum, c) => sum + c.income, 0),
      totalExpense: costCenterRollups.reduce((sum, c) => sum + c.expense, 0),
    }
  })
}
