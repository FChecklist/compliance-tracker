/// <reference types="bun-types" />
// R65 gap-closure: this file (construction-change-order-service.ts) had zero
// test coverage before this PR touched it to add the `trade` field (see
// report_definitions 'Variation Order Analysis',
// report-engine-service.ts#computeInteriorVariationOrderAnalysis). CI's
// check-new-test-coverage.mjs gate ("AI Can Safely Modify Module") requires
// a sibling test for any previously-untested service file a PR touches --
// this is that test.
//
// Same "mock @/lib/db/tenant-scoped's withTenantContext, restore in
// afterEach" precedent construction-expense-service.test.ts /
// construction-billing-workflow-service.test.ts already established for
// this tenant-scoped-db shape (this repo's CI runs `bun test` against a
// placeholder DATABASE_URL with no real Postgres behind it, so a fake
// in-memory db is the right, precedented level of rigor, not a corner cut).
//
// Scope: focused on createChangeOrder (the function this PR's `trade` field
// actually touches) plus the two pure, DB-free validation guards
// (title-required, at-least-one-signer) -- not a full re-test of every
// exported function's DB plumbing, which belongs to whichever change
// actually modifies it.
import { describe, expect, test, mock, afterEach } from "bun:test"

const realTenantScoped = await import("@/lib/db/tenant-scoped")

type Row = Record<string, unknown>

// createChangeOrder only ever issues two calls against the db: a
// select({value: count()}).from(constructionChangeOrders).where(...) to
// derive the next sequential `number`, then an
// insert(constructionChangeOrders).values(...).returning(). Both are
// unconditionally against the one table this service owns, so (matching
// construction-expense-service.test.ts's precedent of not introspecting
// real drizzle `where` SQL objects) the fake just needs to expose those two
// shapes.
function makeFakeDb(existingCountForProject = 0) {
  const store: Row[] = []
  let nextId = 1
  const genId = () => `co-${nextId++}`

  const db = {
    select: mock(() => ({
      from: () => ({
        where: async () => [{ value: existingCountForProject }],
      }),
    })),
    insert: mock(() => ({
      values: (v: Row) => {
        const row = { id: genId(), status: "draft", ...v }
        store.push(row)
        return { returning: async () => [row] }
      },
    })),
  }

  return { db, store }
}

async function loadServiceWith(fakeDb: ReturnType<typeof makeFakeDb>["db"]) {
  await mock.module("@/lib/db/tenant-scoped", () => ({
    ...realTenantScoped,
    withTenantContext: mock(async (_ctx: unknown, fn: (db: unknown) => Promise<unknown>) => fn(fakeDb)),
  }))
  return import("./construction-change-order-service")
}

afterEach(async () => {
  mock.restore()
  await mock.module("@/lib/db/tenant-scoped", () => realTenantScoped)
})

describe("createChangeOrder", () => {
  test("rejects a missing/blank title before ever touching the db", async () => {
    const { db } = makeFakeDb()
    const { createChangeOrder, ServiceError } = await loadServiceWith(db)

    await expect(
      createChangeOrder({ orgId: "org1", userId: "u1" }, { projectId: "p1", title: "   " })
    ).rejects.toThrow(ServiceError)
    expect(db.select).not.toHaveBeenCalled()
    expect(db.insert).not.toHaveBeenCalled()
  })

  test("numbers the change order sequentially (existing count + 1) and persists a trimmed trade", async () => {
    const { db, store } = makeFakeDb(3) // 3 change orders already exist on this project
    const { createChangeOrder } = await loadServiceWith(db)

    const co = await createChangeOrder(
      { orgId: "org1", userId: "u1" },
      { projectId: "p1", title: "Add a rooftop terrace", trade: "  Interior Design  " }
    ) as Row

    expect(co.number).toBe(4)
    expect(co.trade).toBe("Interior Design") // trimmed
    expect(co.orgId).toBe("org1")
    expect(co.projectId).toBe("p1")
    expect(co.requestedById).toBe("u1")
    expect(store.length).toBe(1)
  })

  test("an omitted trade is stored as null, not an empty string or undefined", async () => {
    const { db } = makeFakeDb(0)
    const { createChangeOrder } = await loadServiceWith(db)

    const co = await createChangeOrder(
      { orgId: "org1", userId: "u1" },
      { projectId: "p1", title: "Relocate the site office" }
    ) as Row

    expect(co.number).toBe(1)
    expect(co.trade).toBeNull()
  })

  test("a whitespace-only trade is also normalized to null (same trim-or-null rule as an omitted one)", async () => {
    const { db } = makeFakeDb(0)
    const { createChangeOrder } = await loadServiceWith(db)

    const co = await createChangeOrder(
      { orgId: "org1", userId: "u1" },
      { projectId: "p1", title: "Swap the tile vendor", trade: "   " }
    ) as Row

    expect(co.trade).toBeNull()
  })

  test("defaults costImpact to '0' and scheduleImpactDays to 0 when omitted", async () => {
    const { db } = makeFakeDb(0)
    const { createChangeOrder } = await loadServiceWith(db)

    const co = await createChangeOrder(
      { orgId: "org1", userId: "u1" },
      { projectId: "p1", title: "Minor spec clarification" }
    ) as Row

    expect(co.costImpact).toBe("0")
    expect(co.scheduleImpactDays).toBe(0)
  })
})

describe("submitChangeOrderForApproval -- at-least-one-signer guard", () => {
  test("rejects with no signers before ever loading the change order or touching the db", async () => {
    const { db } = makeFakeDb()
    const { submitChangeOrderForApproval, ServiceError } = await loadServiceWith(db)

    await expect(
      submitChangeOrderForApproval(
        { orgId: "org1", userId: "u1", dbUser: {} as never },
        "co-does-not-matter",
        []
      )
    ).rejects.toThrow(ServiceError)
    expect(db.select).not.toHaveBeenCalled()
  })
})
