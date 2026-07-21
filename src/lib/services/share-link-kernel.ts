// src/lib/services/share-link-kernel.ts
//
// audit198 RULE-053 gap closure (wave 6, SHARING_SECURITY category).
//
// This codebase already had TWO independent, hand-verified implementations
// of the exact same "tokenized, time-limited, individually-revocable
// public share link" shape before this file existed:
//   - conversationShareLinks (Wave 36, src/lib/db/schema.ts)
//   - veriMeetingShareLinks (Wave 44, src/lib/db/schema.ts)
// Both inline the same two-line validity check (`!link || link.revokedAt
// || link.expiresAt < new Date()`) at their own call site instead of
// sharing it. Adding a THIRD copy for report_share_links (this wave) would
// be the third duplication of identical logic -- AI_ENGINEERING_POLICY.yaml
// is explicit that wrappers/reuse beat duplication, so this file factors
// the pure evaluation rule out once, and report-share-service.ts (the new
// consumer) uses it. The two pre-existing services are NOT modified here
// (out of this wave's scope, and each already works correctly) -- but any
// future share-link table can now import this instead of inlining a
// fourth copy.
export type ShareLinkStatus = "valid" | "expired" | "revoked"

export interface ShareLinkValidityFields {
  expiresAt: Date
  revokedAt: Date | null
}

/**
 * Pure -- no I/O, no clock of its own (matches invite-link-service.ts's
 * evaluateInviteLinkStatus convention exactly, the third such pure
 * evaluator in this codebase and the one this file is most directly
 * modeled on). Order matters: a revoked link reports "revoked" even past
 * its own expiry, since that's the more specific, more likely intentional
 * admin action.
 */
export function evaluateShareLinkStatus(row: ShareLinkValidityFields, now: Date): ShareLinkStatus {
  if (row.revokedAt) return "revoked"
  if (row.expiresAt.getTime() <= now.getTime()) return "expired"
  return "valid"
}

export function isShareLinkValid(row: ShareLinkValidityFields, now: Date = new Date()): boolean {
  return evaluateShareLinkStatus(row, now) === "valid"
}
