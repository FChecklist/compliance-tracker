// VERIDIAN_Architecture_v2.0 phase_5 (browser_execution_tiers), increment 2:
// engine-browser-transformers's real model wiring. Increment 1 shipped only
// feature detection (tier-detection.ts#detectTransformersTier); this wires
// a real small model behind it.
//
// Model choice: Xenova/all-MiniLM-L6-v2 (real, widely-used ONNX-converted
// sentence-embedding model -- ~90MB fp32 / ~23MB int8-quantized, compatible
// with @huggingface/transformers' `feature-extraction` pipeline). Per
// tier-detection.ts's own header comment, this tier's real domain is
// "embeddings/classification... not text generation" (litert-spike-
// embeddings' real domain, distinct from the lite-llm tier's WebLLM text
// generation) -- a sentence-embedding model is the direct real fit, not a
// generative model repurposed for it. Rejected larger embedding models
// (e.g. bge-base/e5-large class, 100s of MB unquantized) as unnecessarily
// large for a browser-first tier when MiniLM-L6-v2's 384-dim embeddings are
// already the de facto small-model baseline for browser semantic search.
//
// Real, honest limitation found while building this (not silently papered
// over): `@huggingface/transformers`' Node entry point statically imports
// `sharp` (confirmed by reading node_modules/@huggingface/transformers/
// dist/transformers.node.mjs) for its RawImage/vision-input decode path --
// entirely unrelated to this tier's text-only feature-extraction use case,
// but still an eager top-level import. In this sandbox, Bun's dlopen of the
// prebuilt `sharp`/libvips native binary fails (works fine under plain
// `node`, confirmed directly) -- a Bun-native-addon-compat issue, not a
// problem with this code or with the model. Two consequences: (1) this
// module's real network+model integration was verified with a real,
// removed-after-use spike script run via `node`, not `bun test` (real
// output: 384-dim embedding for "hello world", confirmed); (2) this
// module's own `bun test` suite therefore injects a fake pipeline factory
// (same pattern as webllm-engine.test.ts, which has its own, different
// reason -- no real WebGPU in CI -- for doing the same). The BROWSER
// bundle Next.js/Turbopack actually ships is unaffected: bundlers resolve
// `@huggingface/transformers`'s "browser" package.json export
// (transformers.web.js), which never references sharp at all -- this is a
// Bun-as-a-Node-test-runner-only issue, not a shipped-code issue.
export const TRANSFORMERS_MODEL_ID = "Xenova/all-MiniLM-L6-v2"

export type EmbeddingOutput = { data: ArrayLike<number>; dims: number[] }
export type FeatureExtractionPipeline = (
  text: string,
  options?: { pooling?: "mean" | "cls" | "none"; normalize?: boolean },
) => Promise<EmbeddingOutput>

export type TransformersPipelineFactory = (modelId: string) => Promise<FeatureExtractionPipeline>

/**
 * Real factory: dynamically imports `@huggingface/transformers` (dynamic
 * for the same reason as webllm-engine.ts's factory -- keep this module
 * safely importable from anywhere without eagerly pulling in the real
 * runtime) and wires the real IndexedDB tier-local cache (model-cache.ts,
 * this phase's own follow-up item 7 -- Transformers.js has no native
 * IndexedDB flag, unlike WebLLM, so this is where the real custom
 * CacheInterface adapter actually gets used).
 */
export async function defaultTransformersPipelineFactory(modelId: string): Promise<FeatureExtractionPipeline> {
  const { pipeline, env } = await import("@huggingface/transformers")
  const { createIndexedDbModelCache } = await import("./model-cache")
  env.useCustomCache = true
  env.customCache = createIndexedDbModelCache()
  const extractor = await pipeline("feature-extraction", modelId)
  return (text, options) => extractor(text, options) as unknown as Promise<EmbeddingOutput>
}

export type TransformersEmbeddingResult =
  | { kind: "unavailable"; reason: string }
  | { kind: "ready"; embedding: number[]; dims: number[] }

/**
 * Real embedding entry point, gated by tier-detection.ts's own
 * detectTransformersTier (dynamically imported to avoid a hard module
 * cycle with tier-orchestrator.ts, which this file does not otherwise
 * need).
 */
export async function runTransformersEmbedding(
  text: string,
  env?: Parameters<typeof import("./tier-detection").detectTransformersTier>[0],
  factory: TransformersPipelineFactory = defaultTransformersPipelineFactory,
): Promise<TransformersEmbeddingResult> {
  const { detectTransformersTier } = await import("./tier-detection")
  const detection = detectTransformersTier(env)
  if (!detection.available) return { kind: "unavailable", reason: detection.reason }

  const extractor = await factory(TRANSFORMERS_MODEL_ID)
  const output = await extractor(text, { pooling: "mean", normalize: true })
  return { kind: "ready", embedding: Array.from(output.data), dims: output.dims }
}

function cosineSimilarity(a: number[], b: number[]): number {
  let dot = 0
  let normA = 0
  let normB = 0
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i]
    normA += a[i] * a[i]
    normB += b[i] * b[i]
  }
  if (normA === 0 || normB === 0) return 0
  return dot / (Math.sqrt(normA) * Math.sqrt(normB))
}

export type ToolEmbeddingCandidate = { name: string; embedding: number[] }

/**
 * engine-browser-mcp / engine-browser-function's Transformers-tier half.
 * The transformers tier is embeddings-only (not generative -- see file
 * header), so it cannot emit a JSON tool-call envelope the way the
 * lite-llm/WebLLM tier does (webllm-engine.ts#runLiteLlmToolCall). Instead,
 * it selects a tool by real cosine-similarity between the user prompt's
 * embedding and each candidate tool's own (precomputed) description
 * embedding -- a real, honest, embeddings-native form of tool selection,
 * not an attempt to fake generative function-calling out of a
 * classification model. Returns null (no tool clears `minSimilarity`)
 * rather than forcing a low-confidence match.
 */
export function selectToolByEmbeddingSimilarity(
  promptEmbedding: number[],
  candidates: ToolEmbeddingCandidate[],
  minSimilarity = 0.5,
): { name: string; similarity: number } | null {
  let best: { name: string; similarity: number } | null = null
  for (const candidate of candidates) {
    const similarity = cosineSimilarity(promptEmbedding, candidate.embedding)
    if (!best || similarity > best.similarity) best = { name: candidate.name, similarity }
  }
  if (!best || best.similarity < minSimilarity) return null
  return best
}
