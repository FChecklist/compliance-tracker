/// <reference types="bun-types" />
import { describe, expect, test, beforeEach } from "bun:test"
import { registerGuardrail, evaluateGuardrails, _clearAllGuardrailsForTests } from "./guardrail-engine"
import { _resetRegisteredForTests } from "./guardrail-registrations"

// Real bug found reviewing the Handover Protocol PR: clearing the shared
// REGISTRY here (module-level state, shared across every test file in the
// same bun test process) without also resetting guardrail-registrations.ts's
// own `registered` idempotency guard left registerAllGuardrails() silently
// no-op-ing for every OTHER test file that runs after this one -- their
// guardrail checks would then always pass (an unregistered leaf always
// passes by design), which is exactly backwards from what those tests
// assert. See _resetRegisteredForTests()'s own comment in
// guardrail-registrations.ts for the full story.
beforeEach(() => {
  _clearAllGuardrailsForTests()
  _resetRegisteredForTests()
})

describe("evaluateGuardrails -- the 'not rigid' guarantee", () => {
  test("a leaf with zero registered rules always passes, for every phase", () => {
    expect(evaluateGuardrails("some.unregistered.leaf", "input", {})).toEqual({ passed: true })
    expect(evaluateGuardrails("some.unregistered.leaf", "process", {})).toEqual({ passed: true })
    expect(evaluateGuardrails("some.unregistered.leaf", "output", {})).toEqual({ passed: true })
    expect(evaluateGuardrails("some.unregistered.leaf", "logic", {})).toEqual({ passed: true })
  })

  test("registering a rule for one leaf does not affect other leaves", () => {
    registerGuardrail("leaf.a", { phase: "input", check: () => ({ passed: false, reason: "always fails", guidance: "test" }) })
    expect(evaluateGuardrails("leaf.b", "input", {})).toEqual({ passed: true })
  })

  test("registering a rule for one phase does not affect other phases on the same leaf", () => {
    registerGuardrail("leaf.a", { phase: "input", check: () => ({ passed: false, reason: "always fails", guidance: "test" }) })
    expect(evaluateGuardrails("leaf.a", "process", {})).toEqual({ passed: true })
  })
})

describe("evaluateGuardrails -- real enforcement for what IS registered", () => {
  test("a failing rule is genuinely detected and its reason/guidance returned", () => {
    registerGuardrail("payroll.run", {
      phase: "input",
      check: (ctx) => (ctx.amount as number) > 0
        ? { passed: true }
        : { passed: false, reason: "Amount must be positive", guidance: "Enter a positive payroll amount." },
    })
    const result = evaluateGuardrails("payroll.run", "input", { amount: -5 })
    expect(result.passed).toBe(false)
    if (!result.passed) {
      expect(result.reason).toBe("Amount must be positive")
      expect(result.guidance).toContain("positive")
    }
  })

  test("a passing rule lets the context through", () => {
    registerGuardrail("payroll.run", {
      phase: "input",
      check: (ctx) => (ctx.amount as number) > 0 ? { passed: true } : { passed: false, reason: "bad", guidance: "fix it" },
    })
    expect(evaluateGuardrails("payroll.run", "input", { amount: 100 })).toEqual({ passed: true })
  })

  test("multiple rules for the same leaf+phase all run -- first failure wins", () => {
    registerGuardrail("payroll.run", { phase: "input", check: () => ({ passed: true }) })
    registerGuardrail("payroll.run", { phase: "input", check: () => ({ passed: false, reason: "second rule failed", guidance: "fix" }) })
    const result = evaluateGuardrails("payroll.run", "input", {})
    expect(result.passed).toBe(false)
    if (!result.passed) expect(result.reason).toBe("second rule failed")
  })

  test("check functions are deterministic -- calling twice with the same input gives the same result", () => {
    registerGuardrail("payroll.run", {
      phase: "input",
      check: (ctx) => (ctx.amount as number) > 0 ? { passed: true } : { passed: false, reason: "bad", guidance: "fix" },
    })
    const r1 = evaluateGuardrails("payroll.run", "input", { amount: -1 })
    const r2 = evaluateGuardrails("payroll.run", "input", { amount: -1 })
    expect(r1).toEqual(r2)
  })
})
