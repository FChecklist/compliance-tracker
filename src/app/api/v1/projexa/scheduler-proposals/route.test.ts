/// <reference types="bun-types" />
// PROJEXA-BUILD-002 WP-13 (register row AW-605): GET /api/v1/projexa/scheduler-proposals, the organisation-wide list of what a
// schedule prepared. The route, the role rule and the guard are real; the identity (requireAuthOrApiKey) and the list query
// (listSchedulerProposals, proven on real SQL in folder-watch-store.pglite.test.ts) are replaced by recorders.
//
// WHAT IS PROVEN: an unauthenticated call gets the guard's own answer and reads nothing; a viewer is refused (403); a member's list is
// limited to their own proposals (the query is given onlyFor = the member's id); a manager or above reads the organisation's (no
// limit); a key that names no person gets an empty list and reads nothing; the list is asked for the caller's own organisation; a
// failure is a 500 without the error's text.
//
// Run: bun test --isolate src/app/api/v1/projexa/scheduler-proposals/route.test.ts
import { beforeEach, describe, expect, mock, test } from "bun:test"

const ORG = "org_1"
let identity: { dbUser: Record<string, unknown> | null; apiKey: Record<string, unknown> | null; response?: Response | null }
const listCalls: Array<{ ctx: unknown; options: unknown }> = []
let listBehaviour: () => Promise<unknown[]> = async () => []

const realAuthGuard = await import("@/lib/supabase/auth-guard")
mock.module("@/lib/supabase/auth-guard", () => ({
  ...realAuthGuard,
  requireAuthOrApiKey: mock(async () => (identity.response ? { orgId: null, dbUser: null, apiKey: null, response: identity.response } : { orgId: ORG, response: null, ...identity })),
}))
const realStore = await import("@/lib/services/folder-watch-store")
mock.module("@/lib/services/folder-watch-store", () => ({
  ...realStore,
  listSchedulerProposals: async (ctx: unknown, options: unknown) => {
    listCalls.push({ ctx, options })
    return listBehaviour()
  },
}))

const { GET } = (await import("./route")) as unknown as { GET: (req: Request) => Promise<Response> }
const request = () => new Request("https://app.example.test/api/v1/projexa/scheduler-proposals")
const user = (role: string, id = "person_1") => ({ dbUser: { id, orgId: ORG, name: "P", email: "p@example.test", role, isActive: true }, apiKey: null })

beforeEach(() => {
  listCalls.length = 0
  listBehaviour = async () => []
  identity = user("member")
})

describe("GET /api/v1/projexa/scheduler-proposals", () => {
  test("an unauthenticated call gets the guard's answer and reads nothing", async () => {
    identity = { dbUser: null, apiKey: null, response: new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401 }) }
    expect((await GET(request())).status).toBe(401)
    expect(listCalls).toEqual([])
  })

  test("a viewer is refused", async () => {
    identity = user("viewer")
    expect((await GET(request())).status).toBe(403)
    expect(listCalls).toEqual([])
  })

  test("a member reads only the proposals of the schedules they own", async () => {
    identity = user("member", "person_7")
    listBehaviour = async () => [{ id: "s1", waitingOn: "answers" }]
    const res = await GET(request())
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ count: 1, proposals: [{ id: "s1", waitingOn: "answers" }] })
    expect(listCalls).toEqual([{ ctx: { orgId: ORG, actorId: "person_7" }, options: { onlyFor: "person_7" } }])
  })

  test("a manager and an admin read the organisation's", async () => {
    for (const role of ["manager", "admin", "branch_manager"]) {
      listCalls.length = 0
      identity = user(role, "person_9")
      expect((await GET(request())).status).toBe(200)
      expect(listCalls).toEqual([{ ctx: { orgId: ORG, actorId: "person_9" }, options: {} }])
    }
  })

  test("an API key that names no person gets an empty list and reads nothing", async () => {
    identity = { dbUser: null, apiKey: { id: "key_1", scopes: ["read"], role: "member" } }
    const res = await GET(request())
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ count: 0, proposals: [] })
    expect(listCalls).toEqual([])
  })

  test("a failure is a 500 that does not repeat the error's text", async () => {
    listBehaviour = async () => {
      throw new Error("relation compliance.submissions exploded")
    }
    const res = await GET(request())
    expect(res.status).toBe(500)
    expect(JSON.stringify(await res.json())).not.toContain("exploded")
  })
})
