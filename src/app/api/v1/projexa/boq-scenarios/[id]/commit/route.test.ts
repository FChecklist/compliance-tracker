/// <reference types="bun-types" />
// R85 Addendum 3 v4, Phase 10 -- gates 10-09/10-10/10-12/10-13.
import { describe, test, expect, mock, setDefaultTimeout } from "bun:test"
import { NextRequest } from "next/server"

setDefaultTimeout(20000)

async function mockAuth(auth: { dbUser: { id: string; role: string } | null; apiKey?: { id: string } | null; response?: unknown }) {
  const authActual = await import("@/lib/supabase/auth-guard")
  mock.module("@/lib/supabase/auth-guard", () => ({
    ...authActual,
    requireAuth: mock(async () => ({ orgId: "org-1", dbUser: auth.dbUser, apiKey: auth.apiKey ?? null, response: auth.response ?? null })),
  }))
}

async function mockService(overrides: Record<string, unknown>) {
  const actual = await import("@/lib/services/boq-scenario-service")
  mock.module("@/lib/services/boq-scenario-service", () => ({ ...actual, ...overrides }))
}

function postReq(body: unknown = {}) {
  return new NextRequest("http://localhost/api/v1/projexa/boq-scenarios/s1/commit", { method: "POST", body: JSON.stringify(body) })
}
function paramsFor(id: string) {
  return { params: Promise.resolve({ id }) }
}

describe("POST .../commit -- 10-13 client role refused", () => {
  test("a client_viewer is refused with 403 before commitScenario is ever called", async () => {
    await mockAuth({ dbUser: { id: "u1", role: "client_viewer" } })
    const commitScenario = mock(async () => ({}))
    await mockService({ commitScenario })
    const { POST } = await import("./route")
    const res = await POST(postReq(), paramsFor("s1"))
    expect(res.status).toBe(403)
    expect(commitScenario).not.toHaveBeenCalled()
  })
})

describe("POST .../commit -- 10-12: the route ALWAYS hard-codes actorKind: 'human'", () => {
  test("commitScenario is called with actorKind literally 'human', never derived from the request body", async () => {
    await mockAuth({ dbUser: { id: "u1", role: "manager" } })
    const commitScenario = mock(async () => ({ scenarioId: "s1", costSide: { committed: false, lineItemIds: [] }, contractSide: { committed: false, refused: false } }))
    await mockService({ commitScenario })
    const { POST } = await import("./route")
    // Even a caller who tries to smuggle `actorKind: "ai_agent"` in the body
    // has no effect -- the route never reads that field from the request at
    // all.
    await POST(postReq({ actorKind: "ai_agent" }), paramsFor("s1"))
    expect(commitScenario).toHaveBeenCalledTimes(1)
    const [ctxArg] = commitScenario.mock.calls[0] as [{ actorKind: string }, string, unknown]
    expect(ctxArg.actorKind).toBe("human")
  })
})

describe("POST .../commit -- API-key-only callers are refused (no real dbUser to attribute the commit to)", () => {
  test("an API key with no dbUser is refused with 403, never reaching commitScenario", async () => {
    await mockAuth({ dbUser: null, apiKey: { id: "key-1" } })
    const commitScenario = mock(async () => ({}))
    await mockService({ commitScenario })
    const { POST } = await import("./route")
    const res = await POST(postReq(), paramsFor("s1"))
    expect(res.status).toBe(403)
    expect(commitScenario).not.toHaveBeenCalled()
  })
})

describe("POST .../commit -- 10-09/10-10 happy path and refusal reporting", () => {
  test("a successful commit returns the cost/contract side breakdown", async () => {
    await mockAuth({ dbUser: { id: "u1", role: "manager" } })
    const commitScenario = mock(async () => ({
      scenarioId: "s1",
      costSide: { committed: true, lineItemIds: ["line-1"] },
      contractSide: { committed: false, refused: true, reason: "no evidence", refusedLineItemIds: ["line-2"] },
    }))
    await mockService({ commitScenario })
    const { POST } = await import("./route")
    const res = await POST(postReq(), paramsFor("s1"))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.costSide.committed).toBe(true)
    expect(body.contractSide.refused).toBe(true)
  })

  test("a ScopeReductionError from the service surfaces as 409 with structured conflicts", async () => {
    await mockAuth({ dbUser: { id: "u1", role: "manager" } })
    const { ScopeReductionError } = await import("@/lib/services/construction-boq-service")
    const commitScenario = mock(async () => {
      throw new ScopeReductionError("Scope reduction blocked", [{ itemCode: "EX-01", description: "Excavation" } as never])
    })
    await mockService({ commitScenario })
    const { POST } = await import("./route")
    const res = await POST(postReq(), paramsFor("s1"))
    expect(res.status).toBe(409)
    const body = await res.json()
    expect(body.error).toContain("Scope reduction blocked")
    expect(body.conflicts).toHaveLength(1)
  })

  test("evidence + reason in the body are forwarded to commitScenario's options", async () => {
    await mockAuth({ dbUser: { id: "u1", role: "manager" } })
    const commitScenario = mock(async () => ({ scenarioId: "s1", costSide: { committed: false, lineItemIds: [] }, contractSide: { committed: false, refused: false } }))
    await mockService({ commitScenario })
    const { POST } = await import("./route")
    await POST(postReq({ evidenceArtefactRef: "PO-2026-001", reason: "client agreed variation", allowScopeReductionOverride: true }), paramsFor("s1"))
    const [, , options] = commitScenario.mock.calls[0] as [unknown, string, { evidenceArtefactRef: string; reason: string; allowScopeReductionOverride: boolean }]
    expect(options.evidenceArtefactRef).toBe("PO-2026-001")
    expect(options.reason).toBe("client agreed variation")
    expect(options.allowScopeReductionOverride).toBe(true)
  })
})
