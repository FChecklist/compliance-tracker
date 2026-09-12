/// <reference types="bun-types" />
// R85 Addendum 3 v4, Phase 10 -- gates 10-01/10-07/10-13.
import { describe, test, expect, mock, setDefaultTimeout } from "bun:test"
import { NextRequest } from "next/server"

setDefaultTimeout(20000)

async function mockAuth(dbUser: { id: string; role: string } | null) {
  const authActual = await import("@/lib/supabase/auth-guard")
  mock.module("@/lib/supabase/auth-guard", () => ({
    ...authActual,
    requireAuthOrApiKey: mock(async () => ({ orgId: "org-1", dbUser, apiKey: dbUser ? null : { id: "key-1", scopes: ["read", "write"] }, response: null })),
  }))
}

async function mockService(overrides: Record<string, unknown>) {
  const actual = await import("@/lib/services/boq-scenario-service")
  mock.module("@/lib/services/boq-scenario-service", () => ({ ...actual, ...overrides }))
}

function req(query = "", init?: RequestInit) {
  return new NextRequest(`http://localhost/api/v1/projexa/boq-scenarios${query}`, init)
}

describe("10-13: Scenario routes REFUSE a client role", () => {
  test("GET is refused for a viewer-rank role (rank 1 < manager's rank 3)", async () => {
    await mockAuth({ id: "u1", role: "viewer" })
    await mockService({})
    const { GET } = await import("./route")
    const res = await GET(req("?boqId=boq-1"))
    expect(res.status).toBe(403)
  })

  test("POST (create) is refused for a client_viewer-rank role", async () => {
    await mockAuth({ id: "u1", role: "client_viewer" })
    await mockService({})
    const { POST } = await import("./route")
    const res = await POST(req("", { method: "POST", body: JSON.stringify({ boqId: "boq-1", name: "X" }) }))
    expect(res.status).toBe(403)
  })

  test("a manager-rank role passes the gate", async () => {
    await mockAuth({ id: "u1", role: "manager" })
    const createScenario = mock(async () => ({ id: "s1", name: "X", boqId: "boq-1", adjustments: [] }))
    await mockService({ createScenario })
    const { POST } = await import("./route")
    const res = await POST(req("", { method: "POST", body: JSON.stringify({ boqId: "boq-1", name: "X" }) }))
    expect(res.status).toBe(201)
    expect(createScenario).toHaveBeenCalled()
  })
})

describe("GET /api/v1/projexa/boq-scenarios -- 10-07 list", () => {
  test("boqId is required", async () => {
    await mockAuth({ id: "u1", role: "manager" })
    await mockService({})
    const { GET } = await import("./route")
    const res = await GET(req(""))
    expect(res.status).toBe(400)
  })

  test("lists every scenario for the given boqId", async () => {
    await mockAuth({ id: "u1", role: "manager" })
    const listScenarios = mock(async () => [{ id: "s1" }, { id: "s2" }])
    await mockService({ listScenarios })
    const { GET } = await import("./route")
    const body = await (await GET(req("?boqId=boq-1"))).json()
    expect(body.scenarios).toHaveLength(2)
    expect(listScenarios).toHaveBeenCalledWith({ orgId: "org-1" }, "boq-1")
  })
})

describe("POST /api/v1/projexa/boq-scenarios -- 10-01 create", () => {
  test("name and boqId are required", async () => {
    await mockAuth({ id: "u1", role: "manager" })
    await mockService({})
    const { POST } = await import("./route")
    expect((await POST(req("", { method: "POST", body: JSON.stringify({ name: "X" }) }))).status).toBe(400)
    expect((await POST(req("", { method: "POST", body: JSON.stringify({ boqId: "boq-1" }) }))).status).toBe(400)
  })

  test("a valid create returns 201 with the new scenario", async () => {
    await mockAuth({ id: "u1", role: "manager" })
    const createScenario = mock(async (ctx: unknown, input: { boqId: string; name: string }) => ({
      id: "s1", boqId: input.boqId, name: input.name, adjustments: [], authorId: (ctx as { userId: string }).userId,
    }))
    await mockService({ createScenario })
    const { POST } = await import("./route")
    const res = await POST(req("", { method: "POST", body: JSON.stringify({ boqId: "boq-1", name: "Value engineering" }) }))
    expect(res.status).toBe(201)
    const body = await res.json()
    expect(body.name).toBe("Value engineering")
    expect(body.authorId).toBe("u1")
  })
})
