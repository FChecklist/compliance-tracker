// AI Engineering Quality / Technical Debt gap-closure (Refactoring
// Readiness finding): auth-guard.ts is the single highest-churn (23 commits
// touching it per `git log --name-only`) file in src/lib with zero test
// coverage before this -- and it's not a peripheral file: every API route
// in this codebase calls requireAuth()/requireRole() from here per
// CLAUDE.md's "All API routes MUST call requireAuth()" rule. This locks in
// the pure role/scope logic (ROLE_RANK, hasRole, requireRole, hasScope,
// requireRoleOrScope) that every authorization decision in the app
// ultimately reduces to -- including a regression test for the real,
// already-fixed bug documented in this file's own UserRole/ROLE_RANK
// comment (the 6 Wave-1 hierarchy roles previously resolving to rank 0 and
// being locked out of everything).
//
// Deliberately NOT covering requireAuth()/autoProvisionUser()/
// requireAuthOrApiKey() here -- those need a real Supabase/DB double to
// exercise meaningfully, which is a separate, larger effort; this is the
// "prioritize the highest-value untested surface first" slice, not a claim
// of full-file coverage.
import { describe, expect, test } from "bun:test"
import {
  hasRole,
  hasScope,
  requireRole,
  requireRoleOrScope,
  ROLE_RANK,
  type CombinedAuthContext,
  type UserRole,
} from "./auth-guard"

type DbUser = Parameters<typeof hasRole>[0]

function makeDbUser(role: string): DbUser {
  return { role } as unknown as DbUser
}

describe("ROLE_RANK", () => {
  test("every UserRole has a positive rank (no role silently resolves to the ?? 0 fallback)", () => {
    const roles: UserRole[] = [
      "viewer", "client_viewer", "external_auditor",
      "member", "team_member",
      "senior_professional", "manager",
      "branch_manager",
      "admin",
      "veridian_admin",
    ]
    for (const role of roles) {
      expect(ROLE_RANK[role]).toBeGreaterThan(0)
    }
  })

  test("veridian_admin is the highest-ranked role", () => {
    const max = Math.max(...Object.values(ROLE_RANK))
    expect(ROLE_RANK.veridian_admin).toBe(max)
  })
})

describe("hasRole", () => {
  test("returns false for a null dbUser", () => {
    expect(hasRole(null, "viewer")).toBe(false)
  })

  test("returns false for an unrecognized role string (rank falls back to 0)", () => {
    expect(hasRole(makeDbUser("not_a_real_role"), "viewer")).toBe(false)
  })

  test("a viewer does not meet a manager bar", () => {
    expect(hasRole(makeDbUser("viewer"), "manager")).toBe(false)
  })

  test("an admin meets a manager bar", () => {
    expect(hasRole(makeDbUser("admin"), "manager")).toBe(true)
  })

  test("exact rank match passes (>=, not strictly >)", () => {
    expect(hasRole(makeDbUser("manager"), "manager")).toBe(true)
  })

  // Regression test for the bug documented directly above ROLE_RANK in
  // auth-guard.ts: the 6 Wave-1 hierarchy roles (added alongside the
  // original 4) previously weren't in the UserRole/ROLE_RANK table at all,
  // so every one of them resolved to rank 0 via `ROLE_RANK[role] ?? 0` and
  // failed every requireRole() check -- including veridian_admin, meant to
  // be the MOST privileged role, being locked out of a bare viewer-level
  // gate.
  test("Wave-1 hierarchy roles are not silently locked out of a viewer-level gate", () => {
    const wave1Roles: UserRole[] = [
      "veridian_admin", "branch_manager", "senior_professional",
      "team_member", "client_viewer", "external_auditor",
    ]
    for (const role of wave1Roles) {
      expect(hasRole(makeDbUser(role), "viewer")).toBe(true)
    }
  })

  test("branch_manager outranks manager (both map onto the same historical tier boundary)", () => {
    expect(hasRole(makeDbUser("branch_manager"), "manager")).toBe(true)
    expect(hasRole(makeDbUser("manager"), "branch_manager")).toBe(false)
  })
})

describe("requireRole", () => {
  test("returns null (no block) when the role bar is met", () => {
    expect(requireRole(makeDbUser("admin"), "manager")).toBeNull()
  })

  test("returns a 403 NextResponse when the role bar is not met", async () => {
    const res = requireRole(makeDbUser("viewer"), "admin")
    expect(res).not.toBeNull()
    expect(res!.status).toBe(403)
    const body = await res!.json()
    expect(body.error).toContain("admin")
  })

  test("returns a 403 for a null dbUser", () => {
    const res = requireRole(null, "viewer")
    expect(res).not.toBeNull()
    expect(res!.status).toBe(403)
  })
})

describe("hasScope", () => {
  test("a real logged-in session (dbUser set) always has full access regardless of scope", () => {
    const ctx: CombinedAuthContext = { orgId: "org1", dbUser: makeDbUser("viewer"), apiKey: null, response: null }
    expect(hasScope(ctx, "read")).toBe(true)
    expect(hasScope(ctx, "write")).toBe(true)
  })

  test("an API key is gated on its own scopes array", () => {
    const readOnly: CombinedAuthContext = { orgId: "org1", dbUser: null, apiKey: { id: "k1", name: "k", scopes: ["read"] }, response: null }
    expect(hasScope(readOnly, "read")).toBe(true)
    expect(hasScope(readOnly, "write")).toBe(false)
  })

  test("neither dbUser nor apiKey present means no scope", () => {
    const anon: CombinedAuthContext = { orgId: null, dbUser: null, apiKey: null, response: null }
    expect(hasScope(anon, "read")).toBe(false)
  })
})

describe("requireRoleOrScope", () => {
  test("session user is gated on role, not scope", () => {
    const ctx: CombinedAuthContext = { orgId: "org1", dbUser: makeDbUser("admin"), apiKey: null, response: null }
    expect(requireRoleOrScope(ctx, "manager")).toBeNull()
  })

  test("session user below the role bar is still blocked even though hasScope() would allow it", () => {
    const ctx: CombinedAuthContext = { orgId: "org1", dbUser: makeDbUser("viewer"), apiKey: null, response: null }
    const res = requireRoleOrScope(ctx, "admin")
    expect(res).not.toBeNull()
    expect(res!.status).toBe(403)
  })

  test("write-scoped API key passes a write gate", () => {
    const ctx: CombinedAuthContext = { orgId: "org1", dbUser: null, apiKey: { id: "k1", name: "k", scopes: ["write"] }, response: null }
    expect(requireRoleOrScope(ctx, "manager", "write")).toBeNull()
  })

  test("read-only API key is blocked from a write gate", async () => {
    const ctx: CombinedAuthContext = { orgId: "org1", dbUser: null, apiKey: { id: "k1", name: "k", scopes: ["read"] }, response: null }
    const res = requireRoleOrScope(ctx, "manager", "write")
    expect(res).not.toBeNull()
    expect(res!.status).toBe(403)
    const body = await res!.json()
    expect(body.error).toContain("write")
  })

  test("neither session nor API key present returns 401", () => {
    const ctx: CombinedAuthContext = { orgId: null, dbUser: null, apiKey: null, response: null }
    const res = requireRoleOrScope(ctx, "viewer")
    expect(res).not.toBeNull()
    expect(res!.status).toBe(401)
  })
})
