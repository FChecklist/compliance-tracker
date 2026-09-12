/// <reference types="bun-types" />
// R75 Part 2 Phase 5 (G3-email-conv): proves the requireRole(dbUser,
// "team_member") gate added to POST /api/email-intelligence -- see the
// route's own comment for why "team_member" was chosen (matches the one
// real, already-gated sibling this route's own service-layer header names,
// POST /api/documents/extract). GET is untouched (no gap was filed for it)
// so it is not tested here.
// @/lib/services/email-intelligence-service is mocked entirely so this test
// never reaches a real DB/LLM call. The mock includes every OTHER named
// export of that module (dismissEmailIntelligenceItem/
// promoteEmailIntelligenceItem/sanitizeSuggestedWorkItems), even though this
// file's own route only calls analyzeInboundEmail/listEmailIntelligenceItems
// -- mock.module() replaces the module's exports for the whole process, and
// this same specifier is also mocked (with a different subset) by the
// sibling ../[id]/dismiss and ../[id]/promote route.test.ts files. Without a
// full, consistent export surface here, running these test files together
// (e.g. `bun test src/app/api/email-intelligence`) hits a real Bun
// first-mock-wins caching quirk for a shared module specifier: whichever of
// these files' mocks loads first "freezes" the export shape for the rest of
// the process, and a later file's own mock.module call for the same
// specifier does not reliably re-widen it. Keeping a superset here (as a
// harmless stub, never exercised by this file's own tests) avoids that
// entirely, matching src/lib/supabase/authz-gate-coverage.test.ts's own
// documented posture on this exact mock.module limitation.
import { describe, test, expect, mock } from "bun:test"

const RANK: Record<string, number> = {
  viewer: 1, client_viewer: 1, external_auditor: 1, stage_0: 1,
  member: 2, team_member: 2, senior_professional: 3, manager: 3,
  branch_manager: 4, admin: 5, veridian_admin: 6,
}

function fakeRequireRole(user: { role: string } | null, minimumRole: string) {
  const userRank = RANK[user?.role ?? ""] ?? 0
  const requiredRank = RANK[minimumRole] ?? 99
  if (userRank < requiredRank) {
    return new Response(JSON.stringify({ error: `This action requires ${minimumRole} role or higher` }), { status: 403 }) as any
  }
  return null
}

function dbUser(role: string) {
  return { id: "user-1", role, orgId: "org-1", name: "Test User" } as any
}

function makeRequest(): Request {
  return new Request("http://localhost/api/email-intelligence", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ subject: "Invoice due", body: "Please pay by Friday." }),
  })
}

function fakeServiceError() {
  return class ServiceError extends Error { status: number; constructor(m: string, s: number) { super(m); this.status = s } }
}

describe("POST /api/email-intelligence (access control)", () => {
  test("a role below team_member (viewer) is rejected with 403 and analyzeInboundEmail is never called", async () => {
    mock.module("@/lib/supabase/auth-guard", () => ({
      requireAuth: mock(async () => ({ response: null, dbUser: dbUser("viewer"), orgId: "org-1" })),
      requireRole: fakeRequireRole,
    }))
    mock.module("@/lib/services/email-intelligence-service", () => ({
      analyzeInboundEmail: mock(async () => { throw new Error("analyzeInboundEmail should not be reached for a below-minimum role") }),
      listEmailIntelligenceItems: mock(async () => []),
      dismissEmailIntelligenceItem: mock(async () => { throw new Error("not under test in this file") }),
      promoteEmailIntelligenceItem: mock(async () => { throw new Error("not under test in this file") }),
      sanitizeSuggestedWorkItems: mock(() => []),
      ServiceError: fakeServiceError(),
    }))
    const { POST } = await import("./route")
    const res = await POST(makeRequest() as any)
    expect(res.status).toBe(403)
  })

  test("a team_member-rank caller is allowed through and the email is submitted for analysis", async () => {
    mock.module("@/lib/supabase/auth-guard", () => ({
      requireAuth: mock(async () => ({ response: null, dbUser: dbUser("team_member"), orgId: "org-1" })),
      requireRole: fakeRequireRole,
    }))
    mock.module("@/lib/services/email-intelligence-service", () => ({
      analyzeInboundEmail: mock(async () => ({ id: "eii-1", status: "proposed" })),
      listEmailIntelligenceItems: mock(async () => []),
      dismissEmailIntelligenceItem: mock(async () => { throw new Error("not under test in this file") }),
      promoteEmailIntelligenceItem: mock(async () => { throw new Error("not under test in this file") }),
      sanitizeSuggestedWorkItems: mock(() => []),
      ServiceError: fakeServiceError(),
    }))
    const { POST } = await import("./route")
    const res = await POST(makeRequest() as any)
    expect(res.status).toBe(201)
    const body = await res.json()
    expect(body.id).toBe("eii-1")
  })
})
