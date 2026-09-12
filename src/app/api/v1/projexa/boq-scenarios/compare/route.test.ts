/// <reference types="bun-types" />
// R85 Addendum 3 v4, Phase 10 -- gate 10-07 ("compare side by side").
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

function req(query = "") {
  return new NextRequest(`http://localhost/api/v1/projexa/boq-scenarios/compare${query}`)
}

describe("10-13: Scenario routes REFUSE a client role", () => {
  test("GET is refused for a viewer-rank role (rank 1 < manager's rank 3)", async () => {
    await mockAuth({ id: "u1", role: "viewer" })
    const compareScenarios = mock(async () => [])
    await mockService({ compareScenarios })
    const { GET } = await import("./route")
    const res = await GET(req("?ids=s1,s2"))
    expect(res.status).toBe(403)
    expect(compareScenarios).not.toHaveBeenCalled()
  })

  test("GET is refused for an external_auditor-rank role", async () => {
    await mockAuth({ id: "u1", role: "external_auditor" })
    await mockService({})
    const { GET } = await import("./route")
    const res = await GET(req("?ids=s1,s2"))
    expect(res.status).toBe(403)
  })

  test("a manager-rank role passes the gate", async () => {
    await mockAuth({ id: "u1", role: "manager" })
    const compareScenarios = mock(async () => [{ scenarioId: "s1" }])
    await mockService({ compareScenarios })
    const { GET } = await import("./route")
    const res = await GET(req("?ids=s1"))
    expect(res.status).toBe(200)
    expect(compareScenarios).toHaveBeenCalled()
  })
})

describe("GET /api/v1/projexa/boq-scenarios/compare -- 10-07 side-by-side comparison", () => {
  test("ids is required", async () => {
    await mockAuth({ id: "u1", role: "manager" })
    const compareScenarios = mock(async () => [])
    await mockService({ compareScenarios })
    const { GET } = await import("./route")
    const res = await GET(req(""))
    expect(res.status).toBe(400)
    expect(compareScenarios).not.toHaveBeenCalled()
  })

  test("splits a comma-separated ids list and forwards it to compareScenarios", async () => {
    await mockAuth({ id: "u1", role: "manager" })
    const compareScenarios = mock(async () => [
      { scenarioId: "s1", name: "A" },
      { scenarioId: "s2", name: "B" },
    ])
    await mockService({ compareScenarios })
    const { GET } = await import("./route")
    const res = await GET(req("?ids=s1, s2"))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.scenarios).toHaveLength(2)
    expect(compareScenarios).toHaveBeenCalledWith({ orgId: "org-1" }, ["s1", "s2"])
  })

  test("a ServiceError from the service surfaces with its own status", async () => {
    await mockAuth({ id: "u1", role: "manager" })
    const authActual = await import("@/lib/services/boq-scenario-service")
    const compareScenarios = mock(async () => {
      throw new authActual.ServiceError("At least one scenarioId is required", 400)
    })
    await mockService({ compareScenarios })
    const { GET } = await import("./route")
    const res = await GET(req("?ids=,,"))
    expect(res.status).toBe(400)
  })
})
