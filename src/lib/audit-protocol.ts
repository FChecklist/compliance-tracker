// ai-os/tree4-unified/10-merged-governance-layer.yaml, U-D2.B6.S1
// (confirmed_gap): "Every audit agent follows the same 3-phase protocol:
// Before (understand objective/review standards/load checklist/confirm
// scope/identify evidence), During (verify never assume/inspect/record/
// classify severity/link evidence), After (report/pass-fail/corrective
// actions/remediation ownership/schedule re-audit/update knowledge)."
//
// Confirmed absent by direct code search: chief_audit_officer's one real
// dispatch (task list #29) followed reasonable audit practice, but nothing
// enforces this specific 3-phase shape on any audit-role output --
// evaluateGuardrails() has no leaf for it (guardrail-registrations.ts).
//
// Shape follows handover-protocol.ts's precedent exactly: a small set of
// required structured fields (one 2-3 per phase, matching the requirement
// text's own named sub-steps), validated deterministically, no LLM call.
// Unlike an attempt to parse the SHAPE of an audit role's free-text LLM
// output (rejected -- see guardrail-engine.ts's own header for why a
// hand-authored, brittle content-shape check "would be a large, brittle,
// unscoped effort" for the same class of problem), this validates a
// SUBMISSION -- structured data an audit dispatch would supply once a real
// call site exists, the same posture qa-precompletion-gate.ts and
// closureReviewCheck already use for their own submissions.
//
// Honest scope note, not glossed over: like guardrail-engine.ts's own
// empty-registry precedent (FOLLOWUP-1) and handover-protocol.ts before
// this session wired it into /api/ai/team/dispatch, this module has NO
// live caller yet -- no dedicated "submit audit finding" endpoint exists
// in this codebase today. What ships is real, tested, additive
// infrastructure (registered as a genuine guardrail leaf, not just a
// comment), not a claim that every audit dispatch is enforced against it
// end-to-end. Wiring a real call site is future work once the Owner wants
// audit roles to submit structured findings instead of free text.

import { detectAmbiguousLanguage, type TightTaskValidation } from "./task-tightening"

/**
 * The requirement text's own named sub-steps, one field per phase where a
 * short narrative answer is meaningful. Field names mirror the spec's
 * "Before/During/After" framing directly so a reviewer can match each
 * field 1:1 against U-D2.B6.S1's requirement text.
 */
export type AuditProtocolFields = {
  // --- Before ---
  objectiveUnderstood: string
  standardsReviewed: string
  scopeConfirmed: string
  // --- During ---
  evidenceRecorded: string
  /** 'critical' | 'high' | 'medium' | 'low' | 'none' -- see VALID_SEVERITY. */
  severityClassified: string
  // --- After ---
  /** 'pass' | 'fail' -- see VALID_VERDICT. */
  verdict: string
  correctiveActionOwner: string
  reAuditScheduled: string
}

export type AuditProtocolValidation = TightTaskValidation

export const VALID_SEVERITY = ["critical", "high", "medium", "low", "none"] as const
export const VALID_VERDICT = ["pass", "fail"] as const

const MIN_FIELD_LENGTH = 8

// Mirrors handover-protocol.ts's JUNK_PATTERNS narrowing exactly, for the
// same reason: correctiveActionOwner and reAuditScheduled have a genuine
// real answer of "none"/"not required" (a passing audit has no corrective
// action and may not need a re-audit), unlike the Before/During fields,
// where "none" is always a placeholder, not a real audit finding.
const JUNK_PATTERNS = [
  /^(tbd|todo|xxx+|\.\.\.|fill.?in|same as (above|status|output))$/i,
  /^\s*$/,
]
const NONE_LIKE_PATTERN = /^(n\/?a|none|null|undefined|not required|not applicable)$/i

function isJunk(value: string, allowNoneLike: boolean): boolean {
  const trimmed = value.trim()
  if (JUNK_PATTERNS.some((p) => p.test(trimmed))) return true
  if (!allowNoneLike && NONE_LIKE_PATTERN.test(trimmed)) return true
  return false
}

function checkNarrativeField(value: string | undefined, label: string, guidanceExample: string, allowNoneLike: boolean): AuditProtocolValidation | null {
  const trimmed = (value ?? "").trim()
  if (!trimmed) {
    return { valid: false, reason: `${label} is missing.`, guidance: `Add a ${label} field. Example: "${guidanceExample}"` }
  }
  if (isJunk(trimmed, allowNoneLike)) {
    return { valid: false, reason: `${label} is a placeholder, not a real value ("${trimmed}").`, guidance: `Replace it with the actual ${label.toLowerCase()}. Example: "${guidanceExample}"` }
  }
  if (allowNoneLike && NONE_LIKE_PATTERN.test(trimmed)) return null
  if (trimmed.length < MIN_FIELD_LENGTH) {
    return { valid: false, reason: `${label} is too short to be actionable ("${trimmed}").`, guidance: `Be specific -- name the concrete standard/evidence/action, not just a category. Example: "${guidanceExample}"` }
  }
  const ambiguity = detectAmbiguousLanguage(trimmed)
  if (ambiguity.detected) {
    return {
      valid: false,
      reason: `${label} contains vague, unresolved language ("${ambiguity.matchedPhrase}").`,
      guidance: `Replace "${ambiguity.matchedPhrase}" with the actual finding -- "verify never assume" (the protocol's own During-phase rule) applies to how the audit is reported too.`,
    }
  }
  return null
}

function checkEnumField(value: string | undefined, label: string, validValues: readonly string[]): AuditProtocolValidation | null {
  const trimmed = (value ?? "").trim().toLowerCase()
  if (!trimmed) {
    return { valid: false, reason: `${label} is missing.`, guidance: `Set ${label} to one of: ${validValues.join(", ")}.` }
  }
  if (!validValues.includes(trimmed)) {
    return { valid: false, reason: `${label} ("${trimmed}") is not one of the recognized values.`, guidance: `Must be one of: ${validValues.join(", ")}.` }
  }
  return null
}

/**
 * Validates all 8 required audit-protocol fields (3 Before, 2 During, 3
 * After) are present and non-placeholder before an audit finding may be
 * recorded as protocol-compliant. Deterministic only, no LLM call,
 * matching every other gate in this codebase and mirroring
 * validateHandoverFields()'s exact shape.
 */
export function validateAuditProtocolFields(fields: Partial<AuditProtocolFields>): AuditProtocolValidation {
  const checks: Array<AuditProtocolValidation | null> = [
    checkNarrativeField(fields.objectiveUnderstood, "Objective Understood", "Verify GUARDRAIL_PLATFORM leaves are registered for every high-impact action category", false),
    checkNarrativeField(fields.standardsReviewed, "Standards Reviewed", "AGENTS.md Rule 9, VERIDIAN_TASK_GOVERNANCE_CONSTITUTION.md guardrail manifest", false),
    checkNarrativeField(fields.scopeConfirmed, "Scope Confirmed", "guardrail-registrations.ts and its registered leaves only, not the whole guardrail-engine.ts framework", false),
    checkNarrativeField(fields.evidenceRecorded, "Evidence Recorded", "4 of 9 named leaves have no corresponding test file entry, checked by grep against guardrail-registrations.test.ts", false),
    checkEnumField(fields.severityClassified, "Severity Classified", VALID_SEVERITY),
    checkEnumField(fields.verdict, "Verdict", VALID_VERDICT),
    checkNarrativeField(fields.correctiveActionOwner, "Corrective Action Owner", "chief_software_engineering_officer to add the missing test coverage", true),
    checkNarrativeField(fields.reAuditScheduled, "Re-Audit Scheduled", "Not required -- finding closed same session", true),
  ]
  for (const failure of checks) {
    if (failure) return failure
  }
  return { valid: true }
}
