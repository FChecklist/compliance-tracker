// Owner directive 2026-07-21 (Audit198 gap closure, RCA_ERROR_HANDLING
// category): ARTICLE-029 "Every failure shall undergo Root Cause Analysis
// before closure" and ARTICLE-031 "No known defect shall be closed without
// documented verification" -- confirmed genuinely missing before writing
// anything: schema.ts's own `problemRecords` table (ITIL-style RCA
// grouping, added earlier for ticket-service.ts) already carries a
// `rootCause` text column, and `incidents` already carries `capaOwnerId`
// (corrective/preventive action owner) and a `stage` enum ending in
// 'closed' -- but ticket-service.ts's updateProblemRecord() and
// src/app/api/incidents/[id]/route.ts's PATCH action="advance" both let a
// record reach its terminal closed/resolved state with ZERO check that
// either field was ever actually populated (confirmed by direct read of
// both call sites, not assumed). A "known defect" (a problem record IS
// exactly that: a documented root cause of one or more real tickets) could
// be silently closed with a blank root cause, and an incident could be
// advanced straight to 'closed' with no owner ever assigned -- the precise
// failure shape both Articles exist to prevent.
//
// Deliberately mirrors task-tightening.ts's PLACEHOLDER_PATTERNS /
// checkField() shape and audit-protocol.ts's JUNK_PATTERNS -- same
// deterministic, no-LLM-call discipline as every other gate in this
// codebase, applied to a narrower, different closure surface. Not
// refactored into one shared module this pass (that would touch two
// already-tested, already-wired files with production callers for a
// cosmetic dedup win outside this gap's own scope) -- flagged as a real,
// distinct follow-up in this PR's own body instead of silently expanding
// scope here.
const JUNK_TEXT_PATTERNS = [
  /^(tbd|todo|n\/?a|none|null|undefined|xxx+|\.\.\.|fill.?in|unknown|pending|wip)$/i,
  /^\s*$/,
]
const MIN_ROOT_CAUSE_LENGTH = 10

function isRealDocumentedText(value: string | null | undefined): boolean {
  const trimmed = (value ?? "").trim()
  if (!trimmed) return false
  if (JUNK_TEXT_PATTERNS.some((p) => p.test(trimmed))) return false
  return trimmed.length >= MIN_ROOT_CAUSE_LENGTH
}

export type ClosureGateResult =
  | { allowed: true }
  | { allowed: false; reason: string; guidance: string }

/**
 * ARTICLE-029 / ARTICLE-031: a problem record (this codebase's "known
 * defect" -- a documented root cause of one or more tickets, ticket-
 * service.ts's own header) may only move to status "resolved" once a real,
 * non-placeholder root cause is on record -- either already stored, or
 * supplied in the same patch that resolves it. `resolvedRootCause` is
 * whichever value WOULD be effective after the patch (existing.rootCause,
 * overridden by patch.rootCause when the caller supplied one) -- the
 * caller resolves that merge, this function only judges the result, same
 * separation of concerns as checkFilesWithinDeclaredScope() in
 * task-tightening.ts.
 */
export function checkProblemRecordClosure(patch: { status?: string }, resolvedRootCause: string | null | undefined): ClosureGateResult {
  if (patch.status !== "resolved") return { allowed: true }
  if (isRealDocumentedText(resolvedRootCause)) return { allowed: true }
  return {
    allowed: false,
    reason: "Problem record cannot be marked resolved without a documented root cause.",
    guidance: `Add a rootCause of at least ${MIN_ROOT_CAUSE_LENGTH} characters describing the actual underlying cause (not a placeholder like "TBD"/"unknown") before this problem record can be closed -- see ARTICLE-029/ARTICLE-031.`,
  }
}

/**
 * ARTICLE-028 "Every incident shall have an owner until closure" /
 * ARTICLE-030 "Every Root Cause shall generate either a preventive action,
 * software enhancement..." -- an incident may only advance to the terminal
 * 'closed' stage once a CAPA (corrective/preventive action) owner has been
 * assigned. `resolvedCapaOwnerId` is the value that would be effective
 * after this update (existing.capaOwnerId, overridden by an in-flight
 * patch when the caller sets one alongside the stage advance) -- same
 * merge-then-judge separation as checkProblemRecordClosure above.
 */
export function checkIncidentClosure(nextStage: string, resolvedCapaOwnerId: string | null | undefined): ClosureGateResult {
  if (nextStage !== "closed") return { allowed: true }
  if ((resolvedCapaOwnerId ?? "").trim().length > 0) return { allowed: true }
  return {
    allowed: false,
    reason: "Incident cannot be closed without a CAPA (corrective/preventive action) owner assigned.",
    guidance: "Set capaOwnerId to the person/role responsible for the corrective/preventive action before advancing this incident to 'closed' -- see ARTICLE-028/ARTICLE-030.",
  }
}
