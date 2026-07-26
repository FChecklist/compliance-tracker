// VERIDIAN_Architecture_v2.0 phase_5: engine-model-selection + engine-
// execution-planner. Deterministic (no ML, no randomness) policy deciding
// which on-device AI tiers, if any, are worth attempting for a given
// request -- keyed off phase_2's own ModelSelection.complexityTier
// (src/lib/prompt-compiler/types.ts, "mechanical" | "integrative" |
// "judgment") and this phase's real browser capability report.
import type { ModelSelection } from "@/lib/prompt-compiler/types"
import type { BrowserCapabilityReport, BrowserExecutionTierName } from "./types"

// Below this composite confidence, the deterministic compiler's own
// classification is treated as "not sure enough" and an on-device AI tier
// is worth attempting to refine it -- above it, no AI tier runs at all
// (the concrete "software first" realization: most mechanical requests
// never reach this threshold check's else-branch). Calibrated against
// confidence-engine.ts's own weights, not picked arbitrarily: the
// composite's cache_match signal (weight 0.25) is always 0 in a browser
// call with no semantic-cache lookup available (that's server-side,
// phase_6 scope) -- so the real achievable ceiling here is ~0.75, and
// real sample requests without a cache hit land ~0.28 (vague/gibberish
// text) to ~0.49 (clear, well-formed requests) in verification-pipeline.test.ts-style
// runs. 0.45 sits between those two clusters.
export const MIN_CONFIDENT_COMPOSITE = 0.45

export function needsRefinement(verification: { allPassed: boolean; confidence: { composite: number } }): boolean {
  return !verification.allPassed || verification.confidence.composite < MIN_CONFIDENT_COMPOSITE
}

/**
 * Plans which AI tiers to attempt, in order, for a request that
 * needsRefinement() above. Never includes "deterministic" (always runs
 * first, unconditionally, by the caller) or omits "server" (always the
 * final entry -- every plan must terminate somewhere real).
 */
export function planTierOrder(modelSelection: ModelSelection, capabilities: BrowserCapabilityReport): BrowserExecutionTierName[] {
  const order: BrowserExecutionTierName[] = []

  if (modelSelection.complexityTier === "judgment") {
    // Local on-device models (a few billion parameters at most, per
    // ai-os/MASTER-TRACKER.yaml GAP-LITERT-EDGE-INFERENCE's own finding on
    // LiteRT-LM.js's scope) are not a credible substitute for the server's
    // judgment-tier model -- skip straight to the server's deterministic
    // SOFTWARE execution, which escalates to Tier-5 (Gateway G05) itself
    // only if that specific request needs it.
    order.push("server")
    return order
  }

  if (capabilities.npu.available) order.push("npu")
  if (capabilities.builtinAi.available) order.push("builtin-ai")

  if (modelSelection.complexityTier === "mechanical") {
    // Mechanical requests are the cheapest, most common case -- worth
    // trying every local tier, including the heavier Transformers.js
    // classification pass, before ever reaching the server.
    if (capabilities.liteLlm.available) order.push("lite-llm")
    if (capabilities.transformers.available) order.push("transformers")
  } else {
    // "integrative": local disambiguation is still worth attempting, but
    // only via a real generative tier (lite-llm) -- Transformers.js's
    // classification-only pipelines add little for a request the
    // deterministic pass already flagged as needing cross-signal
    // reasoning, not just a category label.
    if (capabilities.liteLlm.available) order.push("lite-llm")
  }

  order.push("server")
  return order
}
