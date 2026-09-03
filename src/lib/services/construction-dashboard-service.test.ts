import { afterEach, describe, expect, mock, test } from "bun:test"
import { readFileSync } from "node:fs"
import path from "node:path"
import { averageLatestPercent } from "./construction-dashboard-service"

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

  for (const fn of ["getProjectDashboard", "getOrgDashboard"]) {
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

    test(`${fn}: earned value is computed in-transaction with the pure computeEarnedValue()`, () => {
      const body = functionBody(fn)
      expect(body).toMatch(/computeEarnedValue\(/)
    })
  }

  test("only ONE withTenantContext per dashboard function (the outer one)", () => {
    for (const fn of ["getProjectDashboard", "getOrgDashboard"]) {
      const body = functionBody(fn)
      expect(body.match(/withTenantContext\(/g)?.length).toBe(1)
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
const realTenantScoped = await import("@/lib/db/tenant-scoped")
const realEnablement = await import("./construction-enablement-service")

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
