// VERIDIAN_Architecture_v2.0 phase_2: engine-prompt-ab (not_implemented --
// no experimentation framework for prompts existed anywhere). Deterministic
// (hash-based, no randomness -- so the same user always lands in the same
// bucket for a given template) traffic-split assignment between two
// prompt_versions, plus a real statistical-significance check over their
// prompt_eval_runs pass rates. This module only RECOMMENDS auto-promotion
// -- it never calls transitionPromptLifecycle() itself; the approval-gate
// enforcement on top of the bare lifecycle state machine is phase_3
// (governance_policy_cost_engines) scope, not this one's.
import { createHash } from "crypto"

export type AbVariant = "control" | "variant"

/**
 * Deterministic bucket assignment: sha256(userId:templateKey) mod 100
 * compared against splitPct. Same user + template always resolves to the
 * same bucket (no per-request randomness, no stored assignment table
 * needed) -- the same "software, not randomness-dependent" posture the
 * rest of this pipeline holds.
 */
export function assignAbBucket(userId: string, templateKey: string, splitPct: number): AbVariant {
  const hash = createHash("sha256").update(`${userId}:${templateKey}`).digest("hex")
  // First 8 hex chars -> a uint32 -> mod 100, uniform enough for traffic
  // splitting at the precision this needs (not a cryptographic use).
  const bucket = parseInt(hash.slice(0, 8), 16) % 100
  return bucket < splitPct ? "variant" : "control"
}

export type ArmResult = { successes: number; total: number }

export type SignificanceResult = {
  controlRate: number
  variantRate: number
  zScore: number
  pValue: number
  significant: boolean
  recommendation: "promote_variant" | "keep_control" | "insufficient_data"
}

// Standard normal CDF via the Abramowitz & Stegun 7.1.26 approximation --
// good to ~1e-7, more than sufficient for a promotion-recommendation gate
// (this is not a regulated statistical report).
function normalCdf(z: number): number {
  const sign = z < 0 ? -1 : 1
  const x = Math.abs(z) / Math.sqrt(2)
  const a1 = 0.254829592, a2 = -0.284496736, a3 = 1.421413741, a4 = -1.453152027, a5 = 1.061405429, p = 0.3275911
  const t = 1 / (1 + p * x)
  const y = 1 - (((((a5 * t + a4) * t) + a3) * t + a2) * t + a1) * t * Math.exp(-x * x)
  return 0.5 * (1 + sign * y)
}

const MIN_SAMPLE_SIZE_PER_ARM = 30
const SIGNIFICANCE_ALPHA = 0.05

/**
 * Two-proportion z-test over control vs. variant pass rates
 * (prompt_eval_runs.passed, aggregated per arm by the caller). Below
 * MIN_SAMPLE_SIZE_PER_ARM this returns "insufficient_data" rather than a
 * spurious significant/not-significant verdict on too little data.
 */
export function evaluateAbSignificance(control: ArmResult, variant: ArmResult): SignificanceResult {
  const controlRate = control.total > 0 ? control.successes / control.total : 0
  const variantRate = variant.total > 0 ? variant.successes / variant.total : 0

  if (control.total < MIN_SAMPLE_SIZE_PER_ARM || variant.total < MIN_SAMPLE_SIZE_PER_ARM) {
    return { controlRate, variantRate, zScore: 0, pValue: 1, significant: false, recommendation: "insufficient_data" }
  }

  const pooled = (control.successes + variant.successes) / (control.total + variant.total)
  const se = Math.sqrt(pooled * (1 - pooled) * (1 / control.total + 1 / variant.total))
  const zScore = se === 0 ? 0 : (variantRate - controlRate) / se
  const pValue = 2 * (1 - normalCdf(Math.abs(zScore)))
  const significant = pValue < SIGNIFICANCE_ALPHA

  let recommendation: SignificanceResult["recommendation"] = "keep_control"
  if (significant && variantRate > controlRate) recommendation = "promote_variant"

  return { controlRate, variantRate, zScore: Math.round(zScore * 10000) / 10000, pValue: Math.round(pValue * 10000) / 10000, significant, recommendation }
}
