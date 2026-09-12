/// <reference types="bun-types" />
// R85 Addendum 3 v4, Phase 10 -- gates 10-02/10-03/10-08/10-13.
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

function postReq(body: unknown = {}) {
  return new NextRequest("http://localhost/api/v1/projexa/boq-scenarios/s1/adjustments", { method: "POST", body: JSON.stringify(body) })
}
function deleteReq(query = "") {
  return new NextRequest(`http://localhost/api/v1/projexa/boq-scenarios/s1/adjustments${query}`, { method: "DELETE" })
}
function paramsFor(id: string) {
  return { params: Promise.resolve({ id }) }
}

describe("10-13: Scenario routes REFUSE a client role", () => {
  test("POST is refused for a viewer-rank role (rank 1 < manager's rank 3)", async () => {
    await mockAuth({ id: "u1", role: "viewer" })
    const addAdjustment = mock(async () => ({}))
    await mockService({ addAdjustment })
    const { POST } = await import("./route")
    const res = await POST(postReq({ kind: "exclude", lineItemId: "line-1" }), paramsFor("s1"))
    expect(res.status).toBe(403)
    expect(addAdjustment).not.toHaveBeenCalled()
  })

  test("DELETE is refused for a client_viewer-rank role", async () => {
    await mockAuth({ id: "u1", role: "client_viewer" })
    const removeAdjustment = mock(async () => ({}))
    await mockService({ removeAdjustment })
    const { DELETE } = await import("./route")
    const res = await DELETE(deleteReq("?lineItemId=line-1"), paramsFor("s1"))
    expect(res.status).toBe(403)
    expect(removeAdjustment).not.toHaveBeenCalled()
  })

  test("a manager-rank role passes the gate on POST", async () => {
    await mockAuth({ id: "u1", role: "manager" })
    const addAdjustment = mock(async () => ({ id: "s1", adjustments: [{ kind: "exclude", lineItemId: "line-1" }] }))
    await mockService({ addAdjustment })
    const { POST } = await import("./route")
    const res = await POST(postReq({ kind: "exclude", lineItemId: "line-1" }), paramsFor("s1"))
    expect(res.status).toBe(200)
    expect(addAdjustment).toHaveBeenCalled()
  })
})

describe("POST .../adjustments -- 10-02 single-line adjustment (no `selector` in body)", () => {
  test("routes to addAdjustment with the request's ctx + id + body", async () => {
    await mockAuth({ id: "u1", role: "manager" })
    const addAdjustment = mock(async (ctx: unknown, scenarioId: string, input: unknown) => ({ ctx, scenarioId, input }))
    await mockService({ addAdjustment })
    const { POST } = await import("./route")
    const body = { kind: "adjust", lineItemId: "line-1", side: "project", field: "rate", changeType: "percent", value: -10 }
    const res = await POST(postReq(body), paramsFor("s1"))
    expect(res.status).toBe(200)
    expect(addAdjustment).toHaveBeenCalledWith({ orgId: "org-1", userId: "u1" }, "s1", body)
  })
})

describe("POST .../adjustments -- 10-03 bulk adjustment (`selector` present in body)", () => {
  test("routes to addBulkAdjustment instead of addAdjustment", async () => {
    await mockAuth({ id: "u1", role: "manager" })
    const addAdjustment = mock(async () => ({}))
    const addBulkAdjustment = mock(async () => ({ id: "s1", affectedLineItemIds: ["line-1", "line-2"] }))
    await mockService({ addAdjustment, addBulkAdjustment })
    const { POST } = await import("./route")
    const body = { selector: { kind: "all" }, kind: "exclude" }
    const res = await POST(postReq(body), paramsFor("s1"))
    expect(res.status).toBe(200)
    const resBody = await res.json()
    expect(resBody.affectedLineItemIds).toEqual(["line-1", "line-2"])
    expect(addBulkAdjustment).toHaveBeenCalledWith({ orgId: "org-1", userId: "u1" }, "s1", body)
    expect(addAdjustment).not.toHaveBeenCalled()
  })
})

describe("DELETE .../adjustments -- revert one line to the base BOQ", () => {
  test("lineItemId is required", async () => {
    await mockAuth({ id: "u1", role: "manager" })
    const removeAdjustment = mock(async () => ({}))
    await mockService({ removeAdjustment })
    const { DELETE } = await import("./route")
    const res = await DELETE(deleteReq(""), paramsFor("s1"))
    expect(res.status).toBe(400)
    expect(removeAdjustment).not.toHaveBeenCalled()
  })

  test("a valid lineItemId reverts the line via removeAdjustment", async () => {
    await mockAuth({ id: "u1", role: "manager" })
    const removeAdjustment = mock(async () => ({ id: "s1", adjustments: [] }))
    await mockService({ removeAdjustment })
    const { DELETE } = await import("./route")
    const res = await DELETE(deleteReq("?lineItemId=line-1"), paramsFor("s1"))
    expect(res.status).toBe(200)
    expect(removeAdjustment).toHaveBeenCalledWith({ orgId: "org-1", userId: "u1" }, "s1", "line-1")
  })
})

describe("POST/DELETE .../adjustments -- 10-08: a ServiceError from the service surfaces with its own status", () => {
  test("POST", async () => {
    await mockAuth({ id: "u1", role: "manager" })
    const authActual = await import("@/lib/services/boq-scenario-service")
    const addAdjustment = mock(async () => {
      throw new authActual.ServiceError("Scenario not found", 404)
    })
    await mockService({ addAdjustment })
    const { POST } = await import("./route")
    const res = await POST(postReq({ kind: "exclude", lineItemId: "line-1" }), paramsFor("missing"))
    expect(res.status).toBe(404)
  })
})
