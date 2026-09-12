// ADDED 2026-09-11 (R83 bucket C item 13, PM dispatch). De-shared out of
// construction-boq-service.test.ts's "updateLineItemBudget -- material/
// manpower amounts and category (R67 I-03/I-05)" describe block, same
// pattern PR #1666 already used to split other over-cited files: that one
// block's closure_test_path was being cited for BOTH R67 I-03/I-05 (material/
// manpower/category/budgetPercentage) AND R-C09 sub-claim 3 (vendorId/
// vendorAmount) -- an unrelated requirement sharing one file, the exact
// DOD-R5 overshare pattern (construction-boq-service.test.ts was carrying 9
// requirements total; see platform.sumeet_requirements R-C09's own
// 2026-09-11 addendum). These two tests are moved here VERBATIM (no
// assertion changed) so R-C09 has its own unshared citation; the sibling
// R67 I-03/I-05 tests stay in construction-boq-service.test.ts.
//
// Original tests were added in PR #1687 (commit 22fa4267, merged as
// 3cf8dbe3), break-restore verified there: removing the vendorId write from
// updateLineItemBudget's .set({...}) call made the first test fail exactly
// as expected, reverted byte-identical, re-ran green. Not re-planting that
// same break here -- the production code did not move, only the test file
// did, so that verification still stands for this content.
//
// vendorNAME itself is NOT asserted here -- updateLineItemBudget only ever
// writes vendorId (a foreign key); the real name resolution is a separate
// READ-side join (construction-reports-service.ts's boqBudgetVarianceReport,
// supplierNameById.get(item.vendorId)) that this write-path function never
// touches. Asserting a name here would test the wrong function's
// responsibility.
/// <reference types="bun-types" />
import { afterEach, describe, expect, mock, test } from "bun:test"
import * as realTenantScopedForBoq from "@/lib/db/tenant-scoped"
import { type BoqLineItemRow } from "./construction-boq-service"

function row(overrides: Partial<BoqLineItemRow>): BoqLineItemRow {
  return {
    id: overrides.id ?? "row-id",
    boqId: "boq-1",
    activityId: null,
    itemCode: null,
    description: "line item",
    unit: "nos",
    quantity: "0",
    rate: "0",
    amount: "0",
    parentLineItemId: null,
    breakdownPercentage: null,
    materialCost: null,
    labourCost: null,
    equipmentCost: null,
    overheadPercent: null,
    profitPercent: null,
    materialAmount: null,
    manpowerAmount: null,
    category: null,
    createdAt: new Date("2026-07-27T00:00:00Z"),
    ...overrides,
  }
}

describe("updateLineItemBudget -- vendorId/vendorAmount write path (R-C09 sub-claim 3)", () => {
  afterEach(async () => {
    mock.restore()
    await mock.module("@/lib/db/tenant-scoped", () => realTenantScopedForBoq)
  })

  function mountFakeDb() {
    const setCalls: Record<string, unknown>[] = []
    const stored = row({ id: "line-1", amount: "1000", budgetPercentage: "25" }) as unknown as Record<string, unknown>
    const fakeDb = {
      query: {
        constructionBoqLineItems: { findFirst: mock(async () => ({ ...stored, boqId: "boq-1" })) },
        constructionBoqs: { findFirst: mock(async () => ({ id: "boq-1", orgId: "org-1" })) },
      },
      update: () => ({
        set: (values: Record<string, unknown>) => ({
          where: () => ({
            returning: async () => {
              setCalls.push(values)
              return [{ ...stored, ...values }]
            },
          }),
        }),
      }),
    }
    return { fakeDb, setCalls }
  }

  async function patch(input: Record<string, unknown>) {
    const { fakeDb, setCalls } = mountFakeDb()
    await mock.module("@/lib/db/tenant-scoped", () => ({
      ...realTenantScopedForBoq,
      withTenantContext: mock(async (_ctx: { orgId: string }, fn: (db: unknown) => Promise<unknown>) => fn(fakeDb)),
    }))
    const { updateLineItemBudget } = await import("./construction-boq-service")
    const updated = await updateLineItemBudget({ orgId: "org-1" }, "line-1", input)
    return { updated, setCalls }
  }

  test("a PATCH of vendorId and vendorAmount round-trips on the line item", async () => {
    const { updated, setCalls } = await patch({ vendorId: "supplier-42", vendorAmount: 450 })
    expect(setCalls[0]).toEqual({ vendorId: "supplier-42", vendorAmount: "450" })
    expect(updated.vendorId).toBe("supplier-42")
    expect(updated.vendorAmount).toBe("450")
  })

  test("vendorId null clears the vendor link, and vendorAmount null clears the amount, independently", async () => {
    const clearedVendor = await patch({ vendorId: null })
    expect(clearedVendor.setCalls[0]).toEqual({ vendorId: null })
    expect("vendorAmount" in clearedVendor.setCalls[0]).toBe(false)

    const clearedAmount = await patch({ vendorAmount: null })
    expect(clearedAmount.setCalls[0]).toEqual({ vendorAmount: null })
    expect("vendorId" in clearedAmount.setCalls[0]).toBe(false)
  })
})
