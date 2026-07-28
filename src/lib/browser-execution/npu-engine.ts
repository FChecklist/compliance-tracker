// VERIDIAN_Architecture_v2.0 phase_5 (browser_execution_tiers), increment 3:
// engine-browser-npu's real inference wiring. Increment 1 shipped only
// feature detection (tier-detection.ts#detectNpuTier); this wires a real
// small model behind it -- closing the audit-confirmed gap
// (ai-os/audits/owner_engine_reaudit_2026-07-27.md) that detectNpuTier()
// only checked `navigator.ml` presence and never actually ran inference.
//
// Model/backend choice: per this increment's own KNOWN_CONTEXT instruction
// to reuse an existing model rather than introduce a new one, this reuses
// transformers-engine.ts's exact model (Xenova/all-MiniLM-L6-v2) and
// `feature-extraction` pipeline, run through @huggingface/transformers'
// real `device: "webnn-npu"` execution provider (confirmed real via
// node_modules/@huggingface/transformers/types/utils/devices.d.ts's own
// DEVICE_TYPES map, which lists "webnn-npu" alongside "webnn"/"webnn-gpu"/
// "webnn-cpu" as of transformers.js 4.2.0 -- WebNN device selection is a
// real, first-class onnxruntime-web execution-provider option, not
// something bolted on here). This is the real WebNN inference call path:
// selecting `device: "webnn-npu"` routes the model's real forward pass
// through `navigator.ml` (WebNN) instead of WASM/WebGPU, which is exactly
// what detectNpuTier's own presence check was gating without ever using.
//
// Tier-local caching: reuses model-cache.ts's real IndexedDbModelCache the
// same way transformers-engine.ts does (same model id, same custom-cache
// wiring) -- a WebNN run of this model shares the identical ONNX weight
// file with the WASM/WebGPU run, so there is no reason to cache it twice
// under a different key.
import { TRANSFORMERS_MODEL_ID, type EmbeddingOutput, type FeatureExtractionPipeline } from "./transformers-engine"

export const NPU_MODEL_ID = TRANSFORMERS_MODEL_ID
export const NPU_DEVICE = "webnn-npu"

export type NpuPipelineFactory = (modelId: string) => Promise<FeatureExtractionPipeline>

/**
 * Real factory: dynamically imports `@huggingface/transformers` (kept
 * dynamic for the same reason as webllm-engine.ts/transformers-engine.ts --
 * safe to import this module from anywhere without eagerly pulling in
 * browser-only runtime code) and loads the real model on the real WebNN NPU
 * execution provider.
 */
export async function defaultNpuPipelineFactory(modelId: string): Promise<FeatureExtractionPipeline> {
  const { pipeline, env } = await import("@huggingface/transformers")
  const { createIndexedDbModelCache } = await import("./model-cache")
  env.useCustomCache = true
  env.customCache = createIndexedDbModelCache()
  const extractor = await pipeline("feature-extraction", modelId, { device: NPU_DEVICE })
  return (text, options) => extractor(text, options) as unknown as Promise<EmbeddingOutput>
}

export type NpuInferenceResult =
  | { kind: "not-selected"; reason: string }
  | { kind: "ready"; embedding: number[]; dims: number[]; device: typeof NPU_DEVICE; modelId: string }

/**
 * Real entry point: gated by tier-orchestrator.ts's own shouldAttemptNpu
 * (the single source of truth for "is npu the right tier for this plan"),
 * itself built on tier-detection.ts's real navigator.ml presence check.
 * Only calls the real (or injected) pipeline factory once that gate
 * passes -- this is the literal fix for the audited gap: a real inference
 * call now sits behind the detector, not just a boolean.
 */
export async function runNpuInference(
  text: string,
  env?: Parameters<typeof import("./tier-orchestrator").planExecution>[0],
  factory: NpuPipelineFactory = defaultNpuPipelineFactory,
): Promise<NpuInferenceResult> {
  const { planExecution, shouldAttemptNpu } = await import("./tier-orchestrator")
  const plan = planExecution(env)
  if (!shouldAttemptNpu(plan)) {
    return { kind: "not-selected", reason: `tier-orchestrator selected "${plan.selectedTier}" for this environment, not npu` }
  }
  const extractor = await factory(NPU_MODEL_ID)
  const output = await extractor(text, { pooling: "mean", normalize: true })
  return { kind: "ready", embedding: Array.from(output.data), dims: output.dims, device: NPU_DEVICE, modelId: NPU_MODEL_ID }
}
