// VERIDIAN_Architecture_v2.0 phase_5_browser_execution_tiers: the real
// orchestrator -- engine-browser-execution + pipeline-execution. Ties
// together the deterministic compiler (phase_2's runPipeline, imported
// directly from ./pipeline, NEVER from the "@/lib/prompt-compiler" barrel
// -- that barrel also re-exports DB-backed/Node-crypto modules
// (persist-compiled-prompt.ts, prompt-similarity.ts, prompt-ab-testing.ts)
// that must never enter this client-side module's bundle), the
// capability-aware execution planner (model-selection.ts), the on-device
// AI tiers (tier-runners.ts), and the browser-cache-check (storage-cache.ts).
//
// Concretely realizes the Owner's "software first" directive
// (registries.credit_spend_governance): phase_2's deterministic compiler
// ALWAYS runs first, at zero AI cost, for every request -- the 4 on-device
// AI tiers only run at all when that pass's own VerificationResult reports
// low confidence (model-selection.ts's needsRefinement()), and even then
// only to disambiguate a category, never to replace the deterministic
// output. "server" as the final planned tier is not a function call here
// -- it means the caller (VeriComposer) proceeds with its EXISTING,
// unchanged fetch() to the real server dispatch path, which itself only
// escalates to Gateway G05 (Tier-5, llm-client.ts) if that specific
// request needs it.
import { runPipeline, type PipelineInput } from "@/lib/prompt-compiler/pipeline"
import { buildCompiledPrompt } from "@/lib/prompt-compiler/prompt-construction"
import { CHAT_CATEGORIES, type Classification } from "@/lib/prompt-compiler/types"
import { detectCapabilities } from "./tier-capabilities"
import { needsRefinement, planTierOrder } from "./model-selection"
import { runBuiltinAiTier, runLiteLlmTier, runNpuTier, runTransformersTier, type RefinementInput } from "./tier-runners"
import { getCachedOutcome, putCachedOutcome } from "./storage-cache"
import type { BrowserCapabilityReport, BrowserExecutionOutcome, BrowserExecutionTierName, TierAttempt } from "./types"

export type TierRunner = (input: RefinementInput, base: Classification) => Promise<Classification>

// Exported so a caller with a real reason to override one runner (e.g. a
// future desktop/companion context with a different NPU binding) can, but
// the default map is what every real browser call site uses.
export const DEFAULT_TIER_RUNNERS: Partial<Record<BrowserExecutionTierName, TierRunner>> = {
  npu: runNpuTier,
  "builtin-ai": runBuiltinAiTier,
  "lite-llm": runLiteLlmTier,
  transformers: runTransformersTier,
}

export type BrowserExecutionOptions = {
  capabilities?: BrowserCapabilityReport
  tierRunners?: Partial<Record<BrowserExecutionTierName, TierRunner>>
  now?: () => number
}

export async function runBrowserExecutionTiers(input: PipelineInput, options: BrowserExecutionOptions = {}): Promise<BrowserExecutionOutcome> {
  const now = options.now ?? (() => Date.now())
  const runners = options.tierRunners ?? DEFAULT_TIER_RUNNERS
  const start = now()

  // Always runs first, unconditionally, at zero AI cost -- see this file's
  // header comment.
  const pipelineResult = runPipeline(input)

  const cached = await getCachedOutcome(pipelineResult.compiled.contentHash, now())
  if (cached) return { ...cached, cacheHit: true, totalMs: now() - start }

  const attempts: TierAttempt[] = []
  let machinePrompt = pipelineResult.compiled.machinePrompt
  let contentHash = pipelineResult.compiled.contentHash
  let fingerprint = pipelineResult.compiled.fingerprint
  let tierUsed: BrowserExecutionTierName = "deterministic"

  if (needsRefinement(pipelineResult.verification)) {
    const capabilities = options.capabilities ?? detectCapabilities()
    const tierOrder = planTierOrder(pipelineResult.verification.modelSelection, capabilities)
    const refinementInput: RefinementInput = { text: pipelineResult.analysis.originalText, candidateCategories: CHAT_CATEGORIES }

    for (const tier of tierOrder) {
      if (tier === "server") {
        tierUsed = "server"
        attempts.push({ tier: "server", attempted: true, succeeded: true, ms: 0, detail: "handed off to existing server dispatch path (unchanged) for deterministic SOFTWARE execution" })
        break
      }
      const runner = runners[tier]
      if (!runner) continue
      const tierStart = now()
      try {
        const refined = await runner(refinementInput, pipelineResult.analysis.classification)
        const refinedCompiled = buildCompiledPrompt({ ...pipelineResult.analysis, classification: refined })
        machinePrompt = refinedCompiled.machinePrompt
        contentHash = refinedCompiled.contentHash
        fingerprint = refinedCompiled.fingerprint
        tierUsed = tier
        attempts.push({ tier, attempted: true, succeeded: true, ms: now() - tierStart, detail: `refined category to ${refined.category} (confidence ${refined.confidence.toFixed(2)})` })
        break
      } catch (error) {
        attempts.push({ tier, attempted: true, succeeded: false, ms: now() - tierStart, detail: error instanceof Error ? error.message : String(error) })
      }
    }
  }

  const outcome: BrowserExecutionOutcome = {
    machinePrompt,
    contentHash,
    fingerprint,
    complexityTier: pipelineResult.verification.modelSelection.complexityTier,
    tierUsed,
    attempts,
    cacheHit: false,
    totalMs: now() - start,
  }

  await putCachedOutcome(contentHash, outcome, now())
  return outcome
}
