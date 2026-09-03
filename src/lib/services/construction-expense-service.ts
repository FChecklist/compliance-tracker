// Wave 120 (PROJEXA foundation) service layer -- expense-head
// classification (material/labour/transport/subcontractor/equipment/misc)
// per project. A thin rollup layer: entries optionally point back at their
// real source row (erp_purchase_invoice / erp_cash_voucher /
// construction_attendance) via linkedEntityType/linkedEntityId, but this
// table is never the source of truth for the underlying transaction.
//
// F_020 (R43 fault, project-financials -> GL posting pipeline, 2026-08-28):
// until now, NOTHING ever posted a journal entry when an expense entry was
// recorded here -- confirmed live: org ve45lczmkodbiq1m20fy48r5 ("Demo
// Organization") had 3 real expense entries (Cedar Heights Villa $185,000,
// Riverside Business Park $1,250,000, Harbor View HQ $420,000) and ZERO
// erp_journal_entries rows, which is exactly why the Accounting module
// (getFinanceDashboard/trialBalance/profitAndLoss -- all of which sum only
// STATUS='submitted' erp_journal_entry_lines, see
// erp-financial-report-service.ts's accountBalancesInRange) showed all
// zeros while the construction dashboards (which sum this table directly)
// showed real numbers. postConstructionExpenseEntryToGL below closes that
// gap: createExpenseEntry now posts a real, balanced, immediately-submitted
// journal entry (debit the expense-head's GL account, credit the org's
// Accounts Payable control account -- an incurred-but-not-yet-paid
// construction cost, the standard accrual-basis treatment, matching how
// erp-invoicing-service.ts's submitPurchaseInvoice treats an unpaid
// supplier bill) for every new entry, in the SAME transaction as the
// insert.
//
// Delta-safety: this table is create-only (no update/delete route exists
// anywhere in this codebase -- confirmed by grep), so every row IS its own
// delta by construction. There is no absolute "project.expense" value to
// diff against and no risk of re-posting a changed total, unlike a
// mutable field would require.
//
// Deliberately non-blocking when GL posting genuinely cannot happen yet:
// expense-entry logging is real operational construction data independent
// of whether an org has purchased/configured the ERP accounting module, so
// createExpenseEntry() must keep succeeding for orgs that haven't enabled
// ERP (erp_accounts is a per-org opt-in chart -- see
// erp-enablement-service.ts) or that enabled it before this fix shipped and
// have no chart of accounts yet, or when the accounting period covering
// expenseDate is already closed (a closed period must never receive a new
// posting -- that is the entire point of closing it, matching
// submitJournalEntry/submitSalesInvoice's own isPeriodOpenForDate gate).
// journalEntryId simply stays null in those cases -- a real, honest "not
// posted yet" state, never a fabricated one.
import { constructionExpenseEntries, projects, erpAccounts, erpJournalEntries, erpJournalEntryLines } from "@/lib/db"
import { withTenantContext, type TenantDb } from "@/lib/db/tenant-scoped"
import { and, eq, sql } from "drizzle-orm"
import { ServiceError } from "./compliance-service"
export { ServiceError }
import { findControlAccount } from "./erp-invoicing-service"
import { isErpEnabledForOrg } from "./erp-enablement-service"
import { isPeriodOpenForDate } from "./erp-financial-report-service"

export type ExpenseEntryInput = {
  projectId: string
  expenseHead: string
  description?: string
  amount: number
  expenseDate: string
  linkedEntityType?: string
  linkedEntityId?: string
  /** R65 (Rework Analysis report): true when this entry is the cost of redoing work already done once, under any expenseHead. Defaults false. */
  isRework?: boolean
}

const VALID_HEADS = ["material", "labour", "transport", "subcontractor", "equipment", "misc"]

// The chart-of-accounts side of the mapping below. Each construction
// expense_head gets its own dedicated expense account, auto-provisioned
// (expand-only -- INSERTs a new erp_accounts row, never touches an existing
// one) the first time that head is ever posted for an org. Deliberately
// NOT guessed onto one of the org's existing generic expense accounts
// (Rent Expense / Office & Admin Expense / Cost of Goods Sold / Salaries &
// Wages -- none of which map unambiguously to "material" or
// "subcontractor"): this mirrors erp-invoicing-service.ts's OWN documented
// discipline for the identical ambiguity ("requiring an explicit
// revenue/expense account per submission -- there's no reliable
// per-item-group account mapping in this schema yet, so guessing which
// revenue/expense account applies would risk silently wrong postings").
// accountType uses a distinct, filterable, admin-extensible tag
// (`construction_expense:<head>`), matching schema.ts's own documented
// "accountType is deliberately free text ... for admin-extensible
// classification that doesn't need a schema migration to add a new value"
// convention.
const EXPENSE_HEAD_ACCOUNT_LABELS: Record<string, string> = {
  material: "Material Cost",
  labour: "Labour Cost",
  transport: "Transport Cost",
  subcontractor: "Subcontractor Cost",
  equipment: "Equipment Cost",
  misc: "Miscellaneous Construction Expense",
}

function expenseHeadAccountType(expenseHead: string): string {
  return `construction_expense:${expenseHead}`
}

/** Find-or-create (idempotent, per org) the dedicated GL expense account for one construction expense_head. */
async function resolveConstructionExpenseAccount(db: TenantDb, orgId: string, expenseHead: string) {
  const accountType = expenseHeadAccountType(expenseHead)
  const existing = await db.query.erpAccounts.findFirst({ where: and(eq(erpAccounts.orgId, orgId), eq(erpAccounts.accountType, accountType)) })
  if (existing) return existing

  const [created] = await db.insert(erpAccounts).values({
    orgId,
    accountName: EXPENSE_HEAD_ACCOUNT_LABELS[expenseHead] ?? `Construction Expense - ${expenseHead}`,
    rootType: "expense",
    accountType,
    isGroup: false,
  }).returning()
  return created
}

/**
 * Posts one construction expense entry to the GL: debit the expense-head
 * account, credit Accounts Payable, both legs = entry.amount (so the entry
 * is balanced by construction, not by a post-hoc check). Immediately
 * 'submitted' (not 'draft') -- there is no manual review step for these
 * (matching erp-invoicing-service.ts's submitSalesInvoice/
 * submitPurchaseInvoice pattern of inserting straight into 'submitted'
 * status, not the separate draft-then-submit flow createJournalEntry/
 * submitJournalEntry use for hand-authored entries), because only
 * 'submitted' entries are ever summed by accountBalancesInRange (trial
 * balance / P&L / balance sheet / getFinanceDashboard all filter
 * status='submitted' -- see erp-financial-report-service.ts) and there is
 * no human review workflow for a construction expense entry today.
 *
 * Returns null (never throws for these two specific, expected, non-error
 * conditions) when posting genuinely cannot happen yet:
 *   - ERP module not enabled for this org
 *   - no 'payable' control account configured (findControlAccount's own
 *     ServiceError -- see erp-enablement-service.ts's seedDefaultErpFoundation,
 *     which guarantees this account exists for every org enabling ERP from
 *     now on; only pre-existing orgs that enabled ERP before that fix, or
 *     never enabled it, can still be missing one)
 *   - the accounting period covering expenseDate is already closed
 * Any OTHER error (a real DB failure, a schema mismatch) propagates and
 * rolls back the whole transaction, including the expense-entry insert --
 * never silently swallowed.
 */
export async function postConstructionExpenseEntryToGL(
  db: TenantDb,
  ctx: { orgId: string; userId: string },
  entry: { id: string; projectId: string; expenseHead: string; amount: string; expenseDate: string }
): Promise<{ journalEntryId: string } | null> {
  if (!(await isErpEnabledForOrg(ctx.orgId))) return null

  let payableAccount
  try {
    payableAccount = await findControlAccount(db, ctx.orgId, "payable")
  } catch (err) {
    if (err instanceof ServiceError) return null
    throw err
  }

  const periodOpen = await isPeriodOpenForDate({ orgId: ctx.orgId }, entry.expenseDate)
  if (!periodOpen) return null

  const expenseAccount = await resolveConstructionExpenseAccount(db, ctx.orgId, entry.expenseHead)

  const [{ maxNumber }] = await db.select({ maxNumber: sql<number>`coalesce(max(${erpJournalEntries.entryNumber}), 0)` }).from(erpJournalEntries).where(eq(erpJournalEntries.orgId, ctx.orgId))

  const [je] = await db.insert(erpJournalEntries).values({
    orgId: ctx.orgId,
    entryNumber: Number(maxNumber) + 1,
    postingDate: entry.expenseDate,
    referenceType: "construction_expense_entry",
    referenceId: entry.id,
    userRemark: `Construction expense (${entry.expenseHead}) -- project ${entry.projectId}`,
    status: "submitted",
    totalDebit: entry.amount,
    totalCredit: entry.amount,
    createdById: ctx.userId,
    submittedAt: new Date(),
  }).returning()

  await db.insert(erpJournalEntryLines).values([
    { journalEntryId: je.id, accountId: expenseAccount.id, debit: entry.amount, credit: "0" },
    { journalEntryId: je.id, accountId: payableAccount.id, debit: "0", credit: entry.amount },
  ])

  return { journalEntryId: je.id }
}

export async function listExpenseEntries(ctx: { orgId: string }, projectId: string) {
  return withTenantContext({ orgId: ctx.orgId }, (db) =>
    db.query.constructionExpenseEntries.findMany({
      where: and(eq(constructionExpenseEntries.orgId, ctx.orgId), eq(constructionExpenseEntries.projectId, projectId)),
      orderBy: (t, { desc }) => desc(t.expenseDate),
    })
  )
}

export async function createExpenseEntry(ctx: { orgId: string; userId: string }, input: ExpenseEntryInput) {
  if (!input.projectId) throw new ServiceError("projectId is required", 400)
  if (!VALID_HEADS.includes(input.expenseHead)) throw new ServiceError(`expenseHead must be one of: ${VALID_HEADS.join(", ")}`, 400)
  if (!input.expenseDate) throw new ServiceError("expenseDate is required", 400)
  if (!(input.amount > 0)) throw new ServiceError("amount must be positive", 400)

  return withTenantContext({ orgId: ctx.orgId, userId: ctx.userId }, async (db) => {
    const project = await db.query.projects.findFirst({ where: and(eq(projects.id, input.projectId), eq(projects.orgId, ctx.orgId)) })
    if (!project) throw new ServiceError("Project not found", 404)

    const [row] = await db.insert(constructionExpenseEntries).values({
      orgId: ctx.orgId, projectId: input.projectId,
      expenseHead: input.expenseHead as typeof constructionExpenseEntries.$inferInsert.expenseHead,
      description: input.description || null, amount: String(input.amount), expenseDate: input.expenseDate,
      linkedEntityType: input.linkedEntityType || null, linkedEntityId: input.linkedEntityId || null,
      isRework: input.isRework === true,
      recordedById: ctx.userId,
    }).returning()

    const posting = await postConstructionExpenseEntryToGL(db, ctx, row)
    if (!posting) return row

    const [posted] = await db.update(constructionExpenseEntries)
      .set({ journalEntryId: posting.journalEntryId })
      .where(eq(constructionExpenseEntries.id, row.id))
      .returning()
    return posted
  }).then((row) => {
    // Wave 126: fire-and-forget automation trigger. Threshold check
    // (actual > budget) happens here in the calling service, not in the
    // generic automation-rule-service.ts engine, since TriggerCondition
    // only supports operator "equals" -- passing a pre-resolved boolean
    // avoids extending that shared engine's condition grammar.
    void import("./construction-dashboard-service").then(({ getProjectDashboard }) =>
      getProjectDashboard({ orgId: ctx.orgId }, row.projectId).then((dashboard) => {
        // R67 E-06 (R-108): dashboard.budget is now the BOQ-derived budget and
        // is null (not 0) when the project has no BOQ. The threshold is
        // unchanged -- "there is a budget, and spend has passed it" -- but it
        // is now measured against the figure a QS actually maintains, instead
        // of an ERP ledger row a construction org typically never fills in,
        // which is why this alert could not fire before.
        if (dashboard.budget !== null && dashboard.budget > 0 && dashboard.expenses > dashboard.budget) {
          void import("./automation-rule-service").then(({ evaluateAndRunRules }) =>
            evaluateAndRunRules({ orgId: ctx.orgId }, "construction_expense.budget_exceeded", {
              projectId: row.projectId, budget: dashboard.budget, expenses: dashboard.expenses,
            })
          )
        }
      })
    )
    return row
  })
}

/** Sum of expense amounts for a project, grouped by expense head -- the building block for the Expense Report (Wave 122) and the project dashboard's `expenses` figure (Wave 121). */
export async function getExpenseSummaryByHead(ctx: { orgId: string }, projectId: string) {
  return withTenantContext({ orgId: ctx.orgId }, (db) =>
    db.select({
      expenseHead: constructionExpenseEntries.expenseHead,
      total: sql<number>`coalesce(sum(${constructionExpenseEntries.amount}), 0)::float`,
    })
      .from(constructionExpenseEntries)
      .where(and(eq(constructionExpenseEntries.orgId, ctx.orgId), eq(constructionExpenseEntries.projectId, projectId)))
      .groupBy(constructionExpenseEntries.expenseHead)
  )
}
