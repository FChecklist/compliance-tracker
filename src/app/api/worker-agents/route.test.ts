/// <reference types="bun-types" />
// R75 Part 2 Phase 5 (G8-misc): proves the requireRole(dbUser, "member")
// gate added to POST /api/worker-agents -- the "user"-tier proposal path
// had no route-level role check at all (proposeWorkerAgent() already gates
// customer/client tiers on admin, in worker-agent-service.ts -- see the
// route's own comment for why "member" was chosen for the remaining path).
// Mocks @/lib/supabase/auth-guard and @/lib/services/worker-agent-service
// (same convention as pms/time-entries/[id]/approve/route.test.ts), so this
// proves only the route's own wiring.
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

// worker-agent-service.ts (real, unmocked -- see mockService below) itself
// imports hasRole from auth-guard for its own customer/client-tier admin
// check, so the auth-guard mock factory must provide it too -- mock.module()
// replaces the whole module, and an unmocked name a file imports anywhere
// breaks that file's import with a SyntaxError (same note as
// authz-gate-coverage.test.ts's own header).
function fakeHasRole(user: { role: string } | null, minimumRole: string): boolean {
  const userRank = RANK[user?.role ?? ""] ?? 0
  return userRank >= (RANK[minimumRole] ?? 99)
}

function dbUser(role: string) {
  return { id: "user-1", role, orgId: "org-1" } as any
}

function makeRequest(): Request {
  return new Request("http://localhost/api/worker-agents", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ tier: "user", name: "My Agent" }),
  })
}

async function mockService(proposeWorkerAgent: ReturnType<typeof mock>) {
  const actual = await import("@/lib/services/worker-agent-service")
  mock.module("@/lib/services/worker-agent-service", () => ({ ...actual, proposeWorkerAgent }))
}

describe("POST /api/worker-agents (access control)", () => {
  test("a role below member (viewer) is rejected with 403 and proposeWorkerAgent is never called", async () => {
    const proposeWorkerAgent = mock(async () => { throw new Error("should not be called for a below-minimum role") })
    mock.module("@/lib/supabase/auth-guard", () => ({
      requireAuth: mock(async () => ({ response: null, dbUser: dbUser("viewer"), orgId: "org-1" })),
      requireRole: fakeRequireRole,
      hasRole: fakeHasRole,
    }))
    await mockService(proposeWorkerAgent)
    const { POST } = await import("./route")
    const res = await POST(makeRequest() as any)
    expect(res.status).toBe(403)
    expect(proposeWorkerAgent).not.toHaveBeenCalled()
  })

  test("a member-rank caller (self-scoped 'user' tier) is allowed through and proposeWorkerAgent is called", async () => {
    const proposeWorkerAgent = mock(async () => ({ id: "agent-1", tier: "user", lifecycleStatus: "proposed" }))
    mock.module("@/lib/supabase/auth-guard", () => ({
      requireAuth: mock(async () => ({ response: null, dbUser: dbUser("member"), orgId: "org-1" })),
      requireRole: fakeRequireRole,
      hasRole: fakeHasRole,
    }))
    await mockService(proposeWorkerAgent)
    const { POST } = await import("./route")
    const res = await POST(makeRequest() as any)
    expect(res.status).toBe(201)
    expect(proposeWorkerAgent).toHaveBeenCalledTimes(1)
  })
})
