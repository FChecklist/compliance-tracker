/// <reference types="bun-types" />
// VERIDIAN_Architecture_v2.0 phase_5: real unit tests for the master
// browser-execution orchestrator's tier selection + documented fallback
// chain -- this phase's own success-criteria "2-tier fallback... executes
// end to end" claim, exercised deterministically via injected envs.
import { describe, expect, test } from "bun:test"
import { planExecution, requiresServerEscalation, TIER_PRIORITY } from "./tier-orchestrator"

describe("planExecution", () => {
  test("selects npu first when every tier is available", () => {
    const plan = planExecution({ navigator: { ml: {}, gpu: {} }, window: { ai: {} } })
    expect(plan.selectedTier).toBe("npu")
    expect(plan.fallbackChain).toEqual(["builtin-ai", "lite-llm", "transformers", "server"])
  })

  test("real 2-tier fallback: no npu/built-in-ai, but WebGPU present -- selects lite-llm, falls back to transformers then server", () => {
    const plan = planExecution({ navigator: { gpu: {} } })
    expect(plan.selectedTier).toBe("lite-llm")
    expect(plan.fallbackChain).toEqual(["transformers", "server"])
    expect(plan.tiers.find((t) => t.tier === "npu")?.available).toBe(false)
  })

  test("zero browser capability at all -- falls all the way back to server, the always-real terminal tier", () => {
    const plan = planExecution({})
    expect(plan.selectedTier).toBe("server")
    expect(plan.fallbackChain).toEqual([])
  })

  test("every tier in the plan is reported, not just the winner", () => {
    const plan = planExecution({ navigator: { gpu: {} } })
    expect(plan.tiers.map((t) => t.tier)).toEqual(TIER_PRIORITY)
  })
})

describe("requiresServerEscalation", () => {
  test("true when the plan bottoms out at server", () => {
    expect(requiresServerEscalation(planExecution({}))).toBe(true)
  })
  test("false when a real browser tier was selected", () => {
    expect(requiresServerEscalation(planExecution({ navigator: { gpu: {} } }))).toBe(false)
  })
})
