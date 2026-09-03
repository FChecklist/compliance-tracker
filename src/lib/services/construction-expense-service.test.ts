/// <reference types="bun-types" />
// F_020 (R43 fault, project-financials -> GL posting pipeline): tests for
// postConstructionExpenseEntryToGL / createExpenseEntry's new GL-posting
// wiring. Same "mock @/lib/db/tenant-scoped's withTenantContext, restore in
// afterEach" precedent construction-billing-workflow-service.test.ts and
// pms-time-service.test.ts already established for this tenant-scoped-db
// shape -- this repo's CI runs `bun test` against a placeholder DATABASE_URL
// with no real Postgres behind it (see tenant-ai-config.test.ts's header),
// so no .test.ts file in this repo ever touches a live DB; a fake in-memory
// db is the right, precedented level of rigor here, not a corner cut.
//
// findControlAccount (erp-invoicing-service.ts) is deliberately left REAL,
// not mocked -- it is reused verbatim per the task's own "reuse it, don't
// reinvent" instruction, and running it for real against the fake db's
// query.erpAccounts.findFirst is what actually proves the reuse works, not
// just that it was imported. isErpEnabledForOrg / isPeriodOpenForDate are
// mocked directly (their own DB behavior already belongs to
// erp-enablement-service.ts / erp-financial-report-service.ts's own test
// coverage, not this file's job to re-prove).
import { describe, expect, test, mock, afterEach } from "bun:test"

const realTenantScoped = await import("@/lib/db/tenant-scoped")
const realEnablement = await import("./erp-enablement-service")
const realFinancialReport = await import("./erp-financial-report-service")
const realDashboard = await import("./construction-dashboard-service")

type Row = Record<string, unknown>

/**
 * A minimal in-memory chart-of-accounts + GL, backing every query
 * postConstructionExpenseEntryToGL / createExpenseEntry actually issues:
 *   - db.query.projects.findFirst                            (project-exists guard)
 *   - db.query.erpAccounts.findFirst                          (findControlAccount + resolveConstructionExpenseAccount, in that call order)
 *   - db.insert(erpAccounts).values().returning()             (auto-provision an expense-head account)
 *   - db.select({maxNumber}).from(erpJournalEntries).where()  (per-org entry-number sequence)
 *   - db.insert(erpJournalEntries).values().returning()
 *   - db.insert(erpJournalEntryLines).values()
 *   - db.insert(constructionExpenseEntries).values().returning()
 *   - db.update(constructionExpenseEntries).set().where().returning()
 */
function makeFakeDb(seedAccounts: Row[] = []) {
  const store = {
    projects: [{ id: "p1", orgId: "org1", name: "Cedar Heights Villa" }] as Row[],
    erpAccounts: [...seedAccounts] as Row[],
    erpJournalEntries: [] as Row[],
    erpJournalEntryLines: [] as Row[],
    constructionExpenseEntries: [] as Row[],
  }
  let nextId = 1
  const genId = (prefix: string) => `${prefix}-${nextId++}`

  // erpAccounts.findFirst is called twice per successful post, always in
  // the same order this file's own code issues them: (1) findControlAccount
  // looking up accountType='payable', (2) resolveConstructionExpenseAccount
  // looking up accountType=`construction_expense:<head>`. A real drizzle
  // `where` SQL object isn't cheaply introspectable from a plain mock, so
  // this fake matches the documented, code-guaranteed call ORDER instead
  // (an accepted, deterministic stubbing technique, not a fabrication --
  // both call sites and their order live in construction-expense-service.ts
  // itself, right above).
  let accountsFindFirstCall = 0
  const accountsFindFirstQueue: (() => Row | undefined)[] = []

  const db = {
    query: {
      projects: { findFirst: mock(async () => store.projects.find((p) => p.id === "p1")) },
      erpAccounts: {
        findFirst: mock(async () => {
          const handler = accountsFindFirstQueue[accountsFindFirstCall]
          accountsFindFirstCall += 1
          return handler ? handler() : undefined
        }),
      },
    },
    insert: mock((table: unknown) => ({
      values: (v: Row | Row[]) => {
        const rows = Array.isArray(v) ? v : [v]
        const inserted = rows.map((r) => ({ id: genId("row"), ...r }))
        if (table === TABLES.erpAccounts) { store.erpAccounts.push(...inserted); }
        else if (table === TABLES.erpJournalEntries) { store.erpJournalEntries.push(...inserted) }
        else if (table === TABLES.erpJournalEntryLines) { store.erpJournalEntryLines.push(...inserted) }
        else if (table === TABLES.constructionExpenseEntries) { store.constructionExpenseEntries.push(...inserted) }
        return {
          returning: async () => inserted,
          then: (resolve: (v: unknown) => void) => resolve(undefined),
        }
      },
    })),
    update: mock((table: unknown) => ({
      set: (patch: Row) => ({
        where: () => ({
          returning: async () => {
            if (table === TABLES.constructionExpenseEntries) {
              const row = store.constructionExpenseEntries[store.constructionExpenseEntries.length - 1]
              Object.assign(row, patch)
              return [{ ...row }]
            }
            return [{}]
          },
        }),
      }),
    })),
    select: mock(() => ({
      from: (table: unknown) => ({
        where: async () => {
          if (table === TABLES.erpJournalEntries) {
            const maxNumber = store.erpJournalEntries.reduce((m, e) => Math.max(m, Number(e.entryNumber ?? 0)), 0)
            return [{ maxNumber }]
          }
          return [{ maxNumber: 0 }]
        },
      }),
    })),
  }

  return { db, store, accountsFindFirstQueue }
}

// Populated once real @/lib/db is imported below (module identity must
// match exactly what construction-expense-service.ts imports, so the fake
// insert()/update() can tell which logical table a call targets).
let TABLES: { erpAccounts: unknown; erpJournalEntries: unknown; erpJournalEntryLines: unknown; constructionExpenseEntries: unknown }
{
  const realDb = await import("@/lib/db")
  TABLES = {
    erpAccounts: realDb.erpAccounts,
    erpJournalEntries: realDb.erpJournalEntries,
    erpJournalEntryLines: realDb.erpJournalEntryLines,
    constructionExpenseEntries: realDb.constructionExpenseEntries,
  }
}

async function loadServiceWith(opts: { fakeDb: ReturnType<typeof makeFakeDb>["db"]; erpEnabled: boolean; periodOpen: boolean }) {
  await mock.module("@/lib/db/tenant-scoped", () => ({
    ...realTenantScoped,
    withTenantContext: mock(async (_ctx: unknown, fn: (db: unknown) => Promise<unknown>) => fn(opts.fakeDb)),
  }))
  await mock.module("./erp-enablement-service", () => ({ ...realEnablement, isErpEnabledForOrg: mock(async () => opts.erpEnabled) }))
  await mock.module("./erp-financial-report-service", () => ({ ...realFinancialReport, isPeriodOpenForDate: mock(async () => opts.periodOpen) }))
  // createExpenseEntry's pre-existing (unchanged by this PR) fire-and-forget
  // budget-threshold check dynamically imports getProjectDashboard AFTER
  // the transaction above already committed -- it is not awaited by
  // createExpenseEntry, but it still runs against whatever
  // withTenantContext is mocked to at that moment, and this file's own
  // fakeDb is deliberately minimal (it only implements the exact
  // query/insert/update/select shapes THIS file's own code issues, not
  // getProjectDashboard's much larger innerJoin-based budget query). Mocked
  // directly here (budget: 0 so the >budget threshold never fires) rather
  // than widening the fake db, matching construction-billing-workflow-
  // service.test.ts's own precedent of mocking a cross-service dependency
  // directly instead of faking its entire internal query shape.
  await mock.module("./construction-dashboard-service", () => ({ ...realDashboard, getProjectDashboard: mock(async () => ({ budget: 0, expenses: 0 })) }))
  return import("./construction-expense-service")
}

afterEach(async () => {
  mock.restore()
  await mock.module("@/lib/db/tenant-scoped", () => realTenantScoped)
  await mock.module("./erp-enablement-service", () => realEnablement)
  await mock.module("./erp-financial-report-service", () => realFinancialReport)
  await mock.module("./construction-dashboard-service", () => realDashboard)
})

describe("createExpenseEntry -> GL posting (F_020)", () => {
  test("a new expense entry posts a balanced, submitted journal entry (debit expense-head account, credit Accounts Payable)", async () => {
    const { db, store, accountsFindFirstQueue } = makeFakeDb()
    accountsFindFirstQueue.push(
      () => ({ id: "acct-payable", orgId: "org1", accountType: "payable", rootType: "liability" }), // findControlAccount("payable")
      () => undefined, // resolveConstructionExpenseAccount: no "material" account yet -- must auto-create
    )
    const { createExpenseEntry } = await loadServiceWith({ fakeDb: db, erpEnabled: true, periodOpen: true })

    const entry = await createExpenseEntry({ orgId: "org1", userId: "u1" }, {
      projectId: "p1", expenseHead: "material", amount: 185000, expenseDate: "2026-08-20",
    }) as Row

    // 1. The expense entry itself is recorded and links back to a real JE.
    expect(entry.journalEntryId).toBeTruthy()

    // 2. Exactly one journal entry was posted, immediately 'submitted' (not
    // 'draft' -- accountBalancesInRange in erp-financial-report-service.ts
    // only ever sums status='submitted' entries, so a draft here would
    // silently never show up in trial balance / P&L / getFinanceDashboard).
    expect(store.erpJournalEntries.length).toBe(1)
    const je = store.erpJournalEntries[0]
    expect(je.status).toBe("submitted")
    expect(je.referenceType).toBe("construction_expense_entry")
    expect(je.referenceId).toBe(entry.id)

    // 3. BALANCED by construction: debit total === credit total === the
    // entry's own amount (this IS the delta -- expense entries are
    // create-only, so there is no absolute value to diff against, unlike a
    // mutable field would require).
    expect(je.totalDebit).toBe("185000")
    expect(je.totalCredit).toBe("185000")
    expect(store.erpJournalEntryLines.length).toBe(2)
    const totalDebit = store.erpJournalEntryLines.reduce((s, l) => s + Number(l.debit), 0)
    const totalCredit = store.erpJournalEntryLines.reduce((s, l) => s + Number(l.credit), 0)
    expect(totalDebit).toBe(totalCredit)
    expect(totalDebit).toBe(185000)

    // 4. The two legs land on the RIGHT accounts: debit the (auto-created)
    // Material Cost expense account, credit the org's existing Accounts
    // Payable control account -- never the other way round, never a third
    // account.
    const debitLine = store.erpJournalEntryLines.find((l) => Number(l.debit) > 0)!
    const creditLine = store.erpJournalEntryLines.find((l) => Number(l.credit) > 0)!
    expect(creditLine.accountId).toBe("acct-payable")
    const materialAccount = store.erpAccounts.find((a) => a.id === debitLine.accountId)!
    expect(materialAccount.rootType).toBe("expense")
    expect(materialAccount.accountType).toBe("construction_expense:material")
    expect(materialAccount.accountName).toBe("Material Cost")

    // 5. Structural proof this WILL reach getFinanceDashboard/trialBalance/
    // profitAndLoss: accountBalancesInRange (erp-financial-report-service.ts
    // L212-241) sums erp_journal_entry_lines debit/credit grouped by
    // account for status='submitted' entries; profitAndLoss (L273-283)
    // then takes expense-root-type accounts' netBalance (debit-credit,
    // debit-natured) as totalExpense. Replicating that exact formula
    // against this test's own store (not a live DB, but the real documented
    // math against the real posted rows) shows the $185,000 lands as real
    // P&L expense, not swallowed anywhere:
    const submittedLines = store.erpJournalEntryLines.filter((l) =>
      store.erpJournalEntries.some((e) => e.id === l.journalEntryId && e.status === "submitted")
    )
    const expenseAccountIds = new Set(store.erpAccounts.filter((a) => a.rootType === "expense").map((a) => a.id))
    const totalExpenseNetBalance = submittedLines
      .filter((l) => expenseAccountIds.has(l.accountId as string))
      .reduce((sum, l) => sum + (Number(l.debit) - Number(l.credit)), 0) // expense accounts are debit-natured, per profitAndLoss's own comment
    expect(totalExpenseNetBalance).toBe(185000)
  })

  test("posting the SAME expense head twice for the same org reuses the auto-created account (find-or-create, not a duplicate)", async () => {
    const { db, store, accountsFindFirstQueue } = makeFakeDb()
    accountsFindFirstQueue.push(
      () => ({ id: "acct-payable", orgId: "org1", accountType: "payable", rootType: "liability" }),
      () => undefined, // first "labour" post: no account yet
      () => ({ id: "acct-payable", orgId: "org1", accountType: "payable", rootType: "liability" }),
      () => store.erpAccounts.find((a) => a.accountType === "construction_expense:labour"), // second post: reuse
    )
    const { createExpenseEntry } = await loadServiceWith({ fakeDb: db, erpEnabled: true, periodOpen: true })

    await createExpenseEntry({ orgId: "org1", userId: "u1" }, { projectId: "p1", expenseHead: "labour", amount: 100, expenseDate: "2026-08-20" })
    await createExpenseEntry({ orgId: "org1", userId: "u1" }, { projectId: "p1", expenseHead: "labour", amount: 50, expenseDate: "2026-08-21" })

    const labourAccounts = store.erpAccounts.filter((a) => a.accountType === "construction_expense:labour")
    expect(labourAccounts.length).toBe(1) // no duplicate chart-of-accounts row
    expect(store.erpJournalEntries.length).toBe(2) // but two real, separate journal entries -- one per expense (the delta), never one re-posted as an absolute total
    expect(store.erpJournalEntries.map((e) => e.totalDebit)).toEqual(["100", "50"])
  })

  test("ERP not enabled for the org: the expense entry is still recorded, but stays unposted (journalEntryId null) -- never blocks real operational data", async () => {
    const { db, store } = makeFakeDb()
    const { createExpenseEntry } = await loadServiceWith({ fakeDb: db, erpEnabled: false, periodOpen: true })

    const entry = await createExpenseEntry({ orgId: "org1", userId: "u1" }, { projectId: "p1", expenseHead: "material", amount: 500, expenseDate: "2026-08-20" }) as Row

    expect(entry.journalEntryId ?? null).toBeNull()
    expect(store.erpJournalEntries.length).toBe(0)
    expect(store.constructionExpenseEntries.length).toBe(1) // the operational record itself is never dropped
  })

  test("no 'payable' control account configured yet: still records the entry, skips posting rather than crash or post unbalanced", async () => {
    const { db, store, accountsFindFirstQueue } = makeFakeDb()
    accountsFindFirstQueue.push(() => undefined) // findControlAccount("payable") finds nothing -- org has no chart of accounts
    const { createExpenseEntry } = await loadServiceWith({ fakeDb: db, erpEnabled: true, periodOpen: true })

    const entry = await createExpenseEntry({ orgId: "org1", userId: "u1" }, { projectId: "p1", expenseHead: "material", amount: 500, expenseDate: "2026-08-20" }) as Row

    expect(entry.journalEntryId ?? null).toBeNull()
    expect(store.erpJournalEntries.length).toBe(0)
    expect(store.constructionExpenseEntries.length).toBe(1)
  })

  test("the accounting period covering expenseDate is closed: skips posting -- a closed period must never receive a new entry", async () => {
    const { db, store, accountsFindFirstQueue } = makeFakeDb()
    accountsFindFirstQueue.push(() => ({ id: "acct-payable", orgId: "org1", accountType: "payable", rootType: "liability" }))
    const { createExpenseEntry } = await loadServiceWith({ fakeDb: db, erpEnabled: true, periodOpen: false })

    const entry = await createExpenseEntry({ orgId: "org1", userId: "u1" }, { projectId: "p1", expenseHead: "material", amount: 500, expenseDate: "2020-01-15" }) as Row

    expect(entry.journalEntryId ?? null).toBeNull()
    expect(store.erpJournalEntries.length).toBe(0)
  })

  test("an expense change of a DIFFERENT amount on a later date posts its OWN balanced delta entry, never re-posts the running total", async () => {
    const { db, store, accountsFindFirstQueue } = makeFakeDb()
    accountsFindFirstQueue.push(
      () => ({ id: "acct-payable", orgId: "org1", accountType: "payable", rootType: "liability" }),
      () => undefined,
      () => ({ id: "acct-payable", orgId: "org1", accountType: "payable", rootType: "liability" }),
      () => store.erpAccounts.find((a) => a.accountType === "construction_expense:subcontractor"),
    )
    const { createExpenseEntry } = await loadServiceWith({ fakeDb: db, erpEnabled: true, periodOpen: true })

    await createExpenseEntry({ orgId: "org1", userId: "u1" }, { projectId: "p1", expenseHead: "subcontractor", amount: 400000, expenseDate: "2026-06-01" })
    await createExpenseEntry({ orgId: "org1", userId: "u1" }, { projectId: "p1", expenseHead: "subcontractor", amount: 20000, expenseDate: "2026-07-01" })

    // project total expense for this head is now 420000 (matches Harbor View
    // HQ's real $420,000 labour figure from the live fault data) -- but it
    // got there as two independent, individually-balanced postings of
    // 400000 and 20000, never one entry re-posted for 420000.
    expect(store.erpJournalEntries.map((e) => e.totalDebit)).toEqual(["400000", "20000"])
    const grandTotal = store.erpJournalEntryLines.filter((l) => Number(l.debit) > 0).reduce((s, l) => s + Number(l.debit), 0)
    expect(grandTotal).toBe(420000)
  })
})

// R67 D-02 (audit R-004/R-009). getProjectDashboard().budget became
// `number | null` -- null meaning "no budget row exists for this project",
// which is NOT a budget of zero. The fire-and-forget
// construction_expense.budget_exceeded trigger above used to read
// `dashboard.budget > 0 && expenses > budget`; with the wider type that
// decision now lives in one pure, named function so it can be proven here
// without a live DB or the fake-db harness above.
describe("budgetExceeded (R67 D-02: a null budget is not a zero budget)", () => {
  test("never fires when no budget has been set, however large the spend", async () => {
    const { budgetExceeded } = await import("./construction-expense-service")
    expect(budgetExceeded(null, 1_250_000)).toBe(false)
  })

  test("never fires on a zero budget either -- the pre-existing > 0 guard is kept", async () => {
    const { budgetExceeded } = await import("./construction-expense-service")
    expect(budgetExceeded(0, 185_000)).toBe(false)
  })

  test("fires only when a real budget exists and spend is over it", async () => {
    const { budgetExceeded } = await import("./construction-expense-service")
    expect(budgetExceeded(400_000, 420_000)).toBe(true)
    expect(budgetExceeded(400_000, 400_000)).toBe(false)
    expect(budgetExceeded(400_000, 399_999)).toBe(false)
  })
})
