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

// --- Cumulative balance check (added 2026-07-20, Owner zero-waste directive) ---
//
// Real, confirmed gap this closes: MAX_COST_PER_CALL_USD above only ever
// stops a SINGLE call from costing too much. It has no memory of prior
// calls, so it cannot and does not stop many small calls from summing past
// the platform's actual funded budget -- the confirmed real mechanism
// behind this account drifting from its original $10 funding intent
// (PLATFORM_STRATEGY.md §26, "user funded $10 total") to $40.07 real
// OpenRouter usage (confirmed live via /api/v1/credits during this audit).
//
// Deliberately checks OpenRouter's own live balance, not a locally-derived
// sum from tokenUsageLedger -- a derived total is only as complete as every
// call site's logging discipline (confirmed elsewhere in this same audit:
// the systemd worker fleet's real spend was NOT flowing into this ledger
// at all, a separate, disjoint spend path). The account's own real balance
// is the one number that can't be wrong by construction.
//
// Fails OPEN on a network/API error (the check itself being unreachable is
// not evidence the budget is blown -- same "unknown is not itself a block"
// posture as checkCostPolicy above), fails CLOSED on a confirmed low
// balance.
export type BalancePolicyDecision = {
  allowed: boolean
  reason?: string
  remainingUsd: number | null
}

const MIN_SAFE_BALANCE_USD = 0.10

export async function checkOpenRouterBalance(): Promise<BalancePolicyDecision> {
  const apiKey = process.env.OPENROUTER_API_KEY
  if (!apiKey) {
    // No key configured -- the call that would use it is about to fail on
    // its own for the same reason; nothing this check can usefully add.
    return { allowed: true, remainingUsd: null }
  }
  try {
    const res = await fetch("https://openrouter.ai/api/v1/credits", {
      headers: { Authorization: `Bearer ${apiKey}` },
      signal: AbortSignal.timeout(5000),
    })
    if (!res.ok) return { allowed: true, remainingUsd: null } // fail open
    const body = (await res.json()) as { data?: { total_credits?: number; total_usage?: number } }
    const totalCredits = body.data?.total_credits
    const totalUsage = body.data?.total_usage
    if (typeof totalCredits !== "number" || typeof totalUsage !== "number") {
      return { allowed: true, remainingUsd: null } // fail open -- unexpected shape
    }
    const remaining = totalCredits - totalUsage
    if (remaining <= MIN_SAFE_BALANCE_USD) {
      return {
        allowed: false,
        reason: `OpenRouter account balance is $${remaining.toFixed(4)} remaining (live check) -- at or below the $${MIN_SAFE_BALANCE_USD} safety floor. Add funds at openrouter.ai before this role can be called again.`,
        remainingUsd: remaining,
      }
    }
    return { allowed: true, remainingUsd: remaining }
  } catch {
    return { allowed: true, remainingUsd: null } // fail open on any network/timeout error
  }
}
