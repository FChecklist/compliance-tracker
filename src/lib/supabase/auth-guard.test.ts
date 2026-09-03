/// <reference types="bun-types" />
// AI Engineering Quality / Technical Debt gap-closure (Refactoring
// Readiness finding): auth-guard.ts was the highest-churn file in src/lib
// with zero coverage of its core hasRole/requireRole/hasScope/
// requireRoleOrScope logic before this describe block was added -- every
// API route in this codebase calls requireAuth()/requireRole() from here
// per CLAUDE.md's "All API routes MUST call requireAuth()" rule. Locks in
// the pure role/scope logic that every authorization decision in the app
// ultimately reduces to, including a regression test for the real,
// already-fixed bug documented in this file's own UserRole/ROLE_RANK
// comment (the 6 Wave-1 hierarchy roles previously resolving to rank 0 and
// being locked out of everything).
//
// Deliberately NOT covering requireAuth()/autoProvisionUser()/
// requireAuthOrApiKey() here -- those need a real Supabase/DB double to
// exercise meaningfully, which is a separate, larger effort; this is the
// "prioritize the highest-value untested surface first" slice, not a claim
// of full-file coverage.
//
// task-20260727-101145 (external-AI-facing reporting API gateway): also
// covers requireReportsReadAccess(), the gate src/app/api/v1/reports/**
// uses -- no DB/Supabase Auth involved, so no mock.module needed, matching
// permission-service.test.ts's pattern of building a CombinedAuthContext
// object literal directly instead of going through a real session.
import { describe, test, expect, mock, afterEach } from "bun:test"
import {
  hasRole,
  hasScope,
  readActingUserId,
  requireRole,
  requireReportsReadAccess,
  requireRoleOrScope,
  ROLE_RANK,
  type CombinedAuthContext,
  type UserRole,
} from "./auth-guard"
import { userRoleEnum } from "@/lib/db/schema"

type DbUser = Parameters<typeof hasRole>[0]

function makeDbUser(role: string): DbUser {
  return { role } as unknown as DbUser
}

function sessionCtx(): CombinedAuthContext {
  return { orgId: "org-1", dbUser: { id: "user-1" } as any, apiKey: null, response: null }
}

function apiKeyCtx(scopes: string[]): CombinedAuthContext {
  return { orgId: "org-1", dbUser: null, apiKey: { id: "key-1", name: "Test Key", scopes }, response: null }
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

describe("requireReportsReadAccess", () => {
  test("a real logged-in session always passes, regardless of scopes (scopes are an API-key-only concept)", () => {
    expect(requireReportsReadAccess(sessionCtx())).toBeNull()
  })

  test("an API key with the broad, pre-existing 'read' scope passes -- every key minted before this task keeps working", () => {
    expect(requireReportsReadAccess(apiKeyCtx(["read"]))).toBeNull()
  })

  test("an API key with only the new, narrower 'read:reports' scope passes", () => {
    expect(requireReportsReadAccess(apiKeyCtx(["read:reports"]))).toBeNull()
  })

  test("an API key scoped 'write' only (no read, no read:reports) is rejected with 403", async () => {
    const result = requireReportsReadAccess(apiKeyCtx(["write"]))
    expect(result).not.toBeNull()
    expect(result!.status).toBe(403)
    const body = await result!.json()
    expect(body.error).toMatch(/read or read:reports-scoped API key/)
  })

  test("an API key with no scopes at all is rejected with 403", () => {
    const result = requireReportsReadAccess(apiKeyCtx([]))
    expect(result!.status).toBe(403)
  })

  test("neither a session nor an API key (should never happen post-requireAuthOrApiKey, but fails closed) is rejected", () => {
    const result = requireReportsReadAccess({ orgId: null, dbUser: null, apiKey: null, response: null })
    expect(result!.status).toBe(403)
  })
})

// GAP-STAGE0-ROLE-MISSING-FROM-ROLE-RANK regression test: this exact bug
// class (a real userRoleEnum value with no ROLE_RANK entry, silently
// falling back to rank 0 via `ROLE_RANK[role] ?? 0` in hasRole()) has now
// bitten this codebase twice -- once for 6 Wave 1 hierarchy roles, once for
// stage_0. Asserts every real DB role has an explicit, deliberate rank so a
// third occurrence fails CI instead of shipping silently.
describe("ROLE_RANK completeness (GAP-STAGE0-ROLE-MISSING-FROM-ROLE-RANK)", () => {
  test("every real userRoleEnum value has an explicit, positive ROLE_RANK entry", () => {
    for (const role of userRoleEnum.enumValues) {
      const rank = ROLE_RANK[role as keyof typeof ROLE_RANK]
      expect(rank, `userRoleEnum value "${role}" has no ROLE_RANK entry -- would silently rank 0 via hasRole()'s ?? 0 fallback`).toBeDefined()
      expect(rank).toBeGreaterThan(0)
    }
  })

  test("ROLE_RANK has no extra keys beyond the real userRoleEnum values (would silently do nothing, masking a typo)", () => {
    const realRoles = new Set(userRoleEnum.enumValues as readonly string[])
    for (const key of Object.keys(ROLE_RANK)) {
      expect(realRoles.has(key), `ROLE_RANK has a "${key}" entry that is not a real userRoleEnum value`).toBe(true)
    }
  })
})

// R67 WS-H / PROGRAMME DECISION D-05 (identity bridge). resolveActingUser()
// is the ONE place a PROJEXA request stops being "the org's API key" and
// becomes a named person, so the failure modes that would make manager
// validation meaningless are locked in here: an acting-user id that maps to
// nothing in this org, and an id that maps to a deactivated account.
//
// The DB is mocked rather than exercised live -- this repo's established
// pattern for a tenant-scoped read in a .test.ts (see
// pms-time-service.test.ts's own header). The assertion is about the
// resolution ORDER and the returned code/status, which is exactly what a
// route depends on, never about drizzle's SQL building.
const realDbModule = await import("@/lib/db")

/**
 * Answers successive db.query.users.findFirst() calls from `answers`, in
 * order -- so a test can say "the id lookup finds nothing, the email lookup
 * finds someone" and actually prove the second lookup was reached.
 */
async function loadAuthGuardWithUserLookups(answers: Array<Record<string, unknown> | undefined>) {
  const queue = [...answers]
  await mock.module("@/lib/db", () => ({
    ...realDbModule,
    db: { query: { users: { findFirst: mock(async () => queue.shift()) } } },
  }))
  return import("./auth-guard")
}

const PROJEXA_ORG_KEY_CTX = { orgId: "org-1", dbUser: null, apiKey: { id: "key-1", name: "PROJEXA org key", scopes: ["read", "write"] }, response: null }

describe("resolveActingUser -- D-05 X-Acting-User bridge", () => {
  afterEach(async () => {
    mock.restore()
    await mock.module("@/lib/db", () => realDbModule)
  })

  test("an X-Acting-User id with no matching org-scoped compliance.users row fails with the code USER_NOT_LINKED", async () => {
    const { resolveActingUser } = await loadAuthGuardWithUserLookups([undefined])
    const { user, error } = await resolveActingUser(PROJEXA_ORG_KEY_CTX as never, null, "supabase-user-with-no-veridian-row")
    expect(user).toBeNull()
    expect(error).not.toBeNull()
    expect(error!.status).toBe(400)
    const body = await error!.json()
    expect(body.code).toBe("USER_NOT_LINKED")
    expect(body.error).toBe("Your PROJEXA account is not linked to a VERIDIAN user - ask your admin")
  })

  test("an X-Acting-User id that maps to an active user in this org resolves to that real person", async () => {
    const { resolveActingUser } = await loadAuthGuardWithUserLookups([{ id: "veridian-user-9", orgId: "org-1", isActive: true }])
    const { user, error } = await resolveActingUser(PROJEXA_ORG_KEY_CTX as never, null, "supabase-user-1")
    expect(error).toBeNull()
    expect(user!.id).toBe("veridian-user-9")
  })

  test("an X-Acting-User id that maps to a deactivated user is refused, never silently attributed", async () => {
    const { resolveActingUser } = await loadAuthGuardWithUserLookups([{ id: "veridian-user-9", orgId: "org-1", isActive: false }])
    const { user, error } = await resolveActingUser(PROJEXA_ORG_KEY_CTX as never, null, "supabase-user-1")
    expect(user).toBeNull()
    const body = await error!.json()
    expect(body.code).toBe("USER_DEACTIVATED")
  })

  test("a session caller's own dbUser wins outright -- the header is ignored for them", async () => {
    const { resolveActingUser } = await loadAuthGuardWithUserLookups([{ id: "someone-else", orgId: "org-1", isActive: true }])
    const sessionCtx = { orgId: "org-1", dbUser: { id: "session-user" }, apiKey: null, response: null }
    const { user, error } = await resolveActingUser(sessionCtx as never, null, "supabase-user-1")
    expect(error).toBeNull()
    expect(user!.id).toBe("session-user")
  })

  test("an unmapped id still falls back to a real actorEmail rather than breaking a working write (documented D-05 precedence)", async () => {
    const { resolveActingUser } = await loadAuthGuardWithUserLookups([undefined, { id: "veridian-user-by-email", orgId: "org-1", isActive: true }])
    const { user, error } = await resolveActingUser(PROJEXA_ORG_KEY_CTX as never, "priya@skylinebuilders-demo.veridianai.dev", "unmapped-supabase-id")
    expect(error).toBeNull()
    expect(user!.id).toBe("veridian-user-by-email")
  })

  test("no id and no actorEmail is still the original 400 -- this change adds a path, it does not open one", async () => {
    const { resolveActingUser } = await loadAuthGuardWithUserLookups([])
    const { user, error } = await resolveActingUser(PROJEXA_ORG_KEY_CTX as never)
    expect(user).toBeNull()
    expect(error!.status).toBe(400)
  })
})

describe("readActingUserId -- D-05 header read", () => {
  test("reads and trims the X-Acting-User header", () => {
    expect(readActingUserId({ headers: new Headers({ "X-Acting-User": "  supabase-user-1  " }) })).toBe("supabase-user-1")
  })

  test("a missing or blank header is null, never an empty-string id that would match nothing loudly", () => {
    expect(readActingUserId({ headers: new Headers() })).toBeNull()
    expect(readActingUserId({ headers: new Headers({ "X-Acting-User": "   " }) })).toBeNull()
  })
})
