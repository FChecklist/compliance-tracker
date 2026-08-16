// Phase 3 (Phase3_Design_by_Claude.md, structured-response contract +
// software-first gate decision). Both VERIDIAN.docx studies independently
// flagged the same drift: the document's golden rule is that the LLM
// should never talk to the user directly without a software layer between
// it and the UI, but chat-service.ts's generateAiReply() stores and
// renders callLLM()'s raw text completely verbatim.
//
// The full fix -- structured JSON output + a typed renderer instead of a
// text bubble -- is a genuinely large, cross-cutting rewrite (new system
// prompt, new parsing layer, new per-content-type React components, a
// migration story for every existing plain-text message) and is explicitly
// OUT OF SCOPE for this pass; see the design doc for why attempting it now
// would risk breaking the one AI-facing feature that's currently live.
//
// What ships instead is narrower and provable: this LLM call path has NO
// tool-calling capability (confirmed by reading generateAiReply() in full --
// the reply is only ever stored as a chat message, nothing else). That
// means the specific, real risk isn't unauthorized action (nothing the LLM
// says can execute anything) -- it's a HALLUCINATED CLAIM of completed
// action ("I've approved this" / "Payment has been submitted") when no such
// thing happened anywhere in the system, because the model has no tool to
// have actually done it. That's a narrow, high-precision pattern, distinct
// from Phase 2's detectHighImpactAction (which is tuned for USER-INTENT
// language like "delete this" -- reusing it on the assistant's own reply
// text would false-positive on completely legitimate informational
// sentences like "Your payment of Rs.5,000 was recorded on the 3rd").
import { z } from "zod"

export const aiReplyEnvelopeSchema = z.object({
  message: z.string(),
  confidence: z.enum(["high", "medium", "low"]).nullable(),
})
export type AiReplyEnvelope = z.infer<typeof aiReplyEnvelopeSchema>

const MAX_REPLY_CHARS = 8000

// Deliberately narrow: first-person + past-tense + a high-impact verb.
// Precision over recall on purpose -- a false positive here blocks a
// legitimate reply from ever reaching the user.
const FALSE_ACTION_CLAIM_PHRASES = [
  "i have deleted", "i've deleted",
  "i have approved", "i've approved",
  "i have rejected", "i've rejected",
  "i have paid", "i've paid", "i've made the payment", "i have made the payment",
  "i have submitted", "i've submitted",
  "i have filed", "i've filed",
  "i have granted access", "i've granted access",
  "i have revoked access", "i've revoked access",
  "i have archived", "i've archived",
]

export function detectFalseActionClaim(replyText: string): { detected: boolean; matchedPhrase?: string } {
  const lower = replyText.toLowerCase()
  const matchedPhrase = FALSE_ACTION_CLAIM_PHRASES.find((phrase) => lower.includes(phrase))
  return matchedPhrase ? { detected: true, matchedPhrase } : { detected: false }
}

export type AiReplyGateResult =
  | { passed: true }
  | { passed: false; reason: "empty_reply" | "reply_too_long" | "false_action_claim"; matchedPhrase?: string }

export function passesReplyGate(replyText: string): AiReplyGateResult {
  const trimmed = replyText.trim()
  if (trimmed.length === 0) {
    return { passed: false, reason: "empty_reply" }
  }
  if (trimmed.length > MAX_REPLY_CHARS) {
    return { passed: false, reason: "reply_too_long" }
  }
  const claim = detectFalseActionClaim(trimmed)
  if (claim.detected) {
    return { passed: false, reason: "false_action_claim", matchedPhrase: claim.matchedPhrase }
  }
  return { passed: true }
}
