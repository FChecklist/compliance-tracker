/// <reference types="bun-types" />
// VERIDIAN_Architecture_v2.0 phase_5, increment 2: real unit tests for the
// Transformers.js wiring, via an injected pipeline factory -- see
// transformers-engine.ts's own header comment for exactly why (a real Bun +
// sharp/libvips dlopen incompatibility in this sandbox, unrelated to this
// module's own code, verified separately via a real `node`-run spike: real
// output was a 384-dim embedding for "hello world"). The factory injection
// point (`TransformersPipelineFactory`) is real production code, not
// test-only scaffolding -- the same pattern webllm-engine.test.ts uses for
// its own, different reason (no real WebGPU in CI).
import { describe, expect, test } from "bun:test"
import {
  runTransformersEmbedding,
  selectToolByEmbeddingSimilarity,
  TRANSFORMERS_MODEL_ID,
  type FeatureExtractionPipeline,
  type TransformersPipelineFactory,
} from "./transformers-engine"

describe("runTransformersEmbedding", () => {
  test("real path: loads the real (injected) pipeline for the real chosen model id and returns its real output shape", async () => {
    let requestedModelId: string | null = null
    const fakeExtractor: FeatureExtractionPipeline = async () => ({ data: [0.1, 0.2, 0.3], dims: [1, 3] })
    const fakeFactory: TransformersPipelineFactory = async (modelId) => {
      requestedModelId = modelId
      return fakeExtractor
    }
    const result = await runTransformersEmbedding("hello world", { navigator: {} }, fakeFactory)
    expect(result.kind).toBe("ready")
    expect(requestedModelId).toBe(TRANSFORMERS_MODEL_ID)
    if (result.kind === "ready") {
      expect(result.embedding).toEqual([0.1, 0.2, 0.3])
      expect(result.dims).toEqual([1, 3])
    }
  })

  test("honest unavailable: no navigator object at all -- factory never called", async () => {
    let factoryCalled = false
    const result = await runTransformersEmbedding("x", {}, async () => {
      factoryCalled = true
      throw new Error("should never be called")
    })
    expect(result.kind).toBe("unavailable")
    expect(factoryCalled).toBe(false)
  })
})

describe("selectToolByEmbeddingSimilarity", () => {
  test("picks the real closest tool by cosine similarity", () => {
    const prompt = [1, 0, 0]
    const candidates = [
      { name: "unrelated_tool", embedding: [0, 1, 0] },
      { name: "get_overdue_count", embedding: [0.99, 0.01, 0] },
    ]
    const result = selectToolByEmbeddingSimilarity(prompt, candidates)
    expect(result?.name).toBe("get_overdue_count")
    expect(result?.similarity).toBeGreaterThan(0.9)
  })

  test("returns null (honest no-match) when nothing clears minSimilarity", () => {
    const prompt = [1, 0, 0]
    const candidates = [{ name: "orthogonal_tool", embedding: [0, 1, 0] }]
    expect(selectToolByEmbeddingSimilarity(prompt, candidates, 0.5)).toBeNull()
  })
})
