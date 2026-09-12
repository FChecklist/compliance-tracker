/// <reference types="bun-types" />
// R75 Part 2 Phase 5 (G6 pms gap-closure). POST /api/pms/labels had NO role
// gate at all -- any authenticated org member could create a project's
// issue-label picklist entry. Fixed to require "senior_professional" --
// labels lives in the exact same service file (pms-taxonomy-service.ts) and
// shares the exact same route shape (requireAuth, requirePmsEnabled,
// projectId required in body) as its closest already-gated sibling,
// POST /api/pms/milestones, which is senior_professional-gated. (ROLE_RANK
// ranks senior_professional and manager identically at 3, so this is also
// equivalent in practice to the "manager" bar this codebase's org-wide
// picklist gates use elsewhere, e.g. glossary/crm.lost_reasons.)
import { describe, test, expect, mock } from "bun:test"
import { ROLE_RANK } from "@/lib/supabase/role-rank"

function dbUser(role: string) {
  return { id: "user-1", role, orgId: "org-1" } as any
}

function fakeRequireRole(user: any, minimumRole: string) {
  const userRank = ROLE_RANK[user?.role as keyof typeof ROLE_RANK] ?? 0
  const requiredRank = ROLE_RANK[minimumRole as keyof typeof ROLE_RANK] ?? 99
  if (userRank < requiredRank) {
    return new Response(JSON.stringify({ error: `This action requires ${minimumRole} role or higher` }), { status: 403 }) as any
  }
  return null
}

class FakeServiceError extends Error {
  status: number
  constructor(message: string, status: number) {
    super(message)
    this.status = status
  }
}

function makeRequest(body: unknown): Request {
  return new Request("http://localhost/api/pms/labels", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  })
}

describe("POST /api/pms/labels (access control)", () => {
  test("a member (below senior_professional) is rejected with 403 and createLabel is never called", async () => {
    const createLabel = mock(async () => { throw new Error("createLabel should not be called for a below-role caller") })
    mock.module("@/lib/supabase/auth-guard", () => ({
      requireAuth: mock(async () => ({ response: null, dbUser: dbUser("member"), orgId: "org-1" })),
      requireRole: fakeRequireRole,
    }))
    mock.module("@/lib/services/pms-taxonomy-service", () => ({
      listLabels: mock(async () => []),
      createLabel,
    }))
    mock.module("@/lib/services/pms-enablement-service", () => ({
      requirePmsEnabled: mock(async () => {}),
      ServiceError: FakeServiceError,
    }))

    const { POST } = await import("./route")
    const res = await POST(makeRequest({ projectId: "proj-1", name: "bug" }) as any)
    expect(res.status).toBe(403)
    expect(createLabel).not.toHaveBeenCalled()
    mock.restore()
  })

  test("a senior_professional-rank user passes the role gate and createLabel is called", async () => {
    const createLabel = mock(async () => ({ id: "label-1", name: "bug" }))
    mock.module("@/lib/supabase/auth-guard", () => ({
      requireAuth: mock(async () => ({ response: null, dbUser: dbUser("senior_professional"), orgId: "org-1" })),
      requireRole: fakeRequireRole,
    }))
    mock.module("@/lib/services/pms-taxonomy-service", () => ({
      listLabels: mock(async () => []),
      createLabel,
    }))
    mock.module("@/lib/services/pms-enablement-service", () => ({
      requirePmsEnabled: mock(async () => {}),
      ServiceError: FakeServiceError,
    }))

    const { POST } = await import("./route")
    const res = await POST(makeRequest({ projectId: "proj-1", name: "bug" }) as any)
    expect(res.status).not.toBe(403)
    expect(createLabel).toHaveBeenCalledTimes(1)
    mock.restore()
  })
})
