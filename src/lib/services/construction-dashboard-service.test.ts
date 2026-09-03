/// <reference types="bun-types" />
import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test"
import { readFileSync } from "node:fs"
import path from "node:path"
import { averageLatestPercent } from "./construction-dashboard-service"
import { computeEarnedValue } from "./construction-reports-service"
import { bustProjectDashboardCache, resetDashboardCache } from "./project-dashboard-cache"

// ---------------------------------------------------------------------------
// PART 1 -- structural guard, unchanged in intent.
// ---------------------------------------------------------------------------
//
// Regression guard for the app_runtime pool deadlock fixed 2026-09-02
// (R66 UX audit; compliance-tracker PR "fix(dashboard): nested-transaction
// pool deadlock"). The bug was structural, not arithmetic: both dashboard
// functions opened a withTenantContext transaction and then, from INSIDE it,
// called functions that open their own withTenantContext transactions
// (earnedValueReport -> requireConstructionEnabled -> isBranchEnabledForOrg),
// so one request held up to three of tenant-scoped.ts's five pooled
// connections and a handful of concurrent requests self-deadlocked --
// pg_stat_activity showed all five sessions "idle in transaction" for 25
// minutes. A unit test cannot open a real pool, so this guards the SHAPE of
// the source: the nested calls must not reappear inside the transactions.
//
// Static-source assertions are deliberate and honest about their limits:
// they catch the exact regression that shipped (re-adding
// earnedValueReport() or moving the enablement check back inside the
// transaction), not every possible way to nest a transaction.
//
// R67 F-27 retargeted these from getProjectDashboard to getProjectDashboards:
// the plural is now the function that opens the transaction, and the singular
// is a one-line wrapper over it, so the guard follows the transaction.

const SOURCE = readFileSync(path.join(import.meta.dir, "construction-dashboard-service.ts"), "utf8")

// Comments in this file legitimately mention the very calls this guard
// forbids (they explain the bug), so assertions run on comment-stripped code.
const CODE = SOURCE.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^[ \t]*\/\/.*$/gm, "")

function functionBody(name: string): string {
  const start = CODE.indexOf(`export async function ${name}(`)
  expect(start).toBeGreaterThan(-1)
  const next = CODE.indexOf("\nexport ", start + 1)
  return CODE.slice(start, next === -1 ? undefined : next)
}

describe("construction-dashboard-service: no nested withTenantContext transactions", () => {
  test("earnedValueReport() (two nested transactions) is not called anywhere in this file", () => {
    expect(CODE).not.toMatch(/\bearnedValueReport\s*\(/)
    expect(CODE).not.toMatch(/import\s*\{[^}]*\bearnedValueReport\b[^}]*\}/)
  })

  for (const fn of ["getProjectDashboards", "getOrgDashboard"]) {
    test(`${fn}: the construction-enablement check runs BEFORE its withTenantContext transaction, never inside it`, () => {
      const body = functionBody(fn)
      const enablement = body.indexOf("isConstructionEnabledForOrg(")
      const tx = body.indexOf("withTenantContext(")
      expect(enablement).toBeGreaterThan(-1)
      expect(tx).toBeGreaterThan(-1)
      expect(enablement).toBeLessThan(tx)
      // and it is called exactly once per function -- a second call inside
      // the transaction would be the regression
      expect(body.match(/isConstructionEnabledForOrg\(/g)?.length).toBe(1)
    })

    test(`${fn}: only ONE withTenantContext (the outer one)`, () => {
      expect(functionBody(fn).match(/withTenantContext\(/g)?.length).toBe(1)
    })
  }

  test("getProjectDashboard is a thin wrapper: it opens no transaction of its own", () => {
    const body = functionBody("getProjectDashboard")
    expect(body).not.toMatch(/withTenantContext\(/)
    expect(body).toMatch(/getProjectDashboards\(/)
  })

  test("earned value is still computed with the pure, SHARED computeEarnedValue() -- never a second summation path in SQL", () => {
    expect(CODE).toMatch(/computeEarnedValue\(/)
  })
})

// ---------------------------------------------------------------------------
// PART 2 -- R67 F-27 (audit recommendation R-243): ONE round trip, cached 60 s.
// ---------------------------------------------------------------------------
//
// getProjectDashboard used to run about TEN sequential aggregates against a
// remote pooler, one awaited after another. They are now one statement. The
// db below counts execute() calls, so "one round trip" is measured rather than
// asserted in a comment, and the earned value is checked against
// computeEarnedValue() run independently over the same fixture aggregates.

const ORG = "org-r67-f27"
const PROJECT = "project-r67-f27"

// One root BOQ line: 100 units at 50 = 5,000 of contract value, with 20 units
// measured as done. computeEarnedValue prefers a real measured quantity, so
// this is 20 x 50 = 1,000 earned, 20% by value.
//
// R67 E-06 carries budgetPercentage on these same rows, so the BOQ-derived
// budget comes out of the ONE statement that was already being run: 5,000 at
// 25% = 1,250.
const EV_ITEMS = [
  {
    id: "line-1",
    boqId: "boq-1",
    parentLineItemId: null,
    rate: "50",
    amount: "5000",
    breakdownPercentage: null,
    budgetPercentage: "25",
    qty: 20,
    percent: 35,
  },
]

const SQL_ROW = {
  project_id: PROJECT,
  project_name: "Oakwood Residence",
  budget: 900_000,
  revenue: 450_000,
  expenses: 120_000,
  progress_percent: 42.4,
  task_count: 12,
  delayed_task_count: 3,
  photo_count: 7,
  permits_expiring: 2,
  permits_expired: 1,
  project_value: null,
  po_total: "750000",
  ev_items: EV_ITEMS,
}

let executeCalls = 0
let transactionCount = 0

const fakeDb = {
  execute: async () => {
    executeCalls += 1
    return [SQL_ROW]
  },
}

const mockWithTenantContext = mock(async (_ctx: { orgId: string }, fn: (db: unknown) => Promise<unknown>) => {
  transactionCount += 1
  return fn(fakeDb as unknown as never)
})

const realTenantScoped = await import("@/lib/db/tenant-scoped")
const realEnablement = await import("./construction-enablement-service")

async function loadService(constructionEnabled = true) {
  await mock.module("@/lib/db/tenant-scoped", () => ({ withTenantContext: mockWithTenantContext }))
  await mock.module("./construction-enablement-service", () => ({
    isConstructionEnabledForOrg: mock(async () => constructionEnabled),
  }))
  return import("./construction-dashboard-service")
}

beforeEach(() => {
  executeCalls = 0
  transactionCount = 0
  mockWithTenantContext.mockClear()
  resetDashboardCache()
})

afterEach(async () => {
  resetDashboardCache()
  mock.restore()
  await mock.module("@/lib/db/tenant-scoped", () => realTenantScoped)
  await mock.module("./construction-enablement-service", () => realEnablement)
})

describe("getProjectDashboard -- R67 F-27: one SQL round trip, every figure", () => {
  test("issues EXACTLY ONE statement, in exactly one transaction", async () => {
    const { getProjectDashboard } = await loadService()

    await getProjectDashboard({ orgId: ORG }, PROJECT)

    expect(executeCalls).toBe(1)
    expect(transactionCount).toBe(1)
  })

  test("returns every figure the tiles render", async () => {
    const { getProjectDashboard } = await loadService()

    const d = await getProjectDashboard({ orgId: ORG }, PROJECT)

    expect(d.projectId).toBe(PROJECT)
    expect(d.projectName).toBe("Oakwood Residence")
    // R67 E-06 (R-108) SPLIT THESE TWO. `budget` is now the BOQ-derived figure
    // (5,000 x 25% = 1,250) that the Cost Variance screen and the Project
    // Status report also state, and the ERP annual ledger sum this statement
    // returns keeps its own name. Before the split, one tile read "TOTAL BUDGET
    // AED 0" off the ledger while Cost Variance read the BOQ figure.
    expect(d.budget).toBe(1_250)
    expect(d.ledgerBudget).toBe(900_000)
    expect(d.revenue).toBe(450_000)
    expect(d.expenses).toBe(120_000)
    // Rounded for display, same as before this change.
    expect(d.progressPercent).toBe(42)
    expect(d.taskCount).toBe(12)
    expect(d.delayedTaskCount).toBe(3)
    expect(d.photoCount).toBe(7)
    // R67 F-27: the "Permits Expiring" tile no longer needs its own request.
    expect(d.permitsExpiringCount).toBe(2)
    expect(d.permitsExpiredCount).toBe(1)
  })

  test("earnedValue matches computeEarnedValue over the SAME aggregates -- one summation path, not a second one in SQL", async () => {
    const { getProjectDashboard } = await loadService()

    const d = await getProjectDashboard({ orgId: ORG }, PROJECT)

    const expected = computeEarnedValue(
      EV_ITEMS,
      new Map(EV_ITEMS.map((i) => [i.id, i.qty])),
      new Map(EV_ITEMS.map((i) => [i.id, i.percent]))
    )
    expect(d.earnedValue).toBe(expected.earnedValue)
    expect(d.contractValue).toBe(expected.contractValue)
    expect(d.percentByValue).toBe(expected.percentByValue)
    // ...and the measured-quantity branch really is the one taken.
    expect(d.earnedValue).toBe(20 * 50)
  })

  test("with construction disabled the earned-value figures are null, never a fabricated 0", async () => {
    const { getProjectDashboard } = await loadService(false)

    const d = await getProjectDashboard({ orgId: ORG }, PROJECT)

    expect(d.earnedValue).toBeNull()
    expect(d.contractValue).toBeNull()
    expect(d.percentByValue).toBeNull()
  })

  test("projectValue falls back to the linked-PO sum when nobody typed one, and stays null when neither exists", async () => {
    const { toProjectDashboard } = await loadService()

    // Point 121: a human-entered value always WINS over the derived one.
    expect(toProjectDashboard({ ...SQL_ROW, project_value: "123", po_total: "750000" }, true).projectValue).toBe(123)
    expect(toProjectDashboard({ ...SQL_ROW, project_value: null, po_total: "750000" }, true).projectValue).toBe(750_000)
    // Neither source -- null, because a zero project value reads as a real figure.
    expect(toProjectDashboard({ ...SQL_ROW, project_value: null, po_total: null }, true).projectValue).toBeNull()
  })

  test("a project this org does not own is a 404, never an all-zero dashboard", async () => {
    const { getProjectDashboard, ServiceError } = await loadService()
    // The statement returns no row for an id that is not in this org.
    fakeDb.execute = async () => {
      executeCalls += 1
      return []
    }
    try {
      await expect(getProjectDashboard({ orgId: ORG }, "someone-elses-project")).rejects.toThrow(ServiceError)
    } finally {
      fakeDb.execute = async () => {
        executeCalls += 1
        return [SQL_ROW]
      }
    }
  })
})

// R67 E-01 (R-007). The home dashboard row needs the activity-log percentage
// beside the value-weighted one. This is the pure half of that rule, lifted
// out of getProjectDashboard so both dashboards read one definition.
describe("averageLatestPercent (R67 E-01)", () => {
  test("averages the latest logged percentage of every activity that HAS one", () => {
    expect(averageLatestPercent([100, 50, 0])).toBe(50)
  })

  test("rounds to a whole percent, the way the row renders it", () => {
    // 31.79 + 14.3 + 46.08 = 92.17 / 3 = 30.72 -> 31
    expect(averageLatestPercent([31.79, 14.3, 46.08])).toBe(31)
  })

  test("NO activity logged at all is null, never 0 -- 'not recorded' is not 'zero percent'", () => {
    // The dashboard rule treats a fabricated 0 as a failed card; the row
    // renders a hatched "No BOQ yet"/"—" state off this null instead.
    expect(averageLatestPercent([])).toBeNull()
  })

  test("a genuine, logged zero is still zero -- distinguishable from the empty case", () => {
    expect(averageLatestPercent([0, 0])).toBe(0)
  })
})

// The regression this guards is the SAME one the deadlock block above guards,
// in its newest shape: E-01 added three per-project figures (activity
// percentage, spend-over-value, permits expiring) and the obvious way to write
// them is one query per project inside the map. That is exactly the fan-out
// R43_MGR_01 removed. These assertions pin the batched shape.
describe("getOrgDashboard: the R67 E-01 additions are batched, not per-project", () => {
  const body = functionBody("getOrgDashboard")

  test("the per-project map callback issues no awaits of its own", () => {
    // Anchored on the ROW-BUILDING map specifically -- `projectRows.map` also
    // appears far earlier, where it is only collecting ids.
    const mapStart = body.indexOf("const projectSummaries")
    expect(mapStart).toBeGreaterThan(-1)
    // Everything from the map onwards is the row-building block plus the
    // return; a db call there would be the fan-out.
    const tail = body.slice(mapStart)
    expect(tail).not.toMatch(/\bawait\b/)
    expect(tail).not.toMatch(/\bdb\./)
  })

  test("permits and activity percentages are each read once, for every project at once", () => {
    // inArray(..., ids) is what makes it one query rather than N.
    expect(body).toMatch(/inArray\(constructionActivities\.projectId, ids\)/)
    expect(body).toMatch(/inArray\(documents\.linkedEntityId, ids\)/)
  })

  test("spendOverValue is false, never a claim, when there is no contract value to exceed", () => {
    expect(body).toMatch(/spendOverValue:\s*value !== null && expenses > value/)
  })

  // Fix pass. permitsExpiring30d is rendered by PROJEXA as literal words ("2
  // permits expiring in 30 days"), and the query shipped with only an upper
  // bound -- so a permit that expired six months ago satisfied
  // `expiryDate <= cutoff`, was counted, and lit a permanent "needs you" row
  // whose stated reason was false. The window must be closed at BOTH ends.
  test("the permit window has a lower bound, so an already-expired permit is not counted as expiring", () => {
    expect(body).toMatch(/gte\(documents\.expiryDate, permitFloor\)/)
    expect(body).toMatch(/lte\(documents\.expiryDate, permitCutoff\)/)
    // The floor is now, and the cutoff is measured FROM the floor, so the two
    // bounds cannot be read from two different clock ticks.
    expect(body).toMatch(/const permitFloor = new Date\(\)/)
    expect(body).toMatch(/const permitCutoff = new Date\(permitFloor\)/)
    // ...and the bounds still sit in the ONE grouped read, not a second query.
    expect((body.match(/\.from\(documents\)/g) ?? []).length).toBe(1)
  })
})

// R67 E-19 (R-180): the home screen's summary sentence needs a third signal --
// "nothing has moved on this project in a month". The fact it is derived from
// is the latest recorded progress entry per project, and the whole point is
// that it costs NO extra query: entry_date joins the DISTINCT ON row set that
// already exists for percentByActivity. A per-project read here is the exact
// shape R43_MGR_01 removed after it deadlocked the five-connection pool.
describe("getOrgDashboard: lastProgressAt rides the query that already runs (R67 E-19)", () => {
  const body = functionBody("getOrgDashboard")

  test("entry_date is selected by the SAME DISTINCT ON query that reads percent_complete", () => {
    expect(body).toMatch(/SELECT DISTINCT ON \(activity_id\) activity_id, percent_complete, entry_date/)
  })

  test("no second query was added for it", () => {
    // One activity read, one permit read -- the two the E-01 block already
    // pinned. A third db.execute over the progress table would be the fan-out.
    const progressReads = body.match(/construction_work_progress_entries/g) ?? []
    // getOrgDashboard reads that table twice in total: once for the activity
    // percentages (which now also carries entry_date) and twice inside the
    // earned-value block (quantities and latest percent per BOQ line).
    expect(progressReads.length).toBe(3)
  })

  test("it is folded per project by a plain string comparison, so no time zone can reorder it", () => {
    expect(body).toMatch(/if \(!current \|\| lastEntry > current\) lastProgressByProject\.set/)
    expect(body).toMatch(/lastProgressAt: lastProgressByProject\.get\(p\.id\) \?\? null/)
  })
})

describe("isoDay (R67 E-19)", () => {
  test("reduces both driver shapes to the same YYYY-MM-DD string", async () => {
    const { isoDay } = await import("./construction-dashboard-service")
    expect(isoDay("2026-09-01")).toBe("2026-09-01")
    // postgres.js can hand back a full timestamp for a date column depending on
    // its type parser; the day is what this figure means either way.
    expect(isoDay("2026-09-01T00:00:00.000Z")).toBe("2026-09-01")
    expect(isoDay(new Date("2026-09-01T10:30:00.000Z"))).toBe("2026-09-01")
  })

  test("an absent or unreadable date is null, never today", async () => {
    const { isoDay } = await import("./construction-dashboard-service")
    expect(isoDay(null)).toBeNull()
    expect(isoDay(undefined)).toBeNull()
    expect(isoDay("")).toBeNull()
    expect(isoDay("not a date")).toBeNull()
    expect(isoDay(new Date("nonsense"))).toBeNull()
  })
})

// R67 E-02 (R-012): the home's Filter drawer absorbs the retired
// /dashboard/hierarchy screen's selects and adds a date range. The rule these
// pin is the one that keeps the screen honest: the window narrows the two SUMS
// and nothing else, because contract value, earned value and the percentages
// are point-in-time facts about the current BOQ rather than sums over a
// window. Filtering them would make the bar disagree with itself.
describe("getOrgDashboard: the date range narrows revenue and spend ONLY (R67 E-02)", () => {
  const body = functionBody("getOrgDashboard")

  test("revenue is filtered on the invoice's own posting date", () => {
    expect(body).toMatch(/gte\(erpSalesInvoices\.postingDate, from\)/)
    expect(body).toMatch(/lte\(erpSalesInvoices\.postingDate, to\)/)
  })

  test("spend is filtered on the expense entry's own date", () => {
    expect(body).toMatch(/gte\(constructionExpenseEntries\.expenseDate, from\)/)
    expect(body).toMatch(/lte\(constructionExpenseEntries\.expenseDate, to\)/)
  })

  test("the BOQ reads carry no date bound at all -- they are not sums over a window", () => {
    const boqRead = body.slice(body.indexOf("latestBoqPerProject"), body.indexOf("const revenueMap"))
    // The two date bounds are only ever applied through gte(..., from) /
    // lte(..., to); neither appears anywhere in the BOQ value read. (A bare
    // /\bfrom\b/ would match drizzle's own .from(table), which is why this
    // asserts the comparators rather than the word.)
    expect(boqRead).not.toMatch(/gte\(/)
    expect(boqRead).not.toMatch(/lte\(/)
  })

  test("the response says whether a range was applied, so the screen can caption it", () => {
    expect(body).toMatch(/dateRangeApplied,/)
  })
})

// ---------------------------------------------------------------------------
// R67 E-06 (R-108). The home dashboard's "TOTAL BUDGET AED 0" tile.
//
// getOrgDashboard is a DB read, so this mocks only the DB layer and runs the
// real function -- same "capture real modules, restore in afterEach" pattern
// as construction-reports-service.test.ts's own mocked-DB block. What is being
// proved is the thing the item exists for: the portfolio budget is the sum of
// the projects' BOQ budgets, the ERP ledger figure is still returned under its
// own name, and an org with no BOQ anywhere reports null rather than 0.
// ---------------------------------------------------------------------------
// (realTenantScoped / realEnablement are captured once at the top of this file
// -- lane F2's portfolio-batch block above declares them for the same
// "capture, then restore in afterEach" purpose, so this block reuses them
// rather than shadowing them with a second identical pair.)

/**
 * A drizzle-shaped fake whose select() answers by the SHAPE of the projection
 * it was handed -- which is how each of getOrgDashboard's aggregates is told
 * apart without depending on the order they happen to run in.
 */
function fakeOrgDb(opts: { projects: { id: string; name: string }[]; boqByProject: Record<string, string>; valueByBoq: Record<string, { total: number; budget: number }>; ledgerTotal: number; boqLineItems?: unknown[] }) {
  const answerFor = (fields: Record<string, unknown>): unknown[] => {
    const keys = Object.keys(fields).sort().join(",")
    // The ERP annual ledger sum (erp_budget_line_items via the cost centre).
    if (keys === "total") return [{ total: opts.ledgerTotal }]
    // The per-BOQ root-line value AND budget -- one query, two figures.
    if (keys === "boqId,budget,total") {
      return Object.entries(opts.valueByBoq).map(([boqId, v]) => ({ boqId, total: v.total, budget: v.budget }))
    }
    // revenue / expenses / permits / task counts: none in this fixture, which
    // is deliberate -- this test is about the budget and nothing else.
    return []
  }
  return {
    query: {
      projects: { findMany: async () => opts.projects },
      constructionActivities: { findMany: async () => [] },
      constructionBoqLineItems: { findMany: async () => opts.boqLineItems ?? [] },
      users: { findMany: async () => [] },
    },
    select: (fields: Record<string, unknown>) => {
      const rows = answerFor(fields)
      // where() has to be BOTH awaitable (the aggregates that end there) and
      // chainable into groupBy() (the per-project ones) -- a promise carrying
      // the extra method is the smallest fake that is honest about both.
      const terminal = () => Object.assign(Promise.resolve(rows), { groupBy: async () => rows })
      const chain: Record<string, unknown> = {}
      chain.from = () => chain
      chain.innerJoin = () => chain
      chain.where = terminal
      chain.groupBy = async () => rows
      return chain
    },
    execute: async () => Object.entries(opts.boqByProject).map(([project_id, boq_id]) => ({ project_id, boq_id })),
  }
}

describe("getOrgDashboard: one budget number (R67 E-06)", () => {
  afterEach(async () => {
    mock.restore()
    await mock.module("@/lib/db/tenant-scoped", () => realTenantScoped)
    await mock.module("./construction-enablement-service", () => realEnablement)
  })

  async function run(db: unknown) {
    await mock.module("@/lib/db/tenant-scoped", () => ({
      ...realTenantScoped,
      withTenantContext: mock(async (_ctx: { orgId: string }, fn: (d: unknown) => Promise<unknown>) => fn(db)),
    }))
    await mock.module("./construction-enablement-service", () => ({
      ...realEnablement,
      isConstructionEnabledForOrg: mock(async () => true),
    }))
    const { getOrgDashboard } = await import("./construction-dashboard-service")
    return getOrgDashboard({ orgId: "org-e06" })
  }

  test("the portfolio budget is the sum of the projects' BOQ budgets, NOT the ERP ledger sum", async () => {
    const summary = await run(fakeOrgDb({
      projects: [{ id: "p1", name: "Cedar Heights" }, { id: "p2", name: "Riverside" }],
      boqByProject: { p1: "boq-1", p2: "boq-2" },
      valueByBoq: { "boq-1": { total: 8775, budget: 2193.75 }, "boq-2": { total: 4000, budget: 1000 } },
      ledgerTotal: 0,
    }))
    expect(summary.totalBudget).toBe(3193.75)
    expect(summary.projects.map((p) => p.budget)).toEqual([2193.75, 1000])
  })

  test("the ERP annual ledger figure is still returned, under its own name", async () => {
    const summary = await run(fakeOrgDb({
      projects: [{ id: "p1", name: "Cedar Heights" }],
      boqByProject: { p1: "boq-1" },
      valueByBoq: { "boq-1": { total: 8775, budget: 2193.75 } },
      ledgerTotal: 750000,
    }))
    expect(summary.totalLedgerBudget).toBe(750000)
    expect(summary.totalBudget).toBe(2193.75)
  })

  test("a project with no BOQ contributes nothing and reports budget null -- never a 0 that drags the total into a lie", async () => {
    const summary = await run(fakeOrgDb({
      projects: [{ id: "p1", name: "Cedar Heights" }, { id: "p2", name: "Unscoped" }],
      boqByProject: { p1: "boq-1" },
      valueByBoq: { "boq-1": { total: 8775, budget: 2193.75 } },
      ledgerTotal: 0,
    }))
    expect(summary.projects.find((p) => p.id === "p2")!.budget).toBeNull()
    expect(summary.totalBudget).toBe(2193.75)
  })

  test("an org where NOT ONE project has a BOQ reports totalBudget null, so the tile can say 'No BOQ yet'", async () => {
    const summary = await run(fakeOrgDb({
      projects: [{ id: "p1", name: "Cedar Heights" }],
      boqByProject: {},
      valueByBoq: {},
      ledgerTotal: 12000,
    }))
    expect(summary.totalBudget).toBeNull()
    expect(summary.totalLedgerBudget).toBe(12000)
  })
})

describe("getProjectDashboards -- the portfolio batch", () => {
  test("answers many projects in the SAME one statement, not one request each", async () => {
    const { getProjectDashboards } = await loadService()

    await getProjectDashboards({ orgId: ORG }, [PROJECT, "project-b", "project-c"])

    expect(executeCalls).toBe(1)
    expect(transactionCount).toBe(1)
  })

  test("an empty id list costs nothing at all", async () => {
    const { getProjectDashboards } = await loadService()

    expect(await getProjectDashboards({ orgId: ORG }, [])).toEqual([])
    expect(executeCalls).toBe(0)
    expect(transactionCount).toBe(0)
  })

  test("a duplicated id is asked for once and returned once", async () => {
    const { getProjectDashboards } = await loadService()

    const rows = await getProjectDashboards({ orgId: ORG }, [PROJECT, PROJECT])

    expect(rows).toHaveLength(1)
    expect(executeCalls).toBe(1)
  })
})

describe("the 60 s cache", () => {
  test("a second read inside the window costs NO round trip", async () => {
    const { getProjectDashboard } = await loadService()

    await getProjectDashboard({ orgId: ORG }, PROJECT)
    await getProjectDashboard({ orgId: ORG }, PROJECT)

    expect(executeCalls).toBe(1)
  })

  test("a write that busts the cache forces a recompute -- 'I just logged progress, where is it?' stays honest", async () => {
    const { getProjectDashboard } = await loadService()

    await getProjectDashboard({ orgId: ORG }, PROJECT)
    bustProjectDashboardCache(ORG, PROJECT)
    await getProjectDashboard({ orgId: ORG }, PROJECT)

    expect(executeCalls).toBe(2)
  })

  test("another org's read of the same project id is never served from this org's entry", async () => {
    const { getProjectDashboard } = await loadService()

    await getProjectDashboard({ orgId: ORG }, PROJECT)
    await getProjectDashboard({ orgId: "org-somebody-else" }, PROJECT)

    expect(executeCalls).toBe(2)
  })
})
