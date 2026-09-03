/// <reference types="bun-types" />
import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test"
import { readFileSync } from "node:fs"
import path from "node:path"
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
  const start = CODE.indexOf(`export async function ${name}(`)
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
  test("the summary type declares progressPercent per project", () => {
    const typeStart = CODE.indexOf("export type OrgDashboardSummary")
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
const EV_ITEMS = [
  {
    id: "line-1",
    boqId: "boq-1",
    parentLineItemId: null,
    rate: "50",
    amount: "5000",
    breakdownPercentage: null,
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
    expect(d.budget).toBe(900_000)
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
