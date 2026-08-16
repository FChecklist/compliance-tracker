/// <reference types="bun-types" />
// Wave B (VERIDIAN Review Framework remediation, "BYOB white-label
// branding", 2026-07-17): the access-control gate this task explicitly asked
// to be covered -- only an org admin (or above) can change branding, same
// requireRole(dbUser, "admin") convention as access-review/cycles/route.ts
// and every other admin-only route in this codebase. GET has no role gate
// (any authenticated org member can read the resolved branding, same as
// org-limits' own GET). @/lib/supabase/auth-guard is mocked here (not the
// real module) so this test exercises ONLY the route's own wiring -- does it
// actually call requireRole and honor a 403 -- without needing a live DB or
// real Supabase Auth session, matching this repo's precedent of never
// touching a live DB from a .test.ts file. org-branding-service.ts is
// likewise mocked so this file's only job is proving the access-control
// gate, not re-testing the service (see org-branding-service.test.ts for
// that).
import { describe, test, expect, mock } from "bun:test"

function dbUser(role: string) {
  return { id: "user-1", role, orgId: "org-1" } as any
}

function fakeRequireRole(user: any, minimumRole: string) {
  const RANK: Record<string, number> = { viewer: 1, member: 2, manager: 3, branch_manager: 4, admin: 5, veridian_admin: 6 }
  const userRank = RANK[user?.role] ?? 0
  const requiredRank = RANK[minimumRole] ?? 99
  if (userRank < requiredRank) {
    return new Response(JSON.stringify({ error: `This action requires ${minimumRole} role or higher` }), { status: 403 }) as any
  }
  return null
}

function makeRequest(body: unknown): Request {
  return new Request("http://localhost/api/settings/branding", {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  })
}

describe("PATCH /api/settings/branding (access control)", () => {
  test("a member (below admin) is rejected with 403 and the branding service is never called", async () => {
    const updateBranding = mock(async () => { throw new Error("updateBranding should not be called for a non-admin") })
    mock.module("@/lib/supabase/auth-guard", () => ({
      requireAuth: mock(async () => ({ response: null, dbUser: dbUser("member"), orgId: "org-1" })),
      requireRole: fakeRequireRole,
    }))
    mock.module("@/lib/services/org-branding-service", () => ({
      resolveBranding: mock(async () => ({})),
      updateBranding,
      OrgBrandingValidationError: class extends Error {},
    }))
    const { PATCH } = await import("./route")
    const res = await PATCH(makeRequest({ primaryColor: "#111111" }) as any)
    expect(res.status).toBe(403)
    expect(updateBranding).not.toHaveBeenCalled()
  })

  test("a branch_manager (still below admin) is rejected with 403", async () => {
    mock.module("@/lib/supabase/auth-guard", () => ({
      requireAuth: mock(async () => ({ response: null, dbUser: dbUser("branch_manager"), orgId: "org-1" })),
      requireRole: fakeRequireRole,
    }))
    mock.module("@/lib/services/org-branding-service", () => ({
      resolveBranding: mock(async () => ({})),
      updateBranding: mock(async () => { throw new Error("should not be called") }),
      OrgBrandingValidationError: class extends Error {},
    }))
    const { PATCH } = await import("./route")
    const res = await PATCH(makeRequest({ accentColor: "#222222" }) as any)
    expect(res.status).toBe(403)
  })

  test("an admin is allowed through and the branding service is called with the request body", async () => {
    const updateBranding = mock(async (_orgId: string, patch: unknown) => ({ ...patch, isCustomized: true }))
    mock.module("@/lib/supabase/auth-guard", () => ({
      requireAuth: mock(async () => ({ response: null, dbUser: dbUser("admin"), orgId: "org-1" })),
      requireRole: fakeRequireRole,
    }))
    mock.module("@/lib/services/org-branding-service", () => ({
      resolveBranding: mock(async () => ({})),
      updateBranding,
      OrgBrandingValidationError: class extends Error {},
    }))
    const { PATCH } = await import("./route")
    const res = await PATCH(makeRequest({ primaryColor: "#111111" }) as any)
    expect(res.status).toBe(200)
    expect(updateBranding).toHaveBeenCalledTimes(1)
    expect(updateBranding.mock.calls[0][0]).toBe("org-1")
  })

  test("veridian_admin (rank above admin) is also allowed through", async () => {
    const updateBranding = mock(async () => ({ isCustomized: true }))
    mock.module("@/lib/supabase/auth-guard", () => ({
      requireAuth: mock(async () => ({ response: null, dbUser: dbUser("veridian_admin"), orgId: "org-1" })),
      requireRole: fakeRequireRole,
    }))
    mock.module("@/lib/services/org-branding-service", () => ({
      resolveBranding: mock(async () => ({})),
      updateBranding,
      OrgBrandingValidationError: class extends Error {},
    }))
    const { PATCH } = await import("./route")
    const res = await PATCH(makeRequest({ accentColor: "#333333" }) as any)
    expect(res.status).toBe(200)
  })

  test("a validation error from the service surfaces as 400, not 500", async () => {
    class FakeValidationError extends Error {}
    mock.module("@/lib/supabase/auth-guard", () => ({
      requireAuth: mock(async () => ({ response: null, dbUser: dbUser("admin"), orgId: "org-1" })),
      requireRole: fakeRequireRole,
    }))
    mock.module("@/lib/services/org-branding-service", () => ({
      resolveBranding: mock(async () => ({})),
      updateBranding: mock(async () => { throw new FakeValidationError("bad color") }),
      OrgBrandingValidationError: FakeValidationError,
    }))
    const { PATCH } = await import("./route")
    const res = await PATCH(makeRequest({ primaryColor: "nope" }) as any)
    expect(res.status).toBe(400)
  })
})

describe("GET /api/settings/branding (no role gate -- any authenticated org member)", () => {
  test("a viewer-role user can read resolved branding (read is not admin-gated)", async () => {
    mock.module("@/lib/supabase/auth-guard", () => ({
      requireAuth: mock(async () => ({ response: null, dbUser: dbUser("viewer"), orgId: "org-1" })),
      requireRole: fakeRequireRole,
    }))
    mock.module("@/lib/services/org-branding-service", () => ({
      resolveBranding: mock(async () => ({ logoUrl: null, primaryColor: "#1C2B3A", accentColor: "#F5820A", isCustomized: false })),
      updateBranding: mock(async () => ({})),
      OrgBrandingValidationError: class extends Error {},
    }))
    const { GET } = await import("./route")
    const res = await GET()
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.branding.isCustomized).toBe(false)
  })

  test("no organisation on the account returns 400, not a crash", async () => {
    mock.module("@/lib/supabase/auth-guard", () => ({
      requireAuth: mock(async () => ({ response: null, dbUser: dbUser("admin"), orgId: null })),
      requireRole: fakeRequireRole,
    }))
    mock.module("@/lib/services/org-branding-service", () => ({
      resolveBranding: mock(async () => ({})),
      updateBranding: mock(async () => ({})),
      OrgBrandingValidationError: class extends Error {},
    }))
    const { GET } = await import("./route")
    const res = await GET()
    expect(res.status).toBe(400)
  })
})
