/// <reference types="bun-types" />
// R85 Addendum 3 v4, Phase 10 -- gate 10-04 ("target-seek: solve and show, never apply").
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
  return new NextRequest("http://localhost/api/v1/projexa/boq-scenarios/target-seek", { method: "POST", body: JSON.stringify(body) })
}

describe("10-13: Scenario routes REFUSE a client role", () => {
  test("POST is refused for a viewer-rank role (rank 1 < manager's rank 3)", async () => {
    await mockAuth({ id: "u1", role: "viewer" })
    const previewTargetSeekRateForProfit = mock(async () => ({ feasible: true }))
    await mockService({ previewTargetSeekRateForProfit })
    const { POST } = await import("./route")
    const res = await POST(postReq({ boqId: "boq-1", targetProfitPercent: 25 }))
    expect(res.status).toBe(403)
    expect(previewTargetSeekRateForProfit).not.toHaveBeenCalled()
  })

  test("POST is refused for a stage_0-rank role", async () => {
    await mockAuth({ id: "u1", role: "stage_0" })
    await mockService({})
    const { POST } = await import("./route")
    const res = await POST(postReq({ boqId: "boq-1", targetProfitPercent: 25 }))
    expect(res.status).toBe(403)
  })

  test("a manager-rank role passes the gate", async () => {
    await mockAuth({ id: "u1", role: "manager" })
    const previewTargetSeekRateForProfit = mock(async () => ({ feasible: true, rateChangePercent: -10 }))
    await mockService({ previewTargetSeekRateForProfit })
    const { POST } = await import("./route")
    const res = await POST(postReq({ boqId: "boq-1", targetProfitPercent: 25 }))
    expect(res.status).toBe(200)
    expect(previewTargetSeekRateForProfit).toHaveBeenCalled()
  })
})

describe("POST /api/v1/projexa/boq-scenarios/target-seek -- 10-04 solve and show, never apply", () => {
  test("boqId is required", async () => {
    await mockAuth({ id: "u1", role: "manager" })
    await mockService({})
    const { POST } = await import("./route")
    const res = await POST(postReq({ targetProfitPercent: 25 }))
    expect(res.status).toBe(400)
  })

  test("default mode (rate_for_profit) requires targetProfitPercent and calls the rate solver", async () => {
    await mockAuth({ id: "u1", role: "manager" })
    const previewTargetSeekRateForProfit = mock(async () => ({ feasible: true, rateChangePercent: -12.5 }))
    const previewTargetSeekQtyForContractValue = mock(async () => ({ feasible: true }))
    await mockService({ previewTargetSeekRateForProfit, previewTargetSeekQtyForContractValue })
    const { POST } = await import("./route")
    const missing = await POST(postReq({ boqId: "boq-1" }))
    expect(missing.status).toBe(400)

    const res = await POST(postReq({ boqId: "boq-1", targetProfitPercent: 25 }))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.rateChangePercent).toBe(-12.5)
    expect(previewTargetSeekRateForProfit).toHaveBeenCalledWith({ orgId: "org-1" }, "boq-1", 25)
    expect(previewTargetSeekQtyForContractValue).not.toHaveBeenCalled()
  })

  test("mode qty_for_contract_value requires targetContractValue and calls the qty solver", async () => {
    await mockAuth({ id: "u1", role: "manager" })
    const previewTargetSeekQtyForContractValue = mock(async () => ({ feasible: true, qtyReductionPercent: 8 }))
    await mockService({ previewTargetSeekQtyForContractValue })
    const { POST } = await import("./route")
    const missing = await POST(postReq({ boqId: "boq-1", mode: "qty_for_contract_value" }))
    expect(missing.status).toBe(400)

    const res = await POST(postReq({ boqId: "boq-1", mode: "qty_for_contract_value", targetContractValue: 800000 }))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.qtyReductionPercent).toBe(8)
    expect(previewTargetSeekQtyForContractValue).toHaveBeenCalledWith({ orgId: "org-1" }, "boq-1", 800000)
  })

  test("a ServiceError from the service surfaces with its own status, and nothing is ever written (10-04 solve-and-show)", async () => {
    await mockAuth({ id: "u1", role: "manager" })
    const authActual = await import("@/lib/services/boq-scenario-service")
    const previewTargetSeekRateForProfit = mock(async () => {
      throw new authActual.ServiceError("BOQ not found", 404)
    })
    await mockService({ previewTargetSeekRateForProfit })
    const { POST } = await import("./route")
    const res = await POST(postReq({ boqId: "missing-boq", targetProfitPercent: 25 }))
    expect(res.status).toBe(404)
  })
})
