// VERIDIAN_Architecture_v2.0 phase_5: the real on-device model calls for
// each AI tier. Each runner's job is narrow and bounded -- refine a
// low-confidence Classification (src/lib/prompt-compiler/types.ts) into a
// higher-confidence one by picking the best-matching CHAT_CATEGORY, never
// open-ended generation -- because the deterministic compiler
// (prompt-compiler/pipeline.ts) already produced a complete, safe
// machinePrompt; these tiers only run at all when that pass reports low
// confidence (see model-selection.ts's needsRefinement()), so their sole
// value is disambiguation, and a failed/uncertain disambiguation attempt
// must never block the request -- every runner either resolves a
// CHAT_CATEGORY or throws, and the caller (engine.ts) treats a throw as
// "this tier declined, try the next one," never a hard failure.
//
// HONEST LIMITATION (2026-07-26): the library calls below are written
// against each package's real, current API (@mlc-ai/web-llm 0.2.84,
// @huggingface/transformers 4.2.0 -- verified by reading their shipped
// .d.ts files, not guessed) and are exercised end-to-end for
// capability-detection/fallback-decision logic in e2e/browser-execution.spec.ts
// (a real headless-Chromium Playwright run). They were NOT exercised with
// real downloaded model weights in this session -- no GPU/display and
// multi-hundred-MB downloads were impractical in this sandboxed
// environment, the same class of honest limitation
// litert-spike-embeddings' own registered prior art documents (see
// ai-os/MASTER_INDEX.yaml's litert_spike_prior_art entry). Every call is
// wrapped so a real-world failure (unsupported device, OOM, network) is
// caught by the caller and treated as "this tier declined."
import { CHAT_CATEGORIES, type ChatCategory, type Classification } from "@/lib/prompt-compiler/types"

export type RefinementInput = {
  text: string
  candidateCategories: readonly ChatCategory[]
}

const CATEGORY_PROMPT = (text: string, categories: readonly string[]) =>
  `Classify the following user request into exactly one of these categories: ${categories.join(", ")}.\n` +
  `Respond with ONLY the category word, nothing else.\n\nRequest: "${text}"`

/** Parses a model's raw text reply into one of the known ChatCategory values, or null if it didn't clearly name one. Pure -- unit-tested directly, independent of any real model call. */
export function parseCategoryFromModelOutput(raw: string): ChatCategory | null {
  const cleaned = raw.trim().toUpperCase().replace(/[^A-Z_]/g, "")
  const match = CHAT_CATEGORIES.find((c) => cleaned === c || cleaned.includes(c))
  return match ?? null
}

function refinedClassification(base: Classification, category: ChatCategory, confidence: number): Classification {
  return { ...base, category, confidence, scores: { ...base.scores, [category]: confidence } }
}

/** engine-browser-npu: Transformers.js's own `webnn-npu` device target (@huggingface/transformers's real, documented DEVICE_TYPES entry) -- not a separate library, an accelerator selection on the same zero-shot-classification pipeline the "transformers" tier uses with a different device. */
export async function runNpuTier(input: RefinementInput, base: Classification): Promise<Classification> {
  const { pipeline } = await import("@huggingface/transformers")
  const classifier = await pipeline("zero-shot-classification", "Xenova/mobilebert-uncased-mnli", { device: "webnn-npu" })
  const result = await classifier(input.text, input.candidateCategories as unknown as string[])
  const top = Array.isArray(result) ? result[0] : result
  const label = Array.isArray(top.labels) ? top.labels[0] : undefined
  const score = Array.isArray(top.scores) ? top.scores[0] : undefined
  const category = parseCategoryFromModelOutput(String(label ?? ""))
  if (!category || typeof score !== "number") throw new Error("npu tier: no confident category label returned")
  return refinedClassification(base, category, score)
}

/** engine-browser-builtin-ai: Chrome's on-device Prompt API (global LanguageModel). */
export async function runBuiltinAiTier(input: RefinementInput, base: Classification): Promise<Classification> {
  const g = globalThis as unknown as { LanguageModel?: { create: () => Promise<{ prompt: (p: string) => Promise<string> }> } }
  if (!g.LanguageModel) throw new Error("builtin-ai tier: LanguageModel unavailable")
  const session = await g.LanguageModel.create()
  const reply = await session.prompt(CATEGORY_PROMPT(input.text, input.candidateCategories))
  const category = parseCategoryFromModelOutput(reply)
  if (!category) throw new Error("builtin-ai tier: no parseable category in model reply")
  // Chrome's Prompt API does not return a confidence score -- a successful,
  // parseable reply is treated as the same confidence floor this phase's
  // MIN_CONFIDENT_COMPOSITE threshold requires, not invented precision.
  return refinedClassification(base, category, 0.75)
}

// A small, fast, chat-capable model -- not the biggest WebLLM offers,
// deliberately: this tier's job is a one-word category pick, not open
// generation, so model size is optimized for load time over capability.
const LITE_LLM_MODEL_ID = "Llama-3.2-1B-Instruct-q4f16_1-MLC"

/** engine-browser-lite-llm: WebLLM (@mlc-ai/web-llm), adopted over LiteRT.js for this tier -- see ai-os/MASTER_INDEX.yaml's litert_spike_prior_art entry for why (LiteRT-LM.js, the LLM-chat variant, is a separate unevaluated Google product). */
export async function runLiteLlmTier(input: RefinementInput, base: Classification): Promise<Classification> {
  const { CreateMLCEngine } = await import("@mlc-ai/web-llm")
  const engine = await CreateMLCEngine(LITE_LLM_MODEL_ID)
  try {
    const completion = await engine.chat.completions.create({
      messages: [{ role: "user", content: CATEGORY_PROMPT(input.text, input.candidateCategories) }],
      temperature: 0,
    })
    const reply = completion.choices[0]?.message?.content ?? ""
    const category = parseCategoryFromModelOutput(reply)
    if (!category) throw new Error("lite-llm tier: no parseable category in model reply")
    return refinedClassification(base, category, 0.8)
  } finally {
    await engine.unload()
  }
}

/** engine-browser-transformers: Transformers.js zero-shot classification on its default (WebGPU-if-present, else WASM) device -- always available per tier-capabilities.ts's detectTransformers(). */
export async function runTransformersTier(input: RefinementInput, base: Classification): Promise<Classification> {
  const { pipeline } = await import("@huggingface/transformers")
  const classifier = await pipeline("zero-shot-classification", "Xenova/mobilebert-uncased-mnli")
  const result = await classifier(input.text, input.candidateCategories as unknown as string[])
  const top = Array.isArray(result) ? result[0] : result
  const label = Array.isArray(top.labels) ? top.labels[0] : undefined
  const score = Array.isArray(top.scores) ? top.scores[0] : undefined
  const category = parseCategoryFromModelOutput(String(label ?? ""))
  if (!category || typeof score !== "number") throw new Error("transformers tier: no confident category label returned")
  return refinedClassification(base, category, score)
}
