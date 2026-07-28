/// <reference types="bun-types" />
// VERIDIAN_Architecture_v2.0 phase_5: real unit tests for the master
// browser-execution orchestrator's tier selection + documented fallback
// chain -- this phase's own success-criteria "2-tier fallback... executes
// end to end" claim, exercised deterministically via injected envs.
import { describe, expect, test } from "bun:test"
import {
  planExecution,
  planParallelism,
  requiresServerEscalation,
  shouldAttemptBuiltinAi,
  shouldAttemptNpu,
  shouldAttemptWebLlm,
  TIER_PRIORITY,
} from "./tier-orchestrator"

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

describe("shouldAttemptWebLlm", () => {
  test("true when lite-llm is selected and real WebGPU is present", () => {
    const env = { navigator: { gpu: {} } }
    expect(shouldAttemptWebLlm(planExecution(env), env)).toBe(true)
  })

  test("false (real, honest fallback) when lite-llm is selected but WebGPU is absent -- WASM-only, WebLLM has no WASM path", () => {
    const env = { navigator: {} }
    const plan = planExecution(env)
    expect(plan.selectedTier).toBe("lite-llm")
    expect(shouldAttemptWebLlm(plan, env)).toBe(false)
  })

  test("false when a higher-priority tier (npu) was selected instead of lite-llm", () => {
    const env = { navigator: { ml: {}, gpu: {} } }
    expect(shouldAttemptWebLlm(planExecution(env), env)).toBe(false)
  })

  test("false when the plan bottomed out at server (no navigator at all)", () => {
    expect(shouldAttemptWebLlm(planExecution({}), {})).toBe(false)
  })
})

describe("shouldAttemptNpu", () => {
  test("true when npu is selected (navigator.ml present)", () => {
    const env = { navigator: { ml: {} } }
    expect(shouldAttemptNpu(planExecution(env))).toBe(true)
  })
  test("false when npu is absent -- a lower tier wins selection instead", () => {
    const env = { navigator: { gpu: {} } }
    expect(shouldAttemptNpu(planExecution(env))).toBe(false)
  })
})

describe("shouldAttemptBuiltinAi", () => {
  test("true when builtin-ai is selected (navigator.ml absent, window.ai present)", () => {
    const env = { window: { ai: {} } }
    expect(shouldAttemptBuiltinAi(planExecution(env))).toBe(true)
  })
  test("false when npu outranks builtin-ai", () => {
    const env = { navigator: { ml: {} }, window: { ai: {} } }
    expect(shouldAttemptBuiltinAi(planExecution(env))).toBe(false)
  })
  test("false when the plan bottomed out at server", () => {
    expect(shouldAttemptBuiltinAi(planExecution({}))).toBe(false)
  })
})

describe("planParallelism", () => {
  test("recommends hardwareConcurrency - 1, capped at 4, matching worker-pool.ts's own heuristic", () => {
    expect(planParallelism({ navigator: { hardwareConcurrency: 8 } })).toEqual({ recommendedWorkers: 4 })
    expect(planParallelism({ navigator: { hardwareConcurrency: 2 } })).toEqual({ recommendedWorkers: 1 })
  })

  test("falls back to 1 worker (no parallelism) when hardwareConcurrency is unreported", () => {
    expect(planParallelism({})).toEqual({ recommendedWorkers: 1 })
  })
})
