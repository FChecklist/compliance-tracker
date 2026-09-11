/// <reference types="bun-types" />
// Split out of construction-boq-service.test.ts (seq4/c5 de-share,
// 2026-09-11): that file cited 9 requirements over the 3-per-file cap.
// This file carries R-20/R-C13, moved verbatim -- both are real,
// end-to-end createBoqRevision() tests (DB layer faked, service logic
// real), same convention as this repo's other acceptance tests.
//
// R-20 (Sumeet requirement, R75 Part 4, 2026-09-05): "Revision preserves
// parent links and breakdown %" -- verified against
// platform.sumeet_requirements before moving.
// R-C13: "Negative variation must be checked against WPR in case work is
// already done" -- the full end-to-end acceptance test of the same rule
// construction-boq-service.scope-reduction-guard.test.ts's R-22/R-23 test
// at the pure-function level.
import { afterEach, describe, mock, test, expect } from "bun:test"
// R-C13: table refs, compared by reference (===), so the fake db's insert()
// can tell which table a real createBoqRevision() call is writing to.
import { constructionBoqs, constructionBoqLineItems } from "@/lib/db"
import type { BoqLineItemRow } from "./construction-boq-service"
import * as realTenantScopedForBoq from "@/lib/db/tenant-scoped"

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

describe("createBoqRevision -- R-C13: a negative variation on a line item with recorded work progress is rejected with 409", () => {
  afterEach(async () => {
    mock.restore()
    await mock.module("@/lib/db/tenant-scoped", () => realTenantScopedForBoq)
  })

  test("reducing an already-progressed line item's quantity throws a ScopeReductionError (ServiceError, status 409)", async () => {
    const orgId = "org-c13"
    const parentBoq = {
      id: "parent-1", orgId, projectId: "proj-c13", version: 1, title: "Original Scope",
      parentBoqId: null, status: "approved", createdById: "user-c13", createdAt: new Date("2026-08-01T00:00:00Z"),
    }
    const previousLineItem = row({
      id: "li-prev-1", boqId: "parent-1", itemCode: "A1", description: "Blockwork - Ground Floor",
      unit: "sqm", quantity: "100", rate: "50", amount: "5000",
    })
    const insertedChildBoq = {
      id: "child-1", orgId, projectId: "proj-c13", version: 2, parentBoqId: "parent-1",
      title: "Original Scope", createdById: "user-c13", status: "draft", createdAt: new Date("2026-09-01T00:00:00Z"),
    }
    const currentLineItem = row({
      id: "li-curr-1", boqId: "child-1", itemCode: "A1", description: "Blockwork - Ground Floor",
      unit: "sqm", quantity: "60", rate: "50", amount: "3000",
    })

    let boqsFindFirstCalls = 0
    let lineItemsFindManyCalls = 0

    const fakeDb = {
      query: {
        constructionBoqs: {
          findFirst: mock(async () => {
            boqsFindFirstCalls += 1
            return boqsFindFirstCalls === 1 ? parentBoq : undefined
          }),
        },
        constructionBoqLineItems: {
          findMany: mock(async () => {
            lineItemsFindManyCalls += 1
            if (lineItemsFindManyCalls === 1) return [previousLineItem]
            if (lineItemsFindManyCalls === 2) return [{ id: "li-curr-1" }]
            return [currentLineItem]
          }),
        },
        constructionWorkProgressEntries: {
          findMany: mock(async () => [
            { boqLineItemId: "li-prev-1", activityId: null, percentComplete: "45", quantityDone: "45", entryDate: "2026-08-20" },
          ]),
        },
      },
      insert: (table: unknown) => {
        if (table === constructionBoqs) {
          return { values: (_vals: unknown) => ({ returning: async () => [insertedChildBoq] }) }
        }
        if (table === constructionBoqLineItems) {
          return {
            values: (vals: Array<{ itemCode: string | null }>) => ({
              returning: async () => vals.map((v, i) => ({ id: `li-curr-${i + 1}`, itemCode: v.itemCode })),
            }),
          }
        }
        throw new Error("R-C13 fake db: unexpected insert table")
      },
      update: () => ({ set: () => ({ where: async () => {} }) }),
    }

    await mock.module("@/lib/db/tenant-scoped", () => ({
      ...realTenantScopedForBoq,
      withTenantContext: mock(async (_ctx: { orgId: string }, fn: (db: unknown) => Promise<unknown>) => fn(fakeDb)),
    }))

    const { createBoqRevision, ScopeReductionError } = await import("./construction-boq-service")

    let caught: unknown
    try {
      await createBoqRevision(
        { orgId, userId: "user-c13" },
        "parent-1",
        { lineItems: [{ itemCode: "A1", description: "Blockwork - Ground Floor", unit: "sqm", quantity: 60, rate: 50 }] }
      )
    } catch (err) {
      caught = err
    }

    expect(caught).toBeInstanceOf(ScopeReductionError)
    expect((caught as { status: number }).status).toBe(409)
    expect((caught as Error).message).toContain("Blockwork - Ground Floor")
  })
})

describe("createBoqRevision -- R-20: a copy-forward revision preserves parent links and breakdown %", () => {
  afterEach(async () => {
    mock.restore()
    await mock.module("@/lib/db/tenant-scoped", () => realTenantScopedForBoq)
  })

  test("the child row in the new revision points at the new root, with the same breakdown %", async () => {
    const orgId = "org-r20"
    const parentBoq = {
      id: "parent-r20", orgId, projectId: "proj-r20", version: 1, title: "Original Scope",
      parentBoqId: null, status: "approved", createdById: "user-r20", createdAt: new Date("2026-08-01T00:00:00Z"),
    }
    const rootItem = row({
      id: "li-root-old", boqId: "parent-r20", itemCode: "R1", description: "Root Item",
      unit: "sqm", quantity: "100", rate: "50", amount: "5000",
    })
    const childItem = row({
      id: "li-child-old", boqId: "parent-r20", itemCode: "C1", description: "Child Item",
      parentLineItemId: "li-root-old", breakdownPercentage: "40",
      unit: "sqm", quantity: "40", rate: "50", amount: "2000",
    })
    const insertedChildBoq = {
      id: "child-r20", orgId, projectId: "proj-r20", version: 2, parentBoqId: "parent-r20",
      title: "Original Scope", createdById: "user-r20", status: "draft", createdAt: new Date("2026-09-05T00:00:00Z"),
    }

    let boqsFindFirstCalls = 0
    let lineItemsFindManyCalls = 0
    const insertedRows: Array<{ itemCode: string | null; parentLineItemId: string | null; breakdownPercentage: string | null }> = []

    const fakeDb = {
      query: {
        constructionBoqs: {
          findFirst: mock(async () => {
            boqsFindFirstCalls += 1
            if (boqsFindFirstCalls === 1) return parentBoq
            if (boqsFindFirstCalls === 2) return undefined
            return insertedChildBoq
          }),
        },
        constructionBoqLineItems: {
          findMany: mock(async () => {
            lineItemsFindManyCalls += 1
            if (lineItemsFindManyCalls === 1) return [rootItem, childItem] // previousItems
            if (lineItemsFindManyCalls === 2) return insertedRows.map((_, i) => ({ id: `li-new-${i + 1}` })) // assertLineItemsPersisted's count check
            return insertedRows.map((r, i) => ({ id: `li-new-${i + 1}`, itemCode: r.itemCode, boqId: "child-r20" }))
          }),
        },
        constructionWorkProgressEntries: { findMany: mock(async () => []) }, // no recorded progress -- nothing for this revision to violate
      },
      insert: (table: unknown) => {
        if (table === constructionBoqs) {
          return { values: (_vals: unknown) => ({ returning: async () => [insertedChildBoq] }) }
        }
        if (table === constructionBoqLineItems) {
          return {
            values: (vals: Array<{ itemCode: string | null; parentLineItemId: string | null; breakdownPercentage: string | null }>) => ({
              returning: async () => {
                insertedRows.push(...vals)
                return vals.map((v, i) => ({ id: `li-new-${insertedRows.length - vals.length + i + 1}`, itemCode: v.itemCode }))
              },
            }),
          }
        }
        throw new Error("R-20 fake db: unexpected insert table")
      },
      update: () => ({ set: () => ({ where: async () => {} }) }),
    }

    await mock.module("@/lib/db/tenant-scoped", () => ({
      ...realTenantScopedForBoq,
      withTenantContext: mock(async (_ctx: { orgId: string }, fn: (db: unknown) => Promise<unknown>) => fn(fakeDb)),
    }))

    const { createBoqRevision } = await import("./construction-boq-service")

    await createBoqRevision({ orgId, userId: "user-r20" }, "parent-r20", {})

    expect(insertedRows).toHaveLength(2)
    const newRoot = insertedRows.find((r) => r.itemCode === "R1")!
    const newChild = insertedRows.find((r) => r.itemCode === "C1")!
    expect(newRoot).toBeTruthy()
    expect(newChild).toBeTruthy()
    const newRootId = insertedRows.indexOf(newRoot) === 0 ? "li-new-1" : "li-new-2"
    expect(newChild.parentLineItemId).toBe(newRootId)
    expect(newChild.parentLineItemId).not.toBe("li-root-old")
    expect(newChild.breakdownPercentage).toBe("40")
    expect(newRoot.parentLineItemId).toBeNull()
  })
})
