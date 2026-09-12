/// <reference types="bun-types" />
// R75 Phase 5 (G1 compliance authz gap-closure). syncOverdue() is a bulk
// status-update mutation across every overdue item in the org -- the same
// weight as PATCH-ing a single item -- and previously had no role/scope
// restriction beyond org membership (callable via API key or session).
// Fixed to require requireRoleOrScope(ctx, "member", "write"), matching
// compliance/route.ts's own combined-auth POST floor.
//
// fakeRequireRoleOrScope reimplements the real function's dbUser/apiKey
// branching over the REAL ROLE_RANK table (leaf ./role-rank module), so
// this test exercises whether route.ts itself calls the gate.
import { describe, test, expect, mock } from "bun:test"
import { ROLE_RANK } from "@/lib/supabase/role-rank"

function fakeRequireRole(user: any, minimumRole: string) {
  const userRank = ROLE_RANK[user?.role as keyof typeof ROLE_RANK] ?? 0
  const requiredRank = ROLE_RANK[minimumRole as keyof typeof ROLE_RANK] ?? 99
  if (userRank < requiredRank) {
    return new Response(JSON.stringify({ error: `This action requires ${minimumRole} role or higher` }), { status: 403 }) as any
  }
  return null
}

function fakeRequireRoleOrScope(ctx: any, minimumRole: string, writeScope: "read" | "write" = "write") {
  if (ctx.dbUser) return fakeRequireRole(ctx.dbUser, minimumRole)
  if (ctx.apiKey) {
    if (!ctx.apiKey.scopes?.includes(writeScope)) {
      return new Response(JSON.stringify({ error: `This action requires a ${writeScope}-scoped API key` }), { status: 403 }) as any
    }
    return null
  }
  return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401 }) as any
}

function makeRequest(): Request {
  return new Request("http://localhost/api/compliance/overdue", { method: "POST" })
}

describe("POST /api/compliance/overdue (access control)", () => {
  test("a viewer-rank session caller (below member) is rejected with 403 and syncOverdue is never called", async () => {
    const syncOverdue = mock(async () => { throw new Error("syncOverdue should not be called for a below-role caller") })
    mock.module("@/lib/supabase/auth-guard", () => ({
      requireAuthOrApiKey: mock(async () => ({ orgId: "org-1", dbUser: { id: "user-1", role: "viewer" }, apiKey: null, response: null })),
      requireOrg: mock(() => null),
      requireRoleOrScope: fakeRequireRoleOrScope,
    }))
    mock.module("@/lib/services/compliance-service", () => ({ syncOverdue }))

    const { POST } = await import("./route")
    const res = await POST(makeRequest() as any)
    expect(res.status).toBe(403)
    expect(syncOverdue).not.toHaveBeenCalled()
    mock.restore()
  })

  test("a read-only-scoped API key caller is rejected with 403 and syncOverdue is never called", async () => {
    const syncOverdue = mock(async () => { throw new Error("syncOverdue should not be called for a read-scoped key") })
    mock.module("@/lib/supabase/auth-guard", () => ({
      requireAuthOrApiKey: mock(async () => ({ orgId: "org-1", dbUser: null, apiKey: { id: "k-1", name: "k", scopes: ["read"] }, response: null })),
      requireOrg: mock(() => null),
      requireRoleOrScope: fakeRequireRoleOrScope,
    }))
    mock.module("@/lib/services/compliance-service", () => ({ syncOverdue }))

    const { POST } = await import("./route")
    const res = await POST(makeRequest() as any)
    expect(res.status).toBe(403)
    expect(syncOverdue).not.toHaveBeenCalled()
    mock.restore()
  })

  test("a member-rank session caller passes the role gate and syncOverdue is called", async () => {
    const syncOverdue = mock(async () => ({ updated: 3, updatedAt: "2026-09-05T00:00:00.000Z" }))
    mock.module("@/lib/supabase/auth-guard", () => ({
      requireAuthOrApiKey: mock(async () => ({ orgId: "org-1", dbUser: { id: "user-1", role: "member" }, apiKey: null, response: null })),
      requireOrg: mock(() => null),
      requireRoleOrScope: fakeRequireRoleOrScope,
    }))
    mock.module("@/lib/services/compliance-service", () => ({ syncOverdue }))

    const { POST } = await import("./route")
    const res = await POST(makeRequest() as any)
    expect(res.status).not.toBe(403)
    expect(res.status).toBe(200)
    expect(syncOverdue).toHaveBeenCalledTimes(1)
    mock.restore()
  })

  test("a write-scoped API key caller passes the role gate and syncOverdue is called", async () => {
    const syncOverdue = mock(async () => ({ updated: 1, updatedAt: "2026-09-05T00:00:00.000Z" }))
    mock.module("@/lib/supabase/auth-guard", () => ({
      requireAuthOrApiKey: mock(async () => ({ orgId: "org-1", dbUser: null, apiKey: { id: "k-1", name: "k", scopes: ["write"] }, response: null })),
      requireOrg: mock(() => null),
      requireRoleOrScope: fakeRequireRoleOrScope,
    }))
    mock.module("@/lib/services/compliance-service", () => ({ syncOverdue }))

    const { POST } = await import("./route")
    const res = await POST(makeRequest() as any)
    expect(res.status).not.toBe(403)
    expect(res.status).toBe(200)
    expect(syncOverdue).toHaveBeenCalledTimes(1)
    mock.restore()
  })
})
