import { dynamicChains, entityRelationships, taskChatMessages, taskExecutionPlan } from "@/lib/db";
import type { TenantDb } from "@/lib/db/tenant-scoped";
import { eq, and, sql } from "drizzle-orm";
import { evaluateMonitoringRules } from "@/lib/monitoring-engine";
import { nextEscalationRung } from "@/lib/escalation-ladder";

// VERIDIAN Review Framework gap closure (AI Engineering Quality / Code
// Structure & Modularity, 2026-08-15): extracted out of
// task-execution-engine.ts, which now imports both functions below for its
// own updateTaskStatusAndReflect() call site instead of defining them
// inline. Both functions share one real responsibility -- "react to a
// dynamic-chain-selected task reaching a terminal state" -- and were
// already only ever called from that single chokepoint, so grouping them
// here is a pure file-boundary change, not a behavior change.

// GAP-DCMD (Priority 10, next real slice after Wave 173's approval-workflow
// edge, PR #227): the second real entity_relationships graph edge type for
// dynamic_chains -- `dynamic_chain -> worker_agent`, relationshipType
// 'executed_by'. This is what turns "which chains has this agent executed"
// from an unanswerable question into a real, already-exposed query: GET
// /api/v1/brain/entity-relationships?entityType=worker_agent&entityId=<id>
// (entity-relationships/route.ts, built Wave 153) calls getNeighbors(),
// which is generic over relationshipType -- no new API surface needed, this
// migration-free change alone makes the existing endpoint answer a question
// it couldn't before.
//
// Hooked into the same chokepoint as enforceChainMonitoringRules below
// (task-execution-engine.ts's updateTaskStatusAndReflect, called from every
// real completion path: executeStructuredDispatch, executeEngineDispatch,
// and the free-text planning path) so it fires no matter which dispatch
// branch a chain-selected task took, without duplicating call sites. Only
// runs on "completed" (not "failed") -- an agent that failed a task didn't
// meaningfully execute the chain's work, so recording 'executed_by' would
// overstate what happened.
//
// Deliberately an upsert-by-(chain,agent) pair, not one row per task
// completion: unlike the approval edge (whose target -- a specific
// approval_workflow_instance -- is unique per edge), the same agent will
// legitimately complete the same chain many times, and a fresh row per
// completion would flood the graph with duplicates that answer nothing new.
// metadata.taskCount/lastTaskId/lastExecutedAt accumulate on the single
// edge instead, mirroring this file's own established
// find-then-insert-or-update discipline (see approvalPreferences' schema
// comment for the same reasoning applied elsewhere in this codebase).
// Wrapped in try/catch, matching recordChainTriggeredApprovalEdge's
// non-fatal precedent -- a graph-edge write failing must never fail the
// task completion it's attached to.
export async function recordChainWorkerAgentEdges(db: TenantDb, orgId: string, taskId: string, dynamicChainId: string): Promise<void> {
  try {
    const steps = await db
      .selectDistinct({ workerAgentId: taskExecutionPlan.workerAgentId })
      .from(taskExecutionPlan)
      .where(and(eq(taskExecutionPlan.taskId, taskId), sql`${taskExecutionPlan.workerAgentId} IS NOT NULL`));

    const now = new Date();
    for (const { workerAgentId } of steps) {
      if (!workerAgentId) continue;
      const existing = await db.query.entityRelationships.findFirst({
        where: and(
          eq(entityRelationships.orgId, orgId),
          eq(entityRelationships.sourceType, "dynamic_chain"),
          eq(entityRelationships.sourceId, dynamicChainId),
          eq(entityRelationships.targetType, "worker_agent"),
          eq(entityRelationships.targetId, workerAgentId),
          eq(entityRelationships.relationshipType, "executed_by"),
        ),
      });
      if (existing) {
        const prevCount = typeof (existing.metadata as { taskCount?: number } | null)?.taskCount === "number"
          ? (existing.metadata as { taskCount: number }).taskCount
          : 1;
        await db.update(entityRelationships)
          .set({
            metadata: { taskCount: prevCount + 1, lastTaskId: taskId, lastExecutedAt: now.toISOString() },
            updatedAt: now,
          })
          .where(eq(entityRelationships.id, existing.id));
      } else {
        await db.insert(entityRelationships).values({
          orgId,
          sourceType: "dynamic_chain",
          sourceId: dynamicChainId,
          targetType: "worker_agent",
          targetId: workerAgentId,
          relationshipType: "executed_by",
          metadata: { taskCount: 1, lastTaskId: taskId, lastExecutedAt: now.toISOString() },
        });
      }
    }
  } catch (err) {
    console.error(`[chain-completion-service] Failed to record dynamic_chain->worker_agent graph edge(s) for chain ${dynamicChainId}, task ${taskId}:`, err);
  }
}

// tree4-unified/50-completion-plan area 6 remaining_work ("Per-Dynamic-Chain
// monitoring rules ENFORCEMENT layer"): the one real chain-scoped task-
// completion chokepoint -- task-execution-engine.ts's
// updateTaskStatusAndReflect is called from every real completion path
// (executeStructuredDispatch, executeEngineDispatch, the free-text planning
// path, and markTaskOutcome's early-failure path), so wiring here covers a
// chain-selected task no matter which dispatch branch it took. Skipped
// entirely for the majority of tasks that carry no dynamicChainId (no chain
// selected) -- zero extra queries for them.
export async function enforceChainMonitoringRules(db: TenantDb, taskId: string, dynamicChainId: string, elapsedMs: number): Promise<void> {
  const chain = await db.query.dynamicChains.findFirst({
    where: eq(dynamicChains.id, dynamicChainId),
    columns: { monitoringRules: true },
  });
  if (!chain?.monitoringRules) return;

  const [{ count: completedStepCount }] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(taskExecutionPlan)
    .where(and(eq(taskExecutionPlan.taskId, taskId), eq(taskExecutionPlan.status, "completed")));

  const violations = evaluateMonitoringRules(chain.monitoringRules, { durationMs: elapsedMs, completedStepCount });
  for (const violation of violations) {
    if (violation.action === "escalate") {
      const escalation = nextEscalationRung({ reason: "monitoring_rule_violation" });
      await db.insert(taskChatMessages).values({
        taskId,
        role: "system",
        content: `Monitoring rule violated (${violation.metric} = ${violation.actualValue}) -- escalated to ${escalation.title} (${escalation.authority}).`,
      });
    } else {
      await db.insert(taskChatMessages).values({
        taskId,
        role: "system",
        content: `Monitoring rule warning: ${violation.metric} = ${violation.actualValue} is outside the chain's declared bounds.`,
      });
    }
  }
}
