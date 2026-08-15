// VERIDIAN Review Framework gap-closure: AI Engineering Quality / Technical
// Debt & Complexity, "Refactoring Readiness" finding (2026-07-18). This file
// had zero test coverage despite being the single most load-bearing gate in
// the app -- every requireAuth()-protected route (CLAUDE.md: "All API
// routes MUST call requireAuth()") ultimately depends on ROLE_RANK/hasRole/
// requireRole/hasScope/requireRoleOrScope being correct. Matches this
// repo's own established pattern (see permission-service.test.ts's header,
// studied before writing this file): test the REAL pure gate functions
// directly, no reimplementation/mocking of the rank comparison. Only the
// pure, DB-free exports are covered -- requireAuth()/requireAuthOrApiKey()/
// autoProvisionUser() all touch Supabase/the DB and are deliberately left
// untested here, same rationale as report-engine-service.test.ts's header.
/// <reference types="bun-types" />
import { describe, expect, test } from "bun:test"
import {
  ROLE_RANK,
  hasRole,
  requireRole,
  hasScope,
  requireRoleOrScope,
  type UserRole,
  type CombinedAuthContext,
} from "./auth-guard"
import type { users } from "@/lib/db"

type DbUser = typeof users.$inferSelect

function userWithRole(role: UserRole): DbUser {
  return { role } as unknown as DbUser
}

function sessionCtx(role: UserRole): CombinedAuthContext {
  return { orgId: "org-1", dbUser: userWithRole(role), apiKey: null, response: null }
}

function apiKeyCtx(scopes: string[]): CombinedAuthContext {
  return { orgId: "org-1", dbUser: null, apiKey: { id: "key-1", name: "test key", scopes }, response: null }
}

const ALL_ROLES: UserRole[] = [
  "viewer", "client_viewer", "external_auditor",
  "member", "team_member",
  "senior_professional", "manager",
  "branch_manager",
  "admin",
  "veridian_admin",
]

describe("ROLE_RANK -- rank table integrity", () => {
  // Regression guard for the real historical bug documented directly above
  // ROLE_RANK's own definition: the 6 Wave 1 hierarchy roles were once
  // missing from this table entirely, so `ROLE_RANK[role] ?? 0` silently
  // gave them rank 0 and locked them out of every requireRole() check,
  // including the lowest-bar ones -- veridian_admin (meant to be the MOST
  // privileged role) included.
  test("every UserRole has a real rank entry (none fall through to the ?? 0 default)", () => {
    for (const role of ALL_ROLES) {
      expect(ROLE_RANK[role]).toBeGreaterThan(0)
    }
  })

  test("veridian_admin is ranked at or above every other role", () => {
    const max = Math.max(...ALL_ROLES.map((r) => ROLE_RANK[r]))
    expect(ROLE_RANK.veridian_admin).toBe(max)
  })

  test("the four original roles keep their documented relative order", () => {
    expect(ROLE_RANK.viewer).toBeLessThan(ROLE_RANK.member)
    expect(ROLE_RANK.member).toBeLessThan(ROLE_RANK.manager)
    expect(ROLE_RANK.manager).toBeLessThan(ROLE_RANK.admin)
  })

  test("each of the 3 rank-equivalence groups documented in ROLE_RANK shares the same rank", () => {
    expect(ROLE_RANK.viewer).toBe(ROLE_RANK.client_viewer)
    expect(ROLE_RANK.viewer).toBe(ROLE_RANK.external_auditor)
    expect(ROLE_RANK.member).toBe(ROLE_RANK.team_member)
    expect(ROLE_RANK.senior_professional).toBe(ROLE_RANK.manager)
  })
})

describe("hasRole", () => {
  test("returns false for a null dbUser regardless of the required role", () => {
    expect(hasRole(null, "viewer")).toBe(false)
  })

  test("returns true when the user's rank meets the minimum exactly", () => {
    expect(hasRole(userWithRole("manager"), "manager")).toBe(true)
  })

  test("returns true when the user's rank exceeds the minimum", () => {
    expect(hasRole(userWithRole("veridian_admin"), "viewer")).toBe(true)
  })

  test("returns false when the user's rank is below the minimum", () => {
    expect(hasRole(userWithRole("viewer"), "admin")).toBe(false)
  })

  test("an unrecognized role string falls through to rank 0 and fails every real gate", () => {
    // Same `?? 0` fallback the ROLE_RANK integrity tests above guard against
    // -- exercised here from the other side, confirming a garbage/legacy
    // role value fails closed rather than open.
    expect(hasRole({ role: "not_a_real_role" } as unknown as DbUser, "viewer")).toBe(false)
  })
})

describe("requireRole", () => {
  test("returns null (no block) when the user meets the minimum role", () => {
    expect(requireRole(userWithRole("admin"), "manager")).toBeNull()
  })

  test("returns a 403 response naming the required role when the user does not meet it", async () => {
    const res = requireRole(userWithRole("viewer"), "admin")
    expect(res).not.toBeNull()
    expect(res!.status).toBe(403)
    const body = await res!.json()
    expect(body.error).toContain("admin")
  })
})

describe("hasScope", () => {
  test("a real logged-in session (dbUser present) always has access, regardless of scope", () => {
    expect(hasScope(sessionCtx("viewer"), "read")).toBe(true)
    expect(hasScope(sessionCtx("viewer"), "write")).toBe(true)
  })

  test("an API-key context is gated on its own scopes array", () => {
    expect(hasScope(apiKeyCtx(["read"]), "read")).toBe(true)
    expect(hasScope(apiKeyCtx(["read"]), "write")).toBe(false)
    expect(hasScope(apiKeyCtx(["read", "write"]), "write")).toBe(true)
  })

  test("neither dbUser nor apiKey present -> false", () => {
    expect(hasScope({ orgId: null, dbUser: null, apiKey: null, response: null }, "read")).toBe(false)
  })
})

describe("requireRoleOrScope", () => {
  test("session users are gated by requireRole, not by scope", () => {
    expect(requireRoleOrScope(sessionCtx("admin"), "manager")).toBeNull()
    const blocked = requireRoleOrScope(sessionCtx("viewer"), "admin")
    expect(blocked).not.toBeNull()
    expect(blocked!.status).toBe(403)
  })

  test("API-key callers pass when they hold the required write scope", () => {
    expect(requireRoleOrScope(apiKeyCtx(["write"]), "manager", "write")).toBeNull()
  })

  test("API-key callers without the required scope get a 403 naming the scope", async () => {
    const res = requireRoleOrScope(apiKeyCtx(["read"]), "manager", "write")
    expect(res).not.toBeNull()
    expect(res!.status).toBe(403)
    const body = await res!.json()
    expect(body.error).toContain("write")
  })

  test("neither dbUser nor apiKey present -> 401 Unauthorized", async () => {
    const res = requireRoleOrScope({ orgId: null, dbUser: null, apiKey: null, response: null }, "viewer")
    expect(res).not.toBeNull()
    expect(res!.status).toBe(401)
  })

  test("read-scoped keys can still be required explicitly via the writeScope param", () => {
    expect(requireRoleOrScope(apiKeyCtx(["read"]), "manager", "read")).toBeNull()
  })
})
