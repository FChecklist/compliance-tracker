/// <reference types="bun-types" />
// Sumeet requirement #2: a milestone's own record must be editable after
// creation (status/name/description/targetDate) -- no delete, per the
// append-only requirement (status:'cancelled' is the equivalent).
import { describe, test, expect, mock } from "bun:test"
import { actingPersonDouble } from "@/lib/supabase/__test-helpers__/acting-person-double"

class ServiceError extends Error {
  status: number
  constructor(message: string, status: number) {
    super(message)
    this.status = status
  }
}

function mockAuth(ctx: { orgId: string | null; response?: Response | null; roleErr?: Response | null }) {
  mock.module("@/lib/supabase/auth-guard", () => ({
    ...actingPersonDouble(),
    requireAuthOrApiKey: mock(async () => ({
      orgId: ctx.orgId,
      dbUser: ctx.orgId ? { id: "user-1" } : null,
      apiKey: null,
      response: ctx.response ?? null,
    })),
    requireRoleOrScope: mock(() => ctx.roleErr ?? null),
  }))
}

describe("PATCH /api/v1/projexa/milestones/[id]", () => {
  test("updates status and returns the updated row", async () => {
    mockAuth({ orgId: "org-1" })
    const updated = { id: "ms-1", status: "completed", completionPercentage: 100 }
    const updateMilestone = mock(async () => updated)
    mock.module("@/lib/services/pms-taxonomy-service", () => ({ updateMilestone, ServiceError }))

    const { PATCH } = await import("./route")
    const res = await PATCH(
      { json: async () => ({ status: "completed" }) } as any,
      { params: Promise.resolve({ id: "ms-1" }) }
    )

    expect(res.status).toBe(200)
    expect(await res.json()).toEqual(updated)
    expect(updateMilestone).toHaveBeenCalledWith(
      { orgId: "org-1", userId: "user-1", dbUser: { id: "user-1" } },
      "ms-1",
      { name: undefined, description: undefined, targetDate: undefined, status: "completed" }
    )
  })

  test("a service-layer refusal (unknown status, not found) surfaces its real status code, not a bare 500", async () => {
    mockAuth({ orgId: "org-1" })
    const updateMilestone = mock(async () => {
      throw new ServiceError("Milestone not found", 404)
    })
    mock.module("@/lib/services/pms-taxonomy-service", () => ({ updateMilestone, ServiceError }))

    const { PATCH } = await import("./route")
    const res = await PATCH(
      { json: async () => ({ status: "completed" }) } as any,
      { params: Promise.resolve({ id: "ms-missing" }) }
    )

    expect(res.status).toBe(404)
    expect(await res.json()).toEqual({ error: "Milestone not found" })
  })

  test("no organisation on the account is refused before reaching the service layer", async () => {
    mockAuth({ orgId: null })
    const updateMilestone = mock(async () => ({}))
    mock.module("@/lib/services/pms-taxonomy-service", () => ({ updateMilestone, ServiceError }))

    const { PATCH } = await import("./route")
    const res = await PATCH(
      { json: async () => ({ status: "completed" }) } as any,
      { params: Promise.resolve({ id: "ms-1" }) }
    )

    expect(res.status).toBe(400)
    expect(updateMilestone).not.toHaveBeenCalled()
  })
})
