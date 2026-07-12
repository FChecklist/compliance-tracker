// tree4-unified/10-merged-governance-layer.yaml U-D10.B4.S1: "VERI shall
// never: impersonate the user, modify intent, send to unauthorized
// recipients, forward confidential info without permission, escalate
// without approval, send external comms without permission; all
// VERI-initiated communications fully traceable and audit-logged." The
// tree's own note: this only becomes fully enforceable once the
// draft-then-send feature (U-D10.B3, GAP-06) exists -- see
// communication-drafting-service.ts, the first real caller.
//
// What's mechanically checkable TODAY, deterministically, before a drafted
// communication is ever allowed to send (no LLM self-grading, matching
// every other gate in this codebase -- high-impact-action-detector.ts,
// task-tightening.ts, etc.):
//   1. No unauthorized recipients -- every recipient must be a syntactically
//      valid email address. This can't catch "wrong but valid-looking"
//      recipients (that needs the approval step itself, which is the real
//      control), but it DOES catch malformed/empty/injected recipient data
//      before a send is even attempted.
//   2. Non-empty subject/body -- a "communication" with no real content is
//      not a communication VERI drafted, it's a bug; blocking it here is
//      cheaper than discovering it after a human already approved an empty
//      email.
//   3. Never claims to have already been sent -- a drafted body claiming
//      past-tense completion ("I have sent...", "this has been submitted")
//      before approval would be exactly the kind of hallucinated
//      action-completion claim ai-reply-gate.ts already blocks on the chat
//      surface; the same discipline applies here.
//
// Explicitly NOT checked here (honest limitation, not silently skipped):
// impersonation (email.ts has exactly one FROM address, platform-fixed --
// structural, not enforced by this check), forwarding confidential info
// without permission, and escalation-without-approval have no deterministic
// signal available from the draft's own fields alone. "Full audit trail" is
// satisfied by communication-drafting-service.ts's logActivity() calls at
// every state transition, not by this function.
export type CommunicationGuardrailResult =
  | { passed: true }
  | { passed: false; reason: string; guidance: string }

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

const FALSE_COMPLETION_PHRASES = [
  "i have sent",
  "i've sent",
  "this has been sent",
  "already sent",
  "has been submitted",
  "already submitted",
  "this email has been delivered",
]

export type DraftedCommunicationForGuardrailCheck = {
  recipientEmails: unknown
  subject: string | null | undefined
  body: string | null | undefined
}

/** Validates recipient email syntax -- deterministic, no LLM call. */
export function validateRecipients(recipientEmails: unknown): CommunicationGuardrailResult {
  if (!Array.isArray(recipientEmails) || recipientEmails.length === 0) {
    return {
      passed: false,
      reason: "no_recipients",
      guidance: "A drafted communication must name at least one recipient before it can be sent -- an empty recipient list is never a valid unauthorized-recipient state, it's a missing one.",
    }
  }
  for (const entry of recipientEmails) {
    if (typeof entry !== "string" || !EMAIL_REGEX.test(entry.trim())) {
      return {
        passed: false,
        reason: "malformed_recipient",
        guidance: `"${String(entry)}" is not a syntactically valid email address -- fix or remove it before this communication can be approved.`,
      }
    }
  }
  return { passed: true }
}

/** Content presence + no hallucinated past-tense "already sent" claims. */
export function validateContent(subject: string | null | undefined, body: string | null | undefined): CommunicationGuardrailResult {
  if (!subject?.trim() || !body?.trim()) {
    return {
      passed: false,
      reason: "empty_content",
      guidance: "A drafted communication must have a non-empty subject and body -- this looks like a failed or partial draft, not a real communication ready for review.",
    }
  }
  const lowerBody = body.toLowerCase()
  for (const phrase of FALSE_COMPLETION_PHRASES) {
    if (lowerBody.includes(phrase)) {
      return {
        passed: false,
        reason: "false_completion_claim",
        guidance: `The draft body claims this communication was already sent ("${phrase}") before it has even been approved -- this is a hallucinated completion claim and must be corrected before approval.`,
      }
    }
  }
  return { passed: true }
}

/** Combined check -- the single gate communication-drafting-service.ts calls before allowing a send (whether human-approved or auto-approved via preference). */
export function checkCommunicationGuardrails(draft: DraftedCommunicationForGuardrailCheck): CommunicationGuardrailResult {
  const recipientCheck = validateRecipients(draft.recipientEmails)
  if (!recipientCheck.passed) return recipientCheck
  return validateContent(draft.subject, draft.body)
}
