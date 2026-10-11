/// <reference types="bun-types" />
// "Connect your AI" routes: any member connects, removes and shares THEIR OWN AI; only an owner/admin changes the ORGANISATION's. The acting person
// (not the proxy key) decides. Real: the route handlers and the role check. Faked: the auth entry points and the service.
// Falsifiability: change requireRole(user, "admin") to "member" in route.ts and the "member cannot change the organisation's AI" cases fail.
import { beforeEach, describe, expect, mock, test } from "bun:test"
import { NextRequest } from "next/server"

let acting = { id: "u1", role: "admin", isActive: true }
const log: Array<{ fn: string; args: unknown[] }> = []
const realGuard = await import("@/lib/supabase/auth-guard")
mock.module("@/lib/supabase/auth-guard", () => ({
  ...realGuard,
  requireAuthOrApiKey: async () => ({ orgId: "org-1", dbUser: null, apiKey: { id: "k", name: "k", scopes: ["read", "write"] }, response: null }),
  resolveActingUser: async () => ({ user: acting, error: null }),
}))
mock.module("@/lib/ai/internal-ai-org-allowance", () => ({ isInternalAiAllowedForOrg: async () => false }))
const status = { connected: true, provider: "openai", model: "gpt-4o-mini", changedAt: null }
mock.module("@/lib/ai/org-own-ai", () => ({
  OwnAiError: class extends Error { status = 400 },
  getAiPicture: async (...a: unknown[]) => { log.push({ fn: "picture", args: a }); return { effective: { connected: false, source: null } } },
  saveMyAi: async (...a: unknown[]) => { log.push({ fn: "saveMine", args: a }); return { ...status, sharedWith: [] } },
  removeMyAi: async (...a: unknown[]) => { log.push({ fn: "removeMine", args: a }); return { connected: false, sharedWith: [] } },
  saveOwnAi: async (...a: unknown[]) => { log.push({ fn: "saveOrg", args: a }); return status },
  removeOwnAi: async (...a: unknown[]) => { log.push({ fn: "removeOrg", args: a }); return { connected: false } },
  setMyShares: async (...a: unknown[]) => { log.push({ fn: "shares", args: a }); return { ...status, sharedWith: [] } },
  listShareCandidates: async (...a: unknown[]) => { log.push({ fn: "people", args: a }); return [{ id: "u2", name: "Bala", role: "member" }] },
}))
const { GET, PUT, DELETE } = await import("./route")
const { POST: SHARES } = await import("./shares/route")
const { GET: PEOPLE } = await import("./people/route")
const req = (method: string, body?: unknown, url = "http://x/api/v1/projexa/own-ai") =>
  new NextRequest(url, { method, body: body ? JSON.stringify(body) : undefined, headers: { "content-type": "application/json" } })
const calls = (fn: string) => log.filter((l) => l.fn === fn)

beforeEach(() => { acting = { id: "u1", role: "admin", isActive: true }; log.length = 0 })

describe("own-ai routes", () => {
  test("anyone signed in gets their own picture, asked about THEM", async () => {
    acting = { id: "u9", role: "viewer", isActive: true }
    expect((await GET(req("GET"))).status).toBe(200)
    expect(calls("picture")[0]!.args.slice(0, 2)).toEqual(["org-1", "u9"])
  })
  test("a member connects and removes their OWN AI", async () => {
    acting = { id: "u2", role: "member", isActive: true }
    expect((await PUT(req("PUT", { scope: "me", provider: "openai", apiKey: "fake-key-aaaa1111" }))).status).toBe(200)
    expect(calls("saveMine")[0]!.args.slice(0, 2)).toEqual(["org-1", "u2"])
    expect((await DELETE(req("DELETE", undefined, "http://x/api/v1/projexa/own-ai?scope=me"))).status).toBe(200)
    expect(calls("removeMine")).toHaveLength(1)
    expect(calls("saveOrg")).toHaveLength(0)
  })
  test("a member cannot change the organisation's AI; nothing is written", async () => {
    for (const role of ["member", "viewer", "pm"]) {
      acting = { id: "u3", role, isActive: true }
      expect((await PUT(req("PUT", { scope: "org", provider: "openai", apiKey: "fake-key-aaaa1111" }))).status).toBe(403)
      expect((await DELETE(req("DELETE", undefined, "http://x/api/v1/projexa/own-ai?scope=org"))).status).toBe(403)
    }
    expect(calls("saveOrg")).toHaveLength(0)
    expect(calls("removeOrg")).toHaveLength(0)
  })
  test("an admin changes the organisation's AI", async () => {
    expect((await PUT(req("PUT", { scope: "org", provider: "openai", apiKey: "fake-key-aaaa1111" }))).status).toBe(200)
    expect((await DELETE(req("DELETE", undefined, "http://x/api/v1/projexa/own-ai?scope=org"))).status).toBe(200)
    expect(calls("saveOrg")).toHaveLength(1)
    expect(calls("removeOrg")).toHaveLength(1)
  })
  test("a member shares their own connection, and sees who they may share with", async () => {
    acting = { id: "u2", role: "member", isActive: true }
    expect((await SHARES(req("POST", { userIds: ["u5"] }))).status).toBe(200)
    expect(calls("shares")[0]!.args).toEqual(["org-1", "u2", ["u5"]])
    expect((await (await PEOPLE(req("GET"))).json()).people[0].name).toBe("Bala")
    expect(calls("people")[0]!.args).toEqual(["org-1", "u2"])
  })
})
