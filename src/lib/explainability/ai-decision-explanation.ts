// AI Architecture / Explainability & Transparency gap-closure (2026-07-18).
//
// Five separate framework findings ("Business decision explainability",
// "Explain AI Decisions", "Explain 'Why' Behind Recommendation", "Explain
// 'Why Not' for Rejected Options", "Explains Why a Decision Was Made") all
// pointed at the same real gap: crm-service.ts's scoreLead()/
// analyzeOpportunity() are the only place in the codebase where an AI
// decision carries a real "why" (aiScoreReasoning/aiRiskFactors) chained to
// a recommended action -- and that shape was never extracted into something
// reusable. This is that extraction: a generic envelope any AI-decision
// surface can produce, plus a shared UI card
// (src/components/ai/AiDecisionExplanationCard.tsx) that renders it.
//
// Deliberately a plain type + converter functions, not a service with its
// own DB table -- there's no need for a new persistence layer when the two
// real producers (crm_leads/crm_opportunities, task-prediction-service.ts)
// already have somewhere to store their own fields. This module is the
// shared *shape*, not a new source of truth.

export type AiConfidenceLevel = "low" | "medium" | "high"

export type RejectedAlternative = {
  option: string
  reason: string
}

export type AiDecisionExplanation = {
  /** One-line "why" -- always present, safe to show inline/collapsed. */
  summary: string
  /** The fuller reasoning behind the decision/recommendation. */
  reasoning: string
  /** Recommended next action, if the decision produces one. */
  recommendedAction?: string
  /** How confident the AI is in this decision -- absent when the producer has no real confidence signal (never fabricated). */
  confidence?: AiConfidenceLevel
  /** Alternatives the AI considered and did not recommend, with why each was rejected. Empty/absent = no alternatives were evaluated, not "there were none". */
  rejectedAlternatives?: RejectedAlternative[]
  /** What the decision assumed to be true (data gaps, simplifications, proxies used) -- required convention for new AI/engine output going forward, optional here for producers migrated from an older shape that never captured it. */
  assumptions?: string[]
  /** Plain-language statement of what's at stake if this recommendation is followed or ignored. */
  businessImpact?: string
}

/**
 * crm_leads row (or the subset scoreLead() writes back) -> the generic shape.
 * Never fabricates a field the row doesn't actually have -- confidence stays
 * undefined for rows scored before the confidence field existed, rather than
 * inventing one.
 */
export function explainCrmLeadDecision(lead: {
  aiScore?: number | null
  aiScoreReasoning?: string | null
  aiRecommendedAction?: string | null
  aiRejectedAlternatives?: unknown
  aiAssumptions?: unknown
  aiConfidence?: string | null
}): AiDecisionExplanation | null {
  if (!lead.aiScoreReasoning) return null
  return {
    summary: `AI lead score: ${lead.aiScore ?? "N/A"}/100`,
    reasoning: lead.aiScoreReasoning,
    recommendedAction: lead.aiRecommendedAction ?? undefined,
    confidence: isConfidenceLevel(lead.aiConfidence) ? lead.aiConfidence : undefined,
    rejectedAlternatives: asRejectedAlternatives(lead.aiRejectedAlternatives),
    assumptions: asStringArray(lead.aiAssumptions),
  }
}

export function explainCrmOpportunityDecision(opp: {
  aiWinProbability?: number | null
  aiRiskFactors?: unknown
  aiRecommendedAction?: string | null
  aiRejectedAlternatives?: unknown
  aiAssumptions?: unknown
  aiConfidence?: string | null
}): AiDecisionExplanation | null {
  const riskFactors = asStringArray(opp.aiRiskFactors) ?? []
  if (opp.aiWinProbability == null && riskFactors.length === 0) return null
  return {
    summary: `AI win probability: ${opp.aiWinProbability ?? "N/A"}%`,
    reasoning: riskFactors.length > 0 ? `Risk factors identified: ${riskFactors.join("; ")}` : "No specific risk factors identified.",
    recommendedAction: opp.aiRecommendedAction ?? undefined,
    confidence: isConfidenceLevel(opp.aiConfidence) ? opp.aiConfidence : undefined,
    rejectedAlternatives: asRejectedAlternatives(opp.aiRejectedAlternatives),
    assumptions: asStringArray(opp.aiAssumptions),
  }
}

/**
 * task-prediction-service.ts's TaskCompletionPrediction -> the generic shape.
 * Deterministic (no LLM), so "reasoning" describes the real historical-average
 * method rather than an AI-generated explanation -- still genuinely explains
 * the "why" behind the predicted date, which is the actual gap this closes
 * ("apply [the pattern] to approvals/tasks" -- see PROGRESS.md ground-truth
 * notes for why "approvals" has no AI decision to extend today).
 */
export function explainTaskPrediction(prediction: {
  sampleSize: number
  averageDurationDays: number | null
  predictedCompletionDate: string | null
  reason?: string
  confidence?: AiConfidenceLevel
}): AiDecisionExplanation {
  if (prediction.reason) {
    return { summary: prediction.reason, reasoning: prediction.reason, confidence: prediction.confidence }
  }
  return {
    summary: prediction.predictedCompletionDate ? `Predicted completion: ${prediction.predictedCompletionDate}` : "No prediction available",
    reasoning: `Based on the average duration (${prediction.averageDurationDays} days) of your own ${prediction.sampleSize} most recently completed tasks, applied to this task's creation date.`,
    confidence: prediction.confidence,
    assumptions: ["Assumes this task's duration will resemble your own historical average -- does not account for this specific task's size or complexity."],
  }
}

function isConfidenceLevel(value: unknown): value is AiConfidenceLevel {
  return value === "low" || value === "medium" || value === "high"
}

function asStringArray(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined
  const strings = value.filter((v): v is string => typeof v === "string")
  return strings.length > 0 ? strings : undefined
}

function asRejectedAlternatives(value: unknown): RejectedAlternative[] | undefined {
  if (!Array.isArray(value)) return undefined
  const parsed = value
    .filter((v): v is { option: unknown; reason: unknown } => typeof v === "object" && v !== null)
    .map((v) => ({ option: String((v as { option: unknown }).option ?? ""), reason: String((v as { reason: unknown }).reason ?? "") }))
    .filter((v) => v.option && v.reason)
  return parsed.length > 0 ? parsed : undefined
}
