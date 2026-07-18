// VERIDIAN Review Framework gap-closure (2026-07-18), "AI Governance &
// Auditability" -- GP-06 (Knowledge), CONSTITUTION.yaml: "no 'do I have
// sufficient knowledge' self-check exists". Confirmed genuinely missing:
// buildDispatchSelfAssessment (qa-precompletion-gate.ts) derives every
// HandoverFields value from real signals (requiresAudit, riskLevel,
// lowConfidenceDetected) but none of them ask "did the executing role admit
// it lacked the knowledge to do this" -- a distinct failure mode from "the
// answer was hedged" (GP-09/floor-tier-escalation.ts's own
// detectLowConfidenceResponse, which fires on generic uncertainty language
// like "I'm not sure").
//
// Deliberately mirrors detectLowConfidenceResponse's exact shape and
// word-boundary-regex technique (floor-tier-escalation.ts) -- same
// deterministic, no-extra-LLM-call discipline, applied to a different,
// narrower phrase set: explicit admissions of missing KNOWLEDGE/ACCESS
// (e.g. "I don't have access to", "I'm not familiar with this codebase")
// rather than generic hedging about an answer already given.
function toWordBoundaryRegex(phrase: string): RegExp {
  const escaped = phrase.trim().replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
  return new RegExp(`\\b${escaped}\\b`, "i")
}

const KNOWLEDGE_GAP_PHRASES = [
  "i don't have access to", "i do not have access to",
  "i'm not familiar with", "i am not familiar with",
  "i have no information about", "i have no visibility into",
  "i don't have enough context", "i do not have enough context",
  "outside my knowledge", "beyond my knowledge",
  "i cannot verify this", "i can't verify this",
  "i have no way to confirm", "i have no way to check",
  "without access to the codebase", "without access to the repository",
  "i'm unable to inspect", "i am unable to inspect",
]

export type KnowledgeSufficiencyResult = { insufficientKnowledge: boolean; matchedPhrase: string | null }

/** Post-call signal, same posture as detectLowConfidenceResponse: checked against the executing role's OWN output text, never a model-reported self-grade (which would be exactly the unreliable self-grading this codebase's guardrail discipline avoids). */
export function detectKnowledgeGap(outputText: string): KnowledgeSufficiencyResult {
  const normalized = outputText.trim()
  if (!normalized) return { insufficientKnowledge: false, matchedPhrase: null }
  for (const phrase of KNOWLEDGE_GAP_PHRASES) {
    if (toWordBoundaryRegex(phrase).test(normalized)) return { insufficientKnowledge: true, matchedPhrase: phrase }
  }
  return { insufficientKnowledge: false, matchedPhrase: null }
}
