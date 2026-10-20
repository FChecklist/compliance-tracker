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
const timeline = mock(async (_db: unknown, _org: string, _o: unknown) => [{ id: "e1", kind: "action" }, { id: "e2", kind: "error" }])
async function mockService() {
  const actual = await import("@/lib/services/client-log-service")
  mock.module("@/lib/services/client-log-service", () => ({ ...actual, timelineWithDb: timeline }))
  timeline.mockClear()
}
const get = (qs: string) => new NextRequest(`http://localhost/api/v1/projexa/client-logs/timeline${qs}`)

describe("GET /api/v1/projexa/client-logs/timeline", () => {
  test("admin only; projectId is required (400 naming it)", async () => {
    await mockAuth({ role: "member" }); await mockService()
    expect((await (await import("./route")).GET(get("?projectId=p1"))).status).toBe(403)
    await mockAuth({ role: "admin" })
    const { GET } = await import("./route")
    const bad = await GET(get(""))
    expect(bad.status).toBe(400)
    expect((await bad.json()).field).toBe("projectId")
    expect((await GET(get("?projectId=p1&after=garbage"))).status).toBe(400)
  })

  test("returns the chronological events and passes order/limit/after through", async () => {
    await mockAuth({ role: "admin" }); await mockService()
    const { GET } = await import("./route")
    const res = await GET(get("?projectId=p1"))
    expect((await res.json()).events.map((e: { id: string }) => e.id)).toEqual(["e1", "e2"])
    expect(timeline.mock.calls[0][2]).toEqual({ projectId: "p1", limit: 200, order: "asc", after: null })
    await GET(get("?projectId=p1&limit=5000&order=desc&after=2026-10-01T00:00:00Z"))
    expect(timeline.mock.calls[1][2]).toEqual({ projectId: "p1", limit: 1000, order: "desc", after: "2026-10-01T00:00:00Z" })
  })
})