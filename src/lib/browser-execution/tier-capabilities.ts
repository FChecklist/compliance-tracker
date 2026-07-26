// VERIDIAN_Architecture_v2.0 phase_5: engine-browser-npu + engine-browser-
// builtin-ai real feature detection. Pure functions reading only global
// browser objects (navigator/globalThis) -- no side effects, safe to unit
// test by stubbing those globals (works identically under bun test/Node
// and a real browser, since both are just property reads).
//
// API status as of 2026-07-26 (do not assume wider support without
// re-checking): `navigator.ml` (WebNN) and `LanguageModel`/`window.ai`
// (Chrome's on-device Prompt API) are both Chrome-only, several behind
// origin trials/flags -- every detector below fails closed (available:
// false) rather than throwing when the API is absent, which is the common
// case today outside Chrome.
import type { BrowserCapabilityReport, TierCapability } from "./types"

function hasNavigator(): boolean {
  return typeof navigator !== "undefined" && navigator !== null
}

/** engine-browser-npu: WebNN, via navigator.ml. Real feature detection only -- does not open a context (that's a per-attempt cost, done lazily in tier-runners.ts). */
export function detectNpu(): TierCapability {
  const available = hasNavigator() && "ml" in navigator && (navigator as unknown as { ml?: unknown }).ml != null
  return {
    tier: "npu",
    available,
    reason: available
      ? "navigator.ml (WebNN) present -- attempting webnn-npu device"
      : "navigator.ml (WebNN) unavailable -- Chrome-only, experimental as of 2026-07",
  }
}

/** engine-browser-builtin-ai: Chrome's on-device Prompt API (global LanguageModel, or the older window.ai.languageModel shape). */
export function detectBuiltinAi(): TierCapability {
  const g = globalThis as unknown as { LanguageModel?: unknown; ai?: { languageModel?: unknown } }
  const available = typeof g !== "undefined" && (g.LanguageModel != null || g.ai?.languageModel != null)
  return {
    tier: "builtin-ai",
    available,
    reason: available
      ? "window.LanguageModel / window.ai.languageModel present (Chrome Prompt API)"
      : "Built-in AI (Chrome Prompt API) unavailable -- Chrome-only, requires a downloaded on-device model",
  }
}

/** WebGPU -- the shared prerequisite for a fully-accelerated Lite LLM (WebLLM) tier. */
export function detectWebGpu(): TierCapability {
  const available = hasNavigator() && "gpu" in navigator && (navigator as unknown as { gpu?: unknown }).gpu != null
  return {
    tier: "lite-llm",
    available,
    reason: available ? "navigator.gpu present" : "navigator.gpu (WebGPU) unavailable",
  }
}

/** engine-browser-lite-llm: WebLLM (@mlc-ai/web-llm) requires WebGPU -- there is no WASM fallback for a chat-capable LLM at a usable speed, unlike Transformers.js. */
export function detectLiteLlm(webgpu: TierCapability): TierCapability {
  return {
    tier: "lite-llm",
    available: webgpu.available,
    reason: webgpu.available ? "WebGPU present -- WebLLM (@mlc-ai/web-llm) can run" : "WebLLM requires WebGPU, which is unavailable",
  }
}

/** engine-browser-transformers: Transformers.js (@huggingface/transformers) runs on the WASM (onnxruntime-web) backend even without WebGPU, so it is real capability even on the lowest-end browser -- actual per-model load failures (network/memory) are handled per-attempt in tier-runners.ts, not by feature detection here. */
export function detectTransformers(): TierCapability {
  return { tier: "transformers", available: true, reason: "Transformers.js runs on the WASM backend even without WebGPU" }
}

/** The Server tier is the phase's own final, always-available fallback -- the existing server dispatch path (task-service.ts), unchanged by this phase. */
export function detectServer(): TierCapability {
  return { tier: "server", available: true, reason: "always available -- final fallback tier (existing server dispatch, unchanged)" }
}

export function detectCapabilities(): BrowserCapabilityReport {
  const webgpu = detectWebGpu()
  return {
    npu: detectNpu(),
    builtinAi: detectBuiltinAi(),
    webgpu,
    liteLlm: detectLiteLlm(webgpu),
    transformers: detectTransformers(),
    server: detectServer(),
    detectedAt: Date.now(),
  }
}
