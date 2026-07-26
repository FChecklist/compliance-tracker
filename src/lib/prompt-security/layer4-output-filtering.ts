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
// PII scrubbing here is a deterministic regex baseline, NOT Presidio --
// ai-os/VERIDIAN_V2_DEFENSE_IN_DEPTH_TOOL_EVALUATION_2026-07-26.yaml's
// presidio row explains why (real, pip-installable, session-confirmed
// working, but a genuine "browser-adapted" build is phase_5/phase_6 scope,
// and its 400MB spaCy model is a real server-deployment-footprint concern
// not resolved this pass). Content moderation reuses layer3's
// evaluateWithLlamaGuard against the model's OUTPUT (the document's own
// "output-side guardrails" framing) rather than a second classifier.
import type { PiiMatch } from "./types"

// Deliberately simple, high-precision patterns -- a false negative here
// (PII this regex misses) is a real, honestly-scoped gap (see the tool
// evaluation doc's presidio row for the Named Entity Recognition coverage
// this regex baseline does NOT have, e.g. names/addresses); a false
// positive only over-redacts, never under-protects.
const PII_PATTERNS: { type: PiiMatch["type"]; pattern: RegExp }[] = [
  { type: "EMAIL", pattern: /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g },
  { type: "SSN", pattern: /\b\d{3}-\d{2}-\d{4}\b/g },
  { type: "CREDIT_CARD", pattern: /\b(?:\d[ -]*?){13,16}\b/g },
  { type: "PHONE", pattern: /\b(?:\+?1[-.\s]?)?\(?\d{3}\)?[-.\s]\d{3}[-.\s]\d{4}\b/g },
]

const REDACTION_TOKEN: Record<PiiMatch["type"], string> = {
  EMAIL: "[REDACTED_EMAIL]",
  PHONE: "[REDACTED_PHONE]",
  SSN: "[REDACTED_SSN]",
  CREDIT_CARD: "[REDACTED_CARD]",
}

/** Detects + scrubs PII in model output text. Order matters: EMAIL first so a digit-run inside an email local-part (e.g. "j.smith2024@...") can't later be mis-matched as a credit-card/phone number. */
export function scrubPii(text: string): { piiMatches: PiiMatch[]; scrubbedText: string } {
  const piiMatches: PiiMatch[] = []
  let scrubbedText = text
  for (const { type, pattern } of PII_PATTERNS) {
    scrubbedText = scrubbedText.replace(pattern, (match) => {
      piiMatches.push({ type, matchedText: match })
      return REDACTION_TOKEN[type]
    })
  }
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
