// Wave (tree4-unified/50-completion-plan area 3 "Guardrails", D18 /
// PLAN-20): ai-os/audit-tree/01-consutitution.yaml's "Guardrail 9 --
// Confidence" names a literal banding policy ("Example policy: 98-100%
// auto proceed (low-risk tasks only); 95-97% self-review required; 90-94%
// peer review required; below 90% escalation required"). DEC-04 (resolved
// 2026-07-11, recorded in 05-eighteen-areas-tracker.yaml area 3) ruled this
// is complementary to, not duplicative of, model-tier-eligibility.ts's
// mechanical/integrative/judgment tiers -- tiers gate WHICH MODEL may take
// a dispatch (pre-execution), banding is a closure-time OUTPUT confidence
// signal. This module is the banding half only; it does not touch tier
// eligibility.
//
// Deterministic, no LLM call -- matches every other gate in this codebase.
// bandConfidence() alone does not know whether a task is low-risk, so it
// cannot enforce the "(low-risk tasks only)" qualifier on the 98-100% band
// by itself -- callers combine this with risk-classification.ts's
// classifyRisk() output before treating "auto_proceed" as final (see
// guardrail-registrations.ts's closureReviewCheck for the real wiring).
export type ConfidenceBand = "auto_proceed" | "self_review_required" | "peer_review_required" | "escalation_required"

const AUTO_PROCEED_MIN = 98
const SELF_REVIEW_MIN = 95
const PEER_REVIEW_MIN = 90

/**
 * Maps a 0-100 confidence percentage to the closure path the Constitution's
 * Guardrail 9 requires. Values above 100 or below 0 are clamped rather than
 * thrown -- a caller passing a slightly-out-of-range number (e.g. a model
 * that said "101% sure") should fail toward the SAFER (lower) band, not
 * crash the closure gate.
 */
export function bandConfidence(percentage: number): ConfidenceBand {
  const clamped = Number.isFinite(percentage) ? Math.min(100, Math.max(0, percentage)) : 0
  if (clamped >= AUTO_PROCEED_MIN) return "auto_proceed"
  if (clamped >= SELF_REVIEW_MIN) return "self_review_required"
  if (clamped >= PEER_REVIEW_MIN) return "peer_review_required"
  return "escalation_required"
}

export const CONFIDENCE_BAND_LABELS: Record<ConfidenceBand, string> = {
  auto_proceed: "Auto-proceed (low-risk tasks only)",
  self_review_required: "Self-review required",
  peer_review_required: "Peer review required",
  escalation_required: "Escalation required",
}
