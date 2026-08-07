/// <reference types="bun-types" />
// task-20260727-101145 (external-AI-facing reporting API gateway): covers
// only requireReportsReadAccess(), the new gate src/app/api/v1/reports/**
// uses -- no DB/Supabase Auth involved, so no mock.module needed, matching
// permission-service.test.ts's pattern of building a CombinedAuthContext
// object literal directly instead of going through a real session.
import { describe, test, expect } from "bun:test"
import { requireReportsReadAccess, ROLE_RANK, type CombinedAuthContext } from "./auth-guard"
import { userRoleEnum } from "@/lib/db/schema"

function sessionCtx(): CombinedAuthContext {
  return { orgId: "org-1", dbUser: { id: "user-1" } as any, apiKey: null, response: null }
}

function apiKeyCtx(scopes: string[]): CombinedAuthContext {
  return { orgId: "org-1", dbUser: null, apiKey: { id: "key-1", name: "Test Key", scopes }, response: null }
}

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
