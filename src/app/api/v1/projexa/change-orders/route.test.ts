/// <reference types="bun-types" />
// PROJEXA-E2E-001 actor-misattribution sweep: requestedById feeds
// construction-exceptions-service.ts's findSelfApprovedChangeOrders() fraud
// check (approvedById === requestedById) -- before this fix, POST always
// attributed requestedById to the shared PROJEXA API key row
// (ctx.dbUser?.id ?? ctx.apiKey!.id), never the real logged-in person,
// defeating that segregation-of-duties control.
import { describe, test, expect, mock } from "bun:test"

class ServiceError extends Error {
  status: number
  constructor(message: string, status: number) {
    super(message)
    this.status = status
  }
}

function mockAuth(ctx: {
  orgId: string | null
  roleErr?: Response | null
  resolveWriteActorId?: () => Promise<{ actorId: string | null; error: Response | null }>
}) {
  mock.module("@/lib/supabase/auth-guard", () => ({
    requireAuthOrApiKey: mock(async () => ({
      orgId: ctx.orgId,
      dbUser: null,
      apiKey: ctx.orgId ? { id: "shared-api-key-1" } : null,
      response: null,
    })),
    requireRoleOrScope: mock(() => ctx.roleErr ?? null),
    resolveWriteActorId: ctx.resolveWriteActorId ?? mock(async () => ({ actorId: "shared-api-key-1", error: null })),
  }))
}

function mockService(overrides: Record<string, unknown> = {}) {
  mock.module("@/lib/services/construction-change-order-service", () => ({
    listChangeOrders: mock(async () => []),
    createChangeOrder: mock(async () => ({})),
    ServiceError,
    ...overrides,
  }))
}

describe("POST /api/v1/projexa/change-orders", () => {
  test("create attributes requestedById to the REAL resolved acting user, not the shared API key", async () => {
    const resolveWriteActorId = mock(async () => ({ actorId: "real-person-3", error: null }))
    mockAuth({ orgId: "org-1", resolveWriteActorId })
    const createChangeOrder = mock(async () => ({ id: "co-1" }))
    mockService({ createChangeOrder })

    const { POST } = await import("./route")
    const res = await POST({ json: async () => ({ title: "Extra glazing" }) } as any)

    expect(res.status).toBe(201)
    expect(createChangeOrder).toHaveBeenCalledWith({ orgId: "org-1", userId: "real-person-3" }, { title: "Extra glazing" })
  })

  test("create is refused, never silently mis-attributed, when the acting-user signal fails to resolve", async () => {
    const refusal = new Response(JSON.stringify({ error: "USER_NOT_LINKED" }), { status: 400 })
    const resolveWriteActorId = mock(async () => ({ actorId: null, error: refusal }))
    mockAuth({ orgId: "org-1", resolveWriteActorId })
    const createChangeOrder = mock(async () => ({ id: "co-1" }))
    mockService({ createChangeOrder })

    const { POST } = await import("./route")
    const res = await POST({ json: async () => ({ title: "Extra glazing" }) } as any)

    expect(res.status).toBe(400)
    expect(createChangeOrder).not.toHaveBeenCalled()
  })

  test("create falls back to the unchanged legacy actor id when no acting-user signal is sent (backward-compatible default)", async () => {
    mockAuth({ orgId: "org-1" })
    const createChangeOrder = mock(async () => ({ id: "co-1" }))
    mockService({ createChangeOrder })

    const { POST } = await import("./route")
    const res = await POST({ json: async () => ({ title: "Extra glazing" }) } as any)

    expect(res.status).toBe(201)
    expect(createChangeOrder).toHaveBeenCalledWith({ orgId: "org-1", userId: "shared-api-key-1" }, { title: "Extra glazing" })
  })
})
