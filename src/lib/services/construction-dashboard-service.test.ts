/// <reference types="bun-types" />
import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test"
import { readFileSync } from "node:fs"
import path from "node:path"
import { resolveProjectMoney } from "./construction-dashboard-service"
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

// R67 D-02 (audit R-004/R-009): "no budget has been set" and "the budget is
// zero" are different facts, and both dashboards used to return 0 for both --
// which is what made PROJEXA's home render "AED 0" as a real figure and every
// Budget-vs-Actual tile claim the project was over budget on its first
// expense. Both totals are now count-gated: null unless at least one
// erp_budget_line_items row matched. Held here in the same static-source style
// as the guards above (this repo runs `bun test` with no live Postgres behind
// it, so the SQL itself cannot be executed in a unit test) -- these assertions
// catch the exact regression, a re-introduced `?? 0` on either budget read.
describe("construction-dashboard-service: a missing budget is null, never 0", () => {
  // R67 integration note. When this lane was written, getProjectDashboard()
  // still ran its own ~10 sequential aggregates and owned a `budgetRow` local,
  // so this guard was a source-shape assertion over that function's body. Lane
  // F-27 (merged first) replaced all of it with ONE statement plus the pure,
  // exported toProjectDashboard(). The rule under test has not changed -- a
  // project with no erp_budget_line_items rows reports null, never 0 -- so the
  // assertion is restated against the code that now decides it. That is a
  // stronger test than the one it replaces: it exercises real behaviour rather
  // than matching source text.
  test("toProjectDashboard reports null when the budget CTE matched NO line items", async () => {
    const { toProjectDashboard } = await loadService()

    // A real, deliberately-zero budget: rows exist and they sum to zero.
    expect(toProjectDashboard({ ...SQL_ROW, budget: 0, budget_lines: 4 }, true).budget).toBe(0)
    // Nobody has set a budget at all: no rows matched.
    expect(toProjectDashboard({ ...SQL_ROW, budget: 0, budget_lines: 0 }, true).budget).toBeNull()
    // And a real budget is still a real budget.
    expect(toProjectDashboard({ ...SQL_ROW, budget: 900_000, budget_lines: 4 }, true).budget).toBe(900_000)
  })

  test("the batched statement asks for the budget row COUNT, so the two cases stay distinguishable", () => {
    const body = functionBody("getProjectDashboards")
    expect(body).toMatch(/count\(bli\.id\)::int AS lines/)
    expect(body).toMatch(/coalesce\(budget\.lines, 0\)::int AS budget_lines/)
  })

  test("getOrgDashboard returns totalBudget from the row COUNT, not a coalesced sum", () => {
    const body = functionBody("getOrgDashboard")
    expect(body).toMatch(/lines:\s*sql<number>`count\(/)
    expect(body).toMatch(/totalBudget:\s*Number\(budgetTotal\?\.lines \?\? 0\) > 0 \? Number\(budgetTotal!\.total\) : null/)
    expect(body).not.toMatch(/totalBudget:\s*Number\(budgetTotal\?\.total \?\? 0\)/)
  })

  test("getOrgDashboard's empty-scope early returns report a null budget too, not 0", () => {
    const body = functionBody("getOrgDashboard")
    expect(body).not.toMatch(/totalBudget:\s*0\b/)
    expect(body.match(/totalBudget:\s*null/g)?.length).toBe(2)
  })

  test("both public types declare the nullable budget, so every consumer is forced to handle it", () => {
    expect(CODE).toMatch(/budget:\s*number \| null/)
    expect(CODE).toMatch(/totalBudget:\s*number \| null/)
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

  test("`value` survives only as an exact alias of contractValue, so old readers are not broken", () => {
    const body = functionBody("getOrgDashboard")
    expect(body).toMatch(/value: money\.contractValue/)
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
