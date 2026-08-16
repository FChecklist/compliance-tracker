// GAP-RESPONSE-VOCABULARY. Confirmed via repo-wide review before building:
// every AI reply in this codebase today is free-form generation -- runRole()
// in ai-team/team-service.ts returns whatever text callLLM() produced,
// unvalidated against anything except (post-hoc, on the whole reply)
// detectLowConfidenceResponse()/passesReplyGate()'s phrase checks. No
// mechanism anywhere constrains a model's reply to a fixed set of tokens.
//
// NOT the same thing as response-engine.ts's ResponseLabel/formatShortReply
// (Wave 154): that module is software choosing a predefined label FROM REAL
// STATE (a task's status, a gate's failure reason) with zero LLM call --
// an OUTGOING suggestion contract. This module is the INCOMING half: given
// that a mechanical-tier model WAS called and DID reply in free text,
// does that reply actually land on one of the fixed labels the dispatcher
// declared it must? Genuinely different direction, genuinely different
// failure mode (a model ignoring an instruction to reply tersely vs.
// software picking the right template), so this is a new module rather
// than an extension of response-engine.ts.
//
// Honest limitation, stated up front rather than oversold (same discipline
// as model-tier-eligibility.ts / check-guardrail-presence.mjs): this is
// POST-HOC validation of the model's own text, not true constrained
// decoding (no logit-bias/grammar constraint is wired into the OpenRouter
// call in team-service.ts, and not every model behind OpenRouter supports
// one uniformly). What this module actually guarantees is narrower and
// still real: a mechanical-tier reply that doesn't resolve to the declared
// fixed vocabulary is never silently accepted as free text and never
// silently coerced into looking like it matched -- it is flagged, honestly,
// for a human or a higher-tier model to look at. That is the same class of
// guarantee floor-tier-escalation.ts's detectLowConfidenceResponse() and
// ai-reply-gate.ts's passesReplyGate() already give this codebase for their
// own narrower signals.
//
// Deterministic only -- no LLM call to decide whether a reply matches,
// matching every other gate in this codebase.

import type { ComplexityTier } from "./task-tightening"

// Keyed by dispatch/task type, not by AI Workforce role -- a single role
// (e.g. "engineering_generalist") can receive both a genuinely simple
// Yes/No dispatch and an open-ended mechanical dispatch that doesn't fit a
// fixed vocabulary at all ("rename this one variable"). The caller of
// POST /api/ai/team/dispatch declares which shape this particular task is
// via the optional `responseVocabulary` field -- see route.ts. Omitting it
// (the default for every dispatch today) means "ordinary free-form reply,"
// so this is purely additive and breaks nothing already dispatching.
export type VocabularyDispatchType = "yes_no_check" | "status_check" | "approval_decision"

// The fixed vocabularies themselves. Deliberately narrow and literal --
// exactly the doc's own named example set (Yes/No/OK/Pending/Approved/
// Rejected/Escalated), split across the three dispatch shapes that
// actually need different label sets rather than one giant undifferentiated
// list a caller has to filter mentally. Extending this is meant to be as
// easy as adding a new key + array, same "meant to grow" posture as
// check-guardrail-presence.mjs's own manifest.
export const RESPONSE_VOCABULARY: Record<VocabularyDispatchType, readonly string[]> = {
  yes_no_check: ["Yes", "No"],
  status_check: ["OK", "Pending", "Completed", "Failed"],
  approval_decision: ["Approved", "Rejected", "Escalated"],
}

// Matches response-engine.ts's own "max ~4 words" rule (formatShortReply's
// test: "Max ~4 words per the doc's own rule") -- a reply that rambles past
// this, even if it eventually mentions an allowed word, is not the terse
// fixed-vocabulary reply this contract asks for and should not be treated
// as a match.
const MAX_VOCABULARY_REPLY_WORDS = 4

function normalizeForMatch(value: string): string {
  return value.trim().toLowerCase().replace(/[.!?,:;]+$/g, "")
}

export type VocabularyMismatchReason =
  | "empty_reply"
  | "reply_exceeds_vocabulary_length"
  | "reply_not_in_vocabulary"

export type VocabularyCheckResult =
  | { allowed: true; dispatchType: VocabularyDispatchType; matchedLabel: string }
  | {
      allowed: false
      dispatchType: VocabularyDispatchType
      reason: VocabularyMismatchReason
      rawReply: string
      guidance: string
    }

/**
 * Validates a mechanical-tier model's raw reply against the fixed
 * vocabulary declared for `dispatchType`. Exact match only (case-
 * insensitive, trailing punctuation trimmed) -- no fuzzy/synonym matching,
 * because a fuzzy matcher accepting "Yep" for "Yes" or "Declined" for
 * "Rejected" would be exactly the silent-coercion behavior this contract
 * explicitly rules out. A reply that doesn't land on an allowed label is
 * always reported as `allowed: false` with an honest reason and guidance to
 * escalate -- this function never invents, corrects, or discards the reply
 * on the caller's behalf; the caller decides what "flag for review" means
 * (see route.ts's requiresAudit wiring).
 */
export function checkResponseVocabulary(dispatchType: VocabularyDispatchType, replyText: string): VocabularyCheckResult {
  const allowed = RESPONSE_VOCABULARY[dispatchType]
  const raw = replyText ?? ""
  const trimmed = raw.trim()
  const guidance = `Reply did not resolve to one of this dispatch's fixed vocabulary labels (${allowed.join("/")}). Per the constrained-vocabulary contract, an unmatched reply is never silently coerced or discarded -- escalate this dispatch for human or higher-tier-model review instead.`

  if (!trimmed) {
    return { allowed: false, dispatchType, reason: "empty_reply", rawReply: raw, guidance }
  }

  const wordCount = trimmed.split(/\s+/).length
  if (wordCount > MAX_VOCABULARY_REPLY_WORDS) {
    return { allowed: false, dispatchType, reason: "reply_exceeds_vocabulary_length", rawReply: raw, guidance }
  }

  const normalized = normalizeForMatch(trimmed)
  const matchedLabel = allowed.find((label) => normalizeForMatch(label) === normalized)
  if (!matchedLabel) {
    return { allowed: false, dispatchType, reason: "reply_not_in_vocabulary", rawReply: raw, guidance }
  }

  return { allowed: true, dispatchType, matchedLabel }
}

export type VocabularyEligibility =
  | { eligible: true }
  | { eligible: false; reason: string; guidance: string }

/**
 * Constrained-vocabulary replies only make sense for mechanical-tier
 * dispatches (model-tier-eligibility.ts's own definition: "one file, one
 * well-defined operation" -- the same class of task simple enough to
 * genuinely fit a fixed Yes/No/status/approval answer). Declaring
 * `responseVocabulary` on an integrative/judgment-tier task is refused
 * here, fail-closed, before any model is called -- same posture as
 * checkTierEligibility() in model-tier-eligibility.ts. Omitting
 * `responseVocabulary` entirely is always eligible (it's opt-in, not a
 * default every dispatch must satisfy).
 */
export function checkVocabularyDispatchEligibility(
  complexityTier: ComplexityTier,
  dispatchType: VocabularyDispatchType | undefined
): VocabularyEligibility {
  if (!dispatchType) return { eligible: true }
  if (complexityTier !== "mechanical") {
    return {
      eligible: false,
      reason: `responseVocabulary ("${dispatchType}") was declared, but this dispatch's complexity tier is "${complexityTier}", not "mechanical".`,
      guidance: `Constrained-vocabulary replies are only for genuinely simple mechanical-tier work. Either remove responseVocabulary and let this role reply freely, or re-scope the task down to "mechanical" if it truly is a one-file Yes/No, status, or approval check.`,
    }
  }
  return { eligible: true }
}
