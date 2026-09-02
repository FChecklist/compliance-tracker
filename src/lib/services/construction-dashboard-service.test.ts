import { describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import path from "node:path"
import { resolveProjectMoney } from "./construction-dashboard-service"

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
  test("getProjectDashboard returns budget from the row COUNT, not a coalesced sum", () => {
    const body = functionBody("getProjectDashboard")
    expect(body).toMatch(/lines:\s*sql<number>`count\(/)
    expect(body).toMatch(/budget:\s*Number\(budgetRow\?\.lines \?\? 0\) > 0 \? Number\(budgetRow!\.total\) : null/)
    expect(body).not.toMatch(/budget:\s*Number\(budgetRow\?\.total \?\? 0\)/)
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

  test("getProjectDashboard reports the same three named facts", () => {
    const body = functionBody("getProjectDashboard")
    expect(body).toMatch(/resolveProjectMoney\(\{/)
    expect(body).toMatch(/projectValue: money\.projectValue/)
    expect(body).toMatch(/contractValue: money\.contractValue/)
  })

  test("`value` survives only as an exact alias of contractValue, so old readers are not broken", () => {
    const body = functionBody("getOrgDashboard")
    expect(body).toMatch(/value: money\.contractValue/)
  })
})
