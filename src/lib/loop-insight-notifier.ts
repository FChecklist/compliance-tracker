// Super Boss v2 task V2-9 (CSV row #18, "Suggests Process Improvements
// conversationally"): the loops subsystem has been capturing real findings
// into `loop_improvements` via proposeLoopImprovement() since Wave 146, but
// nothing ever surfaced those proposals to the humans who could act on them
// -- they sat in the table, invisible. This is the notification-emission
// hook that closes that gap, reusing the existing `notifications` channel
// (the same table + topbar bell instruction-mismatch-audit.ts /
// task-nudge-digest-service.ts / cost-guard.ts all write to) rather than
// inventing a new delivery surface.
//
// Reuse discipline (Tier1, additive, no schema change):
//   - `notificationTypeEnum` is a closed 7-value Postgres enum
//     (schema.ts:20). Adding an `insight`/`loop_insight` value would need an
//     ALTER TYPE migration -- the same class the schema's own auditLogs
//     comment (schema.ts:596+) warns doesn't scale and is exactly why
//     auditLogs.action was made free-text. So we reuse `type: "system"` and
//     discriminate via `metadata.kind: "loop_insight"`, the same precedent
//     task-nudge-digest-service.ts set with `metadata.kind:
//     "task_nudge_digest"`.
//   - The `notifications` table is single-recipient (userId notNull, no
//     audience/role column) -- to surface a loop insight to N affected users
//     we write N rows, the same per-user fan-out task-nudge-digest-service.ts
//     uses (its lines 104-120).
//
// Human-gated by construction, matching every loop's existing read-only
// posture: this only WRITES A NOTIFICATION (an unread nudge in the topbar),
// it never sets isDeployed=true on the proposal and never changes any org's
// config. Same line proposeLoopImprovement() already holds.
import { db, loopImprovements, notifications, users } from "@/lib/db"
import { and, eq, inArray } from "drizzle-orm"
import type { LoopImprovementProposal } from "@/lib/loop-improvement-proposer"

// The platform Owner -- the single human audience for a `targetType:
// "platform"` insight (a platform-level code/config review no single org's
// admin can act on). Sourced from AGENTS.md's own authorized-owner record,
// not a guess. A `platform` insight with no matching active Owner row simply
// surfaces to no one (the proposal row still exists in loop_improvements for
// anyone querying the table directly) -- we never fall back to spamming a
// random org's admin about a platform-level finding.
const PLATFORM_OWNER_EMAIL = "raajat.agarwal@gmail.com"

// Org-scoped audience for an org-targeted insight: the roles that can
// actually act on a config change (raise a floor-tier default, etc.). Same
// role set cost-guard.ts:119 already targets for its spend-breach notices --
// admin + manager, deliberately not the whole org (no point nudging a
// viewer about a model-tier change they can't touch).
const ORG_ACTIONABLE_ROLES = ["admin", "manager", "veridian_admin"] as const

export type RenderedLoopInsight = {
  title: string
  message: string
  metadata: {
    kind: "loop_insight"
    loopId: string
    improvementType: string
    targetType: string
    targetId: string | null
    improvementDelta: string | null
  }
}

/**
 * Pure: render a loop improvement proposal into the title/message/metadata
 * shape the `notifications` table expects. No DB, no side effects --
 * separated from notifyLoopInsight() so the rendering is unit-testable
 * directly (same discipline as task-nudge-digest-service.ts's
 * summarizeNudgeGroup()).
 *
 * The message is deliberately conversational ("VERIDIAN noticed ... and
 * suggests ..."), matching CSV row #18's "Suggests Process Improvements
 * conversationally" framing -- the insight surfaces as a suggestion, not a
 * raw row dump, and never as an autonomous action ("suggests", never
 * "changed" / "will change").
 */
export function summarizeLoopInsight(proposal: LoopImprovementProposal): RenderedLoopInsight {
  const target = describeTarget(proposal.targetType, proposal.targetId)
  const delta =
    proposal.improvementDelta != null
      ? ` (signal strength: ${proposal.improvementDelta})`
      : ""
  return {
    title: `Process improvement suggested: ${humanImprovementType(proposal.improvementType)}`,
    message: `VERIDIAN noticed ${target} and suggests a review.${delta} Open the improvement to decide whether to apply it.`,
    metadata: {
      kind: "loop_insight",
      loopId: proposal.loopId,
      improvementType: proposal.improvementType,
      targetType: proposal.targetType,
      targetId: proposal.targetId ?? null,
      improvementDelta: proposal.improvementDelta != null ? String(proposal.improvementDelta) : null,
    },
  }
}

function humanImprovementType(improvementType: string): string {
  // Map the snake_case improvementType loops already emit to a readable
  // label. Unknown types fall through to the raw value -- no information
  // loss, just less polished.
  const labels: Record<string, string> = {
    raise_floor_tier_default: "raise default AI model tier",
    review_escalation_signal_coverage: "review escalation signal coverage",
    fix_tier_scoping_mismatch: "fix agent tier scoping",
    revoke_stale_api_key: "revoke a stale API key",
    revoke_stale_mcp_code: "revoke a stale MCP access code",
  }
  return labels[improvementType] ?? improvementType.replace(/_/g, " ")
}

function describeTarget(targetType: string, targetId: string | null | undefined): string {
  switch (targetType) {
    case "org":
      return targetId ? `an org (${targetId}) whose AI calls keep tripping floor-tier escalation` : "an org whose AI calls keep tripping floor-tier escalation"
    case "platform":
      return "a platform-level pattern in escalation-signal coverage"
    case "worker_agent":
      return targetId ? `an agent (${targetId}) whose tier scoping doesn't match its access columns` : "an agent whose tier scoping doesn't match its access columns"
    case "api_key":
      return targetId ? `a stale API key (${targetId})` : "a stale API key"
    case "mcp_access_code":
      return targetId ? `a stale MCP access code (${targetId})` : "a stale MCP access code"
    default:
      return `a ${targetType}${targetId ? ` (${targetId})` : ""}`
  }
}

/**
 * Pure: what KIND of audience does this proposal's targetType imply? Kept
 * separate from resolveInsightRecipients (which does the DB lookup) so the
 * targeting decision is unit-testable without a live users table -- same
 * split as task-nudge-digest-service.ts's groupTasksForNudge (pure) vs
 * runTaskNudgeDigest (DB).
 *
 *   - "org"       -> org-scoped admin/manager/veridian_admin audience
 *   - "platform"  -> the single platform Owner
 *   - "none"      -> infra-level finding (worker_agent / api_key /
 *                    mcp_access_code / unknown) with no human recipient
 */
export function audienceKindForTarget(targetType: string): "org" | "platform" | "none" {
  if (targetType === "org") return "org"
  if (targetType === "platform") return "platform"
  return "none"
}

/**
 * Resolve which human users should be notified about a given proposal.
 * Returns user ids (never the rows themselves -- the caller only needs ids
 * to fan out notification writes).
 *
 * Targeting rules (grounded in the targetType values the loops actually
 * emit -- see byo-model-audit.ts / tier-integrity-audit.ts /
 * api-token-audit.ts):
 *   - org           -> that org's admin/manager/veridian_admin users (the
 *                     roles who can act on a config change).
 *   - platform      -> the platform Owner only.
 *   - worker_agent / api_key / mcp_access_code -> []: infra-level findings
 *                     with no clear human recipient. They stay recorded in
 *                     loop_improvements for anyone querying the table; we
 *                     don't fabricate an audience.
 *
 * Never throws -- a DB error resolves to [] (the proposal row still
 * exists; a notification is a nudge, not a correctness-critical write).
 */
export async function resolveInsightRecipients(
  proposal: LoopImprovementProposal
): Promise<string[]> {
  const kind = audienceKindForTarget(proposal.targetType)
  try {
    if (kind === "org" && proposal.targetId) {
      const rows = await db.query.users.findMany({
        where: and(eq(users.orgId, proposal.targetId), eq(users.isActive, true), inArray(users.role, [...ORG_ACTIONABLE_ROLES])),
        columns: { id: true },
      })
      return rows.map((r) => r.id)
    }
    if (kind === "platform") {
      const owner = await db.query.users.findFirst({
        where: and(eq(users.email, PLATFORM_OWNER_EMAIL), eq(users.isActive, true)),
        columns: { id: true },
      })
      return owner ? [owner.id] : []
    }
    return []
  } catch (err) {
    console.error("resolveInsightRecipients failed (non-fatal, no notifications will be emitted):", err)
    return []
  }
}

/**
 * Emit one loop-derived-insight notification to each affected user, reusing
 * the existing `notifications` channel (type: "system", metadata.kind:
 * "loop_insight"). Writes N rows for N recipients -- the same per-user
 * fan-out task-nudge-digest-service.ts uses.
 *
 * Returns the number of notifications actually written. Never throws: a
 * notification is a best-effort nudge, not a correctness-critical write,
 * same "must never block or fail the caller" discipline
 * task-reflection.ts / activity-log-service.ts hold. The caller
 * (proposeLoopImprovement) has already persisted the proposal row, so the
 * insight is captured regardless of whether the nudge lands.
 */
export async function notifyLoopInsight(proposal: LoopImprovementProposal): Promise<number> {
  const recipientIds = await resolveInsightRecipients(proposal)
  if (recipientIds.length === 0) return 0
  const rendered = summarizeLoopInsight(proposal)
  let written = 0
  for (const userId of recipientIds) {
    try {
      await db.insert(notifications).values({
        userId,
        title: rendered.title,
        message: rendered.message,
        type: "system",
        metadata: rendered.metadata,
      })
      written++
    } catch (err) {
      // One recipient failing must not abort the rest of the fan-out.
      console.error(`notifyLoopInsight: failed to notify user ${userId} (continuing):`, err)
    }
  }
  return written
}

/**
 * The number of new loop_improvements rows proposeLoopImprovement() has
 * created since the last notification emission for a given loop. Used by
 * the hook to decide whether a given proposal is "fresh" -- we only nudge
 * about rows we just inserted, not the whole back-catalog every run. Kept
 * as a thin exported helper so the hook's "is this proposal new?" logic is
 * unit-testable without a live loopImprovements table.
 */
export async function countLoopImprovementsSince(loopId: string, sinceIso: string): Promise<number> {
  try {
    const rows = await db.query.loopImprovements.findMany({
      where: and(eq(loopImprovements.loopId, loopId)),
      columns: { id: true, createdAt: true },
    })
    return rows.filter((r) => new Date(r.createdAt).toISOString() > sinceIso).length
  } catch {
    return 0
  }
}
