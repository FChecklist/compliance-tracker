// VERIDIAN Review Framework gap-closure (2026-07-18), "AI Governance &
// Auditability" -- GP-09 (Confidence). CONSTITUTION.yaml's documented gap
// ("no numeric confidence-score pipeline with tiered thresholds exists") is
// PARTIALLY stale: confidence-banding.ts::bandConfidence() + the tiered
// 98/95/90 thresholds it implements are real and already enforced in
// guardrail-registrations.ts's closureReviewCheck -- but only ever fed by a
// REVIEWER's own optional, human-supplied number at closure time, never
// computed by the system itself at dispatch time. This module is that
// missing half: a real, deterministic 0-100 score derived entirely from
// signals dispatch/route.ts already computes for its own requiresAudit
// decision (never a model self-reported number, which would be exactly the
// unreliable self-grading this codebase's guardrail discipline avoids --
// see floor-tier-escalation.ts's own header for the same reasoning).
//
// Deliberately simple, additive penalties rather than a fitted model -- the
// exact number is less important than it being derived from real signals
// and landing in the direction VERIDIAN_AUDIT_ORGANIZATION.md's Guardrail 9
// intends (any of these signals firing should land below the 98%
// auto-proceed floor, never above it).
export type DispatchConfidenceInput = {
  lowConfidenceDetected: boolean
  knowledgeGapDetected: boolean
  riskLevel: "low" | "medium" | "high" | "critical" | string
}

const LOW_CONFIDENCE_PENALTY = 15
const KNOWLEDGE_GAP_PENALTY = 20
const RISK_PENALTY: Record<string, number> = { critical: 15, high: 8, medium: 3, low: 0 }

export function computeDispatchConfidencePercentage(input: DispatchConfidenceInput): number {
  let score = 100
  if (input.lowConfidenceDetected) score -= LOW_CONFIDENCE_PENALTY
  if (input.knowledgeGapDetected) score -= KNOWLEDGE_GAP_PENALTY
  score -= RISK_PENALTY[input.riskLevel] ?? 0
  return Math.max(0, Math.min(100, score))
}
