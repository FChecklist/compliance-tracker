/// <reference types="bun-types" />
// R60 T7 (E-52 sweep, house-pattern "silent-empty-200"): GET previously
// returned 200 { compliance: [], total: 0, page: 1, limit: 20, totalPages: 0 }
// when ctx.orgId was falsy -- a valid, empty, cheerful answer indistinguishable
// from "authenticated tenant, zero compliance items" -- while POST in this
// same file already returned 400 "No organisation on this account" for the
// identical condition. Fixed to match. Same mock.module convention as
// reports/catalog/route.test.ts and tasks/[id]/status/route.test.ts: auth-guard
// and the service layer are both mocked so this proves the route's own
// wiring, not a live DB.
import { describe, test, expect, mock } from "bun:test"

class ServiceError extends Error {
  status: number
  constructor(message: string, status: number) {
    super(message)
    this.status = status
  }
}

function mockAuth(ctx: { orgId: string | null; response?: Response | null }) {
  mock.module("@/lib/supabase/auth-guard", () => ({
    requireAuthOrApiKey: mock(async () => ({
      orgId: ctx.orgId,
      dbUser: ctx.orgId ? { id: "user-1" } : null,
      apiKey: null,
      response: ctx.response ?? null,
    })),
    requireRoleOrScope: mock(() => null),
  }))
}

function mockService(listImpl?: () => Promise<unknown>) {
  const listComplianceItems = mock(listImpl ?? (async () => ({ compliance: [], total: 0, page: 1, limit: 20, totalPages: 0 })))
  mock.module("@/lib/services/compliance-service", () => ({
    listComplianceItems,
    createComplianceItem: mock(async () => ({ id: "c-1" })),
    ServiceError,
  }))
  return listComplianceItems
}

function getRequest() {
  // Plain Request has no .nextUrl (that's a Next.js-specific NextRequest
  // extension) -- requireAuthOrApiKey is mocked above and never inspects
  // the request object itself, so a minimal stand-in carrying just the
  // .nextUrl the route body actually reads is enough here.
  return { nextUrl: new URL("http://localhost/api/v1/compliance") }
}

describe("GET /api/v1/compliance", () => {
  test("a caller with no resolvable org now gets 400, matching this file's own POST -- not a silent 200 empty list", async () => {
    mockAuth({ orgId: null })
    const listComplianceItems = mockService()

    const { GET } = await import("./route")
    const res = await GET(getRequest() as any)

    expect(res.status).toBe(400)
    expect(await res.json()).toEqual({ error: "No organisation on this account" })
    expect(listComplianceItems).not.toHaveBeenCalled()
  })

  test("real case: authenticated + org resolved calls listComplianceItems with the caller's own orgId", async () => {
    mockAuth({ orgId: "org-1" })
    const listComplianceItems = mockService(async () => ({
      compliance: [{ id: "c-1" }],
      total: 1,
      page: 1,
      limit: 20,
      totalPages: 1,
    }))

    const { GET } = await import("./route")
    const res = await GET(getRequest() as any)

    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ compliance: [{ id: "c-1" }], total: 1, page: 1, limit: 20, totalPages: 1 })
    expect(listComplianceItems).toHaveBeenCalledTimes(1)
    expect(listComplianceItems.mock.calls[0][0]).toEqual({ orgId: "org-1" })
  })

  test("an unauthenticated caller gets the auth-guard's own response verbatim, service never called", async () => {
    mockAuth({ orgId: null, response: new Response(JSON.stringify({ error: "Not authenticated" }), { status: 401 }) })
    const listComplianceItems = mockService()

    const { GET } = await import("./route")
    const res = await GET(getRequest() as any)

    expect(res.status).toBe(401)
    expect(listComplianceItems).not.toHaveBeenCalled()
  })
})
