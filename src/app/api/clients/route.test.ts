/// <reference types="bun-types" />
// Regression test for a real, live-found bug: GAP-CLIENT-LIST-NO-SCOPE-
// ENFORCEMENT (OCID-047 independent re-verification, UMR-20260802-165606-4413).
//
// Live evidence: a real viewer-role user with zero `user_client_access`
// grant rows issued `GET /api/clients` and got back the org's full client
// roster, identical to the admin's own view. Root cause: the handler
// queried `where: eq(clients.orgId, orgId)` only -- it never called
// `resolveAccessibleClientIds()` (src/lib/services/client-access-service.ts),
// which already existed and is used correctly by firm-enablement-service.ts
// / firm-practice-dashboard-service.ts, just never wired into this route.
// `clients` has no per-client RLS policy of its own (only org-scoped), so
// this can only be fixed at the application layer, not by passing
// `clientIds` into `withTenantContext`.
//
// Same isolation convention as departments/route.test.ts: mock
// @/lib/supabase/auth-guard and @/lib/db/tenant-scoped, no live DB.
import { describe, test, expect, mock } from "bun:test"

function makeRequest(): Request {
  return new Request("http://localhost/api/clients", { method: "GET" })
}

describe("GET /api/clients (access scoping -- OCID-047 regression)", () => {
  test("unauthenticated caller gets the auth-guard's own response verbatim, nothing else called", async () => {
    const withTenantContext = mock(async () => {
      throw new Error("withTenantContext should not be called when auth fails")
    })
    const resolveAccessibleClientIds = mock(async () => {
      throw new Error("resolveAccessibleClientIds should not be called when auth fails")
    })
    mock.module("@/lib/supabase/auth-guard", () => ({
      requireAuth: mock(async () => ({
        response: new Response(JSON.stringify({ error: "Not authenticated" }), { status: 401 }),
        orgId: null,
        dbUser: null,
      })),
      requireRole: () => null,
    }))
    mock.module("@/lib/db/tenant-scoped", () => ({ withTenantContext }))
    mock.module("@/lib/services/client-access-service", () => ({ resolveAccessibleClientIds }))

    const { GET } = await import("./route")
    const res = await GET()
    expect(res.status).toBe(401)
    expect(withTenantContext).not.toHaveBeenCalled()
    expect(resolveAccessibleClientIds).not.toHaveBeenCalled()
  })

  test("REGRESSION: a viewer with zero user_client_access grants gets an empty list, and the DB is never queried (fail closed, not the org's full roster)", async () => {
    const withTenantContext = mock(async () => {
      throw new Error("withTenantContext should not be called when the caller has zero accessible clients")
    })
    const resolveAccessibleClientIds = mock(async () => [] as string[])
    mock.module("@/lib/supabase/auth-guard", () => ({
      requireAuth: mock(async () => ({ response: null, orgId: "org-1", dbUser: { id: "user-1", role: "viewer" } })),
      requireRole: () => null,
    }))
    mock.module("@/lib/db/tenant-scoped", () => ({ withTenantContext }))
    mock.module("@/lib/services/client-access-service", () => ({ resolveAccessibleClientIds }))

    const { GET } = await import("./route")
    const res = await GET()
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.clients).toEqual([])
    expect(withTenantContext).not.toHaveBeenCalled()
    expect(resolveAccessibleClientIds).toHaveBeenCalledWith("org-1", { id: "user-1", role: "viewer" })
  })

  test("a viewer with one real grant sees only their accessible clients, and resolveAccessibleClientIds is consulted with this caller's own org/user", async () => {
    const resolveAccessibleClientIds = mock(async () => ["client-a"])
    const now = new Date("2026-08-05T00:00:00.000Z")
    const findMany = mock(async () => [
      { id: "client-a", name: "Alpha Corp", isSelf: false, isActive: true, entities: [], createdAt: now },
    ])
    const withTenantContext = mock(async (_ctx: unknown, fn: (db: unknown) => unknown) =>
      fn({ query: { clients: { findMany } } })
    )
    mock.module("@/lib/supabase/auth-guard", () => ({
      requireAuth: mock(async () => ({ response: null, orgId: "org-1", dbUser: { id: "user-1", role: "viewer" } })),
      requireRole: () => null,
    }))
    mock.module("@/lib/db/tenant-scoped", () => ({ withTenantContext }))
    mock.module("@/lib/services/client-access-service", () => ({ resolveAccessibleClientIds }))

    const { GET } = await import("./route")
    const res = await GET()
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.clients).toEqual([
      { id: "client-a", name: "Alpha Corp", isSelf: false, isActive: true, entities: [], createdAt: now.toISOString() },
    ])
    expect(resolveAccessibleClientIds).toHaveBeenCalledWith("org-1", { id: "user-1", role: "viewer" })
    expect(findMany).toHaveBeenCalledTimes(1)
  })

  test("branch_manager+ (full access) still sees the whole org roster, unchanged from before this fix", async () => {
    const resolveAccessibleClientIds = mock(async () => ["client-a", "client-b"])
    const now = new Date("2026-08-05T00:00:00.000Z")
    const findMany = mock(async () => [
      { id: "client-a", name: "Alpha Corp", isSelf: false, isActive: true, entities: [], createdAt: now },
      { id: "client-b", name: "Beta Corp", isSelf: false, isActive: true, entities: [], createdAt: now },
    ])
    const withTenantContext = mock(async (_ctx: unknown, fn: (db: unknown) => unknown) =>
      fn({ query: { clients: { findMany } } })
    )
    mock.module("@/lib/supabase/auth-guard", () => ({
      requireAuth: mock(async () => ({ response: null, orgId: "org-1", dbUser: { id: "user-1", role: "branch_manager" } })),
      requireRole: () => null,
    }))
    mock.module("@/lib/db/tenant-scoped", () => ({ withTenantContext }))
    mock.module("@/lib/services/client-access-service", () => ({ resolveAccessibleClientIds }))

    const { GET } = await import("./route")
    const res = await GET()
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.clients.map((c: { id: string }) => c.id)).toEqual(["client-a", "client-b"])
  })
})
