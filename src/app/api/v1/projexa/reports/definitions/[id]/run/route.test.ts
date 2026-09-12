/// <reference types="bun-types" />
// R75 Part 2 Phase 5 (G4 reports): proves the requireRoleOrScope(ctx,
// "manager", "read") gate added to this route -- it previously had NO role/
// scope check at all beyond requireAuthOrApiKey. Matches this route's own
// declared session-auth sibling, src/app/api/reports/definitions/[id]/run/
// route.ts, which is gated requireRole(dbUser, "manager") -- same
// dispatcher (executeReportDefinition), same execution stakes, same
// minimum. fakeRequireRoleOrScope below mirrors the REAL
// requireRoleOrScope()'s logic (rank comparison for a session dbUser, scope
// membership for an API-key caller) rather than a canned true/false, so
// this proves the actual rank/scope boundary, not just that some function
// was called.
import { describe, test, expect, mock } from "bun:test"
import { ROLE_RANK } from "@/lib/supabase/role-rank"

function fakeRequireRoleOrScope(ctx: any, minimumRole: string, writeScope: "read" | "write" = "write") {
  if (ctx.dbUser) {
    const userRank = ROLE_RANK[ctx.dbUser.role as keyof typeof ROLE_RANK] ?? 0
    const requiredRank = ROLE_RANK[minimumRole as keyof typeof ROLE_RANK] ?? 99
    if (userRank < requiredRank) {
      return new Response(JSON.stringify({ error: `This action requires ${minimumRole} role or higher` }), { status: 403 }) as any
    }
    return null
  }
  if (ctx.apiKey) {
    if (!ctx.apiKey.scopes.includes(writeScope)) {
      return new Response(JSON.stringify({ error: `This action requires a ${writeScope}-scoped API key` }), { status: 403 }) as any
    }
    return null
  }
  return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401 }) as any
}

class FakeServiceError extends Error {
  status: number
  constructor(message: string, status: number) {
    super(message)
    this.status = status
  }
}

function dbUser(role: string) {
  return { id: "user-1", role, orgId: "org-1" } as any
}

function makeRequest(): Request {
  return new Request("http://localhost/api/v1/projexa/reports/definitions/def-1/run", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ params: {} }),
  })
}

function mockAuth(ctx: { orgId: string | null; dbUser?: unknown; apiKey?: unknown; response?: unknown }) {
  const hasDbUser = Object.prototype.hasOwnProperty.call(ctx, "dbUser")
  mock.module("@/lib/supabase/auth-guard", () => ({
    requireAuthOrApiKey: mock(async () => ({
      orgId: ctx.orgId,
      dbUser: hasDbUser ? ctx.dbUser : null,
      apiKey: ctx.apiKey ?? null,
      response: ctx.response ?? null,
    })),
    requireRoleOrScope: fakeRequireRoleOrScope,
  }))
}

function mockService(executeReportDefinition: ReturnType<typeof mock>) {
  mock.module("@/lib/services/report-engine-service", () => ({ executeReportDefinition, ServiceError: FakeServiceError }))
}

describe("POST /api/v1/projexa/reports/definitions/[id]/run (access control)", () => {
  test("a session caller below manager (member) is rejected with 403 and executeReportDefinition is never called", async () => {
    const executeReportDefinition = mock(async () => { throw new Error("should not be called for a below-minimum caller") })
    mockAuth({ orgId: "org-1", dbUser: dbUser("member") })
    mockService(executeReportDefinition)

    const { POST } = await import("./route")
    const res = await POST(makeRequest() as any, { params: Promise.resolve({ id: "def-1" }) })
    expect(res.status).toBe(403)
    expect(executeReportDefinition).not.toHaveBeenCalled()
  })

  test("a manager-rank session caller is allowed through and executeReportDefinition is called", async () => {
    const executeReportDefinition = mock(async () => ({ columns: ["A"], rows: [] }))
    mockAuth({ orgId: "org-1", dbUser: dbUser("manager") })
    mockService(executeReportDefinition)

    const { POST } = await import("./route")
    const res = await POST(makeRequest() as any, { params: Promise.resolve({ id: "def-1" }) })
    expect(res.status).toBe(200)
    expect(executeReportDefinition).toHaveBeenCalledTimes(1)
  })

  test("an API-key caller without read scope is rejected with 403 and executeReportDefinition is never called", async () => {
    const executeReportDefinition = mock(async () => { throw new Error("should not be called for a below-minimum caller") })
    mockAuth({ orgId: "org-1", dbUser: null, apiKey: { id: "apikey-1", name: "Key", scopes: ["write"] } })
    mockService(executeReportDefinition)

    const { POST } = await import("./route")
    const res = await POST(makeRequest() as any, { params: Promise.resolve({ id: "def-1" }) })
    expect(res.status).toBe(403)
    expect(executeReportDefinition).not.toHaveBeenCalled()
  })

  test("an API-key caller with read scope is allowed through and executeReportDefinition is called", async () => {
    const executeReportDefinition = mock(async () => ({ columns: ["A"], rows: [] }))
    mockAuth({ orgId: "org-1", dbUser: null, apiKey: { id: "apikey-1", name: "Key", scopes: ["read"] } })
    mockService(executeReportDefinition)

    const { POST } = await import("./route")
    const res = await POST(makeRequest() as any, { params: Promise.resolve({ id: "def-1" }) })
    expect(res.status).toBe(200)
    expect(executeReportDefinition).toHaveBeenCalledTimes(1)
  })
})
