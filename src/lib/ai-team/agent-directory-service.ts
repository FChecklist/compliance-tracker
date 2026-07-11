// Wave 172 (tree4-unified/50-completion-plan area 12 "Loop Engineering",
// remaining_work item 2): "Per-AI-Agent permanent directory
// (Agent/Task/Version/Average Success/Average Time/Failures/Common Errors/
// Improvement Suggestions/Latest Prompt Version/Validation Rules/Loop
// Engineering Status) -- worker_agent_usage_log/worker_agent_learnings cover
// Worker Agents only, not AI Dev Team roles (roster.ts)."
//
// Platform-level aggregation (raw `db`, not withTenantContext) -- same
// posture as token-usage-service.ts: one role_key's dispatches can span
// multiple orgs (different veridian_admins), and the directory is a single
// cross-org row per role, not tenant data. Every aggregate column here comes
// from real, already-persisted data:
//   - Average Success / Average Time / Failures / Common Errors: activity_log
//     rows for activity_type = 'ai_team_dispatch', grouped by the role_key/
//     duration_ms/error_reason columns Wave 172 added to that table.
//   - Latest Prompt Version: prompt_versions, the same table prompt-os-
//     resolver.ts already reads at call time -- not a second source of truth.
//   - Validation Rules: model-tier-eligibility.ts's already-enforced tier
//     gate for this role's model. Real and live, not a new invented rule.
//   - Improvement Suggestions: loop_improvements (the CLEE pipeline) IF a
//     row ever targets this role_key (targetType = 'ai_team_role') -- no
//     caller writes that targetType yet, so this is honestly null today,
//     same "don't fabricate what doesn't exist" discipline as everywhere
//     else in this wave.
// loop_engineering_status is never advanced past its schema default here --
// see schema.ts's own comment on that column for why.
import { db, activityLog, promptTemplates, promptVersions, loopImprovements, aiAgentDirectory } from "@/lib/db";
import { and, desc, eq, isNotNull, sql } from "drizzle-orm";
import { getRole } from "./roster";
import { isModelEligibleForTier, requiresMandatoryAudit } from "@/lib/model-tier-eligibility";

async function findLatestPromptVersion(promptKey: string | null): Promise<number | null> {
  if (!promptKey) return null;
  const template = await db.query.promptTemplates.findFirst({ where: eq(promptTemplates.templateKey, promptKey) });
  if (!template) return null;
  const version = await db.query.promptVersions.findFirst({
    where: and(eq(promptVersions.promptTemplateId, template.id), eq(promptVersions.isActive, true)),
    orderBy: desc(promptVersions.version),
  });
  return version?.version ?? null;
}

async function findLatestImprovementSuggestion(roleKey: string): Promise<string | null> {
  const improvement = await db.query.loopImprovements.findFirst({
    where: and(eq(loopImprovements.targetType, "ai_team_role"), eq(loopImprovements.targetId, roleKey)),
    orderBy: desc(loopImprovements.createdAt),
  });
  if (!improvement) return null;
  const before = improvement.beforeState ? JSON.stringify(improvement.beforeState) : null;
  return before ? `${improvement.improvementType}: ${before}`.slice(0, 500) : improvement.improvementType;
}

/**
 * Recomputes and upserts one role's directory row from real dispatch
 * history. Called after each AI Team dispatch closes (activity-log-
 * service.ts's recordActivity/recordPeerReview, on a terminal lifecycle
 * stage) -- narrow, real trigger, not a scheduled/batch job pretending to be
 * comprehensive. Never throws -- a directory-refresh failure must not affect
 * the dispatch it's summarizing.
 */
export async function refreshAgentDirectory(roleKey: string): Promise<void> {
  try {
    const role = getRole(roleKey);

    const [counts] = await db
      .select({
        total: sql<number>`count(*)::int`,
        successCount: sql<number>`count(*) filter (where ${activityLog.lifecycleStage} = 'completed')::int`,
        failureCount: sql<number>`count(*) filter (where ${activityLog.lifecycleStage} = 'failed')::int`,
        avgDurationMs: sql<number | null>`avg(${activityLog.durationMs}) filter (where ${activityLog.durationMs} is not null)`,
      })
      .from(activityLog)
      .where(and(eq(activityLog.activityType, "ai_team_dispatch"), eq(activityLog.roleKey, roleKey)));

    const commonErrorRows = await db
      .select({ reason: activityLog.errorReason, count: sql<number>`count(*)::int` })
      .from(activityLog)
      .where(and(eq(activityLog.activityType, "ai_team_dispatch"), eq(activityLog.roleKey, roleKey), isNotNull(activityLog.errorReason)))
      .groupBy(activityLog.errorReason)
      .orderBy(desc(sql`count(*)`))
      .limit(5);

    const latestRow = await db.query.activityLog.findFirst({
      where: and(eq(activityLog.activityType, "ai_team_dispatch"), eq(activityLog.roleKey, roleKey)),
      orderBy: desc(activityLog.createdAt),
      columns: { objective: true },
    });

    const [latestPromptVersion, improvementSuggestions] = await Promise.all([
      findLatestPromptVersion(role?.promptKey ?? null),
      findLatestImprovementSuggestion(roleKey),
    ]);

    const validationRules = role?.model
      ? {
          model: role.model,
          mechanicalEligible: isModelEligibleForTier(role.model, "mechanical"),
          integrativeEligible: isModelEligibleForTier(role.model, "integrative"),
          judgmentEligible: isModelEligibleForTier(role.model, "judgment"),
          mandatoryAudit: requiresMandatoryAudit(role.model),
        }
      : null;

    const values = {
      roleKey,
      title: role?.title ?? null,
      team: role?.team ?? null,
      latestTaskSummary: latestRow?.objective ?? null,
      latestPromptVersion,
      totalDispatches: counts?.total ?? 0,
      successCount: counts?.successCount ?? 0,
      failureCount: counts?.failureCount ?? 0,
      avgDurationMs: counts?.avgDurationMs != null ? String(counts.avgDurationMs) : null,
      commonErrors: commonErrorRows.map((r) => ({ reason: r.reason, count: r.count })),
      improvementSuggestions,
      validationRules,
      lastComputedAt: new Date(),
      updatedAt: new Date(),
    };

    await db
      .insert(aiAgentDirectory)
      .values(values)
      .onConflictDoUpdate({ target: aiAgentDirectory.roleKey, set: values });
  } catch (err) {
    // roleKey passed as a separate arg, not interpolated into the format
    // string -- CodeQL js/tainted-format-string flagged the interpolated
    // form as log injection (a caller-controlled roleKey could otherwise
    // forge fake log lines via embedded newlines/control characters).
    console.error("[agent-directory] failed to refresh directory for role (non-fatal):", roleKey, err);
  }
}
