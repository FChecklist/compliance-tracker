// VERIDIAN_Architecture_v2.0 phase_5 (browser_execution_tiers):
// engine-browser-execution (master orchestrator -- "routing tasks to
// optimal compute tier"), engine-model-selection ("task-aware model
// routing across NPU, WebGPU LLM, Built-in AI, and server tiers"),
// engine-execution-planner ("build and optimize execution plans
// considering latency, cost, privacy, capability constraints"), and
// engine-server-escalation (deepen -- "intelligent escalation from browser
// to server when local resources are insufficient").
//
// Tier priority follows the document's own ordering (NPU -> Built-in AI ->
// Lite LLM -> Transformers.js -> Server, fastest/cheapest/most-private
// first, per engine-execution-planner's latency/cost/privacy constraints)
// and is a pure function of the availability facts tier-detection.ts
// reports -- no engine here decides *whether* a tier is real, only which
// available one to prefer. Selecting the "server" tier IS
// engine-server-escalation's real escalation decision: it is always last
// in priority and always available, so the browser always has a real
// documented fallback (this phase's own 2-tier-fallback success
// criterion), and per the Owner's credit-governance reconciliation,
// picking it means "run deterministic server-side SOFTWARE" -- it does
// NOT by itself mean "call Gateway G05" (see ../llm-client.ts /
// model-tier-eligibility.ts for the separate, existing decision of whether
// a given server-side request needs an actual AI call).
import { detectAllTiers, type BrowserExecutionTier, type TierAvailability } from "./tier-detection"

export const TIER_PRIORITY: BrowserExecutionTier[] = ["npu", "builtin-ai", "lite-llm", "transformers", "server"]

export type ExecutionPlan = {
  tiers: TierAvailability[]
  selectedTier: BrowserExecutionTier
  selectionReason: string
  fallbackChain: BrowserExecutionTier[]
}

/**
 * Builds the real execution plan for one browser-side task: the full
 * priority-ordered availability list (so a caller/telemetry consumer can
 * see every tier's real status, not just the winner), the selected tier
 * (highest-priority available one), and the documented fallback chain
 * (every lower-priority tier after the selection, in order) -- this is
 * exactly the "WebGPU inference attempt -> documented real fallback path"
 * this phase's own success criteria require, generalized to all 5 tiers
 * instead of hardcoding just WebGPU->WASM.
 */
export function planExecution(env?: Parameters<typeof detectAllTiers>[0]): ExecutionPlan {
  const tiers = detectAllTiers(env)
  const byTier = new Map(tiers.map((t) => [t.tier, t]))

  let selected: TierAvailability | undefined
  for (const tier of TIER_PRIORITY) {
    const candidate = byTier.get(tier)
    if (candidate?.available) {
      selected = candidate
      break
    }
  }
  // detectServerTier() always reports available:true, so `selected` is
  // never undefined in practice -- this branch exists only so the return
  // type stays sound without a non-null assertion.
  const selectedTier = selected?.tier ?? "server"
  const selectedIndex = TIER_PRIORITY.indexOf(selectedTier)

  return {
    tiers,
    selectedTier,
    selectionReason: selected?.reason ?? "no tier reported available; defaulted to server",
    fallbackChain: TIER_PRIORITY.slice(selectedIndex + 1),
  }
}

/**
 * engine-server-escalation (deepen): true when the execution plan's own
 * selection already bottomed out at "server" -- i.e. no faster/cheaper/
 * more-private browser tier was available at all, so this request was
 * never going to get a browser-native FIRST pass. This is a distinct,
 * narrower signal from the prompt-compiler pipeline's own
 * VerificationResult.allPassed (a compiled-prompt CONFIDENCE escalation,
 * decided server-side after the FIRST pass ran) -- both are real
 * escalation paths to the same Tier-5 target (llm-client.ts), triggered by
 * different causes (no local capability vs. low compiled-prompt
 * confidence), so callers should check both rather than conflating them.
 */
export function requiresServerEscalation(plan: ExecutionPlan): boolean {
  return plan.selectedTier === "server"
}
