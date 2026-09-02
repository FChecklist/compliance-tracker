import { describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import path from "node:path"

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
