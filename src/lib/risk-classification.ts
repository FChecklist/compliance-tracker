// Wave (tree4-unified/50-completion-plan area 3 "Guardrails", PLAN-16
// re-scoped item (d)): ai-os/audit-tree/01-consutitution.yaml's
// "Guardrail 10 -- Risk Classification" ("Each task classified: Low,
// Medium, High, Critical. Risk level determines: review requirements,
// approval authority, escalation level, audit depth"). DEC-04 (resolved
// 2026-07-11) ruled this is additive to, not a replacement for,
// model-tier-eligibility.ts's mechanical/integrative/judgment tiers -- risk
// answers "how much could go wrong," tier answers "which model may attempt
// it." Kept in a separate module for exactly that reason.
//
// Deterministic, no LLM call. Reuses high-impact-action-detector.ts's
// existing category taxonomy rather than inventing a second one -- a task
// already flagged payment/delete/compliance_submission/access_changes is
// definitionally not low-risk, regardless of amount.
import type { HighImpactCategory } from "./high-impact-action-detector"

export type RiskLevel = "low" | "medium" | "high" | "critical"

export type BlastRadius = "single" | "org" | "platform"

export type RiskFactors = {
  /** Real currency amount (INR) this task's action touches, when known (e.g. a payment/refund/journal-entry amount). Omit when not financial. */
  financialAmountInr?: number | null
  /** True when the action cannot be cleanly undone (delete, payment, compliance submission, access revocation). */
  isIrreversible?: boolean
  /** How many orgs/users/records this action could affect if it goes wrong. */
  blastRadius?: BlastRadius
  /** high-impact-action-detector.ts's own category, when this task IS a detected high-impact action. */
  highImpactCategory?: HighImpactCategory | null
}

// Thresholds are intentionally coarse and documented, not tuned against
// real incident data (none exists yet) -- same honesty discipline as
// task-tightening.ts's MIN_FIELD_LENGTH: a defensible starting point,
// revisable once real classification history accumulates.
const CRITICAL_FINANCIAL_THRESHOLD_INR = 1_000_000 // INR 10 lakh
const HIGH_FINANCIAL_THRESHOLD_INR = 100_000 // INR 1 lakh
const MEDIUM_FINANCIAL_THRESHOLD_INR = 10_000 // INR 10 thousand

// These categories are never "low" risk by their own nature, independent of
// amount -- a payment/deletion/compliance filing/access change is
// consequential even at small scale (see high-impact-action-detector.ts's
// own module header, VERIDIAN.docx CSV 205 §26).
const INHERENTLY_HIGH_CATEGORIES: ReadonlySet<HighImpactCategory> = new Set([
  "payment", "delete", "compliance_submission",
])
const INHERENTLY_MEDIUM_CATEGORIES: ReadonlySet<HighImpactCategory> = new Set([
  "archive", "approval", "rejection", "access_changes", "data_export", "configuration_changes",
])

/**
 * Derives a Low/Medium/High/Critical risk level from task characteristics.
 * Order of checks is most-severe-first -- any single qualifying factor is
 * enough to raise the level, matching Guardrail 10's own framing ("risk
 * level determines review requirements" -- a cheap-but-irreversible action
 * and an expensive-but-reversible one can both deserve the same scrutiny).
 */
export function classifyRisk(factors: RiskFactors): RiskLevel {
  if (factors.blastRadius === "platform") return "critical"
  if (factors.financialAmountInr != null && factors.financialAmountInr >= CRITICAL_FINANCIAL_THRESHOLD_INR) return "critical"

  if (factors.financialAmountInr != null && factors.financialAmountInr >= HIGH_FINANCIAL_THRESHOLD_INR) return "high"
  if (factors.highImpactCategory && INHERENTLY_HIGH_CATEGORIES.has(factors.highImpactCategory)) return "high"
  if (factors.isIrreversible && factors.blastRadius === "org") return "high"

  if (factors.financialAmountInr != null && factors.financialAmountInr >= MEDIUM_FINANCIAL_THRESHOLD_INR) return "medium"
  if (factors.highImpactCategory && INHERENTLY_MEDIUM_CATEGORIES.has(factors.highImpactCategory)) return "medium"
  if (factors.isIrreversible) return "medium"
  if (factors.blastRadius === "org") return "medium"

  return "low"
}

export const RISK_LEVEL_LABELS: Record<RiskLevel, string> = {
  low: "Low",
  medium: "Medium",
  high: "High",
  critical: "Critical",
}
