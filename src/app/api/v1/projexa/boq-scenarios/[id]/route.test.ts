/// <reference types="bun-types" />
// R85 Addendum 3 v4, Phase 10 -- gates 10-05/10-06/10-13.
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

function req() {
  return new NextRequest("http://localhost/api/v1/projexa/boq-scenarios/s1")
}
function paramsFor(id: string) {
  return { params: Promise.resolve({ id }) }
}

describe("10-13: Scenario routes REFUSE a client role", () => {
  test("GET is refused for a viewer-rank role (rank 1 < manager's rank 3)", async () => {
    await mockAuth({ id: "u1", role: "viewer" })
    const getScenario = mock(async () => ({ id: "s1" }))
    const computeScenarioView = mock(async () => ({ scenarioId: "s1" }))
    await mockService({ getScenario, computeScenarioView })
    const { GET } = await import("./route")
    const res = await GET(req(), paramsFor("s1"))
    expect(res.status).toBe(403)
    expect(getScenario).not.toHaveBeenCalled()
    expect(computeScenarioView).not.toHaveBeenCalled()
  })

  test("GET is refused for a client_viewer-rank role", async () => {
    await mockAuth({ id: "u1", role: "client_viewer" })
    await mockService({})
    const { GET } = await import("./route")
    const res = await GET(req(), paramsFor("s1"))
    expect(res.status).toBe(403)
  })

  test("a manager-rank role passes the gate", async () => {
    await mockAuth({ id: "u1", role: "manager" })
    const getScenario = mock(async () => ({ id: "s1", name: "X" }))
    const computeScenarioView = mock(async () => ({ scenarioId: "s1", lines: [] }))
    await mockService({ getScenario, computeScenarioView })
    const { GET } = await import("./route")
    const res = await GET(req(), paramsFor("s1"))
    expect(res.status).toBe(200)
    expect(getScenario).toHaveBeenCalled()
    expect(computeScenarioView).toHaveBeenCalled()
  })
})

describe("GET /api/v1/projexa/boq-scenarios/[id] -- 10-05/10-06 scenario + BASE|SCENARIO|DELTA view", () => {
  test("returns the scenario record and the computed view together, read-only (10-08)", async () => {
    await mockAuth({ id: "u1", role: "manager" })
    const getScenario = mock(async () => ({ id: "s1", name: "Value engineering", boqId: "boq-1" }))
    const computeScenarioView = mock(async () => ({
      scenarioId: "s1",
      boqId: "boq-1",
      lines: [{ lineItemId: "line-1", negative: true }],
      negativeLineItemIds: ["line-1"],
    }))
    await mockService({ getScenario, computeScenarioView })
    const { GET } = await import("./route")
    const res = await GET(req(), paramsFor("s1"))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.scenario.name).toBe("Value engineering")
    expect(body.view.negativeLineItemIds).toEqual(["line-1"])
  })

  test("a ServiceError from the service surfaces with its own status", async () => {
    await mockAuth({ id: "u1", role: "manager" })
    const authActual = await import("@/lib/services/boq-scenario-service")
    const getScenario = mock(async () => {
      throw new authActual.ServiceError("Scenario not found", 404)
    })
    await mockService({ getScenario })
    const { GET } = await import("./route")
    const res = await GET(req(), paramsFor("missing"))
    expect(res.status).toBe(404)
    const body = await res.json()
    expect(body.error).toBe("Scenario not found")
  })
})
