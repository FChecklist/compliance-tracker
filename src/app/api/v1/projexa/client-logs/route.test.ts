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
const ingest = mock(async (_db: unknown, _c: unknown, events: unknown[]) => ({ stored: events.length, duplicates: 0 }))
async function mockService() {
  const actual = await import("@/lib/services/client-log-service")
  mock.module("@/lib/services/client-log-service", () => ({ ...actual, ingestClientLogEventsWithDb: ingest }))
  actual.resetRateLimitForTests()
  ingest.mockClear()
}
const evt = (i: number, over: Record<string, unknown> = {}) => ({ id: `evt-${String(i).padStart(8, "0")}`, kind: "error", message: "boom", fingerprint: "fp", occurred_at: new Date().toISOString(), ...over })
const post = (body: unknown, headers: Record<string, string> = {}) =>
  new NextRequest("http://localhost/api/v1/projexa/client-logs", { method: "POST", headers: { "content-type": "application/json", ...headers }, body: typeof body === "string" ? body : JSON.stringify(body) })

describe("POST /api/v1/projexa/client-logs", () => {
  test("a signed-in viewer (lowest role) can send; one tenant transaction; accepted count returned", async () => {
    await mockAuth({ role: "viewer" }); await mockService()
    const { POST } = await import("./route")
    const res = await POST(post({ events: [evt(1), evt(2), evt(3, { kind: "action", action_name: "save" })] }))
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ accepted: 3, rejected: [] })
    expect(tenantCalls).toEqual([{ orgId: "org-1", userId: "u-session" }])
    expect(ingest).toHaveBeenCalledTimes(1)
  })

  test("unauthenticated is 401 and nothing is stored", async () => {
    await mockAuth({ none: true }); await mockService()
    const { POST } = await import("./route")
    expect((await POST(post({ events: [evt(1)] }))).status).toBe(401)
    expect(ingest).not.toHaveBeenCalled()
  })

  test("an API key needs write scope; with it the acting-user header names the person", async () => {
    await mockAuth({ scopes: ["read"] }); await mockService()
    const { POST } = await import("./route")
    expect((await POST(post({ events: [evt(1)] }))).status).toBe(403)
    await mockAuth({ scopes: ["write"] })
    const res = await (await import("./route")).POST(post({ events: [evt(1)] }, { "x-acting-user": "person-7" }))
    expect(res.status).toBe(200)
    expect(tenantCalls).toEqual([{ orgId: "org-1", userId: "person-7" }])
  })

  test("bad events are reported by index, never a 500; good ones in the same batch are stored", async () => {
    await mockAuth({ role: "member" }); await mockService()
    const { POST } = await import("./route")
    const res = await POST(post({ events: [evt(1), { id: "x", kind: "error" }, "junk", evt(4, { kind: "nope" }), evt(5)] }))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.accepted).toBe(2)
    expect(body.rejected.map((r: { index: number }) => r.index)).toEqual([1, 2, 3])
    expect(ingest.mock.calls[0][2]).toHaveLength(2)
  })

  test("a malformed body, a non-array and more than 50 events are 400", async () => {
    await mockAuth({ role: "member" }); await mockService()
    const { POST } = await import("./route")
    expect((await POST(post("{not json"))).status).toBe(400)
    expect((await POST(post({ events: "x" }))).status).toBe(400)
    expect((await POST(post({ events: Array.from({ length: 51 }, (_, i) => evt(i + 1)) }))).status).toBe(400)
    expect(ingest).not.toHaveBeenCalled()
  })

  test("over 120 events a minute for one person: 429 with the accepted count, rest reported rate_limited", async () => {
    await mockAuth({ role: "member" }); await mockService()
    const { POST } = await import("./route")
    const batch = (from: number) => ({ events: Array.from({ length: 50 }, (_, i) => evt(from + i)) })
    expect((await POST(post(batch(1)))).status).toBe(200)
    expect((await POST(post(batch(100)))).status).toBe(200)
    const res = await POST(post(batch(200)))
    expect(res.status).toBe(429)
    expect(res.headers.get("retry-after")).toBe("60")
    const body = await res.json()
    expect(body.accepted).toBe(20)
    expect(body.rejected).toHaveLength(30)
    expect(body.rejected[0].reason).toBe("rate_limited")
    expect((await POST(post(batch(300)))).status).toBe(429)
  })

  test("a storage failure is a plain 500 (the device keeps the batch and retries)", async () => {
    await mockAuth({ role: "member" }); await mockService()
    ingest.mockImplementationOnce(async () => { throw new Error("db down") })
    const { POST } = await import("./route")
    expect((await POST(post({ events: [evt(1)] }))).status).toBe(500)
  })
})