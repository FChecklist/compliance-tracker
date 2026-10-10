/// <reference types="bun-types" />
// PROJEXA-E2E-001 actor-misattribution sweep: the new revision's
// createdById feeds erp-selling-service.ts's updateQuotationStatus()
// 'approved'-transition isSelfApproval() check -- before this fix, POST
// always attributed createdById to the shared PROJEXA API key row
// (ctx.dbUser?.id ?? ctx.apiKey!.id), never the real logged-in person,
// defeating that self-approval gate for the revision.
//
// PROJEXA-BUILD-001 U-20b: the route now uses requireActingPerson. The third
// test used to pin the "no signal -> the key's own id" fallback; that
// fallback is gone, so it now pins the refusal instead. The shared double
// reads the request's real X-Acting-User header.
import { describe, test, expect, mock } from "bun:test"
import { actingPersonDouble } from "@/lib/supabase/__test-helpers__/acting-person-double"

class ServiceError extends Error {
  status: number
  constructor(message: string, status: number) {
    super(message)
    this.status = status
  }
}

const PERSON_11 = { id: "real-person-11" }

function mockAuth(ctx: { orgId: string | null; roleErr?: Response | null }) {
  mock.module("@/lib/supabase/auth-guard", () => ({
    ...actingPersonDouble((actorId) => (actorId === "projexa-user-11" ? PERSON_11 : null)),
    requireAuthOrApiKey: mock(async () => ({
      orgId: ctx.orgId,
      dbUser: null,
      apiKey: ctx.orgId ? { id: "shared-api-key-1", name: "PROJEXA org key" } : null,
      response: null,
    })),
    requireRoleOrScope: mock(() => ctx.roleErr ?? null),
    requireRole: mock(() => ctx.roleErr ?? null),
    hasRole: mock(() => true),
  }))
}

function mockService(overrides: Record<string, unknown> = {}) {
  mock.module("@/lib/services/erp-selling-service", () => ({
    createQuotationRevision: mock(async () => ({})),
    ServiceError,
    ...overrides,
  }))
}

function post(headers: Record<string, string>) {
  return { json: async () => ({}), headers: new Headers(headers) } as any
}

describe("POST /api/v1/projexa/quotations/[id]/revisions", () => {
  test("create attributes the revision's createdById to the REAL resolved acting user, not the shared API key", async () => {
    mockAuth({ orgId: "org-1" })
    const createQuotationRevision = mock(async () => ({ id: "quote-rev-1" }))
    mockService({ createQuotationRevision })

    const { POST } = await import("./route")
    const res = await POST(post({ "X-Acting-User": "projexa-user-11" }), { params: Promise.resolve({ id: "quote-1" }) })

    expect(res.status).toBe(201)
    expect(createQuotationRevision).toHaveBeenCalledWith(
      {
        orgId: "org-1", userId: "real-person-11",
        dbUser: PERSON_11, apiKey: { id: "shared-api-key-1", name: "PROJEXA org key" }, actingViaApiKey: true,
      },
      "quote-1",
      undefined
    )
  })

  test("create is refused, never silently mis-attributed, when the acting-user signal fails to resolve", async () => {
    mockAuth({ orgId: "org-1" })
    const createQuotationRevision = mock(async () => ({ id: "quote-rev-1" }))
    mockService({ createQuotationRevision })

    const { POST } = await import("./route")
    const res = await POST(post({ "X-Acting-User": "someone-unlinked" }), { params: Promise.resolve({ id: "quote-1" }) })

    expect(res.status).toBe(400)
    expect((await res.json()).code).toBe("USER_NOT_LINKED")
    expect(createQuotationRevision).not.toHaveBeenCalled()
  })

  test("U-20b: create with no acting-user signal is refused with ACTING_USER_REQUIRED -- the key's own id is never recorded", async () => {
    mockAuth({ orgId: "org-1" })
    const createQuotationRevision = mock(async () => ({ id: "quote-rev-1" }))
    mockService({ createQuotationRevision })

    const { POST } = await import("./route")
    const res = await POST(post({}), { params: Promise.resolve({ id: "quote-1" }) })

    expect(res.status).toBe(400)
    expect((await res.json()).code).toBe("ACTING_USER_REQUIRED")
    expect(createQuotationRevision).not.toHaveBeenCalled()
  })
})