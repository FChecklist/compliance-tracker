// Wave 146 (VERIDIAN.docx joint implementation plan, Phase 2): PII redaction
// for LLM-call content logging, added as a direct follow-up to z.ai's audit
// of Wave 144 (AUDIT_wave144.md) -- Wave 144 started storing full
// systemPrompt/userMessage/reply text in orchestra_executions for
// explainability, which the auditor correctly flagged as unredacted.
//
// Design decisions (this file is the "real design pass" the plan called
// for, not a Phase-1-sized patch):
// - REDACT-AT-WRITE, not redact-at-read: the raw text should never be
//   persisted at all, so there's nothing to leak even if RLS were ever
//   misconfigured on this table in the future -- matches this codebase's
//   general deterministic-first, fail-safe-by-default posture.
// - Deterministic regex-based, no LLM call -- consistent with every other
//   validation/detection utility in this codebase (see
//   src/lib/engines/data-quality-engine.ts's PAN/GSTIN/IFSC/email/phone
//   validators, which this file's patterns are format-consistent with,
//   though not directly reusable: those are ANCHORED whole-field
//   validators (^...$), this needs to find matches embedded anywhere
//   inside free-flowing chat text).
// - Retention policy is explicitly OUT OF SCOPE for this pass:
//   orchestra_executions is a durable audit-log table (unlike
//   llmResponseCache's 24h-TTL purge loop), and redacting PII at write
//   time is the higher-leverage fix -- a retention/purge policy for the
//   table as a whole is a separate decision or add.
// - Conservative over exhaustive: covers the PII categories most likely to
//   appear in a business chat (contact info + Indian government ID
//   numbers, given this platform's domain), not a general-purpose PII
//   scrubber. False negatives are possible; over-redaction (masking
//   something that wasn't really PII) is the safer failure mode than
//   under-redaction, so patterns lean permissive.

const PATTERNS: { label: string; regex: RegExp }[] = [
  // Same 15-char structure as data-quality-engine.ts's GSTIN_FORMAT_REGEX,
  // unanchored for in-text matching. Checked before PAN since a GSTIN
  // contains a valid PAN as a substring (chars 3-12) -- matching GSTIN
  // first consumes the whole 15 chars instead of leaving a dangling PAN-
  // shaped remainder.
  { label: "GSTIN", regex: /\b[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z]{1}[1-9A-Z]{1}Z[0-9A-Z]{1}\b/g },
  // Same structure as PAN_REGEX in data-quality-engine.ts, unanchored.
  { label: "PAN", regex: /\b[A-Z]{5}[0-9]{4}[A-Z]\b/g },
  // Same structure as IFSC_REGEX in data-quality-engine.ts, unanchored.
  { label: "IFSC", regex: /\b[A-Z]{4}0[A-Z0-9]{6}\b/g },
  // Credit/debit card-shaped runs: 13-19 digits, optionally grouped by
  // spaces or dashes every 4 -- deliberately broad (better to over-redact
  // a false positive than miss a real card number). MUST run before
  // AADHAAR below: a real bug caught during manual testing -- a 16-digit
  // card number written as 4 space-separated groups ("4111 1111 1111
  // 1111") let AADHAAR's shorter 4-4-4 pattern greedily consume the FIRST
  // 12 digits before CARD ever got a chance to match the full run, leaving
  // "[REDACTED:AADHAAR] 1111" -- a real card number half-redacted in
  // plain text. Longer/more-specific patterns must be tried first.
  { label: "CARD", regex: /\b\d(?:[\s-]?\d){12,18}\b/g },
  // Aadhaar: 12 digits, conventionally written as 4-4-4 with spaces or
  // dashes (e.g. "1234 5678 9012") or run together.
  { label: "AADHAAR", regex: /\b\d{4}[\s-]?\d{4}[\s-]?\d{4}\b/g },
  // Email -- standard practical pattern (not RFC 5322 exhaustive; this
  // codebase's isValidEmail() uses the `validator` package for real
  // validation elsewhere, which isn't suited to in-text scanning).
  { label: "EMAIL", regex: /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g },
  // Indian mobile numbers: optional +91/91 prefix, 10 digits starting 6-9.
  { label: "PHONE", regex: /\b(?:\+?91[\s-]?)?[6-9]\d{9}\b/g },
]

/** Deterministic, regex-based -- no LLM call. Order matters (see comments above). */
export function redactPii(text: string): string {
  if (!text) return text
  let result = text
  for (const { label, regex } of PATTERNS) {
    result = result.replace(regex, `[REDACTED:${label}]`)
  }
  return result
}
