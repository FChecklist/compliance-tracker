/// <reference types="bun-types" />
// Split out of route.test.ts (seq4/c5 de-share, 2026-09-11): that file cited
// 7 requirements over the 3-per-file cap. This file carries R-19 alone.
//
// Same real-route + fake-transactional-DB harness as
// boq-route.parent-code-validation.test.ts (see that file's header for the
// full rationale) -- createBoq() and every pure function it calls run FOR
// REAL against a small in-memory fake `db`, only the DB layer and auth guard
// are mocked.
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

describe("POST /api/v1/construction/boq -- R74-RULING-03 closure (nested pricing)", () => {
  test("R-19: a grandchild sub-task (2 levels deep) prices off the ROOT ancestor, not its immediate parent", async () => {
    const { POST } = await import("./route")
    const res = await POST(
      makeRequest({
        title: "R-19 closure test",
        projectId: PROJECT_ID,
        lineItems: [
          { itemCode: "R-100", description: "Root", unit: "LS", quantity: 10, rate: 1000 },
          { itemCode: "C-200", parentItemCode: "R-100", breakdownPercentage: 50, description: "Child 50%", unit: "LS" },
          { itemCode: "G-300", parentItemCode: "C-200", breakdownPercentage: 30, description: "Grandchild 30%", unit: "LS" },
        ],
      })
    )
    const body = await res.json()

    expect(res.status).toBe(201)

    const grandchild = store.committedLineItems.find((li) => li.itemCode === "G-300")
    expect(grandchild).toBeDefined()
    // The wrong-but-plausible answer a bug pricing off the IMMEDIATE PARENT
    // would produce is rate=150 (500 * 0.30), amount=1500. The correct,
    // root-derived answer is rate=1000*0.30=300, amount=10*300=3000 --
    // written down before this assertion, not reverse-engineered from
    // whatever the code happens to return.
    expect(grandchild!.rate).toBe("300")
    expect(grandchild!.quantity).toBe("10")
    expect(grandchild!.amount).toBe("3000")
    expect(body.lineItems.find((li: any) => li.itemCode === "G-300").rate).not.toBe("150")
  })
})
