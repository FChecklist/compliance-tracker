/// <reference types="bun-types" />
import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test"
import { readFileSync } from "node:fs"
import path from "node:path"
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
