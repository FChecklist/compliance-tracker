/// <reference types="bun-types" />
// PROJEXA-E2E-001 actor-misattribution sweep: submittedById feeds
// reviewSubmittal()'s isSelfApproval() check (construction-field-workflow-
// service.ts) -- before this fix, POST always attributed submittedById to
// the shared PROJEXA API key row (ctx.dbUser?.id ?? ctx.apiKey!.id), never
// the real logged-in person, defeating that self-approval gate.
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
  mock.module("@/lib/services/construction-field-workflow-service", () => ({
    listSubmittals: mock(async () => []),
    createSubmittal: mock(async () => ({})),
    ServiceError,
    ...overrides,
  }))
}

describe("POST /api/v1/projexa/submittals", () => {
  test("create attributes submittedById to the REAL resolved acting user, not the shared API key", async () => {
    const resolveWriteActorId = mock(async () => ({ actorId: "real-person-7", error: null }))
    mockAuth({ orgId: "org-1", resolveWriteActorId })
    const createSubmittal = mock(async () => ({ id: "sub-9" }))
    mockService({ createSubmittal })

    const { POST } = await import("./route")
    const res = await POST({ json: async () => ({ title: "Concrete mix design" }) } as any)

    expect(res.status).toBe(201)
    expect(createSubmittal).toHaveBeenCalledWith({ orgId: "org-1", userId: "real-person-7" }, { title: "Concrete mix design" })
  })

  test("create is refused, never silently mis-attributed, when the acting-user signal fails to resolve", async () => {
    const refusal = new Response(JSON.stringify({ error: "USER_NOT_LINKED" }), { status: 400 })
    const resolveWriteActorId = mock(async () => ({ actorId: null, error: refusal }))
    mockAuth({ orgId: "org-1", resolveWriteActorId })
    const createSubmittal = mock(async () => ({ id: "sub-9" }))
    mockService({ createSubmittal })

    const { POST } = await import("./route")
    const res = await POST({ json: async () => ({ title: "Concrete mix design" }) } as any)

    expect(res.status).toBe(400)
    expect(createSubmittal).not.toHaveBeenCalled()
  })

  test("create falls back to the unchanged legacy actor id when no acting-user signal is sent (backward-compatible default)", async () => {
    mockAuth({ orgId: "org-1" })
    const createSubmittal = mock(async () => ({ id: "sub-9" }))
    mockService({ createSubmittal })

    const { POST } = await import("./route")
    const res = await POST({ json: async () => ({ title: "Concrete mix design" }) } as any)

    expect(res.status).toBe(201)
    expect(createSubmittal).toHaveBeenCalledWith({ orgId: "org-1", userId: "shared-api-key-1" }, { title: "Concrete mix design" })
  })
})
