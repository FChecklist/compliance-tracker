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
import { detectAllTiers, detectLiteLlmTier, type BrowserExecutionTier, type TierAvailability } from "./tier-detection"
import { recommendPoolSize, type ParallelismEnv } from "./worker-pool"

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

/**
 * engine-browser-lite-llm (increment 2, real model wiring): the real gate
 * deciding whether the lite-llm tier's actual WebLLM inference (see
 * webllm-engine.ts's startLiteLlmSession) should run for this plan, vs.
 * falling back one tier further. True only when BOTH (a) this plan's own
 * selection already landed on "lite-llm" (i.e. no faster/more-private tier
 * beat it) AND (b) real WebGPU is present (`navigator.gpu`) --
 * unlike litert-spike's LiteRT.js pipeline, WebLLM has no WASM fallback
 * path of its own, so "lite-llm tier selected but WASM-only" must fall
 * back to a lower tier rather than attempt a WebLLM load that would fail.
 * Kept here (not duplicated in webllm-engine.ts) so tier selection stays
 * this module's single source of truth, per this file's own header note.
 */
export function shouldAttemptWebLlm(plan: ExecutionPlan, env?: Parameters<typeof detectLiteLlmTier>[0]): boolean {
  if (plan.selectedTier !== "lite-llm") return false
  return detectLiteLlmTier(env).gpuAccelerated
}

/**
 * engine-browser-npu (increment 3, real inference wiring): the real gate
 * deciding whether npu-engine.ts's real WebNN inference call should run for
 * this plan. Unlike shouldAttemptWebLlm there is no secondary hardware
 * check beyond selection itself -- detectNpuTier's own `navigator.ml`
 * presence check already IS the real prerequisite (there is no WebNN
 * equivalent of "GPU present but WASM-only", the tier is either usable or
 * it isn't) -- kept here anyway, not inlined in npu-engine.ts, so
 * tier-orchestrator.ts stays the single source of truth for "should tier X
 * actually run" across every tier, matching shouldAttemptWebLlm's own
 * precedent.
 */
export function shouldAttemptNpu(plan: ExecutionPlan): boolean {
  return plan.selectedTier === "npu"
}

/**
 * engine-browser-builtin-ai (increment 3, real inference wiring): the real
 * gate deciding whether builtin-ai-engine.ts's real window.ai /
 * window.LanguageModel call should run for this plan. Same reasoning as
 * shouldAttemptNpu above -- detectBuiltinAiTier's own presence check is
 * the real prerequisite, this function exists only to keep tier SELECTION
 * centralized here rather than duplicated per engine file.
 */
export function shouldAttemptBuiltinAi(plan: ExecutionPlan): boolean {
  return plan.selectedTier === "builtin-ai"
}

/**
 * stack-browser-compute / stack-parallelism (deepening): the real
 * parallelism plan for a BATCH of independent browser-tier tasks (e.g.
 * embedding N chunks via the transformers tier, see
 * transformers-engine.ts) dispatched through worker-pool.ts's WorkerPool.
 * Generalizes beyond increment 1's single-task-at-a-time orchestration and
 * litert-spike's own one-worker-per-page precedent -- sizing is a pure
 * function of the real environment's navigator.hardwareConcurrency (see
 * worker-pool.ts#recommendPoolSize for the heuristic and its cap), reusable
 * by any tier, not just lite-llm.
 */
export function planParallelism(env?: ParallelismEnv): { recommendedWorkers: number } {
  return { recommendedWorkers: recommendPoolSize(env) }
}
