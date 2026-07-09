// VERIDIAN.docx Study 1 Level 2 / Joint_Implementation_Plan.md Phase 2
// (z.ai-owned item): filler-word/phrase-normalization preprocessor.
//
// Before a user's chat message is sent to the LLM, strip conversational
// filler that doesn't change intent -- greetings, politeness, hedges,
// ways of addressing the AI, and meta-phrases like "I want you to". This
// reduces the token count leaving the tenant on every callLLM() call.
//
// IMPORTANT: the ORIGINAL message is still stored/shown to the user
// unchanged (the caller persists it before generateAiReply runs). Only the
// copy handed to callLLM is normalized. This is deterministic
// (regex/word-list based) -- never an LLM call.

// Words that change meaning and must NEVER be removed, even when they
// appear inside a filler-phrase match. Every candidate span is checked
// against this list before deletion; if any denylist word occurs in the
// span (as a whole word), the span is left intact.
//
// Note: this intentionally blocks two listed politeness fillers -- "may
// you" (contains "may") and "if possible" (contains "if") -- because the
// denylist takes precedence. That asymmetry is the intended conservative
// behaviour: it is better to under-strip than to alter permission/condition
// semantics.
const DENYLIST = [
  "not", "never", "don't", "except", "unless", "only", "without",
  "before", "after", "if", "else", "should", "must", "may", "all",
  "any", "every", "first", "last",
]

// Filler phrases safe to strip anywhere they occur as a whole phrase
// (case-insensitive, word-boundary anchored). Covers greetings/closings,
// politeness, conversational fillers, and meta-phrases.
const FILLER_PHRASES = [
  // Greetings / closings
  "hi", "hello", "hey", "good morning", "good afternoon", "good evening",
  "thanks", "thank you", "bye", "regards",
  // Politeness
  "please", "kindly", "would you", "could you", "can you", "may you", "if possible",
  // Conversational fillers
  "i think", "i believe", "i guess", "maybe", "perhaps", "actually",
  "basically", "literally", "honestly", "just", "simply", "really",
  "quite", "somewhat",
  // Meta-phrases
  "i want you to", "i need you to", "i would like you to", "help me",
  "tell me", "explain to me",
]

// Words that name/address the AI. These are stripped ONLY when a whole
// segment (the text between sentence delimiters [.,;!?] or string
// boundaries) consists of EXACTLY this word -- so "AI" inside
// "AI cognitive research" is never touched, but a standalone "hey VERI,"
// address is. Conservative by design: an address word embedded in a
// longer clause (e.g. "VERI do this" with no punctuation) is left alone.
const ADDRESS_WORDS = [
  "assistant", "veri", "dude", "chatgpt", "chat", "ai", "buddy", "friend",
]

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
}

// Does the matched span contain any denylist word as a whole word?
function spanContainsDenylistedWord(span: string): boolean {
  const lower = span.toLowerCase()
  return DENYLIST.some((w) => new RegExp(`\\b${escapeRegex(w)}\\b`).test(lower))
}

/**
 * Normalize a user chat message for LLM consumption: strip conversational
 * filler, collapse leftover whitespace, and never return an empty/near-empty
 * result (the original text is returned instead so an empty prompt is never
 * sent to the LLM).
 */
export function normalizeForLlm(text: string): string {
  if (!text) return text
  const original = text

  // --- Phase A: strip filler phrases (whole-phrase, case-insensitive) ---
  // Longest-first so multi-word phrases match before their sub-words.
  const phrases = [...FILLER_PHRASES].sort((a, b) => b.length - a.length)
  let working = text
  for (const phrase of phrases) {
    const re = new RegExp(`\\b${escapeRegex(phrase)}\\b`, "gi")
    working = working.replace(re, (match) =>
      // Refuse to delete a span carrying a meaning-changing word.
      spanContainsDenylistedWord(match) ? match : ""
    )
  }

  // --- Phase B: strip standalone AI-address words ---
  // Split on sentence delimiters, KEEPING the delimiters so we can rejoin
  // losslessly. A non-delimiter segment whose trimmed lowercased content is
  // exactly an address word is removed along with the single delimiter that
  // follows it (the comma/period that set off the address).
  const addressSet = new Set(ADDRESS_WORDS)
  const parts = working.split(/([.,;!?])/)
  const rebuilt: string[] = []
  for (let i = 0; i < parts.length; i++) {
    const part = parts[i]
    if (i % 2 === 1) {
      // delimiter segment -- keep (unless already consumed by the address
      // branch below, which skips ahead).
      rebuilt.push(part)
      continue
    }
    const trimmed = part.trim().toLowerCase()
    if (trimmed && addressSet.has(trimmed)) {
      // Drop this address segment AND consume the following delimiter
      // (if any) so we don't leave a stray comma/period behind.
      i++ // skip the next part (the delimiter)
      continue
    }
    rebuilt.push(part)
  }
  working = rebuilt.join("")

  // --- Phase C: collapse whitespace + tidy punctuation artifacts ---
  working = working
    .replace(/\s+/g, " ")
    .replace(/\s+([.,;!?])/g, "$1") // no space before punctuation
    .replace(/^[\s.,;!?]+/, "") // strip leading whitespace/punctuation
    .trim()

  // Never send an empty / near-empty prompt to the LLM. If nothing with a
  // word/digit character survived (e.g. the whole message was "hi thanks"),
  // return the original unmodified text.
  if (!working || !working.replace(/[^\w]/g, "").trim()) return original
  return working
}
