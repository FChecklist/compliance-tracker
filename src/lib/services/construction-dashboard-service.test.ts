/// <reference types="bun-types" />
import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test"
import { readFileSync } from "node:fs"
import path from "node:path"
import { averageLatestPercent, resolveProjectMoney } from "./construction-dashboard-service"
import { computeCategoryProgress, computeEarnedValue } from "./construction-reports-service"
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
  // R67 integration fix: this only ever looked for `export async function`,
  // which was true of every function it was asked about when it was written.
  // The one-statement rewrite moved the per-project money and budget decisions
  // into the PURE, synchronous toProjectDashboard(), so the helper now finds
  // either form -- otherwise a guard asked about a real exported function
  // fails with "expected > -1" and looks like a missing implementation.
  const start = (() => {
    const asAsync = CODE.indexOf(`export async function ${name}(`)
    if (asAsync !== -1) return asAsync
    return CODE.indexOf(`export function ${name}(`)
  })()
  expect(start).toBeGreaterThan(-1)
  const next = CODE.indexOf("\nexport ", start + 1)
  return CODE.slice(start, next === -1 ? undefined : next)
}

// R67 F-03. listProjectsForSelection() exists so PROJEXA's 50 project-scoped
// pages stop resolving "which project am I on" through getOrgDashboard() --
// the earned-value/BOQ/invoice aggregate. Its whole value is being cheap, so
// the guard is that it stays cheap: one transaction, and none of the
// expensive tables. Same static-source posture as the rest of this file
// (a unit test cannot open a real pool), with the same honest limits.
describe("construction-dashboard-service: listProjectsForSelection stays a cheap single read", () => {
  test("opens exactly one withTenantContext transaction", () => {
    const body = functionBody("listProjectsForSelection")
    expect(body.match(/withTenantContext\(/g)?.length).toBe(1)
  })

  test("reads only `projects` -- no BOQ, progress, invoice or budget tables", () => {
    const body = functionBody("listProjectsForSelection")
    for (const forbidden of [
      "constructionBoqs",
      "constructionBoqLineItems",
      "constructionWorkProgressEntries",
      "erpSalesInvoices",
      "erpBudgetLineItems",
      "erpPurchaseOrders",
      "pmsIssues",
    ]) {
      expect(body).not.toContain(forbidden)
    }
    expect(body).toContain("db.query.projects.findMany")
  })

  test("does not call the enablement check or any earned-value helper", () => {
    const body = functionBody("listProjectsForSelection")
    expect(body).not.toMatch(/isConstructionEnabledForOrg\(/)
    expect(body).not.toMatch(/computeEarnedValue\(/)
  })

  test("selects only the three fields the picker needs", () => {
    const body = functionBody("listProjectsForSelection")
    expect(body).toMatch(/columns:\s*\{\s*id:\s*true,\s*name:\s*true,\s*status:\s*true\s*\}/)
  })
})

// R67 F-01. PROJEXA's overview screen read progressPercent by calling
// GET /dashboard/{id} once per project on top of the org payload -- an N+1 of
// HTTP requests against a five-connection pool. getOrgDashboard() now carries
// the figure itself, computed by ONE grouped query inside the transaction it
// already holds.
describe("construction-dashboard-service: getOrgDashboard carries progressPercent", () => {
  // R67 second-merge fix: progressPercent lives on the NAMED per-project type
  // OrgDashboardProjectSummary now (E-06's second merge folded F-01's inline
  // `projects: {...}[]` shape into the named type OrgDashboardSummary.projects
  // already used), not inlined directly under OrgDashboardSummary's own block.
  test("the per-project summary type declares progressPercent", () => {
    const typeStart = CODE.indexOf("export type OrgDashboardProjectSummary")
    expect(typeStart).toBeGreaterThan(-1)
    const typeBlock = CODE.slice(typeStart, CODE.indexOf("\nexport ", typeStart + 1))
    expect(typeBlock).toContain("progressPercent: number")
  })

  test("it is derived from a grouped query, not a per-project call", () => {
    const body = functionBody("getOrgDashboard")
    expect(body).toMatch(/GROUP BY latest\.project_id/)
    expect(body).toMatch(/DISTINCT ON \(e\.activity_id\)/)
    expect(body).toContain("progressPercent: Math.round(progressMap.get(p.id) ?? 0)")
    // the whole point: no getProjectDashboard fan-out reappears here
    expect(body).not.toMatch(/getProjectDashboard\s*\(/)
  })

  test("the added query still runs on the already-open transaction handle", () => {
    // `db.execute` is the outer transaction's handle -- a second
    // withTenantContext would be the regression the suite above guards.
    const body = functionBody("getOrgDashboard")
    expect(body).toMatch(/const progressByProject = \(await db\.execute\(/)
  })
})

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
  // R67 D-02: the statement now returns how many erp_budget_line_items rows the
  // budget CTE matched, so "no budget set" (0) and "a budget of zero" stay
  // distinguishable. This fixture is a project that HAS a budget.
  budget_lines: 4,
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

  test("no EXTRA query was added for it", () => {
    // One activity read, one permit read -- the two the E-01 block already
    // pinned. A per-project fan-out over the progress table would be the
    // regression this guards against.
    const progressReads = body.match(/construction_work_progress_entries/g) ?? []
    // getOrgDashboard reads that table FOUR times in total, all of them
    // grouped/batched, never per-project: once for the activity percentages
    // (which now also carries entry_date), twice inside the earned-value
    // block (quantities and latest percent per BOQ line), and once more for
    // F-01's own grouped progressPercent-per-project query (landed on main
    // after this guard was written; folded in, not fanned out -- see the
    // "batched, not per-project" describe block above).
    expect(progressReads.length).toBe(4)
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
    // R67 D-02 (second-merge fold-in): the statement also asks for `lines` --
    // the row COUNT that tells "no budget set" (0 lines) apart from "a real
    // budget that sums to zero" (lines > 0). This fixture is never about that
    // distinction (it always has a real ledger row), so lines is a fixed 1.
    if (keys === "lines,total") return [{ total: opts.ledgerTotal, lines: 1 }]
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

// R67 D-02 (audit R-004/R-009): "no budget has been set" and "the budget is
// zero" are different facts, and both dashboards used to return 0 for both --
// which is what made PROJEXA's home render "AED 0" as a real figure and every
// Budget-vs-Actual tile claim the project was over budget on its first
// expense. Both totals are now count-gated: null unless at least one
// erp_budget_line_items row matched. Held here in the same static-source style
// as the guards above (this repo runs `bun test` with no live Postgres behind
// it, so the SQL itself cannot be executed in a unit test) -- these assertions
// catch the exact regression, a re-introduced `?? 0` on either budget read.
describe("construction-dashboard-service: a missing ERP ledger budget is null, never 0", () => {
  // R67 integration note. When this lane was written, getProjectDashboard()
  // still ran its own ~10 sequential aggregates and owned a `budgetRow` local,
  // so this guard was a source-shape assertion over that function's body. Lane
  // F-27 (merged first) replaced all of it with ONE statement plus the pure,
  // exported toProjectDashboard(). The rule under test has not changed -- a
  // project with no erp_budget_line_items rows reports null, never 0 -- so the
  // assertion is restated against the code that now decides it. That is a
  // stronger test than the one it replaces: it exercises real behaviour rather
  // than matching source text.
  //
  // Second-merge note (R67 E-06 landed after this guard was written and split
  // the field this guard originally checked, `budget`, into two: `budget` is
  // now the BOQ-derived figure (see the E-06 describe block above) and
  // `ledgerBudget` is the ERP annual-ledger figure this guard actually tests.
  // Restated against `ledgerBudget` -- the null-vs-zero rule this guard exists
  // for is unchanged, only the field's name moved.
  test("toProjectDashboard reports ledgerBudget null when the budget CTE matched NO line items", async () => {
    const { toProjectDashboard } = await loadService()

    // A real, deliberately-zero budget: rows exist and they sum to zero.
    expect(toProjectDashboard({ ...SQL_ROW, budget: 0, budget_lines: 4 }, true).ledgerBudget).toBe(0)
    // Nobody has set a budget at all: no rows matched.
    expect(toProjectDashboard({ ...SQL_ROW, budget: 0, budget_lines: 0 }, true).ledgerBudget).toBeNull()
    // And a real budget is still a real budget.
    expect(toProjectDashboard({ ...SQL_ROW, budget: 900_000, budget_lines: 4 }, true).ledgerBudget).toBe(900_000)
  })

  test("the batched statement asks for the budget row COUNT, so the two cases stay distinguishable", () => {
    const body = functionBody("getProjectDashboards")
    expect(body).toMatch(/count\(bli\.id\)::int AS lines/)
    expect(body).toMatch(/coalesce\(budget\.lines, 0\)::int AS budget_lines/)
  })

  test("getOrgDashboard returns totalLedgerBudget from the row COUNT, not a coalesced sum", () => {
    const body = functionBody("getOrgDashboard")
    expect(body).toMatch(/lines:\s*sql<number>`count\(/)
    expect(body).toMatch(/totalLedgerBudget:\s*Number\(budgetTotal\?\.lines \?\? 0\) > 0 \? Number\(budgetTotal!\.total\) : null/)
    expect(body).not.toMatch(/totalLedgerBudget:\s*Number\(budgetTotal\?\.total \?\? 0\)/)
  })

  test("getOrgDashboard's empty-scope early returns report a null ledger budget too, not 0", () => {
    const body = functionBody("getOrgDashboard")
    expect(body).not.toMatch(/totalLedgerBudget:\s*0\b/)
    expect(body.match(/totalLedgerBudget:\s*null/g)?.length).toBe(2)
  })

  test("both public types declare the nullable ledger budget, so every consumer is forced to handle it", () => {
    expect(CODE).toMatch(/ledgerBudget:\s*number \| null/)
    expect(CODE).toMatch(/totalLedgerBudget:\s*number \| null/)
  })
})

// ─── R67 D-62: one project-money model ───────────────────────────────────────
//
// resolveProjectMoney() is pure, so unlike the guards above these are real
// behaviour tests, not source-shape assertions.
describe("R67 D-62 resolveProjectMoney", () => {
  const NONE = { enteredProjectValue: null, purchaseOrderTotal: null, boqContractValue: null, earnedValue: null }

  test("a user-entered value wins over the purchase orders and says so", () => {
    const money = resolveProjectMoney({ ...NONE, enteredProjectValue: 1_200_000, purchaseOrderTotal: 800_000 })
    expect(money.projectValue).toBe(1_200_000)
    expect(money.projectValueSource).toBe("entered")
  })

  test("with no entered value the purchase orders answer, and are named as the source", () => {
    const money = resolveProjectMoney({ ...NONE, purchaseOrderTotal: 800_000 })
    expect(money.projectValue).toBe(800_000)
    expect(money.projectValueSource).toBe("purchase_orders")
  })

  test("projectValue is null -- never 0 -- when neither source exists", () => {
    const money = resolveProjectMoney(NONE)
    expect(money.projectValue).toBeNull()
    expect(money.projectValueSource).toBeNull()
  })

  test("an entered value of 0 is a real figure and is kept, not treated as absent", () => {
    const money = resolveProjectMoney({ ...NONE, enteredProjectValue: 0, purchaseOrderTotal: 800_000 })
    expect(money.projectValue).toBe(0)
    expect(money.projectValueSource).toBe("entered")
  })

  test("projectValue never falls back to the BOQ (Rajat's ruling on projects.projectValue)", () => {
    const money = resolveProjectMoney({ ...NONE, boqContractValue: 5_000_000 })
    expect(money.projectValue).toBeNull()
    expect(money.projectValueSource).toBeNull()
    expect(money.contractValue).toBe(5_000_000)
  })

  test("contractValue and earnedValue pass through untouched, null when there is no BOQ", () => {
    expect(resolveProjectMoney({ ...NONE, boqContractValue: 500, earnedValue: 125 })).toEqual({
      contractValue: 500,
      projectValue: null,
      projectValueSource: null,
      earnedValue: 125,
    })
    expect(resolveProjectMoney(NONE).contractValue).toBeNull()
    expect(resolveProjectMoney(NONE).earnedValue).toBeNull()
  })
})

describe("R67 D-62: the home dashboard reads the SAME money model", () => {
  test("getOrgDashboard builds each project's money through resolveProjectMoney", () => {
    const body = functionBody("getOrgDashboard")
    expect(body).toMatch(/resolveProjectMoney\(\{/)
    expect(body).toMatch(/projectValueSource: money\.projectValueSource/)
  })

  test("getOrgDashboard reads projectValue and the PO totals it never had before", () => {
    const body = functionBody("getOrgDashboard")
    expect(body).toMatch(/columns:\s*\{ id: true, name: true, projectValue: true \}/)
    expect(body).toMatch(/erpPurchaseOrders/)
  })

  test("the PO sum is ONE grouped query, not one per project (R43_MGR_01's pool rule)", () => {
    const body = functionBody("getOrgDashboard")
    expect(body).toMatch(/\.groupBy\(erpPurchaseOrders\.projectId\)/)
    expect(body.match(/from\(erpPurchaseOrders\)/g)?.length).toBe(1)
  })

  // Same integration note as the budget guard above: the per-project money now
  // resolves inside the pure toProjectDashboard() that lane F-27's one-statement
  // rewrite introduced, so this is restated as a behaviour test over that
  // function rather than a text match on getProjectDashboard's old body.
  test("the per-project dashboard reports the same three named facts, from the same helper", async () => {
    const { toProjectDashboard } = await loadService()

    const entered = toProjectDashboard({ ...SQL_ROW, project_value: "1200000", po_total: "800000" }, true)
    expect(entered.projectValue).toBe(1_200_000)
    expect(entered.projectValueSource).toBe("entered")

    const derived = toProjectDashboard({ ...SQL_ROW, project_value: null, po_total: "800000" }, true)
    expect(derived.projectValue).toBe(800_000)
    expect(derived.projectValueSource).toBe("purchase_orders")

    const neither = toProjectDashboard({ ...SQL_ROW, project_value: null, po_total: null }, true)
    expect(neither.projectValue).toBeNull()
    expect(neither.projectValueSource).toBeNull()
    // ...and contractValue is still the BOQ's own figure, never projectValue.
    expect(neither.contractValue).toBe(5_000)
  })

  test("the batch resolves its money through resolveProjectMoney, not a second private copy of the rule", () => {
    const body = functionBody("toProjectDashboard")
    expect(body).toMatch(/resolveProjectMoney\(\{/)
    expect(body).toMatch(/projectValueSource: money\.projectValueSource/)
    // The private resolveProjectValue() that stated the same rule is gone.
    expect(CODE).not.toMatch(/function resolveProjectValue\(/)
  })

  // Second-merge note (R67 E-06): `value` is now also the input to the
  // per-project overspend check (spendOverValue), so getOrgDashboard binds it
  // to a local rather than inlining `money.contractValue` at the return site.
  // Still the exact same figure, just named once instead of repeated.
  test("`value` survives only as an exact alias of contractValue, so old readers are not broken", () => {
    const body = functionBody("getOrgDashboard")
    expect(body).toMatch(/const value = money\.contractValue/)
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

// ---------------------------------------------------------------------------
// R67 F-14 (R-215) / F-15 (R-232) -- the two folded-in panels.
//
// THE FAULT. PROJEXA's project dashboard made two extra calls of its own for
// exactly this data -- GET /api/reports/category-progress and
// GET /api/work-progress -- and each of those opened its OWN transaction on the
// five-connection app_runtime pool to re-read what getProjectDashboard had just
// read. Folding them in removes two round trips AND two pooled connections per
// dashboard view.
//
// CORRECTED BY THE R67 INTEGRATION MERGE (F-14 x F-27, decision D-11). These
// tests were written against F-14's own implementation, which read the
// categories, the activities and the recent entries with four separate ORM
// calls on the open handle. F-27's batched single-statement version is
// canonical, so the panels are now three more CTEs in that ONE statement and
// the fixture below is a SQL row rather than a stack of db.query stubs. Two
// assertions necessarily moved with the mechanism and are marked where they
// did: the per-activity averaging and the "gone activity" name resolution are
// now done in SQL, so they are pinned as source assertions over the emitted
// statement instead of as arithmetic over stubbed ORM rows.
// ---------------------------------------------------------------------------

const F14_CATEGORY_ROWS = [
  { id: "c1", name: "Substructure" },
  { id: "c2", name: "Superstructure" },
]
const F14_ACTIVITY_ROWS = [
  { id: "a1", categoryId: "c1" },
  { id: "a2", categoryId: "c1" },
  { id: "a3", categoryId: "c2" },
]
// a1 at 60% and a3 at 30%; a2 has never been logged, so the statement's
// activity_latest CTE has no row for it at all.
const F14_ACTIVITY_PERCENTS = [
  { activityId: "a1", percent: 60 },
  { activityId: "a3", percent: 30 },
]
const F14_RECENT_ENTRIES = [
  { id: "e1", activityId: "a1", activityName: "Excavation", entryDate: "2026-09-02", quantityDone: "12", percentComplete: "60" },
  // The LEFT JOIN in recent_ranked is what produces this null: the entry's
  // activity row is gone, so the name is NULL rather than the raw id.
  { id: "e2", activityId: "a9", activityName: null, entryDate: "2026-09-01", quantityDone: "4", percentComplete: "10" },
]

const F14_SQL_ROW = {
  ...SQL_ROW,
  category_rows: F14_CATEGORY_ROWS,
  activity_rows: F14_ACTIVITY_ROWS,
  activity_percents: F14_ACTIVITY_PERCENTS,
  recent_entries: F14_RECENT_ENTRIES,
}

describe("getProjectDashboard: category progress and recent entries ride on the ONE statement", () => {
  async function runF14() {
    const original = fakeDb.execute
    fakeDb.execute = async () => {
      executeCalls += 1
      return [F14_SQL_ROW]
    }
    try {
      const { getProjectDashboard } = await loadService()
      return await getProjectDashboard({ orgId: ORG }, PROJECT)
    } finally {
      fakeDb.execute = original
    }
  }

  test("both panels arrive without a second statement or a second transaction", async () => {
    const result = await runF14()

    expect(result.categories).toHaveLength(2)
    expect(result.recentEntries).toHaveLength(2)
    expect(executeCalls).toBe(1)
    expect(transactionCount).toBe(1)
  })

  test("the payload carries categories, averaged per category exactly as the named report does", async () => {
    const result = await runF14()
    // c1: a1 at 60, a2 never logged (counts as 0) -> 30. c2: a3 at 30 -> 30.
    expect(result.categories).toEqual([
      { categoryId: "c1", name: "Substructure", percentComplete: 30 },
      { categoryId: "c2", name: "Superstructure", percentComplete: 30 },
    ])
  })

  test("the category arithmetic really is computeCategoryProgress, not a second implementation", async () => {
    const result = await runF14()
    expect(result.categories).toEqual(
      computeCategoryProgress(
        F14_CATEGORY_ROWS,
        F14_ACTIVITY_ROWS,
        new Map(F14_ACTIVITY_PERCENTS.map((r) => [r.activityId, r.percent]))
      )
    )
  })

  test("the payload carries the recent entries, newest first, with their activity's name", async () => {
    const result = await runF14()
    expect(result.recentEntries.map((e) => e.id)).toEqual(["e1", "e2"])
    expect(result.recentEntries[0].activityName).toBe("Excavation")
  })

  test("an entry whose activity is gone reports a null name, never the raw id", async () => {
    const result = await runF14()
    const orphan = result.recentEntries.find((e) => e.id === "e2")
    expect(orphan?.activityName).toBeNull()
    expect(orphan?.activityId).toBe("a9")
  })

  test("a project with neither panel populated reports empty lists, never null", async () => {
    const original = fakeDb.execute
    fakeDb.execute = async () => {
      executeCalls += 1
      return [{ ...SQL_ROW, category_rows: null, activity_rows: null, activity_percents: null, recent_entries: null }]
    }
    try {
      const { getProjectDashboard } = await loadService()
      const result = await getProjectDashboard({ orgId: ORG }, PROJECT)
      expect(result.categories).toEqual([])
      expect(result.recentEntries).toEqual([])
    } finally {
      fakeDb.execute = original
    }
  })

  // MOVED MECHANISM, stated rather than dropped. Before the merge this was
  // arithmetic over stubbed ORM rows ("progressPercent still averages the
  // LATEST entry per logged activity"); F-27 does it in SQL, so what is left
  // to pin is that the statement still takes the LATEST entry per activity and
  // averages those, and that a recent entry's name comes from a LEFT JOIN so a
  // deleted activity yields NULL rather than dropping the row.
  test("the statement still averages the LATEST entry per activity, and LEFT JOINs the recent entries' names", () => {
    const body = functionBody("getProjectDashboards")
    expect(body).toContain("DISTINCT ON (e.activity_id)")
    expect(body).toContain("ORDER BY e.activity_id, e.entry_date DESC")
    expect(body).toContain("avg(percent_complete)")
    expect(body).toContain("LEFT JOIN compliance.construction_activities a ON a.id = e.activity_id")
  })

  // R67 F-15 (R-232/R-251). The static guard at the top of this file pins the
  // SHAPE of the source; this pins the BEHAVIOUR, which is what actually cost
  // production 25 minutes of pool: the construction-enablement check --
  // itself a withTenantContext transaction, via isBranchEnabledForOrg -- must
  // resolve BEFORE this function takes a connection of its own, so one request
  // never holds two of the five app_runtime slots.
  test("the enablement check runs ONCE, and completes before the transaction opens", async () => {
    const order: string[] = []
    const orderedTransaction = mock(async (_ctx: { orgId: string }, fn: (db: unknown) => Promise<unknown>) => {
      order.push("transaction")
      return fn(fakeDb as unknown as never)
    })
    const enablementSpy = mock(async () => {
      order.push("enablement")
      return true
    })
    await mock.module("@/lib/db/tenant-scoped", () => ({ withTenantContext: orderedTransaction }))
    await mock.module("./construction-enablement-service", () => ({ isConstructionEnabledForOrg: enablementSpy }))
    const { getProjectDashboard } = await import("./construction-dashboard-service")

    await getProjectDashboard({ orgId: ORG }, PROJECT)

    expect(enablementSpy.mock.calls.length).toBe(1)
    expect(order).toEqual(["enablement", "transaction"])
  })
})
