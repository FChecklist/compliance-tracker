// Wave 149 (Phase4_Implementation_Plan.md, "Intent Engine v1"). Both
// VERIDIAN.docx studies independently flagged this as the single biggest
// missing piece -- nearly every "software vs. AI routing" decision the
// document describes depends on classifying what a user actually wants
// before deciding how to handle it. `high-impact-action-detector.ts`'s own
// header comment explicitly calls out its keyword-regex approach as a
// stand-in for this Intent Engine -- this file is the real thing, same
// deterministic word-boundary-regex approach (matching this codebase's
// established preference for cheap, reliable, non-bypassable gates over
// LLM classification wherever a gate needs to be unconditionally reliable).
//
// v1 covers a defensible starter set of intents that Wave 150's routing
// gate can act on -- NOT the document's "100,000+ intent definitions"
// vision, correctly out of scope per GapAnalysis_by_Claude.md's own P5
// framing. Unmatched text returns "unknown" and falls through to existing
// behavior unchanged -- purely additive, zero regression risk.

export type Intent =
  | "create_task" | "check_status" | "create_contact" | "generate_report" | "unknown"

const TRIGGERS: Record<Exclude<Intent, "unknown">, string[]> = {
  create_task: ["create a task", "add a task", "new task", "remind me to", "give me a task", "assign a task"],
  // Wave 149 audit fix (AUDIT_wave149_claude_items.md, z.ai CONCERN): "how
  // is" on its own fires on completely unrelated everyday phrasing ("How
  // is your day going?", "How is the weather?") -- narrowed to "how is the
  // status" / "how is it going" so it stays scoped to an actual status
  // question rather than matching any "how is ..." sentence.
  check_status: ["what's the status", "check status", "check the status", "is this done", "how is the status", "how is it going", "status of", "what is the status"],
  create_contact: ["add a customer", "add a contact", "new customer", "new contact", "add a client", "create a customer", "create a contact"],
  generate_report: ["generate a report", "create a report", "show me a report", "summarize this week", "summarise this week", "give me a summary"],
}

export type IntentClassification = { intent: Intent; confidence: "high" | null; matchedPhrase: string | null }

function toWordBoundaryRegex(phrase: string): RegExp {
  const escaped = phrase.trim().replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
  return new RegExp(`\\b${escaped}\\b`, "i")
}

/** Deterministic, case-insensitive phrase match -- no LLM call. */
export function classifyIntent(text: string): IntentClassification {
  const normalized = text.trim()
  if (!normalized) return { intent: "unknown", confidence: null, matchedPhrase: null }

  for (const [intent, phrases] of Object.entries(TRIGGERS) as [Exclude<Intent, "unknown">, string[]][]) {
    for (const phrase of phrases) {
      if (toWordBoundaryRegex(phrase).test(normalized)) {
        return { intent, confidence: "high", matchedPhrase: phrase.trim() }
      }
    }
  }
  return { intent: "unknown", confidence: null, matchedPhrase: null }
}

export const INTENT_LABELS: Record<Intent, string> = {
  create_task: "Create Task",
  check_status: "Check Status",
  create_contact: "Create Contact",
  generate_report: "Generate Report",
  unknown: "Unknown",
}
