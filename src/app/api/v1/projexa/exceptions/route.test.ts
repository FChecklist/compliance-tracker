/// <reference types="bun-types" />
// Sumeet requirement (new): proves the 28-item exceptions report is a real,
// live, GET-only endpoint reachable from PROJEXA, gated at "manager" the
// same way the sibling boq-analysis report is.
import { describe, test, expect, mock } from "bun:test"

class ServiceError extends Error {
  status: number
  constructor(message: string, status: number) {
    super(message)
    this.status = status
  }
}

function mockAuth(ctx: { orgId: string | null; response?: Response | null; roleErr?: Response | null }) {
  mock.module("@/lib/supabase/auth-guard", () => ({
    requireAuthOrApiKey: mock(async () => ({
      orgId: ctx.orgId,
      dbUser: ctx.orgId ? { id: "user-1" } : null,
      apiKey: null,
      response: ctx.response ?? null,
    })),
    requireRoleOrScope: mock(() => ctx.roleErr ?? null),
    requireOrg: mock((c: { orgId: string | null }) =>
      c.orgId ? null : new Response(JSON.stringify({ error: "No organisation on this account" }), { status: 400 })
    ),
  }))
}

describe("GET /api/v1/projexa/exceptions", () => {
  test("returns the project's 28-item exceptions report", async () => {
    mockAuth({ orgId: "org-1" })
    const checks = [{ item: 1, title: "Extra work done, never captured", flagged: true, count: 1, records: [{ id: "d1", detail: "..." }], formula: "..." }]
    const getProjectExceptions = mock(async () => checks)
    mock.module("@/lib/services/construction-exceptions-service", () => ({ getProjectExceptions, ServiceError }))

    const { GET } = await import("./route")
    const res = await GET({ nextUrl: new URL("http://localhost/api/v1/projexa/exceptions?projectId=proj-1") } as any)

    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ checks })
    expect(getProjectExceptions).toHaveBeenCalledWith({ orgId: "org-1" }, "proj-1")
  })

  test("a role below manager is refused before reaching the service layer", async () => {
    mockAuth({ orgId: "org-1", roleErr: new Response(JSON.stringify({ error: "This action requires manager role or above" }), { status: 403 }) })
    const getProjectExceptions = mock(async () => [])
    mock.module("@/lib/services/construction-exceptions-service", () => ({ getProjectExceptions, ServiceError }))

    const { GET } = await import("./route")
    const res = await GET({ nextUrl: new URL("http://localhost/api/v1/projexa/exceptions?projectId=proj-1") } as any)

    expect(res.status).toBe(403)
    expect(getProjectExceptions).not.toHaveBeenCalled()
  })

  test("no projectId is refused with a clear 400, not a silent org-wide report", async () => {
    mockAuth({ orgId: "org-1" })
    const getProjectExceptions = mock(async () => [])
    mock.module("@/lib/services/construction-exceptions-service", () => ({ getProjectExceptions, ServiceError }))

    const { GET } = await import("./route")
    const res = await GET({ nextUrl: new URL("http://localhost/api/v1/projexa/exceptions") } as any)

    expect(res.status).toBe(400)
    expect(getProjectExceptions).not.toHaveBeenCalled()
  })
})
