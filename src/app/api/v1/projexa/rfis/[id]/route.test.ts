/// <reference types="bun-types" />
// PROJEXA-E2E-001 surface-4 (email): live testing of the digest reply-by-
// email path (digest-item-dispatcher.ts's applyRfiVerb, which sends
// X-Acting-User/X-Acting-User-Email so a reply-driven RFI answer is
// attributed to the real person who replied) found this route never
// consumed those headers at all -- PATCH always computed `ctx.dbUser?.id ??
// ctx.apiKey!.id`, so every PROJEXA-proxied "answer" (whether from a reply
// email or PROJEXA's own RFI screen) stored answered_by_id as the shared
// per-org API key's own row, never a real compliance.users id. Live-
// verified directly against pcrjmlpuqsbocqfwoxod: answering a real open RFI
// via the real reply pipeline stored answered_by_id = the org's
// api_keys.id, not arjun.mehta's compliance.users.id.
//
// Fix: PATCH now resolves the acting user via resolveWriteActorId()
// (auth-guard.ts) -- unchanged legacy fallback when no acting-user signal
// is sent (so PROJEXA's own existing RFI-answer UI, which sends no
// headers, is not broken by this fix), but a real resolved identity is
// used whenever one is available, and a signal that fails to resolve is
// refused rather than silently mis-attributed.
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
    getRfi: mock(async () => ({})),
    answerRfi: mock(async () => ({})),
    closeRfi: mock(async () => ({})),
    ServiceError,
    ...overrides,
  }))
}

describe("PATCH /api/v1/projexa/rfis/[id]", () => {
  test("answer calls answerRfi with the default-resolved actor when no override is set (backward-compatible default)", async () => {
    mockAuth({ orgId: "org-1" })
    const answerRfi = mock(async () => ({ id: "rfi-1", status: "answered" }))
    mockService({ answerRfi })

    const { PATCH } = await import("./route")
    const res = await PATCH({ json: async () => ({ action: "answer", answer: "Use grade-40 rebar" }) } as any, { params: Promise.resolve({ id: "rfi-1" }) })

    expect(res.status).toBe(200)
    expect(answerRfi).toHaveBeenCalledWith({ orgId: "org-1", userId: "user-1" }, "rfi-1", "Use grade-40 rebar")
  })

  test("answer attributes to the REAL resolved acting user, not a fallback identity (PROJEXA-E2E-001 surface-4 fix)", async () => {
    const resolveWriteActorId = mock(async () => ({ actorId: "real-person-42", error: null }))
    mockAuth({ orgId: "org-1", resolveWriteActorId })
    const answerRfi = mock(async () => ({ id: "rfi-1", status: "answered" }))
    mockService({ answerRfi })

    const { PATCH } = await import("./route")
    const res = await PATCH({ json: async () => ({ action: "answer", answer: "Use grade-40 rebar" }) } as any, { params: Promise.resolve({ id: "rfi-1" }) })

    expect(res.status).toBe(200)
    expect(answerRfi).toHaveBeenCalledWith({ orgId: "org-1", userId: "real-person-42" }, "rfi-1", "Use grade-40 rebar")
  })

  test("answer is refused, never silently mis-attributed, when the acting-user signal fails to resolve", async () => {
    const refusal = new Response(JSON.stringify({ error: "USER_NOT_LINKED" }), { status: 400 })
    const resolveWriteActorId = mock(async () => ({ actorId: null, error: refusal }))
    mockAuth({ orgId: "org-1", resolveWriteActorId })
    const answerRfi = mock(async () => ({ id: "rfi-1", status: "answered" }))
    mockService({ answerRfi })

    const { PATCH } = await import("./route")
    const res = await PATCH({ json: async () => ({ action: "answer", answer: "x" }) } as any, { params: Promise.resolve({ id: "rfi-1" }) })

    expect(res.status).toBe(400)
    expect(answerRfi).not.toHaveBeenCalled()
  })

  test("close does not require an acting user at all (closeRfi takes no userId)", async () => {
    const resolveWriteActorId = mock(async () => { throw new Error("must not be called for close") })
    mockAuth({ orgId: "org-1", resolveWriteActorId })
    const closeRfi = mock(async () => ({ id: "rfi-1", status: "closed" }))
    mockService({ closeRfi })

    const { PATCH } = await import("./route")
    const res = await PATCH({ json: async () => ({ action: "close" }) } as any, { params: Promise.resolve({ id: "rfi-1" }) })

    expect(res.status).toBe(200)
    expect(closeRfi).toHaveBeenCalledWith({ orgId: "org-1" }, "rfi-1")
  })

  test("an unknown action is refused", async () => {
    mockAuth({ orgId: "org-1" })
    mockService()

    const { PATCH } = await import("./route")
    const res = await PATCH({ json: async () => ({ action: "delete" }) } as any, { params: Promise.resolve({ id: "rfi-1" }) })

    expect(res.status).toBe(400)
  })
})
