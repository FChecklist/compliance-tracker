// Founder directive (2026-07-10): orgs that don't bring their own AI key
// run on the platform-default floor tier (GPT-OSS-120B via Groq --
// orchestra-model-resolver.ts's PLATFORM_DEFAULT_MODEL), chosen for speed/
// cost, not top-tier reasoning (~70% of GLM-5.2, ~50% of Claude Sonnet 5
// High per the founder's own benchmark framing). Per the 90-day quality
// mandate (AGENTS.md Operating Rule 8), cheap/fast is fine for genuinely
// low-stakes work, but specific signals should bump a single call up to a
// stronger model rather than silently accepting a floor-tier answer where
// it matters. Deterministic, regex-based -- no extra LLM call to decide
// this, matching this codebase's existing preference (see
// high-impact-action-detector.ts / ai-reply-gate.ts) for cheap deterministic
// gates over LLM classification wherever a gate needs to be reliable and
// fast. Reserved for floor-tier calls only: never overrides an org's own
// BYO model choice (callers must check `!isCustomerConfigured` first).

function toWordBoundaryRegex(phrase: string): RegExp {
  const escaped = phrase.trim().replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
  return new RegExp(`\\b${escaped}\\b`, "i")
}

// Pre-call signal 1: the user is correcting or re-asking VERI -- the prior
// floor-tier answer likely missed the mark. Only meaningful when there IS a
// prior AI turn to be correcting (empty history means this is a fresh
// conversation, not a correction).
const CORRECTION_PHRASES = [
  "that's wrong", "that's not right", "that's not what i", "not what i asked",
  "you misunderstood", "you're wrong", "incorrect", "try again",
  "that's not correct", "no, i meant", "no i meant", "that doesn't answer",
  "you didn't answer", "still wrong", "still not right",
]

export function detectReaskOrCorrection(userMessage: string, historyLength: number): { detected: boolean; matchedPhrase: string | null } {
  if (historyLength === 0) return { detected: false, matchedPhrase: null }
  const normalized = userMessage.trim()
  if (!normalized) return { detected: false, matchedPhrase: null }
  for (const phrase of CORRECTION_PHRASES) {
    if (toWordBoundaryRegex(phrase).test(normalized)) return { detected: true, matchedPhrase: phrase }
  }
  return { detected: false, matchedPhrase: null }
}

// Post-call signal: the floor tier's OWN reply hedges rather than actually
// answering -- a real, if imperfect, proxy for "this model wasn't confident
// enough to be trusted here." Deliberately checked against the reply text,
// not a model-reported confidence score -- Groq's chat completions response
// carries no such field, and asking the model to self-report confidence
// would be exactly the unreliable self-grading this design avoids (see the
// module header).
const LOW_CONFIDENCE_PHRASES = [
  "i'm not sure", "i am not sure", "i don't know", "i do not know",
  "i'm unable to determine", "i cannot determine", "unclear from",
  "i don't have enough information", "i do not have enough information",
  "it's hard to say", "it is hard to say", "i can't be certain",
  "i cannot be certain", "not entirely sure", "i might be wrong",
]

export function detectLowConfidenceResponse(replyText: string): { detected: boolean; matchedPhrase: string | null } {
  const normalized = replyText.trim()
  if (!normalized) return { detected: false, matchedPhrase: null }
  for (const phrase of LOW_CONFIDENCE_PHRASES) {
    if (toWordBoundaryRegex(phrase).test(normalized)) return { detected: true, matchedPhrase: phrase }
  }
  return { detected: false, matchedPhrase: null }
}

// Priority 5 (10-priority5-software-orchestrator-tracker.yaml): a 5th signal,
// distinct from the 4 reactive ones above -- "novel_capability" fires
// PROACTIVELY, before any floor-tier call is even attempted, when
// software-coverage-service.ts's classifyExecutionWithReliability()
// returns NOVEL (no approved instruction package exists for the matched
// capability, or none was matched at all). A floor-tier model reasoning
// freely on a genuinely uncovered gap is exactly the unreliable case this
// whole escalation mechanism exists to avoid -- see task-execution-engine.ts's
// executeTask() free-text branch and chat-service.ts's generateAiReply()
// for the two real call sites that set this signal instead of running
// checkPreCallEscalation()'s reactive checks first.
export type EscalationSignal = "reask_correction" | "prior_task_failure" | "high_impact" | "low_confidence" | "novel_capability"

export type PreCallEscalation = { shouldEscalate: boolean; signals: EscalationSignal[]; matchedPhrase: string | null }

/** Combines the 3 signals knowable BEFORE any LLM call. `low_confidence` is checked separately, after the floor-tier reply comes back -- see detectLowConfidenceResponse. */
export function checkPreCallEscalation(input: {
  userMessage: string
  historyLength: number
  isHighImpact: boolean
  priorTaskFailed: boolean
}): PreCallEscalation {
  const signals: EscalationSignal[] = []
  let matchedPhrase: string | null = null

  const correction = detectReaskOrCorrection(input.userMessage, input.historyLength)
  if (correction.detected) {
    signals.push("reask_correction")
    matchedPhrase = correction.matchedPhrase
  }
  if (input.isHighImpact) signals.push("high_impact")
  if (input.priorTaskFailed) signals.push("prior_task_failure")

  return { shouldEscalate: signals.length > 0, signals, matchedPhrase }
}
