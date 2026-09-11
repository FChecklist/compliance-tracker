/// <reference types="bun-types" />
// Split out of route.test.ts (seq4/c5 de-share, 2026-09-11): that file cited
// 7 requirements (R-03, R-04, R-14, R-16, R-17, R-18, R-19), over the 3-per-
// file cap. This file carries the three that share one code path:
//
// R74-RULING-03 closure test for R-16, R-17, R-18: all three were verified
// live (R74 Phase 5/8, platform.sumeet_uat) via ad-hoc scratchpad scripts
// against a real dev server -- real, valid evidence, but not a "named,
// committed, re-runnable test" per R74-RULING-03's six conditions, so none
// could be marked CLOSED on that evidence alone. This file is the actual
// closing artifact.
//
// R-16 (child with parentItemCode but no breakdownPercentage is rejected)
// and R-18 (circular parentItemCode is rejected) and R-17 (a parentItemCode
// matching nothing in the submission is rejected) are three DISTINCT
// customer-specified requirements that happen to share code: R-16 is caught
// by validateLineItemInputs() BEFORE any transaction opens
// (construction-boq-service.ts, "breakdownPercentage is required when
// parentItemCode is set"); R-17 and R-18 are BOTH caught by the same
// generic "unresolvable" batch-resolution check inside insertLineItems()
// ("Unresolvable parentItemCode reference(s) among: ...") -- a true cycle
// (R-18, neither node ever becomes "ready") and a genuinely dangling
// reference to a code that exists nowhere in the submission (R-17) are
// mechanically indistinguishable to that one loop today. Each gets its own
// test with its own characteristic scenario (R-17's has no cycle at all)
// rather than reusing R-18's assertion, so a future refactor that DOES
// split the two error paths apart is still covered correctly by both.
//
// Mocks the DB layer only (@/lib/supabase/auth-guard, @/lib/db/tenant-scoped,
// ./project-dashboard-cache) -- same convention as
// src/app/settings/api-keys/route.test.ts. createBoq() itself, and every
// pure function it calls (insertLineItems, deriveLineItemQuantityAndRate,
// resolveRootAncestor), run FOR REAL against a small in-memory fake `db` --
// this exercises the actual business logic through the actual route
// handler a real POST /api/v1/construction/boq hits, not a re-implementation
// of it.
//
// TRANSACTIONAL SEMANTICS MATTER HERE, not just a convenience detail: the
// real withTenantContext() wraps createBoq()'s body in a real Postgres
// db.transaction(), so a throw partway through (e.g. insertLineItems
// rejecting a cycle AFTER the BOQ header row was already inserted) rolls
// EVERYTHING back. Every write is staged per withTenantContext call and only
// merged into the committed store if the callback resolves; a throw
// discards the stage entirely, mirroring a real ROLLBACK.
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

/** One call's worth of staged writes -- merged into the store on success, discarded on throw. */
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
      const result = await fn(db) // a throw here propagates -- commit() never runs, staged writes vanish
      commit()
      return result
    }),
  }))
  mock.module("./project-dashboard-cache", () => ({
    bustProjectDashboardCache: mock(() => {}),
  }))
})

describe("POST /api/v1/construction/boq -- R74-RULING-03 closure (parentItemCode validation)", () => {
  test("R-16: a child with parentItemCode but no breakdownPercentage is rejected with 400, and NOTHING is persisted", async () => {
    const { POST } = await import("./route")
    const res = await POST(
      makeRequest({
        title: "R-16 closure test",
        projectId: PROJECT_ID,
        lineItems: [
          { itemCode: "ROOT-1", description: "Root", unit: "LS", quantity: 10, rate: 100 },
          { itemCode: "CHILD-1", parentItemCode: "ROOT-1", description: "Child, no %", unit: "LS" },
        ],
      })
    )
    const body = await res.json()

    expect(res.status).toBe(400)
    expect(body.error).toMatch(/breakdownPercentage is required when parentItemCode is set/)
    expect(store.committedBoqs.length).toBe(0)
    expect(store.committedLineItems.length).toBe(0)
  })

  test("R-17: a parentItemCode matching no itemCode anywhere in the submission is rejected with 400, and NOTHING is persisted", async () => {
    const { POST } = await import("./route")
    const res = await POST(
      makeRequest({
        title: "R-17 closure test",
        projectId: PROJECT_ID,
        lineItems: [
          { itemCode: "ROOT-1", description: "Root", unit: "LS", quantity: 10, rate: 100 },
          { itemCode: "CHILD-1", parentItemCode: "GHOST-999", breakdownPercentage: 50, description: "Orphan child", unit: "LS" },
        ],
      })
    )
    const body = await res.json()

    expect(res.status).toBe(400)
    expect(body.error).toMatch(/Unresolvable parentItemCode reference/)
    expect(body.error).toMatch(/GHOST-999|CHILD-1/)
    expect(store.committedBoqs.length).toBe(0)
    expect(store.committedLineItems.length).toBe(0)
  })

  test("R-18: a circular parentItemCode reference (A-10 <-> CHILD-1) is rejected with 400, and NOTHING is persisted", async () => {
    const { POST } = await import("./route")
    const res = await POST(
      makeRequest({
        title: "R-18 closure test",
        projectId: PROJECT_ID,
        lineItems: [
          { itemCode: "A-10", parentItemCode: "CHILD-1", breakdownPercentage: 50, description: "Root A", unit: "LS" },
          { itemCode: "CHILD-1", parentItemCode: "A-10", breakdownPercentage: 50, description: "Child 1", unit: "LS" },
        ],
      })
    )
    const body = await res.json()

    expect(res.status).toBe(400)
    expect(body.error).toMatch(/Unresolvable parentItemCode reference/)
    expect(store.committedLineItems.length).toBe(0)
    expect(store.committedBoqs.length).toBe(0)
  })
})
