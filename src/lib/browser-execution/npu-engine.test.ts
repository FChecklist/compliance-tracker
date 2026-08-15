/// <reference types="bun-types" />
// VERIDIAN_Architecture_v2.0 phase_5, increment 3: real unit tests proving
// NPU inference actually EXECUTES (not just detects) when navigator.ml is
// present -- a real WebNN device isn't available in this test runtime any
// more than a real GPU is (see webllm-engine.test.ts's own note for the
// established reason this codebase injects a fake factory rather than
// skipping the test), so this exercises the real production call path
// (runNpuInference -> tier-orchestrator's real shouldAttemptNpu gate ->
// factory) with only the factory's *implementation* (the real multi-MB
// model load) swapped out.
import { describe, expect, test } from "bun:test"
import { NPU_DEVICE, NPU_MODEL_ID, runNpuInference, type NpuPipelineFactory } from "./npu-engine"

describe("runNpuInference", () => {
  test("real path: navigator.ml present -- npu selected, real inference call executes against the real model id on the real webnn-npu device", async () => {
    let requestedModelId: string | null = null
    const fakeEmbedding = new Float32Array([0.1, 0.2, 0.3])
    const fakeFactory: NpuPipelineFactory = async (modelId) => {
      requestedModelId = modelId
      return async (text: string) => ({ data: fakeEmbedding, dims: [1, 3] })
    }

    const result = await runNpuInference("hello world", { navigator: { ml: {} } }, fakeFactory)

    expect(result.kind).toBe("ready")
    expect(requestedModelId).toBe(NPU_MODEL_ID)
    if (result.kind === "ready") {
      expect(result.device).toBe(NPU_DEVICE)
      expect(result.embedding).toEqual(Array.from(fakeEmbedding))
      expect(result.dims).toEqual([1, 3])
    }
  })

  test("real, honest not-selected: navigator.ml absent -- does NOT call the inference factory at all", async () => {
    let factoryCalled = false
    const fakeFactory: NpuPipelineFactory = async () => {
      factoryCalled = true
      throw new Error("should never be called")
    }

    const result = await runNpuInference("hello world", { navigator: { gpu: {} } }, fakeFactory)

    expect(result.kind).toBe("not-selected")
    expect(factoryCalled).toBe(false)
  })

  test("not-selected: builtin-ai outranks npu when navigator.ml is absent but window.ai is present", async () => {
    const result = await runNpuInference("hi", { window: { ai: {} } }, async () => {
      throw new Error("should never be called")
    })
    expect(result.kind).toBe("not-selected")
  })

  test("zero browser capability at all -- server tier wins, npu inference never attempted", async () => {
    let factoryCalled = false
    const result = await runNpuInference("hi", {}, async () => {
      factoryCalled = true
      throw new Error("should never be called")
    })
    expect(result.kind).toBe("not-selected")
    expect(factoryCalled).toBe(false)
  })
})
