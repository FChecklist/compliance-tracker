// Wave 160 (UNIVERSAL_TASK_WRAPPER_DESIGN.md, Phase 1): the write path for
// the universal activity envelope. Mirrors orchestra-execution-logger.ts's
// posture exactly -- fire-and-forget, caught/logged failure, must never
// block or fail the actual activity it's recording.
//
// Phase 1 scope, corrected from the design doc's original claim: only
// `ai_team_dispatch` is wired here. The design doc listed `loop_run` as a
// second currently-unpersisted activity type -- checking the live schema
// before writing code found that's wrong: `loop_executions` already
// exists and already records every loop run (per-loop, not activity_log
// shaped, but genuinely persisted). More importantly, loop runs are
// cross-org by nature (an audit loop scans ALL orgs in one run) and
// `loop_executions` correctly has no org_id column at all -- forcing loop
// runs into this table's tenant-scoped RLS (org_id NOT NULL, policy
// `org_id = current_org_id()`) would either require a fake org_id or
// weaken the RLS guarantee for every other row here. Not done. tasks/
// orchestraExecutions already have their own rich tables and are NOT
// double-written here yet either -- that's Phase 2, a deliberately
// separate, lower-risk step (read-only-shaped additions to already-working
// functions) per the design doc's own phasing.
import { activityLog } from "@/lib/db";
import { withTenantContext } from "@/lib/db/tenant-scoped";
import { and, desc, eq, isNotNull } from "drizzle-orm";
import { runTaskReflection } from "@/lib/loops/task-reflection";
import { refreshAgentDirectory } from "@/lib/ai-team/agent-directory-service";
import { bandConfidence } from "@/lib/confidence-banding";
import type { RiskLevel } from "@/lib/risk-classification";

export type ActivityType = "ai_team_dispatch";

// Wave 172 (area 12 "Loop Engineering"): a terminal lifecycle_stage is the
// real "this dispatch closed" touchpoint -- both the universal reflection
// (task-reflection.ts) and the per-AI-Agent directory refresh
// (agent-directory-service.ts) fire exactly here, once, regardless of which
// of the two functions below reached the terminal stage.
const TERMINAL_STAGES = new Set(["completed", "failed", "closed"]);

export type RecordActivityInput = {
  orgId: string;
  clientId?: string;
  userId?: string;
  activityType: ActivityType;
  lifecycleStage: "requested" | "classified" | "validated" | "executing" | "reviewing" | "completed" | "failed" | "closed";
  objective?: string;
  /** The AI Dev Team role_key (roster.ts) that executed this dispatch -- null when rejected before classification. */
  roleKey?: string | null;
  /** Wall-clock ms the caller measured for this dispatch. Only meaningful on a terminal-stage call. */
  durationMs?: number | null;
  /** The real guardrail/tier/validation message when lifecycleStage = 'failed'. */
  errorReason?: string | null;
  /** estimateCostUsd() output when usage + model pricing were available -- forwarded to the reflection row, not persisted as an activity_log column. */
  costUsd?: number | null;
  /** risk-classification.ts's classifyRisk() output, computed by the caller at dispatch time (Guardrail 10). */
  riskLevel?: string | null;
};

/**
 * Fire-and-forget by default -- callers that don't await the returned promise
 * are unaffected, matching every existing call site. Returns the inserted
 * row's id (or null on failure) so a caller that DOES need to reference this
 * activity later -- e.g. the 'reviewing' stage write in the AI Team dispatch
 * route, which needs the id to attach a peer review to -- can await it.
 * Never throws into the caller -- a logging failure must never break the
 * activity it's recording.
 */
export function recordActivity(params: RecordActivityInput): Promise<{ id: string } | null> {
  return withTenantContext({ orgId: params.orgId, userId: params.userId }, async (db) => {
    const [row] = await db.insert(activityLog).values({
      orgId: params.orgId,
      clientId: params.clientId ?? null,
      userId: params.userId ?? null,
      activityType: params.activityType,
      lifecycleStage: params.lifecycleStage,
      objective: params.objective ?? null,
      roleKey: params.roleKey ?? null,
      durationMs: params.durationMs ?? null,
      errorReason: params.lifecycleStage === "failed" ? (params.errorReason ?? null) : null,
      riskLevel: params.riskLevel ?? null,
    }).returning({ id: activityLog.id });
    if (row && TERMINAL_STAGES.has(params.lifecycleStage)) {
      await runTaskReflection(db, {
        orgId: params.orgId,
        sourceType: "ai_team_dispatch",
        sourceId: row.id,
        roleKey: params.roleKey ?? null,
        outcome: params.lifecycleStage === "failed" ? "failure" : "success",
        summary: params.objective ?? null,
        failureReason: params.errorReason ?? null,
        elapsedMs: params.durationMs ?? null,
        costUsd: params.costUsd ?? null,
      });
      if (params.roleKey) void refreshAgentDirectory(params.roleKey);
    }
    return row ?? null;
  }).catch((err) => {
    console.warn(`activity_log write failed for '${params.activityType}' (non-fatal):`, err);
    return null;
  });
}

/**
 * Reads back the risk level (Guardrail 10) persisted on an activity_log row
 * at dispatch time. Used by the closure-review route to feed audit-
 * cadence.ts's classifyAuditCadence() -- the review request body itself
 * must never be trusted for this, since a client-supplied riskLevel could
 * be spoofed to dodge the critical-risk escalation gate in
 * guardrail-registrations.ts's closureReviewCheck. Returns null on any
 * failure (not found, or a logging-adjacent DB error) -- same fail-quiet
 * posture as recordActivity's own catch, since a lookup failure here should
 * degrade to "no extra risk-based gate applies," not crash the review.
 */
export function getActivityRiskLevel(orgId: string, activityLogId: string): Promise<RiskLevel | null> {
  return withTenantContext({ orgId }, async (db) => {
    const row = await db.query.activityLog.findFirst({
      where: eq(activityLog.id, activityLogId),
      columns: { riskLevel: true },
    });
    return (row?.riskLevel as RiskLevel | null) ?? null;
  }).catch(() => null);
}

export type PeerReviewInput = {
  orgId: string;
  activityLogId: string;
  reviewedBy: string;
  reviewNotes: string;
  reviewDecision: "approved" | "rejected";
  selfAssessment?: Record<string, unknown>;
  /**
   * 0-100 self-assessed confidence, when the reviewer supplied one --
   * confidence-banding.ts's bandConfidence() input (Guardrail 9). The
   * derived band is computed and persisted here so it's queryable, but the
   * actual "escalation_required band can't just be approved" ENFORCEMENT
   * happens earlier, in guardrail-registrations.ts's closureReviewCheck --
   * by the time this function runs, that gate has already passed.
   */
  confidencePercentage?: number | null;
};

export type PeerReviewResult =
  | { recorded: true }
  | { recorded: false; reason: "not_found" | "not_in_review" | "self_review_not_allowed" };

/**
 * Records an independent reviewer's decision against a 'reviewing'-stage
 * activity_log row and transitions it to 'completed' (approved) or 'failed'
 * (rejected) -- the actual gate. Fails closed: an activity that isn't
 * currently 'reviewing', or a reviewer identical to the original dispatcher,
 * is rejected rather than silently accepted.
 */
export async function recordPeerReview(params: PeerReviewInput): Promise<PeerReviewResult> {
  return withTenantContext({ orgId: params.orgId }, async (db) => {
    const existing = await db.query.activityLog.findFirst({ where: eq(activityLog.id, params.activityLogId) });
    if (!existing) return { recorded: false, reason: "not_found" as const };
    if (existing.lifecycleStage !== "reviewing") return { recorded: false, reason: "not_in_review" as const };
    if (existing.userId && existing.userId === params.reviewedBy) return { recorded: false, reason: "self_review_not_allowed" as const };

    const newStage = params.reviewDecision === "approved" ? "completed" : "failed";
    const confidenceBand = params.confidencePercentage != null ? bandConfidence(params.confidencePercentage) : null;
    await db.update(activityLog).set({
      lifecycleStage: newStage,
      reviewedBy: params.reviewedBy,
      reviewNotes: params.reviewNotes,
      reviewDecision: params.reviewDecision,
      selfAssessment: params.selfAssessment ?? existing.selfAssessment,
      errorReason: newStage === "failed" ? params.reviewNotes : existing.errorReason,
      confidencePercentage: params.confidencePercentage != null ? String(params.confidencePercentage) : existing.confidencePercentage,
      confidenceBand: confidenceBand ?? existing.confidenceBand,
      updatedAt: new Date(),
    }).where(eq(activityLog.id, params.activityLogId));

    // Wave 172: recordPeerReview is the SECOND real path to a terminal
    // activity_log stage (recordActivity's own terminal-stage branch above
    // covers the direct-completion path) -- reflection/directory-refresh
    // fire here too, using the role_key already stored on the row from the
    // original 'reviewing'-stage write.
    await runTaskReflection(db, {
      orgId: params.orgId,
      sourceType: "ai_team_dispatch",
      sourceId: existing.id,
      roleKey: existing.roleKey,
      outcome: newStage === "failed" ? "failure" : "success",
      summary: existing.objective,
      failureReason: newStage === "failed" ? params.reviewNotes : null,
      elapsedMs: existing.durationMs,
    });
    if (existing.roleKey) void refreshAgentDirectory(existing.roleKey);

    return { recorded: true as const };
  });
}

// tree4-unified/50-completion-plan area 9 "Auditing", U-D15.B3.S1: the
// Constitution's closing recommendation ("no task is ever considered
// permanently complete... every completed task remains eligible for
// re-audit whenever new evidence, changed requirements, production
// incidents, architectural changes, or governance updates indicate the
// original approval may no longer be valid" -- ai-os/audit-tree/
// 02-audit-organization.yaml lines 363-367). Honest scope: this is the
// FLAG + query surface, not an automatic detector. No code in this
// codebase today observes "new evidence" or "changed requirements" as a
// structured, machine-readable event it could react to on its own --
// building a fake auto-trigger for that would be fabricating a feature
// that doesn't exist. What's real and reachable right now: an explicit
// admin flag (this function's caller, POST /api/ai/team/re-audit) and any
// future caller that discovers a genuine post-closure signal (e.g. a
// guardrail violation later found against an already-closed dispatch)
// calling the same function -- wiring an automatic trigger to a specific
// live signal is the follow-up, tracked in 04-implementation-log.yaml, not
// invented here.
const TERMINAL_STAGES_FOR_REAUDIT = new Set(["completed", "failed", "closed"]);

export type ReAuditFlagResult =
  | { flagged: true }
  | { flagged: false; reason: "not_found" | "not_terminal" };

/**
 * Flags a previously-terminal activity_log row for re-audit. Fails closed:
 * a row that doesn't exist, or one that hasn't actually reached a terminal
 * lifecycle stage yet (re-auditing something still in flight is a
 * contradiction in terms -- it isn't "re" anything), is rejected.
 */
export async function flagForReAudit(params: {
  orgId: string;
  activityLogId: string;
  reason: string;
  requestedBy: string;
}): Promise<ReAuditFlagResult> {
  return withTenantContext({ orgId: params.orgId }, async (db) => {
    const existing = await db.query.activityLog.findFirst({ where: eq(activityLog.id, params.activityLogId) });
    if (!existing) return { flagged: false, reason: "not_found" as const };
    if (!TERMINAL_STAGES_FOR_REAUDIT.has(existing.lifecycleStage)) return { flagged: false, reason: "not_terminal" as const };

    await db.update(activityLog).set({
      reAuditRequestedAt: new Date(),
      reAuditReason: params.reason,
      reAuditRequestedBy: params.requestedBy,
      updatedAt: new Date(),
    }).where(eq(activityLog.id, params.activityLogId));

    return { flagged: true as const };
  });
}

/** Clears a re-audit flag once the re-audit has been performed and resolved. Idempotent -- clearing an already-clear row is a no-op, not an error. */
export async function clearReAuditFlag(orgId: string, activityLogId: string): Promise<{ cleared: boolean }> {
  return withTenantContext({ orgId }, async (db) => {
    const result = await db.update(activityLog).set({
      reAuditRequestedAt: null,
      reAuditReason: null,
      reAuditRequestedBy: null,
      updatedAt: new Date(),
    }).where(eq(activityLog.id, activityLogId)).returning({ id: activityLog.id });
    return { cleared: result.length > 0 };
  });
}

/** Lists every activity_log row currently flagged for re-audit in an org, most-recently-flagged first -- the query surface U-D15.B3.S1 requires ("eligible for re-audit" has to be discoverable, not just settable). */
export function listReAuditFlagged(orgId: string) {
  return withTenantContext({ orgId }, async (db) => {
    return db.query.activityLog.findMany({
      where: and(eq(activityLog.orgId, orgId), isNotNull(activityLog.reAuditRequestedAt)),
      orderBy: desc(activityLog.reAuditRequestedAt),
    });
  });
}
