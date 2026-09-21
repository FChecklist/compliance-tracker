/// <reference types="bun-types" />
// PROJEXA-E2E-001 surface-4 (email): same fix and same reasoning as the
// sibling rfis/[id]/route.test.ts -- see that file's own header. This
// route's PATCH (submittal review) had the identical
// `ctx.dbUser?.id ?? ctx.apiKey!.id` gap.
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
  response?: Response | null
  roleErr?: Response | null
  resolveWriteActorId?: () => Promise<{ actorId: string | null; error: Response | null }>
}) {
  mock.module("@/lib/supabase/auth-guard", () => ({
    requireAuthOrApiKey: mock(async () => ({
      orgId: ctx.orgId,
      dbUser: ctx.orgId ? { id: "user-1" } : null,
      apiKey: null,
      response: ctx.response ?? null,
    })),
    requireRoleOrScope: mock(() => ctx.roleErr ?? null),
    resolveWriteActorId: ctx.resolveWriteActorId ?? mock(async () => ({ actorId: "user-1", error: null })),
  }))
}

function mockService(overrides: Record<string, unknown> = {}) {
  mock.module("@/lib/services/construction-field-workflow-service", () => ({
    getSubmittal: mock(async () => ({})),
    reviewSubmittal: mock(async () => ({})),
    ServiceError,
    ...overrides,
  }))
}

describe("PATCH /api/v1/projexa/submittals/[id]", () => {
  test("review calls reviewSubmittal with the default-resolved actor when no override is set (backward-compatible default)", async () => {
    mockAuth({ orgId: "org-1" })
    const reviewSubmittal = mock(async () => ({ id: "sub-1", status: "approved" }))
    mockService({ reviewSubmittal })

    const { PATCH } = await import("./route")
    const res = await PATCH({ json: async () => ({ action: "review", status: "approved", comments: "Looks good" }) } as any, { params: Promise.resolve({ id: "sub-1" }) })

    expect(res.status).toBe(200)
    expect(reviewSubmittal).toHaveBeenCalledWith({ orgId: "org-1", userId: "user-1" }, "sub-1", "approved", "Looks good")
  })

  test("review attributes to the REAL resolved acting user, not a fallback identity (PROJEXA-E2E-001 surface-4 fix)", async () => {
    const resolveWriteActorId = mock(async () => ({ actorId: "real-person-42", error: null }))
    mockAuth({ orgId: "org-1", resolveWriteActorId })
    const reviewSubmittal = mock(async () => ({ id: "sub-1", status: "approved" }))
    mockService({ reviewSubmittal })

    const { PATCH } = await import("./route")
    const res = await PATCH({ json: async () => ({ action: "review", status: "approved" }) } as any, { params: Promise.resolve({ id: "sub-1" }) })

    expect(res.status).toBe(200)
    expect(reviewSubmittal).toHaveBeenCalledWith({ orgId: "org-1", userId: "real-person-42" }, "sub-1", "approved", undefined)
  })

  test("review is refused, never silently mis-attributed, when the acting-user signal fails to resolve", async () => {
    const refusal = new Response(JSON.stringify({ error: "USER_NOT_LINKED" }), { status: 400 })
    const resolveWriteActorId = mock(async () => ({ actorId: null, error: refusal }))
    mockAuth({ orgId: "org-1", resolveWriteActorId })
    const reviewSubmittal = mock(async () => ({ id: "sub-1", status: "approved" }))
    mockService({ reviewSubmittal })

    const { PATCH } = await import("./route")
    const res = await PATCH({ json: async () => ({ action: "review", status: "approved" }) } as any, { params: Promise.resolve({ id: "sub-1" }) })

    expect(res.status).toBe(400)
    expect(reviewSubmittal).not.toHaveBeenCalled()
  })

  test("a non-review action is refused", async () => {
    mockAuth({ orgId: "org-1" })
    mockService()

    const { PATCH } = await import("./route")
    const res = await PATCH({ json: async () => ({ action: "delete" }) } as any, { params: Promise.resolve({ id: "sub-1" }) })

    expect(res.status).toBe(400)
  })
})
