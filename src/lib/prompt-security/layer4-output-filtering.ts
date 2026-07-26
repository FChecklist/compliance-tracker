// VERIDIAN_Architecture_v2.0 phase_4: Layer 4 (Output Filtering and
// Monitoring) of the document's 4-layer defense-in-depth architecture (2.8)
// -- closes the output-filtering half of engine-defense-in-depth and
// pipeline-post-execution's guardrails sub-scope. Per the document's own
// description (line 497 of the extracted source): "This layer scrubs PII
// from model outputs using Microsoft Presidio (adapted for browser
// execution), detects and removes any leaked system instructions ... applies
// content moderation using Llama Guard 3 ..., and logs all outputs to the
// Audit Engine for compliance review."
//
// PII scrubbing here REUSES pii-redaction.ts (Wave 146, already the
// production-wired PII engine for orchestra_executions logging -- see
// src/app/api/help/ask/route.ts) instead of maintaining a second, divergent
// regex baseline: the phase_4 audit found the original version of this file
// had its own EMAIL/PHONE/CREDIT_CARD/SSN list that never referenced
// pii-redaction.ts and, worse, regressed on it -- missing that file's
// India-specific GSTIN/PAN/IFSC/Aadhaar coverage entirely, a real gap on a
// compliance platform whose primary market is India. SSN is the one
// genuinely new category kept here: pii-redaction.ts is India-focused and
// has no US SSN pattern of its own. Content moderation reuses layer3's
// evaluateWithLlamaGuard against the model's OUTPUT (the document's own
// "output-side guardrails" framing) rather than a second classifier.
import { findPii, redactPii } from "@/lib/pii-redaction"
import type { PiiMatch } from "./types"

// Two categories absent from pii-redaction.ts's India-focused pattern list --
// genuine additive gaps this layer still needs to cover, not duplicates of
// anything that file already does: a US SSN pattern (that file has none),
// and a US-format phone number (that file's PHONE pattern only matches
// India's +91/10-digit-starting-6-9 mobile format).
const SSN_PATTERN = /\b\d{3}-\d{2}-\d{4}\b/g
const US_PHONE_PATTERN = /\b(?:\+?1[-.\s]?)?\(?\d{3}\)?[-.\s]\d{3}[-.\s]\d{4}\b/g

// pii-redaction.ts's label vocabulary already matches this layer's PiiMatch
// "type" union 1:1 except CARD -> CREDIT_CARD.
const LABEL_TO_TYPE: Record<string, PiiMatch["type"]> = { CARD: "CREDIT_CARD" }

/** Detects + scrubs PII in model output text, delegating to pii-redaction.ts's shared engine (see this file's header) and adding only the SSN/US-phone categories that engine doesn't cover. */
export function scrubPii(text: string): { piiMatches: PiiMatch[]; scrubbedText: string } {
  const piiMatches: PiiMatch[] = findPii(text).map((m) => ({
    type: (LABEL_TO_TYPE[m.label] ?? m.label) as PiiMatch["type"],
    matchedText: m.matchedText,
  }))
  let scrubbedText = redactPii(text)
  scrubbedText = scrubbedText.replace(SSN_PATTERN, (match) => {
    piiMatches.push({ type: "SSN", matchedText: match })
    return "[REDACTED:SSN]"
  })
  scrubbedText = scrubbedText.replace(US_PHONE_PATTERN, (match) => {
    piiMatches.push({ type: "PHONE", matchedText: match })
    return "[REDACTED:PHONE]"
  })
  return { piiMatches, scrubbedText }
}

// Detects the model's output verbatim-echoing a hardened system-prompt
// delimiter or the instruction-hierarchy preamble text (layer2's own
// wording) -- a real signal of leaked system instructions, distinct from
// Layer 3's safety-classification concern.
const LEAK_SIGNALS = [/<system_instructions>/i, /<\/system_instructions>/i, /the <system_instructions> block below/i]

export function detectLeakedSystemInstruction(outputText: string): boolean {
  return LEAK_SIGNALS.some((pattern) => pattern.test(outputText))
}
