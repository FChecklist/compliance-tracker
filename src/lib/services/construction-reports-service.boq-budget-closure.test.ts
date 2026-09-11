/// <reference types="bun-types" />
// Split out of construction-reports-service.test.ts (seq4/c5 de-share,
// 2026-09-11): that file cited 5 requirements over the 3-per-file cap. This
// file carries the other 3: R-33, R-C11, R-52.
//
// R-33 (sumRootLineBudgets, moved verbatim, self-contained): summation
// correctness -- "no double-counting weighted sub-tasks". R-33 has no test
// literally labeled with its own ID in the source file; the mapping to
// sumRootLineBudgets rests on the disambiguating comment that sat directly
// above the R-52 describe block there ("R-33's already-covered concern,
// sumRootLineBudgets above"), which explicitly separates R-33 (summation)
// from R-52 (BOQ selection) as two distinct requirements sharing this one
// file. Flagged here as inherited, not re-derived independently.
//
// R-C11 (single test, extracted out of a larger describe block that also
// held ~10 unrelated R67 E-08 acceptance tests staying behind in the
// original file): the LINES fixture it reads by closure is duplicated
// locally since the sibling tests it originally shared that fixture with
// are intentionally not moved here.
//
// R-52 (scopeReport, moved verbatim): BOQ-selection correctness -- a
// superseded row sorted first must not win over an older but still-active
// row. Needs the same "capture real modules, restore in afterEach" mock
// pattern as the original file (see designerTimesheetReport's block there),
// duplicated here since realTenantScoped/realEnablementService aren't
// exported by the source module itself.
import { describe, expect, test, mock, afterEach } from "bun:test"
import { sumRootLineBudgets, aggregateRevenueBudgetActual } from "./construction-reports-service"

const realTenantScoped = await import("@/lib/db/tenant-scoped")
const realEnablementService = await import("./construction-enablement-service")

describe("sumRootLineBudgets (R67 E-06)", () => {
  test("sums amount x budgetPercentage / 100 over the ROOT lines -- the item's own 2,193.75", () => {
    expect(sumRootLineBudgets([
      { parentLineItemId: null, amount: 5400, budgetPercentage: 25 },  // 1350
      { parentLineItemId: null, amount: 3375, budgetPercentage: 25 },  //  843.75
    ])).toBe(2193.75)
  })

  test("R-33: a weighted sub-task is NOT added again -- its amount is already inside its parent's", () => {
    const withChildren = sumRootLineBudgets([
      { parentLineItemId: null, amount: 5400, budgetPercentage: 25 },
      { parentLineItemId: "root-1", amount: 2700, budgetPercentage: 25 },
      { parentLineItemId: "root-1", amount: 2700, budgetPercentage: 25 },
    ])
    expect(withChildren).toBe(1350)
  })

  test("no lines at all is null, NEVER 0 -- 'no BOQ' is not 'a budget of nothing'", () => {
    expect(sumRootLineBudgets([])).toBeNull()
    expect(sumRootLineBudgets([{ parentLineItemId: "root-1", amount: 100, budgetPercentage: 25 }])).toBeNull()
  })

  test("a real BOQ worth zero still reports 0 -- absent and zero stay distinguishable in both directions", () => {
    expect(sumRootLineBudgets([{ parentLineItemId: null, amount: 0, budgetPercentage: 25 }])).toBe(0)
  })

  test("rounds ONCE at the end, so the total reconciles to a raw SQL sum over the same rows", () => {
    // Three lines whose individual budgets are 33.333..., summed then rounded.
    expect(sumRootLineBudgets([
      { parentLineItemId: null, amount: 100, budgetPercentage: 33.3333 },
      { parentLineItemId: null, amount: 100, budgetPercentage: 33.3333 },
      { parentLineItemId: null, amount: 100, budgetPercentage: 33.3334 },
    ])).toBe(100)
  })
})

describe("aggregateRevenueBudgetActual: category merge (R-C11 gap closure)", () => {
  // Same LINES fixture as the original file's "aggregateRevenueBudgetActual
  // (R67 E-08)" describe block -- duplicated here since this is the only one
  // of that block's ~10 tests belonging to this 5-requirement group.
  const LINES = [
    { lineItemId: "l1", code: "C-01", description: "Blockwork", category: "Civil", revenue: 5400, budget: 1350, vendorAmount: 1500, materialAmount: null, manpowerAmount: null },
    { lineItemId: "l2", code: "C-02", description: "Plaster", category: "Civil", revenue: 3375, budget: 843.75, vendorAmount: null, materialAmount: 400, manpowerAmount: 200 },
    { lineItemId: "l3", code: "J-01", description: "Wardrobes", category: "Joinery", revenue: 2000, budget: 500, vendorAmount: null, materialAmount: null, manpowerAmount: null },
  ]

  // R75 Part 2 Phase 3 (R-C11 gap closure): the original file's "ACCEPTANCE"
  // tests only assert that summed figures agree between scope-wise and
  // category-wise foldings -- a property that holds true even if "category"
  // grouping were silently broken (e.g. it fell back to one row per line,
  // exactly like "scope"), because a sum over ungrouped rows equals the same
  // sum over correctly-grouped rows either way. Nothing else actually proved
  // lines SHARING a category are merged into one row. LINES has l1+l2 both
  // "Civil" (l3 is the only "Joinery" line) -- this pins the real merge: row
  // count collapses from 3 lines to 2 categories, and the Civil row's
  // figures are the true sum of l1+l2, not a coincidental pass-through.
  test("R-C11: category-wise MERGES every line sharing a category into ONE row (not one row per line)", () => {
    const { rows } = aggregateRevenueBudgetActual(LINES, "category")

    expect(rows).toHaveLength(2)
    const civil = rows.find((r) => r.item === "Civil")!
    const joinery = rows.find((r) => r.item === "Joinery")!

    expect(civil.lineCount).toBe(2)
    expect(civil.revenue).toBe(5400 + 3375)
    expect(civil.budget).toBe(1350 + 843.75)
    // l1's actual is vendor-only (1500), l2's is material+manpower (600) --
    // the merged row must carry their real sum, 2100, not just l1's or l2's.
    expect(civil.actual).toBe(1500 + 600)

    expect(joinery.lineCount).toBe(1)
    expect(joinery.revenue).toBe(2000)
    expect(joinery.actual).toBeNull()
  })
})

// R75 Phase 3 (R74-RULING-03 closure for R-52 -- "Only the LATEST revision is
// selected"): the app resolves "the active BOQ" as .find(status !==
// "superseded") ?? position 0, NOT position 0 blindly, even when the DB's own
// sort (version+createdAt DESC) happens to put a superseded row first. This
// block is deliberately scoped to SELECTION only (which BOQ counts), not
// summation (R-33's already-covered concern, sumRootLineBudgets above) -- the
// fake select-chain returns a fixed canned value regardless of which boqId it
// was called with, same convention as the original file's fakeDbFor's ROW,
// so this test's own assertions are on report.boq/report.revisions, never
// report.totalValue.
describe("scopeReport (R75 Phase 3 / R-52): the DB-sorted-first-non-superseded BOQ wins, not array position 0 blindly", () => {
  afterEach(async () => {
    mock.restore()
    await mock.module("@/lib/db/tenant-scoped", () => realTenantScoped)
    await mock.module("./construction-enablement-service", () => realEnablementService)
  })

  const SUPERSEDED_NEWEST = { id: "boq-superseded", orgId: "org-r52", projectId: "proj-r52", version: 2, status: "superseded", title: "Superseded rev", createdAt: new Date("2026-02-01") }
  const ACTIVE_OLDER = { id: "boq-active", orgId: "org-r52", projectId: "proj-r52", version: 1, status: "approved", title: "Still-active v1", createdAt: new Date("2026-01-01") }

  function fakeDbMultiBoq(boqsInDbSortOrder: typeof SUPERSEDED_NEWEST[]) {
    const chain: Record<string, unknown> = {}
    chain.from = () => chain
    // Canned, boqId-independent -- see this block's own header on why.
    chain.where = async () => [{ total: 999, count: 1 }]
    return {
      query: {
        constructionBoqs: { findMany: async () => boqsInDbSortOrder },
        constructionBoqLineItems: { findMany: async () => [] },
      },
      select: () => chain,
    }
  }

  async function withMultiBoqFakeDb(boqsInDbSortOrder: typeof SUPERSEDED_NEWEST[]) {
    await mock.module("@/lib/db/tenant-scoped", () => ({
      ...realTenantScoped,
      withTenantContext: mock(async (_ctx: { orgId: string }, fn: (db: unknown) => Promise<unknown>) => fn(fakeDbMultiBoq(boqsInDbSortOrder))),
    }))
    await mock.module("./construction-enablement-service", () => ({
      ...realEnablementService,
      requireConstructionEnabled: mock(async () => {}),
      isConstructionEnabledForOrg: mock(async () => true),
      // R75 Part 2/3 (R-80 fix): construction-dashboard-service.ts's
      // getProjectDashboard(s)/getOrgDashboard now delegate to a WithDb
      // sibling that calls isConstructionEnabledForOrgWithDb (reusing the
      // caller's own db handle) instead of the plain, self-opening
      // isConstructionEnabledForOrg -- mock both so a real, unmocked call
      // never slips through to a real DB.
      isConstructionEnabledForOrgWithDb: mock(async () => true),
    }))
    return import("./construction-reports-service")
  }

  test("R-52: a superseded row sorted first (higher version) is skipped -- the older but still-active row is the one that counts", async () => {
    const { scopeReport } = await withMultiBoqFakeDb([SUPERSEDED_NEWEST, ACTIVE_OLDER])
    const report = await scopeReport({ orgId: "org-r52" }, "proj-r52")

    expect(report.boq).not.toBeNull()
    expect(report.boq!.id).toBe(ACTIVE_OLDER.id)
    expect(report.boq!.id).not.toBe(SUPERSEDED_NEWEST.id)
    // Both still surface in the revisions list -- R-52 is about what COUNTS,
    // not about hiding the history.
    expect(report.revisions.map((r) => r.id).sort()).toEqual([ACTIVE_OLDER.id, SUPERSEDED_NEWEST.id].sort())
  })

  test("when NEITHER row is superseded, DB sort order (position 0, already version+createdAt DESC) wins -- the app trusts Postgres's own ORDER BY, it does not re-sort", async () => {
    const bothActive = { ...SUPERSEDED_NEWEST, id: "boq-both-active", status: "approved" }
    const { scopeReport } = await withMultiBoqFakeDb([bothActive, ACTIVE_OLDER])
    const report = await scopeReport({ orgId: "org-r52" }, "proj-r52")
    expect(report.boq!.id).toBe(bothActive.id)
  })

  test("no BOQ at all reports null, not a crash", async () => {
    const { scopeReport } = await withMultiBoqFakeDb([])
    const report = await scopeReport({ orgId: "org-r52" }, "proj-r52")
    expect(report.boq).toBeNull()
    expect(report.totalValue).toBe(0)
    expect(report.revisions).toEqual([])
  })
})
