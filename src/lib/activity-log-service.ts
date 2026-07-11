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
import { eq } from "drizzle-orm";
import { runTaskReflection } from "@/lib/loops/task-reflection";
import { refreshAgentDirectory } from "@/lib/ai-team/agent-directory-service";

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

export type PeerReviewInput = {
  orgId: string;
  activityLogId: string;
  reviewedBy: string;
  reviewNotes: string;
  reviewDecision: "approved" | "rejected";
  selfAssessment?: Record<string, unknown>;
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
    await db.update(activityLog).set({
      lifecycleStage: newStage,
      reviewedBy: params.reviewedBy,
      reviewNotes: params.reviewNotes,
      reviewDecision: params.reviewDecision,
      selfAssessment: params.selfAssessment ?? existing.selfAssessment,
      errorReason: newStage === "failed" ? params.reviewNotes : existing.errorReason,
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
