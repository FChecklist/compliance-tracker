/// <reference types="bun-types" />
// "Connect your AI" route: anyone signed in may see WHETHER an AI is connected; only an organisation owner/admin may connect or remove one.
// Real: the route and the role check. Faked: the two auth entry points and the service. Falsifiability: change requireRole(..., "admin") to
// "member" in route.ts and the member cases fail.
import { beforeEach, describe, expect, mock, test } from "bun:test"
import { NextRequest } from "next/server"

let acting = { id: "u1", role: "admin", isActive: true }
const saved: unknown[] = []
const realGuard = await import("@/lib/supabase/auth-guard")
mock.module("@/lib/supabase/auth-guard", () => ({
  ...realGuard,
  requireAuthOrApiKey: async () => ({ orgId: "org-1", dbUser: null, apiKey: { id: "k", name: "k", scopes: ["read", "write"] }, response: null }),
  resolveActingUser: async () => ({ user: acting, error: null }),
}))
mock.module("@/lib/ai/org-own-ai", () => ({
  OwnAiError: class extends Error { status = 400 },
  getOwnAiStatus: async () => ({ connected: saved.length > 0, provider: saved.length ? "openai" : null, model: null, changedAt: null }),
  saveOwnAi: async (_o: string, b: unknown) => { saved.push(b); return { connected: true, provider: "openai", model: "gpt-4o-mini", changedAt: null } },
  removeOwnAi: async () => { saved.length = 0; return { connected: false, provider: null, model: null, changedAt: null } },
}))
const { GET, PUT, DELETE } = await import("./route")
const req = (method: string, body?: unknown) => new NextRequest("http://x/api/v1/projexa/own-ai", { method, body: body ? JSON.stringify(body) : undefined, headers: { "content-type": "application/json" } })

beforeEach(() => { acting = { id: "u1", role: "admin", isActive: true }; saved.length = 0 })

describe("own-ai route", () => {
  test("anyone signed in can see the state", async () => {
    acting = { id: "u2", role: "viewer", isActive: true }
    expect((await (await GET(req("GET"))).json()).connected).toBe(false)
  })
  test("an admin connects and removes", async () => {
    const put = await PUT(req("PUT", { provider: "openai", apiKey: "fake-test-key-aaaa1111" }))
    expect(put.status).toBe(200)
    expect(saved).toHaveLength(1)
    expect((await (await DELETE(req("DELETE"))).json()).connected).toBe(false)
  })
  test("a member or viewer is refused and nothing is saved", async () => {
    for (const role of ["member", "viewer", "pm"]) {
      acting = { id: "u3", role, isActive: true }
      expect((await PUT(req("PUT", { provider: "openai", apiKey: "fake-test-key-aaaa1111" }))).status).toBe(403)
      expect((await DELETE(req("DELETE"))).status).toBe(403)
    }
    expect(saved).toHaveLength(0)
  })
})
