/// <reference types="bun-types" />
// Split out of route.test.ts (seq4/c5 de-share, 2026-09-11): that file cited
// 7 requirements over the 3-per-file cap. This file carries the original
// "R75 Phase 2 (task w103) -- R-03, R-04, R-14 closure" describe block
// verbatim (already exactly 3 requirements, so no further split needed).
// Reuses the real-route + fake-transactional-DB harness (see
// boq-route.parent-code-validation.test.ts's header for the full rationale)
// rather than building a second one: these three requirements are about
// createBoq()'s actual persisted outcome (or lack thereof), which the
// committed-store assertions below check honestly.
import { describe, test, expect, mock, beforeEach } from "bun:test"
import { ROLE_RANK } from "@/lib/supabase/role-rank"

const PROJECT_ID = "test-project-1"
const ORG_ID = "test-org-1"

type FakeBoqRow = { id: string; orgId: string; projectId: string; version: number; title: string; createdById: string }
type FakeLineItemRow = {
  id: string; orgId: string; boqId: string; activityId: string | null; itemCode: string | null
  parentLineItemId: string | null; breakdownPercentage: string | null; description: string; unit: string
  quantity: string; rate: string; amount: string
  materialCost: string | null; labourCost: string | null; equipmentCost: string | null
  overheadPercent: string | null; profitPercent: string | null
  materialAmount: string | null; manpowerAmount: string | null; category: string | null
}

function makeFakeStore() {
  let nextId = 1
  return {
    committedBoqs: [] as FakeBoqRow[],
    committedLineItems: [] as FakeLineItemRow[],
    freshId: (prefix: string) => `${prefix}-${nextId++}`,
  }
}

function makeTransactionalDb(store: ReturnType<typeof makeFakeStore>) {
  const stagedBoqs: FakeBoqRow[] = []
  const stagedLineItems: FakeLineItemRow[] = []
  const visibleBoqs = () => [...store.committedBoqs, ...stagedBoqs]
  const visibleLineItems = () => [...store.committedLineItems, ...stagedLineItems]

  const db = {
    query: {
      projects: {
        findFirst: async () => ({ id: PROJECT_ID, orgId: ORG_ID, name: "Fake Project" }),
      },
      constructionBoqs: {
        findFirst: async () => visibleBoqs()[visibleBoqs().length - 1] ?? null,
      },
      constructionBoqLineItems: {
        findMany: async () => {
          const currentBoqId = visibleBoqs()[visibleBoqs().length - 1]?.id
          return visibleLineItems().filter((li) => li.boqId === currentBoqId)
        },
      },
    },
    insert: (_table: any) => ({
      values: (v: any | any[]) => {
        const rows = Array.isArray(v) ? v : [v]
        return {
          returning: async (proj?: any) => {
            if (rows[0] && "title" in rows[0]) {
              const inserted = rows.map((r: any) => ({ ...r, id: store.freshId("boq") }) as FakeBoqRow)
              stagedBoqs.push(...inserted)
              return inserted
            }
            const inserted = rows.map((r: any) => ({ ...r, id: store.freshId("li") }) as FakeLineItemRow)
            stagedLineItems.push(...inserted)
            return proj ? inserted.map((r) => ({ id: r.id, itemCode: r.itemCode })) : inserted
          },
        }
      },
    }),
  }

  return {
    db,
    commit: () => {
      store.committedBoqs.push(...stagedBoqs)
      store.committedLineItems.push(...stagedLineItems)
    },
  }
}

function makeRequest(body: unknown): Request {
  return new Request("http://localhost/api/v1/construction/boq", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  })
}

let store: ReturnType<typeof makeFakeStore>

beforeEach(() => {
  store = makeFakeStore()
  mock.module("@/lib/supabase/auth-guard", () => ({
    ROLE_RANK,
    requireAuthOrApiKey: mock(async () => ({ response: null, orgId: ORG_ID, dbUser: { id: "user-1" }, apiKey: null })),
    requireRoleOrScope: mock(() => null),
  }))
  mock.module("@/lib/db/tenant-scoped", () => ({
    withTenantContext: mock(async (_ctx: unknown, fn: (db: any) => any) => {
      const { db, commit } = makeTransactionalDb(store)
      const result = await fn(db)
      commit()
      return result
    }),
  }))
  mock.module("./project-dashboard-cache", () => ({
    bustProjectDashboardCache: mock(() => {}),
  }))
})

describe("POST /api/v1/construction/boq -- R75 P2 W103: R-03/R-04/R-14 closure", () => {
  test("R-03: a title with an empty lineItems array is created with no validation errors -- a header-only BOQ, zero line items committed", async () => {
    const { POST } = await import("./route")
    const res = await POST(
      makeRequest({
        title: "R-03 closure test",
        projectId: PROJECT_ID,
        lineItems: [],
      })
    )
    const body = await res.json()

    expect(res.status).toBe(201)
    expect(body.error).toBeUndefined()
    expect(body.lineItems).toEqual([])
    expect(store.committedBoqs.length).toBe(1)
    expect(store.committedLineItems.length).toBe(0)
  })

  test("R-04: a BOQ creation request that omits title is rejected with 400 naming the title field, and nothing is persisted", async () => {
    const { POST } = await import("./route")
    const res = await POST(
      makeRequest({
        projectId: PROJECT_ID,
        lineItems: [],
      })
    )
    const body = await res.json()

    expect(res.status).toBe(400)
    expect(body.error).toMatch(/title/)
    expect(store.committedBoqs.length).toBe(0)
    expect(store.committedLineItems.length).toBe(0)
  })

  test("R-14: sibling breakdownPercentages that do not sum to 100 (40 + 45 = 85) are accepted with no validation error or warning", async () => {
    const { POST } = await import("./route")
    const res = await POST(
      makeRequest({
        title: "R-14 closure test",
        projectId: PROJECT_ID,
        lineItems: [
          { itemCode: "R-100", description: "Root", unit: "LS", quantity: 10, rate: 1000 },
          { itemCode: "C-1", parentItemCode: "R-100", breakdownPercentage: 40, description: "Child 1", unit: "LS" },
          { itemCode: "C-2", parentItemCode: "R-100", breakdownPercentage: 45, description: "Child 2", unit: "LS" },
        ],
      })
    )
    const body = await res.json()

    expect(res.status).toBe(201)
    expect(body.error).toBeUndefined()
    expect(body.warnings).toBeUndefined()
    expect(store.committedBoqs.length).toBe(1)
    expect(store.committedLineItems.length).toBe(3)
    const c1 = store.committedLineItems.find((li) => li.itemCode === "C-1")
    const c2 = store.committedLineItems.find((li) => li.itemCode === "C-2")
    expect(c1!.rate).toBe("400")
    expect(c2!.rate).toBe("450")
  })
})
