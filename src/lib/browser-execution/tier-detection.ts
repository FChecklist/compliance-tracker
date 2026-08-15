// VERIDIAN_Architecture_v2.0 phase_5 (browser_execution_tiers): real
// feature-detection for the document's 5 browser compute tiers (NPU ->
// Built-in AI -> Lite LLM -> Transformers.js -> Server). Each detector
// answers one question honestly -- "is this real browser capability
// present right now" -- and never claims a tier is usable when it isn't.
// gap items closed: engine-browser-npu, engine-browser-builtin-ai
// (detection half), engine-browser-lite-llm (detection half -- see
// ../../../ai-os/BROWSER_LITE_LLM_TECH_DECISION.md for the WebLLM-vs-LiteRT
// decision this tier's real inference path follows), engine-browser-
// transformers (detection half).
//
// Every detector takes an optional `env` (defaults to `globalThis`) so unit
// tests can inject a fake navigator/window without needing a real browser
// or a DOM test environment -- this file itself has zero DOM-lib
// dependency, only duck-typed reads of well-known global property names,
// which is also what keeps it safe to import from both server code (env
// lacks these properties -> every tier reports unavailable, which is
// correct: the server has no browser to run them in) and client bundles.

export type BrowserExecutionTier = "npu" | "builtin-ai" | "lite-llm" | "transformers" | "server"

export type TierAvailability = {
  tier: BrowserExecutionTier
  available: boolean
  reason: string
}

type DetectionEnv = {
  navigator?: { ml?: unknown; gpu?: unknown }
  window?: { ai?: unknown; LanguageModel?: unknown }
}

function readEnv(env?: Partial<DetectionEnv>): DetectionEnv {
  if (env) return env
  if (typeof globalThis === "undefined") return {}
  const g = globalThis as unknown as DetectionEnv
  return { navigator: g.navigator, window: g.window }
}

/** engine-browser-npu: WebNN (navigator.ml) presence check. */
export function detectNpuTier(env?: Partial<DetectionEnv>): TierAvailability {
  const { navigator } = readEnv(env)
  const available = Boolean(navigator?.ml)
  return {
    tier: "npu",
    available,
    reason: available ? "navigator.ml (WebNN) is present" : "navigator.ml (WebNN) is not present on this runtime",
  }
}

/** engine-browser-builtin-ai: Chrome window.ai / window.LanguageModel presence check. */
export function detectBuiltinAiTier(env?: Partial<DetectionEnv>): TierAvailability {
  const { window } = readEnv(env)
  const available = Boolean(window?.ai || window?.LanguageModel)
  return {
    tier: "builtin-ai",
    available,
    reason: available
      ? "window.ai / window.LanguageModel (Chrome Built-in AI) is present"
      : "window.ai / window.LanguageModel (Chrome Built-in AI) is not present on this runtime",
  }
}

/**
 * engine-browser-lite-llm: WebGPU presence check -- the real prerequisite
 * both litert-spike's existing webgpu-with-wasm-fallback path and the
 * WebLLM engine this phase adopts (see the tech-decision doc cited above)
 * require for GPU-accelerated local inference. Reports available even when
 * only the WASM fallback would end up running (litert-spike's own real
 * behavior today) -- callers needing to distinguish "GPU-accelerated" from
 * "WASM fallback" read `gpuAccelerated` separately, matching how
 * inference-worker.ts itself only discovers this at model-compile time,
 * not before.
 */
export function detectLiteLlmTier(env?: Partial<DetectionEnv>): TierAvailability & { gpuAccelerated: boolean } {
  const { navigator } = readEnv(env)
  const inBrowser = navigator !== undefined
  const gpuAccelerated = Boolean(navigator?.gpu)
  // Lite LLM tier is "available" whenever this code is running in any JS
  // engine that can load a WASM runtime -- which, per this repo's own
  // litert-spike prior art, is every real browser (WebGPU absent just means
  // the WASM fallback path runs instead of the GPU path). Server-side
  // (no navigator object at all) it is genuinely unavailable.
  return {
    tier: "lite-llm",
    available: inBrowser,
    gpuAccelerated,
    reason: gpuAccelerated
      ? "navigator.gpu (WebGPU) is present -- GPU-accelerated path available"
      : inBrowser
        ? "navigator.gpu (WebGPU) absent -- WASM fallback path only, same as litert-spike's real webgpu-with-wasm-fallback behavior"
        : "no navigator object at all -- not running in a browser",
  }
}

/**
 * engine-browser-transformers: Transformers.js has a real, universal WASM
 * backend (onnxruntime-web), so this tier is available anywhere the
 * lite-llm tier's WASM fallback is (i.e. any real browser) -- it does not
 * additionally require WebGPU. Distinct from lite-llm: this tier is for
 * embeddings/classification (litert-spike-embeddings' real domain), not
 * text generation.
 */
export function detectTransformersTier(env?: Partial<DetectionEnv>): TierAvailability {
  const { navigator } = readEnv(env)
  const available = navigator !== undefined
  return {
    tier: "transformers",
    available,
    reason: available
      ? "running in a browser-like environment -- Transformers.js WASM backend assumed available"
      : "no navigator object at all -- not running in a browser",
  }
}

/** engine-server-escalation (deepen): the terminal tier, always available. */
export function detectServerTier(): TierAvailability {
  return { tier: "server", available: true, reason: "server-side deterministic SOFTWARE execution (llm-client.ts) is always reachable" }
}

export function detectAllTiers(env?: Partial<DetectionEnv>): TierAvailability[] {
  const liteLlm = detectLiteLlmTier(env)
  return [detectNpuTier(env), detectBuiltinAiTier(env), liteLlm, detectTransformersTier(env), detectServerTier()]
}
