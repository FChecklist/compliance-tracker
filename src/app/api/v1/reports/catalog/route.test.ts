/// <reference types="bun-types" />
// task-20260727-101145: thin wiring test, same pattern as
// definitions/[id]/run/route.test.ts -- proves getFullReportCatalog() is
// always called with the authenticated caller's own orgId, and that the
// 401/403 gates short-circuit before it's ever called.
import { describe, test, expect, mock } from "bun:test"

function mockAuth(ctx: { orgId: string | null; response?: Response | null; scopeErr?: Response | null }) {
  mock.module("@/lib/supabase/auth-guard", () => ({
    requireAuthOrApiKey: mock(async () => ({
      orgId: ctx.orgId,
      dbUser: null,
      apiKey: ctx.orgId ? { id: "key-1", name: "Test Key", scopes: ["read"] } : null,
      response: ctx.response ?? null,
    })),
    requireReportsReadAccess: mock(() => ctx.scopeErr ?? null),
  }))
}

function mockCatalog(catalog: unknown[]) {
  const getFullReportCatalog = mock(async () => catalog)
  // Also stubs executeReportDefinition (unused by this route) -- bun's
  // mock.module() replaces this module's exports process-wide, and
  // ../definitions/[id]/run/route.test.ts imports the same specifier, so a
  // factory missing an export it needs would break that file if the two
  // ran interleaved in the same `bun test` process.
  mock.module("@/lib/services/report-engine-service", () => ({
    getFullReportCatalog,
    executeReportDefinition: mock(async () => ({ columns: [], rows: [] })),
    ServiceError: class ServiceError extends Error {
      status: number
      constructor(message: string, status: number) {
        super(message)
        this.status = status
      }
    },
  }))
  return getFullReportCatalog
}

function getRequest() {
  return new Request("http://localhost/api/v1/reports/catalog", {
    headers: { authorization: "Bearer vk_test" },
  })
}

describe("GET /api/v1/reports/catalog", () => {
  test("calls getFullReportCatalog with the authenticated caller's own orgId", async () => {
    mockAuth({ orgId: "org-b" })
    const getFullReportCatalog = mockCatalog([{ id: "r1" }])

    const { GET } = await import("./route")
    const res = await GET(getRequest() as any)

    expect(res.status).toBe(200)
    expect(getFullReportCatalog).toHaveBeenCalledWith({ orgId: "org-b" })
    expect(await res.json()).toEqual({ catalog: [{ id: "r1" }] })
  })

  test("an authenticated caller with no organisation gets 400, matching the /run route's contract", async () => {
    // Previously returned 200 { catalog: [] } here -- inconsistent with
    // .../run's 400 "No organisation found" for the identical condition.
    mockAuth({ orgId: null })
    const getFullReportCatalog = mockCatalog([])

    const { GET } = await import("./route")
    const res = await GET(getRequest() as any)

    expect(res.status).toBe(400)
    expect(await res.json()).toEqual({ error: "No organisation found" })
    expect(getFullReportCatalog).not.toHaveBeenCalled()
  })

  test("an invalid/missing API key never reaches getFullReportCatalog", async () => {
    mockAuth({ orgId: null, response: new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401 }) })
    const getFullReportCatalog = mockCatalog([])

    const { GET } = await import("./route")
    const res = await GET(getRequest() as any)

    expect(res.status).toBe(401)
    expect(getFullReportCatalog).not.toHaveBeenCalled()
  })

  test("a key without read/read:reports scope is rejected with 403 before getFullReportCatalog runs", async () => {
    mockAuth({ orgId: "org-b", scopeErr: new Response(JSON.stringify({ error: "scoped" }), { status: 403 }) })
    const getFullReportCatalog = mockCatalog([])

    const { GET } = await import("./route")
    const res = await GET(getRequest() as any)

    expect(res.status).toBe(403)
    expect(getFullReportCatalog).not.toHaveBeenCalled()
  })
})
