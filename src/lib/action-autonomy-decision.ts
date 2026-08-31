// R65 Part B ("80% software, no approval needed / 20% needs human approval"):
// generalizes a real pattern this codebase already runs live, but only for
// one pipeline. src/app/api/ai/team/dispatch/route.ts already computes
// `requiresAudit = lowConfidence || knowledgeGap || riskLevel === "high"/
// "critical" || vocabularyMismatch` and sets `status: requiresAudit ?
// "pending_review" : "completed"` -- a real, live 80/20-shaped auto-proceed/
// needs-human-review split, but hardcoded to AI Team role dispatch only.
//
// This module is that same decision, generalized so ANY module (task
// dispatch, compliance-item creation, a report send, a financial entry) can
// make the identical real call from its own real signals -- not a parallel
// invention, a real extraction of the proven logic. Built entirely on two
// existing, already-real, already-tested pure functions:
//   - risk-classification.ts's classifyRisk() (Guardrail 10)
//   - confidence-banding.ts's bandConfidence() (Guardrail 9)
// Deterministic, no LLM call, no DB access -- matches every other gate in
// this codebase's guardrail layer.
import { classifyRisk, type RiskFactors, type RiskLevel } from "./risk-classification"
import { bandConfidence, type ConfidenceBand } from "./confidence-banding"

export type AutonomyDecision = "auto_proceed" | "pending_review"

export type ActionAutonomyInput = {
  /** Real risk signals for the action being dispatched -- same shape every risk-classification.ts caller already builds. */
  riskFactors: RiskFactors
  /**
   * 0-100 AI self-reported confidence, when this action was produced/
   * recommended by an AI step. Omit entirely for a purely deterministic,
   * human-form-driven software action (e.g. a click-driven create) -- there
   * is no "confidence" to band when no model made a judgment call, and
   * treating a missing signal as 0 would wrongly force every plain CRUD
   * action into pending_review.
   */
  confidencePercentage?: number | null
}

export type ActionAutonomyResult = {
  decision: AutonomyDecision
  riskLevel: RiskLevel
  confidenceBand: ConfidenceBand | null
  reason: string
}

/**
 * The general, cross-module "should this run automatically, or wait for a
 * human" gate. Risk always wins over confidence -- matches Guardrail 9's own
 * qualifier ("98-100% auto proceed (LOW-RISK TASKS ONLY)"): high confidence
 * in a high-risk action is still not a reason to skip a human, the same way
 * requiresAudit in the AI dispatch route ORs risk and confidence together
 * rather than letting one override the other.
 */
export function decideActionAutonomy(input: ActionAutonomyInput): ActionAutonomyResult {
  const riskLevel = classifyRisk(input.riskFactors)
  const confidenceBand = input.confidencePercentage != null ? bandConfidence(input.confidencePercentage) : null

  if (riskLevel === "critical" || riskLevel === "high") {
    return {
      decision: "pending_review",
      riskLevel,
      confidenceBand,
      reason: `Risk level is ${riskLevel} (${describeRiskFactors(input.riskFactors)}) -- always requires human review regardless of confidence.`,
    }
  }

  if (confidenceBand && confidenceBand !== "auto_proceed") {
    return {
      decision: "pending_review",
      riskLevel,
      confidenceBand,
      reason: `Confidence band is "${confidenceBand}", below the auto-proceed threshold (Guardrail 9: 98%+ required).`,
    }
  }

  return {
    decision: "auto_proceed",
    riskLevel,
    confidenceBand,
    reason: confidenceBand
      ? `Risk level is ${riskLevel} and confidence band is "${confidenceBand}" -- both within auto-proceed range.`
      : `Risk level is ${riskLevel} and no AI confidence signal applies (deterministic action) -- safe to auto-proceed.`,
  }
}

function describeRiskFactors(f: RiskFactors): string {
  const parts: string[] = []
  if (f.financialAmountInr != null) parts.push(`amount ₹${f.financialAmountInr.toLocaleString("en-IN")}`)
  if (f.isIrreversible) parts.push("irreversible")
  if (f.blastRadius && f.blastRadius !== "single") parts.push(`blast radius: ${f.blastRadius}`)
  if (f.highImpactCategory) parts.push(`category: ${f.highImpactCategory}`)
  return parts.length > 0 ? parts.join(", ") : "no elevated factors"
}
