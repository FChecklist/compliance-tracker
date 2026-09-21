/// <reference types="bun-types" />
// PROJEXA-E2E-001 actor-misattribution sweep: the new revision's
// createdById feeds erp-selling-service.ts's updateQuotationStatus()
// 'approved'-transition isSelfApproval() check -- before this fix, POST
// always attributed createdById to the shared PROJEXA API key row
// (ctx.dbUser?.id ?? ctx.apiKey!.id), never the real logged-in person,
// defeating that self-approval gate for the revision.
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
    requireRole: mock(() => ctx.roleErr ?? null),
    hasRole: mock(() => true),
    resolveWriteActorId: ctx.resolveWriteActorId ?? mock(async () => ({ actorId: "shared-api-key-1", error: null })),
  }))
}

function mockService(overrides: Record<string, unknown> = {}) {
  mock.module("@/lib/services/erp-selling-service", () => ({
    createQuotationRevision: mock(async () => ({})),
    ServiceError,
    ...overrides,
  }))
}

describe("POST /api/v1/projexa/quotations/[id]/revisions", () => {
  test("create attributes the revision's createdById to the REAL resolved acting user, not the shared API key", async () => {
    const resolveWriteActorId = mock(async () => ({ actorId: "real-person-11", error: null }))
    mockAuth({ orgId: "org-1", resolveWriteActorId })
    const createQuotationRevision = mock(async () => ({ id: "quote-rev-1" }))
    mockService({ createQuotationRevision })

    const { POST } = await import("./route")
    const res = await POST(
      { json: async () => ({}) } as any,
      { params: Promise.resolve({ id: "quote-1" }) }
    )

    expect(res.status).toBe(201)
    expect(createQuotationRevision).toHaveBeenCalledWith(
      { orgId: "org-1", userId: "real-person-11", apiKey: { id: "shared-api-key-1" } },
      "quote-1",
      undefined
    )
  })

  test("create is refused, never silently mis-attributed, when the acting-user signal fails to resolve", async () => {
    const refusal = new Response(JSON.stringify({ error: "USER_NOT_LINKED" }), { status: 400 })
    const resolveWriteActorId = mock(async () => ({ actorId: null, error: refusal }))
    mockAuth({ orgId: "org-1", resolveWriteActorId })
    const createQuotationRevision = mock(async () => ({ id: "quote-rev-1" }))
    mockService({ createQuotationRevision })

    const { POST } = await import("./route")
    const res = await POST(
      { json: async () => ({}) } as any,
      { params: Promise.resolve({ id: "quote-1" }) }
    )

    expect(res.status).toBe(400)
    expect(createQuotationRevision).not.toHaveBeenCalled()
  })

  test("create falls back to the unchanged legacy actor id when no acting-user signal is sent (backward-compatible default)", async () => {
    mockAuth({ orgId: "org-1" })
    const createQuotationRevision = mock(async () => ({ id: "quote-rev-1" }))
    mockService({ createQuotationRevision })

    const { POST } = await import("./route")
    const res = await POST(
      { json: async () => ({}) } as any,
      { params: Promise.resolve({ id: "quote-1" }) }
    )

    expect(res.status).toBe(201)
    expect(createQuotationRevision).toHaveBeenCalledWith(
      { orgId: "org-1", userId: "shared-api-key-1", apiKey: { id: "shared-api-key-1" } },
      "quote-1",
      undefined
    )
  })
})
