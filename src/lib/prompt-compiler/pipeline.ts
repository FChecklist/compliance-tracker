// VERIDIAN_Architecture_v2.0 phase_2: the Layer 2-5 orchestrator (the
// document's own "Lightweight Analysis" through "Verification" pipeline
// stages, pipeline-lightweight-analysis through pipeline-verification).
// Composes this module's own pure stages with each stage's own
// document-specified latency budget (15ms/25ms/30ms/30ms) measured and
// reported per run -- not simulated, real Date.now() deltas around each
// real stage call. Deliberately synchronous and DB-free: any DB-backed
// input a real caller needs (a semantic-cache match score, a
// platform-model-readiness flag, the caller's own roles) is resolved by
// that caller BEFORE invoking this function, so the pipeline itself stays
// unit-testable without a live database, matching this repo's established
// .test.ts convention.
import { assembleContext } from "./context-assembly"
import { analyzeLightweight, buildCompiledPrompt } from "./prompt-construction"
import { verify } from "./verification-pipeline"
import type { BusinessContext, ContextMessage, PipelineResult, PipelineStageTiming, UserContext } from "./types"

export type PipelineInput = {
  rawText: string
  business: BusinessContext
  user: UserContext
  sessionMessages: ContextMessage[]
  template?: string
  templateVariables?: Record<string, string>
  // Resolved by the caller from prompt-similarity.ts's findSemanticCacheHit()
  // -- 0 when no cache hit was looked up or found.
  cacheMatchScore?: number
  // Resolved by the caller from orchestra-model-resolver.ts's
  // platformApiKeyFor() -- defaults to true (assume ready) rather than
  // penalizing confidence for callers that haven't wired this yet.
  modelReady?: boolean
  userRoles?: string[]
}

const STAGE_BUDGETS_MS = {
  lightweight_analysis: 15,
  context_assembly: 25,
  prompt_construction: 30,
  verification: 30,
} as const

function timeStage<T>(stage: keyof typeof STAGE_BUDGETS_MS, fn: () => T): { result: T; timing: PipelineStageTiming } {
  const start = Date.now()
  const result = fn()
  const durationMs = Date.now() - start
  const budgetMs = STAGE_BUDGETS_MS[stage]
  return { result, timing: { stage, durationMs, budgetMs, withinBudget: durationMs <= budgetMs } }
}

/** Runs the full Layer 2-5 compiler pipeline over one raw end-user input. */
export function runPipeline(input: PipelineInput): PipelineResult {
  const { result: analysis, timing: t1 } = timeStage("lightweight_analysis", () => analyzeLightweight(input.rawText))

  const { result: context, timing: t2 } = timeStage("context_assembly", () =>
    assembleContext({
      business: input.business,
      user: input.user,
      sessionMessages: input.sessionMessages,
      currentQuery: input.rawText,
      template: input.template,
      templateVariables: input.templateVariables,
    })
  )

  const { result: compiled, timing: t3 } = timeStage("prompt_construction", () => buildCompiledPrompt(analysis))

  const { result: verification, timing: t4 } = timeStage("verification", () =>
    verify({
      analysis,
      classification: analysis.classification,
      intent: analysis.intent,
      context,
      compiled,
      cacheMatchScore: input.cacheMatchScore ?? 0,
      modelReady: input.modelReady ?? true,
      userRoles: input.userRoles ?? [],
    })
  )

  return { analysis, context, compiled, verification, timings: [t1, t2, t3, t4] }
}
