/// <reference types="bun-types" />
// lf-b3-ai-off: the switch itself (strictly "1", default off), the one plain answer, the refusal's shape, and Level 1's own guard
// (runLevel1 answers "nothing resolved, zero model calls" while off -- before the provider gate or the provider is consulted, which are
// spies here: "never called" is "no model, no provider").
//
// Run: bun test --isolate src/lib/projexa-internal-ai.test.ts
import { afterAll, beforeEach, describe, expect, mock, test } from "bun:test"
// Audit 37 point 11: the per-organisation allow flag (internal-ai-org-allowance.ts) is default closed; this file tests behaviour for an ALLOWED org.
mock.module("@/lib/ai/internal-ai-org-allowance", () => ({ INTERNAL_AI_BRANCH_KEY: "internal_ai", isInternalAiAllowedForOrg: async () => true, isInternalAiAllowedForOrgWithDb: async () => true }))

const realAdapter = await import("@/lib/ai/adapter")
const classifySpy = mock(async (segments: string[]) => segments.map(() => ({ functionId: null, params: {}, missingParams: [], confidence: 0, unmappedIntent: null })))
const getAiProviderSpy = mock(() => ({ classify: classifySpy, analyse: mock(async () => []) }))
// Thrown on purpose when reached, so the "on" case proves the gate is the next step without touching a database.
const assertAllowedSpy = mock(() => {
  throw new Error("sentinel: provider gate reached")
})
mock.module("@/lib/ai/adapter", () => ({ ...realAdapter, getAiProvider: getAiProviderSpy, assertAiProviderAllowed: assertAllowedSpy }))

const { runLevel1, LEVEL1_INTERNAL_AI_OFF_REASON } = await import("@/lib/pipeline/level1")
const m = await import("./projexa-internal-ai")
const { ServiceError } = await import("@/lib/services/service-error")

const FLAG = "PROJEXA_INTERNAL_AI_ENABLED"
const saved = process.env[FLAG]
beforeEach(() => {
  delete process.env[FLAG]
  getAiProviderSpy.mockClear()
  assertAllowedSpy.mockClear()
  classifySpy.mockClear()
})
afterAll(async () => {
  if (saved === undefined) delete process.env[FLAG]
  else process.env[FLAG] = saved
  mock.restore()
  await mock.module("@/lib/ai/adapter", () => realAdapter)
})

describe("the switch", () => {
  test("off unless it is exactly '1'", () => {
    expect(m.PROJEXA_INTERNAL_AI_FLAG).toBe(FLAG)
    expect(m.projexaInternalAiEnabled()).toBe(false)
    for (const v of ["", "0", "true", "TRUE", "yes", "on", " 1", "1 ", "01"]) {
      process.env[FLAG] = v
      expect(m.projexaInternalAiEnabled()).toBe(false)
    }
    process.env[FLAG] = "1"
    expect(m.projexaInternalAiEnabled()).toBe(true)
  })

  test("assertProjexaInternalAi throws while off and is silent while on", () => {
    expect(() => m.assertProjexaInternalAi("t")).toThrow(m.ProjexaInternalAiOffError)
    process.env[FLAG] = "1"
    expect(() => m.assertProjexaInternalAi("t")).not.toThrow()
  })
})

describe("the answer", () => {
  test("the one plain sentence says what to do and that the app still works", () => {
    expect(m.USE_YOUR_OWN_AI).toContain("PROJEXA does not run its own AI")
    expect(m.USE_YOUR_OWN_AI).toContain("paste your PROJEXA AI link")
    expect(m.USE_YOUR_OWN_AI).toContain("buttons and menus still work")
  })

  test("the refusal is a ServiceError 403 with the sentence as its message, so every route maps it to {error: sentence}", () => {
    const e = new m.ProjexaInternalAiOffError("construction.discuss")
    expect(e).toBeInstanceOf(ServiceError)
    expect(e.status).toBe(403)
    expect(e.message).toBe(m.USE_YOUR_OWN_AI)
    expect(e.code).toBe(m.PROJEXA_INTERNAL_AI_OFF_CODE)
    expect(e.retryable).toBe(false)
    expect(e.surface).toBe("construction.discuss")
    expect(m.isProjexaInternalAiOff(e)).toBe(true)
    expect(m.isProjexaInternalAiOff(new ServiceError("x", 403))).toBe(false)
  })
})

describe("runLevel1's own guard", () => {
  const ctx = { orgId: "org-1", userId: "user-1", personId: "person-1", projectId: null, candidateFunctionIds: ["record_attendance"] }

  test("switch unset: nothing resolved, zero model calls, and neither the provider gate nor the provider is consulted", async () => {
    const outcome = await runLevel1(["one", "two"], ctx)
    expect(outcome).toEqual({ resolutions: [null, null], reasons: [LEVEL1_INTERNAL_AI_OFF_REASON, LEVEL1_INTERNAL_AI_OFF_REASON], modelCalls: 0 })
    expect(assertAllowedSpy).not.toHaveBeenCalled()
    expect(getAiProviderSpy).not.toHaveBeenCalled()
    expect(classifySpy).not.toHaveBeenCalled()
  })

  test("switch '1': the provider gate is the next step, as before", async () => {
    process.env[FLAG] = "1"
    await expect(runLevel1(["one"], ctx)).rejects.toThrow("sentinel: provider gate reached")
    expect(assertAllowedSpy).toHaveBeenCalledTimes(1)
  })
})
