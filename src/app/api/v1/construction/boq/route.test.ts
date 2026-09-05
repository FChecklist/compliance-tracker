/// <reference types="bun-types" />
// R74-RULING-03 closure test for R-16, R-17, R-18, R-19: all four were
// verified live (R74 Phase 5/8, platform.sumeet_uat) via ad-hoc scratchpad
// scripts against a real dev server -- real, valid evidence, but not a
// "named, committed, re-runnable test" per R74-RULING-03's six conditions,
// so none could be marked CLOSED on that evidence alone. This file is the
// actual closing artifact for all four (R75 Phase 3 added R-16/R-17 to
// R74's original R-18/R-19 pair, reusing the same fake transactional DB
// rather than building a second one).
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
// Mocks the DB layer only (@/lib/db/tenant-scoped, @/lib/supabase/auth-guard,
// ./project-dashboard-cache) -- same convention as
// src/app/api/settings/api-keys/route.test.ts. createBoq() itself, and every
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
// EVERYTHING back. A first cut of this fake pushed straight into the
// "committed" arrays with no rollback, which made the R-18 test fail on its
// own harness bug (the header row survived a thrown error) -- caught by
// actually running the test, not assumed correct. Fixed by staging every
// write per withTenantContext call and only merging into the committed
// store if the callback resolves; a throw discards the stage entirely,
// mirroring a real ROLLBACK.
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
  // Reads see committed rows PLUS this transaction's own not-yet-committed
  // writes (real Postgres reads its own uncommitted writes inside one
  // transaction too) -- never rows staged by a DIFFERENT, concurrent
  // transaction, which these tests never run anyway (one call at a time).
  const visibleBoqs = () => [...store.committedBoqs, ...stagedBoqs]
  const visibleLineItems = () => [...store.committedLineItems, ...stagedLineItems]

  const db = {
    query: {
      projects: {
        findFirst: async () => ({ id: PROJECT_ID, orgId: ORG_ID, name: "Fake Project" }),
      },
      constructionBoqs: {
        // Query builder `where` clauses (drizzle's `eq`/`and`) are opaque SQL
        // fragment objects to this fake -- rather than re-implementing a SQL
        // interpreter, this just returns the most recently (staged-or-
        // committed) inserted BOQ, which is correct because each test only
        // ever has ONE boq in flight at a time.
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
    // ROLE_RANK re-exported from ./role-rank (a leaf module, no circular-
    // import risk) -- something in construction-boq-service.ts's own import
    // chain needs the real value, not a stub, and a mock.module factory
    // fully REPLACES a module's exports rather than merging with the real
    // ones (see api-keys/route.test.ts's own header comment on the same
    // gotcha, hit there first). Dynamically re-importing @/lib/supabase/
    // auth-guard itself from inside its own mock factory hangs Bun's module
    // resolver (tried, times out with zero output) -- importing the
    // narrower, non-circular ./role-rank module instead avoids that.
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

describe("POST /api/v1/construction/boq -- R74-RULING-03 closure", () => {
  test("R-16: a child with parentItemCode but no breakdownPercentage is rejected with 400, and NOTHING is persisted", async () => {
    const { POST } = await import("./route")
    const res = await POST(
      makeRequest({
        title: "R-16 closure test",
        projectId: PROJECT_ID,
        lineItems: [
          { itemCode: "ROOT-1", description: "Root", unit: "LS", quantity: 10, rate: 100 },
          // Has a parentItemCode but omits breakdownPercentage entirely --
          // the exact shape validateLineItemInputs() rejects before any
          // transaction opens (construction-boq-service.ts's own comment:
          // "Before the transaction: a malformed body should never open one").
          { itemCode: "CHILD-1", parentItemCode: "ROOT-1", description: "Child, no %", unit: "LS" },
        ],
      })
    )
    const body = await res.json()

    expect(res.status).toBe(400)
    expect(body.error).toMatch(/breakdownPercentage is required when parentItemCode is set/)
    // R74-RULING-03 condition (e): re-read the store, not just the status.
    // Rejected pre-transaction means the store should never even have been
    // touched -- a stronger assertion than "rolled back", since this path
    // never calls withTenantContext at all.
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
          // GHOST-999 does not appear as any item's itemCode in this
          // submission at all -- no cycle, genuinely dangling. Distinct
          // scenario from R-18's true 2-node cycle below.
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
    // R74-RULING-03 condition (e): assert the outcome PERSISTED (or here,
    // did NOT persist) by re-reading the store, not by trusting the status
    // code alone -- a 400 that still wrote a row would be exactly the
    // false-success class of defect this whole work order exists to catch.
    // (This assertion is what caught this file's own first-draft harness
    // bug: no rollback simulation, so the BOQ header row -- inserted before
    // insertLineItems throws -- survived. Fixed above by staging writes per
    // transaction and only committing on success, mirroring the real
    // db.transaction() withTenantContext wraps this in.)
    expect(store.committedLineItems.length).toBe(0)
    expect(store.committedBoqs.length).toBe(0)
  })

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

    // R74-RULING-03 condition (e): re-read what was actually COMMITTED (the
    // fake db's own store), not just the response body.
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
