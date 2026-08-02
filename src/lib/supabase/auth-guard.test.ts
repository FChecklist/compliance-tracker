/// <reference types="bun-types" />
// task-20260727-101145 (external-AI-facing reporting API gateway): covers
// only requireReportsReadAccess(), the new gate src/app/api/v1/reports/**
// uses -- no DB/Supabase Auth involved, so no mock.module needed, matching
// permission-service.test.ts's pattern of building a CombinedAuthContext
// object literal directly instead of going through a real session.
import { describe, test, expect } from "bun:test"
import { requireReportsReadAccess, type CombinedAuthContext } from "./auth-guard"

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
