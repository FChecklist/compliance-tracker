import { describe, expect, test } from "bun:test"
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
