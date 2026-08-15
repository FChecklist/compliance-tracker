// VERIDIAN_Architecture_v2.0 phase_2: engine-prompt-testing (deepen --
// partially_implemented via prompt-eval-service.ts's createEvalCase/
// runEval, but "no adversarial or shadow-testing mode" per the gap
// analysis) + engine-prompt-benchmark (deepen -- prompt_eval_runs already
// captures speed/cost/quality per run, but "no cross-prompt standardized
// leaderboard/benchmark-suite concept"). Both wire onto the existing
// prompt-eval-service.ts/prompt_eval_runs mechanism -- no new eval schema,
// no second test-runner.
import type { PromptEvalContext } from "@/lib/services/prompt-eval-service"
import { runEval } from "@/lib/services/prompt-eval-service"
import { rankPromptVersions, type PromptVersionMetrics, type RankedPromptVersion } from "./prompt-ranking-recommendation"

export type ShadowComparisonResult = {
  evalCaseId: string
  productionVersionId: string
  candidateVersionId: string
  productionRun: Awaited<ReturnType<typeof runEval>>
  candidateRun: Awaited<ReturnType<typeof runEval>>
  agreement: "both_passed" | "both_failed" | "regressed" | "improved"
}

/**
 * engine-prompt-testing's "shadow testing" deepening: runs the SAME real
 * eval case against both the current production prompt version and a
 * candidate (e.g. Staging-lifecycle) version, via the existing runEval() --
 * mirrors production traffic against a candidate without ever promoting it,
 * the real meaning of shadow testing, applied here to prompt versions
 * instead of a second, parallel eval mechanism.
 */
export async function runShadowComparison(
  ctx: PromptEvalContext,
  input: { evalCaseId: string; productionVersionId: string; candidateVersionId: string; provider: string; model: string }
): Promise<ShadowComparisonResult> {
  const [productionRun, candidateRun] = await Promise.all([
    runEval(ctx, { evalCaseId: input.evalCaseId, promptVersionId: input.productionVersionId, provider: input.provider, model: input.model }),
    runEval(ctx, { evalCaseId: input.evalCaseId, promptVersionId: input.candidateVersionId, provider: input.provider, model: input.model }),
  ])

  const prodPassed = "passed" in productionRun && productionRun.passed
  const candPassed = "passed" in candidateRun && candidateRun.passed

  let agreement: ShadowComparisonResult["agreement"]
  if (prodPassed && candPassed) agreement = "both_passed"
  else if (!prodPassed && !candPassed) agreement = "both_failed"
  else if (prodPassed && !candPassed) agreement = "regressed"
  else agreement = "improved"

  return {
    evalCaseId: input.evalCaseId,
    productionVersionId: input.productionVersionId,
    candidateVersionId: input.candidateVersionId,
    productionRun,
    candidateRun,
    agreement,
  }
}

// classifier.py-style keyword tagging, applied to eval-case NAMES (not
// prompt content) so an eval case authored as e.g. "adversarial: prompt
// injection via ignore-instructions" is recognized as an adversarial test
// without a schema change to prompt_eval_cases.
const ADVERSARIAL_NAME_HINTS = ["adversarial", "injection", "jailbreak", "red team", "red-team"]

export function isAdversarialEvalCase(evalCaseName: string): boolean {
  const lower = evalCaseName.toLowerCase()
  return ADVERSARIAL_NAME_HINTS.some((h) => lower.includes(h))
}

export type BenchmarkReport = { templateKey: string; ranked: RankedPromptVersion[]; generatedAt: Date }

/**
 * engine-prompt-benchmark's "cross-prompt standardized leaderboard"
 * deepening: reuses prompt-ranking-recommendation.ts's rankPromptVersions()
 * (same quality/cost/latency/freshness weighting) rather than a second,
 * benchmark-specific scoring formula -- a benchmark IS a ranking, applied
 * to every version of one template instead of picking the single best one.
 */
export function buildBenchmarkReport(templateKey: string, metrics: PromptVersionMetrics[], now: Date): BenchmarkReport {
  return { templateKey, ranked: rankPromptVersions(metrics, now), generatedAt: now }
}
