/// <reference types="bun-types" />
// R75 Part 2 "G2 crm" gap-closure (2026-09-05): this file
// (crm-activities-service.ts) had zero test coverage before this PR. Real
// gap fixed here: POST /api/crm/activities (createActivity) had NO role
// gate at all -- any authenticated org member of any rank, including
// viewer/client_viewer/external_auditor, could log a CRM activity
// (task/meeting/call) against any lead/opportunity/account/contact.
//
// Gated with the existing canCreateCrmRecord predicate (crm-service.ts) --
// creating a brand-new activity has no existing owner to check against,
// same "member rank or above" bar as createLead/createOpportunity/
// createAccount's own canCreateCrmRecord gate, reused rather than
// re-declared a third time.
//
// Same "mock @/lib/db/tenant-scoped's withTenantContext + ./crm-enablement-
// service, restore in afterEach" precedent as
// construction-change-order-service.test.ts / crm-service.test.ts's own
// getSalesRepPerformanceDashboard block (this repo's CI runs `bun test`
// against a placeholder DATABASE_URL with no real Postgres behind it).
import { describe, expect, test, mock, afterEach } from "bun:test"

const realTenantScoped = await import("@/lib/db/tenant-scoped")
const realCrmEnablementService = await import("./crm-enablement-service")

type Row = Record<string, unknown>

function makeFakeDb() {
  const store: Row[] = []
  let nextId = 1
  const db = {
    insert: mock(() => ({
      values: (v: Row) => {
        const row = { id: `act-${nextId++}`, ...v }
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
  await mock.module("./crm-enablement-service", () => ({
    ...realCrmEnablementService,
    requireSalesEnabled: mock(async () => undefined),
  }))
  return import("./crm-activities-service")
}

afterEach(async () => {
  mock.restore()
  await mock.module("@/lib/db/tenant-scoped", () => realTenantScoped)
  await mock.module("./crm-enablement-service", () => realCrmEnablementService)
})

const VALID_INPUT = {
  entityType: "lead" as const,
  entityId: "lead-1",
  activityType: "task" as const,
  subject: "Call the prospect back",
}

describe("createActivity -- member-rank-or-above RBAC gate (R75 Part 2 G2)", () => {
  test("rejects a viewer (below member rank) with a 403, before ever touching the db", async () => {
    const { db } = makeFakeDb()
    const { createActivity } = await loadServiceWith(db)

    await expect(
      createActivity({ orgId: "org1", userId: "u1", role: "viewer" }, VALID_INPUT)
    ).rejects.toMatchObject({ status: 403 })
    expect(db.insert).not.toHaveBeenCalled()
  })

  test("rejects every other sub-member rank (client_viewer, external_auditor) with a 403", async () => {
    const { db } = makeFakeDb()
    const { createActivity } = await loadServiceWith(db)

    for (const role of ["client_viewer", "external_auditor"]) {
      await expect(
        createActivity({ orgId: "org1", userId: "u1", role }, VALID_INPUT)
      ).rejects.toMatchObject({ status: 403 })
    }
    expect(db.insert).not.toHaveBeenCalled()
  })

  test("the 403's reason names the member-role requirement, matching canCreateCrmRecord's own message", async () => {
    const { db } = makeFakeDb()
    const { createActivity } = await loadServiceWith(db)

    try {
      await createActivity({ orgId: "org1", userId: "u1", role: "viewer" }, VALID_INPUT)
      throw new Error("expected createActivity to reject")
    } catch (err) {
      expect((err as { message: string }).message).toMatch(/member role or higher/)
    }
  })

  test("allows a member-rank caller to create the activity", async () => {
    const { db, store } = makeFakeDb()
    const { createActivity } = await loadServiceWith(db)

    const activity = await createActivity({ orgId: "org1", userId: "u1", role: "member" }, VALID_INPUT) as Row
    expect(activity.subject).toBe("Call the prospect back")
    expect(activity.entityType).toBe("lead")
    expect(store.length).toBe(1)
  })

  test("allows a manager-rank caller too (at/above the required bar)", async () => {
    const { db } = makeFakeDb()
    const { createActivity } = await loadServiceWith(db)

    const activity = await createActivity({ orgId: "org1", userId: "u1", role: "manager" }, VALID_INPUT) as Row
    expect(activity.subject).toBe("Call the prospect back")
  })

  test("role is optional and additive -- omitting it entirely (no ctx.role) behaves exactly as before this fix, still succeeding", async () => {
    const { db } = makeFakeDb()
    const { createActivity } = await loadServiceWith(db)

    const activity = await createActivity({ orgId: "org1", userId: "u1" }, VALID_INPUT) as Row
    expect(activity.subject).toBe("Call the prospect back")
  })
})
