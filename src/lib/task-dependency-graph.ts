// GP-20 (Loop Prevention) Phase 2 -- DB-touching half of the
// task-dependency-graph cycle detector. loop-prevention.ts's
// wouldCreateCycle() is the pure algorithm (unit-tested directly, matching
// escalation-ladder.ts's established "test the pure predicate, not the
// withTenantContext wrapper" convention); this file is the thin,
// untested-directly wrapper that loads real edges and persists new ones.
//
// Edges are stored in entity_relationships (sourceType/targetType 'task',
// relationshipType 'escalates_to') -- the same generic graph substrate
// task-execution-engine.ts's own recordChainWorkerAgentEdges() already
// writes to for dynamic_chain -> worker_agent edges. No new table.
//
// Real call site: crm-service.ts's createChainedTask() (Wave 78,
// "Multi-Agent Chaining") -- the one place in this codebase where one
// task's processing creates AND EXECUTES a second, distinct `tasks` row.
import { and, eq } from "drizzle-orm"
import { entityRelationships } from "./db"
import type { TenantDb } from "./db/tenant-scoped"
import { wouldCreateCycle, type TaskEscalationEdge } from "./loop-prevention"
import { ServiceError } from "./services/compliance-service"

const TASK_ENTITY_TYPE = "task"
const ESCALATES_TO_RELATIONSHIP = "escalates_to"

export type TaskEscalationEdgeReason = "chained_follow_up_task"

/**
 * Loads every existing task->task 'escalates_to' edge for this org. Real DB
 * read, no caching -- the graph is small (one row per real escalation/
 * dispatch edge ever recorded) and correctness here matters more than
 * shaving one query.
 */
async function loadTaskEscalationEdges(db: TenantDb, orgId: string): Promise<TaskEscalationEdge[]> {
  const rows = await db.query.entityRelationships.findMany({
    where: and(
      eq(entityRelationships.orgId, orgId),
      eq(entityRelationships.sourceType, TASK_ENTITY_TYPE),
      eq(entityRelationships.targetType, TASK_ENTITY_TYPE),
      eq(entityRelationships.relationshipType, ESCALATES_TO_RELATIONSHIP)
    ),
    columns: { sourceId: true, targetId: true },
  })
  return rows.map((row) => ({ fromTaskId: row.sourceId, toTaskId: row.targetId }))
}

/**
 * Records a new task-to-task escalation/dispatch edge -- but refuses first
 * (ServiceError, 409) if doing so would create a cycle back to an ancestor
 * task, per GP-20. Must be called inside the same tx a caller's
 * withTenantContext already opened (matching escalation-ladder.ts's
 * claimEscalation() convention), so the refusal check and the insert see a
 * consistent snapshot and the whole operation is atomic with whatever else
 * that transaction does (e.g. the new task's own insert).
 */
export async function recordTaskEscalationEdge(
  db: TenantDb,
  params: { orgId: string; fromTaskId: string; toTaskId: string; reason: TaskEscalationEdgeReason }
): Promise<void> {
  const edges = await loadTaskEscalationEdges(db, params.orgId)

  if (wouldCreateCycle(edges, params.fromTaskId, params.toTaskId)) {
    throw new ServiceError(
      `Dispatching task ${params.fromTaskId} to task ${params.toTaskId} would create a recursive-delegation cycle back to an ancestor task -- refused before dispatch, per GP-20 (Loop Prevention).`,
      409,
      { code: "TASK_ESCALATION_CYCLE", kind: "business", retryable: false }
    )
  }

  await db.insert(entityRelationships).values({
    orgId: params.orgId,
    sourceType: TASK_ENTITY_TYPE,
    sourceId: params.fromTaskId,
    targetType: TASK_ENTITY_TYPE,
    targetId: params.toTaskId,
    relationshipType: ESCALATES_TO_RELATIONSHIP,
    metadata: { reason: params.reason },
  })
}
