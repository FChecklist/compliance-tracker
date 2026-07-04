// Wave 46 -- VERIDIAN AI Constitution, Policy Enforcement Engine.
// See VERIDIAN_AI_CONSTITUTION.md for the full governance document this
// implements. This is the "hard, server-enforced" half of the same
// belt-and-suspenders discipline purpose-bound-ai.ts (Wave 17) already
// established for tool/domain restriction -- extended here to cover the
// two gaps that discipline didn't: free-text business-purpose scoping
// (Constitution §3-4) and prompt-injection/jailbreak resistance (§18).
// Deliberately a DETERMINISTIC keyword/pattern gate, not an LLM-based
// classifier -- for the same reason purpose-bound-ai.ts gave for its own
// hard allowlist: it "never depends on the model actually honoring the
// prompt," and (unlike an LLM classifier) costs nothing, adds no latency,
// and cannot itself be prompt-injected.
//
// This is a PRE-CALL gate: every real LLM call site must invoke
// enforcePolicy() and check `.allowed` BEFORE calling callLLM/callLLMJson/
// callLLMVision. A denied request never reaches any model, any provider,
// or costs any tokens -- the refusal is returned directly to the user.
import { isKnownDomain, DEFAULT_DOMAIN } from "@/lib/purpose-bound-ai"
import { recordOrchestraExecution } from "@/lib/orchestra-execution-logger"

export type PolicyCategory = "personal_use" | "prompt_injection" | "out_of_domain" | "ok"

export type PolicyDecision = {
  allowed: boolean
  category: PolicyCategory
  reason?: string
}

// Constitution §4 "No Personal AI Usage" -- the document's own named
// examples, turned into patterns. Deliberately conservative (word-boundary
// matches on distinctive terms) to minimize false-positives against
// legitimate business language that happens to share a word.
const PERSONAL_USE_PATTERNS: RegExp[] = [
  /\bhoroscopes?\b/i, /\bastrology\b/i, /\btarot\b/i, /\bdream interpretation\b/i,
  /\btell (me |us )?a joke\b/i, /\bmake me laugh\b/i,
  /\bwrite (me |us )?a (short )?story\b/i, /\bwrite (me |us )?(a )?poem\b/i,
  /\b(flipkart|amazon\.(com|in))\b/i, /\bbuy me\b/i, /\bshopping list\b/i, /\badd to (my )?cart\b/i,
  /\bholiday (plan|itinerary|planning)\b/i, /\bvacation (plan|itinerary)\b/i,
  /\bdating (app|advice|profile)\b/i, /\btinder\b/i, /\bhinge\b/i,
  /\bmeme\b/i, /\bpersonal social media\b/i,
  /\b(my|personal) homework\b/i, /\bplay (a |the )?game with me\b/i, /\blottery numbers\b/i,
  /\bpersonal financial advice\b/i, /\bshould i invest my (own |personal )?(money|savings)\b/i,
  /\brecipe for\b/i, /\bcook(ing)? (me |us )?(dinner|a meal)\b/i,
]

// Constitution §18 "Prompt Security" -- common jailbreak/injection phrasings.
const PROMPT_INJECTION_PATTERNS: RegExp[] = [
  /ignore (all |any |the )?(previous|prior|above|earlier) instructions?/i,
  /disregard (all |any |the )?(previous|prior|above) (instructions?|rules?|prompts?)/i,
  /reveal (your |the )?(system prompt|hidden instructions?|internal instructions?|initial instructions?)/i,
  /what (is|was) your (system prompt|initial instructions?)/i,
  /show me your (instructions?|prompt|configuration)/i,
  /disable (the )?guardrails?/i, /bypass (the )?(polic(y|ies)|guardrails?|restrictions?)/i,
  /you are now (in )?(dan|developer mode|unrestricted|jailbroken)/i,
  /pretend (you are|to be) (an? )?(admin|administrator|unrestricted|different ai)/i,
  /act as if (you have no|there are no) (restrictions?|rules?|guardrails?)/i,
  /forget (you are|your) (restrictions?|guidelines?|instructions?)/i,
]

/** Constitution §4 -- is this request a personal/non-business use, not a legitimate enterprise task? */
export function classifyBusinessPurpose(text: string): PolicyDecision {
  for (const pattern of PERSONAL_USE_PATTERNS) {
    if (pattern.test(text)) {
      return { allowed: false, category: "personal_use", reason: `Matched personal-use pattern: ${pattern.source}` }
    }
  }
  return { allowed: true, category: "ok" }
}

/** Constitution §18 -- is this an attempt to override/reveal/disable the platform's own instructions? */
export function checkPromptInjection(text: string): PolicyDecision {
  for (const pattern of PROMPT_INJECTION_PATTERNS) {
    if (pattern.test(text)) {
      return { allowed: false, category: "prompt_injection", reason: `Matched prompt-injection pattern: ${pattern.source}` }
    }
  }
  return { allowed: true, category: "ok" }
}

/** Constitution §5 -- is this domain even a real, known business domain on the platform? */
export function checkDomainValidity(domain: string): PolicyDecision {
  if (!isKnownDomain(domain)) {
    return { allowed: false, category: "out_of_domain", reason: `Unknown domain: ${domain}` }
  }
  return { allowed: true, category: "ok" }
}

export type PolicyEnforcementContext = {
  orgId: string
  userId?: string
  clientId?: string
  domain?: string // defaults to DEFAULT_DOMAIN if omitted
  layerKey: string // which orchestra layer this request is destined for, for logging
  eventType: string // e.g. "chat.ai_thread_reply", "fde.evaluate_request" -- for logging
}

/**
 * The single pre-call gate. Combines all 3 checks (business purpose,
 * prompt injection, domain validity), and -- whether allowed or denied --
 * logs the decision via the existing orchestraExecutions table (Wave 22/23
 * observability infra, no new table). A denial is logged with status
 * "denied" and zero cost (no LLM was ever called); an allow is NOT logged
 * here (the caller's own subsequent recordOrchestraExecution() call after
 * the real LLM call already covers that -- this function only logs the
 * cases where nothing else would have).
 */
export function enforcePolicy(ctx: PolicyEnforcementContext, userMessage: string): PolicyDecision {
  const domain = ctx.domain ?? DEFAULT_DOMAIN

  const domainCheck = checkDomainValidity(domain)
  const injectionCheck = checkPromptInjection(userMessage)
  const purposeCheck = classifyBusinessPurpose(userMessage)

  const decision = !domainCheck.allowed ? domainCheck : !injectionCheck.allowed ? injectionCheck : purposeCheck

  if (!decision.allowed) {
    recordOrchestraExecution({
      orgId: ctx.orgId, userId: ctx.userId, clientId: ctx.clientId,
      layerKey: ctx.layerKey, eventType: ctx.eventType,
      input: { userMessage: userMessage.slice(0, 500) },
      output: { policyDenied: true, category: decision.category, reason: decision.reason },
      status: "denied", durationMs: 0,
    })
  }

  return decision
}

/** User-facing refusal text -- polite, explains scope, never echoes the denylist pattern that matched. */
export function refusalMessageFor(decision: PolicyDecision): string {
  switch (decision.category) {
    case "personal_use":
      return "VERIDIAN AI is an enterprise platform scoped to authorized business activities for your organisation. I can't help with personal or recreational requests -- happy to help with anything work-related instead."
    case "prompt_injection":
      return "I can't override my operating instructions or reveal internal configuration. I'm glad to help with any legitimate business task within my scope."
    case "out_of_domain":
      return "This request falls outside the business domain this assistant is authorized for. Please contact your administrator if you believe this should be enabled."
    default:
      return "I can't help with that request."
  }
}

// User/admin-facing short label for a policy decision -- kept deliberately
// gentle (never the word "denied") for anywhere this surfaces in the UI
// (e.g. a request-history badge). The internal orchestraExecutions.status
// value stays the precise, technical "denied" -- that's an audit/compliance
// record for admins, not end-user copy, and accuracy matters more there.
export function policyDecisionDisplayLabel(category: PolicyCategory): string {
  switch (category) {
    case "personal_use":
    case "out_of_domain":
      return "Not Part of Work"
    case "prompt_injection":
      return "Not Permitted"
    case "ok":
      return "Approved"
  }
}
