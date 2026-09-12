/// <reference types="bun-types" />
// R75 Part 2 Phase 5 (G8-misc): proves the requireRole(dbUser, "manager")
// gate added to POST /api/workspace-memory/import -- this route previously
// had no role check beyond org membership, unlike its sibling
// export/route.ts (which already gated on "manager"). Mocks
// @/lib/supabase/auth-guard and @/lib/services/workspace-memory-service
// (same convention as pms/time-entries/[id]/approve/route.test.ts), so this
// proves only the route's own wiring: a below-minimum-role caller is
// rejected with the gate's own 403 before importWorkspaceMemory() is ever
// called, and an at-minimum-role caller reaches it.
import { describe, test, expect, mock } from "bun:test"

const RANK: Record<string, number> = { viewer: 1, member: 2, manager: 3, branch_manager: 4, admin: 5, veridian_admin: 6 }

function fakeRequireRole(user: { role: string } | null, minimumRole: string) {
  const userRank = RANK[user?.role ?? ""] ?? 0
  const requiredRank = RANK[minimumRole] ?? 99
  if (userRank < requiredRank) {
    return new Response(JSON.stringify({ error: `This action requires ${minimumRole} role or higher` }), { status: 403 }) as any
  }
  return null
}

function dbUser(role: string) {
  return { id: "user-1", role, orgId: "org-1" } as any
}

function makeRequest(): Request {
  const form = new FormData()
  form.set("file", new File([new Uint8Array([1, 2, 3])], "capsule.mv2"))
  return new Request("http://localhost/api/workspace-memory/import", { method: "POST", body: form })
}

async function mockService(importWorkspaceMemory: ReturnType<typeof mock>) {
  const actual = await import("@/lib/services/workspace-memory-service")
  mock.module("@/lib/services/workspace-memory-service", () => ({ ...actual, importWorkspaceMemory }))
}

describe("POST /api/workspace-memory/import (access control)", () => {
  test("a role below manager (member) is rejected with 403 and importWorkspaceMemory is never called", async () => {
    const importWorkspaceMemory = mock(async () => { throw new Error("should not be called for a below-minimum role") })
    mock.module("@/lib/supabase/auth-guard", () => ({
      requireAuth: mock(async () => ({ response: null, dbUser: dbUser("member"), orgId: "org-1" })),
      requireRole: fakeRequireRole,
    }))
    await mockService(importWorkspaceMemory)
    const { POST } = await import("./route")
    const res = await POST(makeRequest() as any)
    expect(res.status).toBe(403)
    expect(importWorkspaceMemory).not.toHaveBeenCalled()
  })

  test("a manager-rank caller is allowed through and importWorkspaceMemory is called", async () => {
    const importWorkspaceMemory = mock(async () => ({ eventId: "evt-1" }))
    mock.module("@/lib/supabase/auth-guard", () => ({
      requireAuth: mock(async () => ({ response: null, dbUser: dbUser("manager"), orgId: "org-1" })),
      requireRole: fakeRequireRole,
    }))
    await mockService(importWorkspaceMemory)
    const { POST } = await import("./route")
    const res = await POST(makeRequest() as any)
    expect(res.status).toBe(201)
    expect(importWorkspaceMemory).toHaveBeenCalledTimes(1)
  })
})
