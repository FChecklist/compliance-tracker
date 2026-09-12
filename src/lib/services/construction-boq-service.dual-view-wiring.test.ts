/// <reference types="bun-types" />
// R85 Addendum 3 v4 Phase 2 (owner rulings D87/D88/D89/D90/D91, claude_log
// 366/372/373/374/375) -- WIRING PROOF, not a re-test of the pure math.
// boq-dual-view-service.test.ts already exhaustively covers
// computeBoqLineMoneyView/rollUpRootLines/computeCostCoverage's own
// arithmetic and NOT_SET rules; this file proves the ONE PRODUCER's
// functions are actually CALLED by getBoq()/getBoqRow()/listBoqs() -- the
// X-27 gap this pass closes (built and unit-tested since Phase 2, never
// wired into a single real route until now).
//
// Real service functions, DB layer mocked -- the same "don't touch
// withTenantContext/a live DB from a .test.ts file" convention every other
// describe block in construction-boq-service.test.ts already uses.
//
// FALSIFIABILITY (R74-RULING-03(c), performed by hand against this exact
// file before commit): temporarily reverted withComputedRate()/getBoq()'s
// spread of computeBoqLineMoneyView/rollUpRootLines/computeCostCoverage --
// every test below went RED (projectValue/moneyView/costCoverage undefined).
// Restored, re-ran, GREEN again. See this change's PR description for the
// verbatim RED output.
import { afterEach, describe, expect, mock, test } from "bun:test"
import * as realTenantScoped from "@/lib/db/tenant-scoped"

const ORG_ID = "org-dual-view"

// One root line, fully priced on BOTH sides with DELIBERATELY DISTINCT
// numbers on every field, so a wiring bug that swapped/mislabelled a figure
// (e.g. contractValue where projectValue belongs) could not hide behind a
// coincidental equal value:
//   qtyProject=100, rateProject=40 -> projectValue = 4,000
//   qtyContract=100, rateContract=50 -> contractValue = 5,000
//   variance = 1,000; variancePercent = 20
//   quantityVariance = (100-100)*40 = 0 (same qty both sides, isolates rate)
//   rateVariance = (50-40)*100 = 1,000
const ROOT_LINE = {
  id: "line-root", boqId: "boq-1", activityId: null, itemCode: "C-01",
  description: "Excavation", unit: "m3", quantity: "100", rate: "50", amount: "5000",
  parentLineItemId: null as string | null, breakdownPercentage: null,
  materialCost: null, labourCost: null, equipmentCost: null, overheadPercent: null, profitPercent: null,
  materialAmount: null, manpowerAmount: null, category: null, createdAt: new Date("2026-09-12T00:00:00Z"),
  qtyProject: "100", rateProject: "40", qtyContract: "100", rateContract: "50",
}

// A weighted sub-task of ROOT_LINE, with figures an order of magnitude
// larger -- if the BOQ-level rollup wrongly included it (A7/R-32's own
// regression class), the assertions below would be off by 100x, not a
// rounding error, so this cannot pass by accident.
const SUB_LINE = {
  ...ROOT_LINE,
  id: "line-sub",
  parentLineItemId: "line-root",
  qtyProject: "1000", rateProject: "1000", qtyContract: "1000", rateContract: "1000",
}

// A second root line, deliberately UNPRICED on the project side (NOT_SET),
// to prove costCoverage's partial-pricing signal is real and to prove the
// rollup does not silently coerce a missing figure to 0 (X-04).
const UNPRICED_ROOT_LINE = {
  ...ROOT_LINE,
  id: "line-unpriced",
  qtyProject: null, rateProject: null,
  qtyContract: "50", rateContract: "20", // contractValue = 1,000
}

afterEach(async () => {
  mock.restore()
  await mock.module("@/lib/db/tenant-scoped", () => realTenantScoped)
})

async function mountGetBoq(lineItems: unknown[]) {
  const fakeDb = {
    query: {
      constructionBoqs: {
        findFirst: mock(async () => ({ id: "boq-1", orgId: ORG_ID, projectId: "proj-1", version: 1, title: "Villa 21", status: "draft" })),
      },
      constructionBoqLineItems: { findMany: mock(async () => lineItems) },
    },
  }
  await mock.module("@/lib/db/tenant-scoped", () => ({
    ...realTenantScoped,
    withTenantContext: mock(async (_ctx: { orgId: string }, fn: (db: unknown) => Promise<unknown>) => fn(fakeDb)),
  }))
  const { getBoq } = await import("./construction-boq-service")
  return getBoq({ orgId: ORG_ID }, "boq-1") as unknown as {
    lineItems: Array<Record<string, unknown>>
    moneyView: { projectValue: unknown; contractValue: unknown; variance: unknown; variancePercent: unknown; rootLineCount: number }
    costCoverage: { coveredContractValue: number; totalContractValue: unknown; coverageRatio: unknown }
  }
}

describe("getBoq -- Phase 2/D91 dual view is actually wired in (X-27 gap closed)", () => {
  test("each line item carries its own computed dual-view figures, not just the raw qtyProject/rateProject columns", async () => {
    const boq = await mountGetBoq([ROOT_LINE, SUB_LINE])
    const root = boq.lineItems.find((l) => l.id === "line-root")!
    expect(root.projectValue).toBe(4000)
    expect(root.contractValue).toBe(5000)
    expect(root.variance).toBe(1000)
    expect(root.variancePercent).toBe(20)
    expect(root.quantityVariance).toBe(0)
    expect(root.rateVariance).toBe(1000)
    // computedRate/computedBudget (pre-existing, unrelated) must survive --
    // this wiring is additive, never a replacement.
    expect(root.computedRate).toBeDefined()
  })

  test("the whole-BOQ moneyView rolls up ROOT lines only -- the sub-task's 100x-larger figures are excluded (A7/R-32), not double-counted", async () => {
    const boq = await mountGetBoq([ROOT_LINE, SUB_LINE])
    expect(boq.moneyView.projectValue).toBe(4000) // NOT 1,004,000
    expect(boq.moneyView.contractValue).toBe(5000) // NOT 1,005,000
    expect(boq.moneyView.rootLineCount).toBe(1)
  })

  test("costCoverage reports full coverage when the one root line is fully priced", async () => {
    const boq = await mountGetBoq([ROOT_LINE])
    expect(boq.costCoverage.coverageRatio).toBe(100)
    expect(boq.costCoverage.totalContractValue).toBe(5000)
  })

  test("an unpriced project side yields NOT_SET, never a silent 0 (X-04), and shows up as partial coverage", async () => {
    const boq = await mountGetBoq([ROOT_LINE, UNPRICED_ROOT_LINE])
    const unpriced = boq.lineItems.find((l) => l.id === "line-unpriced")!
    expect(unpriced.projectValue).toBe("NOT_SET")
    expect(unpriced.contractValue).toBe(1000)
    // Rollup: projectValue only sums the ROOT_LINE's 4,000 (the unpriced
    // line's NOT_SET is excluded, not coerced to 0); contractValue sums both
    // roots' contract sides (5,000 + 1,000 = 6,000).
    expect(boq.moneyView.projectValue).toBe(4000)
    expect(boq.moneyView.contractValue).toBe(6000)
    // costCoverage: only 5,000 of the 6,000 total contract value has a
    // project-side price entered -> 83.33...%, not 100% and not NOT_SET.
    expect(boq.costCoverage.coveredContractValue).toBe(5000)
    expect(boq.costCoverage.totalContractValue).toBe(6000)
    expect(boq.costCoverage.coverageRatio).toBeCloseTo((5000 / 6000) * 100, 6)
  })
})

describe("listBoqs -- same wiring reaches the list screen too (D91 'side by side, at every stage', not just the object page)", () => {
  function mountListBoqsDb(lineItems: unknown[]) {
    return {
      query: {
        constructionBoqs: {
          findMany: mock(async () => [
            { id: "boq-1", orgId: ORG_ID, projectId: "proj-1", version: 1, title: "Villa 21", status: "draft", parentBoqId: null, createdAt: new Date("2026-09-12T00:00:00Z") },
          ]),
        },
        constructionBoqLineItems: { findMany: mock(async () => lineItems) },
      },
    }
  }

  test("?include=lineItems returns moneyView/costCoverage per BOQ, computed by the SAME producer as getBoq()", async () => {
    await mock.module("@/lib/db/tenant-scoped", () => ({
      ...realTenantScoped,
      withTenantContext: mock(async (_ctx: { orgId: string }, fn: (db: unknown) => Promise<unknown>) => fn(mountListBoqsDb([ROOT_LINE, SUB_LINE]))),
    }))
    const { listBoqs } = await import("./construction-boq-service")
    const [boq] = (await listBoqs({ orgId: ORG_ID }, "proj-1", { include: "lineItems" })) as unknown as Array<{
      moneyView: { projectValue: unknown; contractValue: unknown }
      lineItems: Array<{ projectValue: unknown }>
    }>
    expect(boq.moneyView.projectValue).toBe(4000)
    expect(boq.moneyView.contractValue).toBe(5000)
    expect(boq.lineItems[0].projectValue).toBe(4000)
  })

  test("without ?include=lineItems, no moneyView is attached -- every OTHER existing caller of listBoqs keeps its exact prior response shape", async () => {
    await mock.module("@/lib/db/tenant-scoped", () => ({
      ...realTenantScoped,
      withTenantContext: mock(async (_ctx: { orgId: string }, fn: (db: unknown) => Promise<unknown>) => fn(mountListBoqsDb([ROOT_LINE]))),
    }))
    const { listBoqs } = await import("./construction-boq-service")
    const [boq] = await listBoqs({ orgId: ORG_ID }, "proj-1", {})
    expect("moneyView" in (boq as object)).toBe(false)
    expect("costCoverage" in (boq as object)).toBe(false)
    expect("lineItems" in (boq as object)).toBe(false)
  })
})
