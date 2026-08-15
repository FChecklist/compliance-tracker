/// <reference types="bun-types" />
import { describe, expect, test, beforeEach } from "bun:test"
import { registerGuardrail, _clearAllGuardrailsForTests } from "./guardrail-engine"
import { _resetRegisteredForTests } from "./guardrail-registrations"
import { assertBusinessRulesBeforeExecution, BusinessRuleViolationError } from "./business-rule-validator"

beforeEach(() => {
  _clearAllGuardrailsForTests()
  _resetRegisteredForTests()
})

describe("assertBusinessRulesBeforeExecution", () => {
  test("never throws for a leaf key with no registered rules -- the 'not rigid' guarantee applies here too", () => {
    expect(() => assertBusinessRulesBeforeExecution("some_unregistered_engine", { anything: 1 })).not.toThrow()
  })

  test("throws BusinessRuleViolationError with the guardrail's reason/guidance when a registered 'process' rule fails", () => {
    registerGuardrail("test_engine", {
      phase: "process",
      check: (ctx) => (ctx.principal as number) > 0
        ? { passed: true }
        : { passed: false, reason: "principal_must_be_positive", guidance: "Enter a positive principal." },
    })
    expect(() => assertBusinessRulesBeforeExecution("test_engine", { principal: -1 })).toThrow(BusinessRuleViolationError)
    try {
      assertBusinessRulesBeforeExecution("test_engine", { principal: -1 })
      throw new Error("should have thrown")
    } catch (err) {
      expect(err).toBeInstanceOf(BusinessRuleViolationError)
      expect((err as Error).message).toContain("principal_must_be_positive")
      expect((err as Error).message).toContain("Enter a positive principal.")
    }
  })

  test("passes through silently when the registered rule is satisfied", () => {
    registerGuardrail("test_engine", {
      phase: "process",
      check: (ctx) => (ctx.principal as number) > 0 ? { passed: true } : { passed: false, reason: "bad", guidance: "fix" },
    })
    expect(() => assertBusinessRulesBeforeExecution("test_engine", { principal: 100 })).not.toThrow()
  })

  test("only checks the 'process' phase -- a rule registered for 'input' on the same leaf doesn't block dispatch", () => {
    registerGuardrail("test_engine", { phase: "input", check: () => ({ passed: false, reason: "irrelevant", guidance: "n/a" }) })
    expect(() => assertBusinessRulesBeforeExecution("test_engine", {})).not.toThrow()
  })
})
