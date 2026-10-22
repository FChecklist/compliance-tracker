/// <reference types="bun-types" />
import { describe, test, expect, mock, beforeEach, setDefaultTimeout } from "bun:test"
import { NextRequest, NextResponse } from "next/server"
import type { users } from "@/lib/db"
import type { UserRole } from "@/lib/supabase/auth-guard"

setDefaultTimeout(30000)
type DbUser = typeof users.$inferSelect

// Real requireRoleOrScope()/hasRole() are used (not mocked); only the credential lookup is controlled.
async function mockAuth(who: { role?: UserRole; scopes?: string[]; none?: boolean }) {
  const actual = await import("@/lib/supabase/auth-guard")
  mock.module("@/lib/supabase/auth-guard", () => ({
    ...actual,
    requireAuthOrApiKey: mock(async () =>
      who.none
        ? { orgId: null, dbUser: null, apiKey: null, response: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) }
        : who.role
          ? { orgId: "org-1", dbUser: { id: "u-session", email: "o@x.com", role: who.role } as unknown as DbUser, apiKey: null, response: null }
          : { orgId: "org-1", dbUser: null, apiKey: { id: "k1", name: "projexa-key", scopes: who.scopes ?? [] }, response: null }
    ),
  }))
}
const tenantCalls: unknown[] = []
mock.module("@/lib/db/tenant-scoped", () => ({
  withTenantContext: async (c: unknown, fn: (db: unknown) => unknown) => { tenantCalls.push(c); return fn({}) },
}))
beforeEach(() => { tenantCalls.length = 0 })
const list = mock(async (_db: unknown, _org: string, _o: unknown) => [{ id: "i1", fingerprint: "fp", sample_event: { message: "boom" } }])
async function mockService() {
  const actual = await import("@/lib/services/client-log-service")
  mock.module("@/lib/services/client-log-service", () => ({ ...actual, listIssuesWithDb: list }))
  list.mockClear()
}
const get = (qs = "") => new NextRequest(`http://localhost/api/v1/projexa/client-logs/issues${qs}`)

describe("GET /api/v1/projexa/client-logs/issues", () => {
  test("a member is refused (403); an admin gets issues with their sample report", async () => {
    await mockAuth({ role: "member" }); await mockService()
    const { GET } = await import("./route")
    expect((await GET(get())).status).toBe(403)
    expect(list).not.toHaveBeenCalled()
    await mockAuth({ role: "admin" })
    const res = await (await import("./route")).GET(get())
    expect(res.status).toBe(200)
    expect((await res.json()).issues[0].sample_event.message).toBe("boom")
  })

  test("defaults to open, passes status/projectId/limit through, clamps limit", async () => {
    await mockAuth({ role: "admin" }); await mockService()
    const { GET } = await import("./route")
    await GET(get())
    expect(list.mock.calls[0][2]).toEqual({ status: "open", projectId: null, limit: 50 })
    await GET(get("?status=reopened&projectId=p9&limit=9999"))
    expect(list.mock.calls[1][2]).toEqual({ status: "reopened", projectId: "p9", limit: 200 })
    expect((await GET(get("?status=all"))).status).toBe(200)
    expect((await GET(get("?status=bogus"))).status).toBe(400)
  })

  test("an API key needs read scope", async () => {
    await mockAuth({ scopes: ["write"] }); await mockService()
    expect((await (await import("./route")).GET(get())).status).toBe(403)
    await mockAuth({ scopes: ["read"] })
    expect((await (await import("./route")).GET(get())).status).toBe(200)
  })
})