// Cost & Policy Engine — the one role in roster.ts that is deliberately
// `isCodeOnly: true` ("VERIDIAN AI OS ... Cost & Policy Engine under control
// of AI Router / Task Classifier ... (Your Code - No LLM)", per the
// founder's own org chart). Deterministic budget/rate checks belong in
// code, not an LLM call — same posture as estimateCostUsd() in
// llm-client.ts, which this reuses rather than re-deriving pricing.

import { estimateCostUsd, type LLMUsage } from "@/lib/llm-client"

export type CostPolicyDecision = {
  allowed: boolean
  reason?: string
  estimatedCostUsd: number | null
}

// Platform-internal dev-team usage is the founder's own OpenRouter spend
// (funded $10, per PLATFORM_STRATEGY.md §26) -- not a per-customer budget.
// A conservative per-call ceiling stops a single misclassified task from
// burning meaningful spend before a human notices.
const MAX_COST_PER_CALL_USD = 0.50

/**
 * Pre-call check: is this role/model combination worth calling given its
 * known pricing? Returns allowed=true with estimatedCostUsd=null when the
 * model has no pricing entry (unknown cost is not itself a block -- most
 * OpenRouter models used here won't be in llm-client's MODEL_PRICING table
 * yet; that table only tracks what's been manually verified so far).
 */
export function checkCostPolicy(model: string, usage: LLMUsage): CostPolicyDecision {
  const cost = estimateCostUsd(model, usage)
  if (cost !== null && cost > MAX_COST_PER_CALL_USD) {
    return { allowed: false, reason: `Estimated cost $${cost.toFixed(4)} exceeds per-call ceiling $${MAX_COST_PER_CALL_USD}`, estimatedCostUsd: cost }
  }
  return { allowed: true, estimatedCostUsd: cost }
}
