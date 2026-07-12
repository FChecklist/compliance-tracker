// Wave 51 (shared Approval Workflow Engine) -- per ERP_BENCHMARK_COMPARISON.md
// Section 10's #1-ranked platform-wide gap: VERIDIAN had two non-reusable
// single-purpose approval implementations (approvalRequests single-step
// maker-checker; pmsWorkflowTransitions PMS-issue-only configurable
// transitions) plus every other module hand-rolling its own status enum.
// This engine is entity-agnostic (entityType/entityId polymorphic, matching
// approvalRequests' own precedent) so any future module -- not just ERP --
// can adopt it without inventing a ninth approval mechanism.
//
// Design note (also recorded in ERP_BENCHMARK_COMPARISON.md): evaluated
// `xstate` for the state-transition core, but workflow *definitions* here
// are per-org runtime data (rows in a table an admin edits), not code --
// a hand-rolled ordered-step-with-quorum resolver is simpler to reason
// about and test than constructing dynamic xstate machine configs from DB
// rows for a marginal benefit. Role gating reuses this codebase's existing
// ROLE_RANK hierarchy (a step's approverRole is a *minimum* rank, exactly
// like hasRole()'s own semantics) rather than inventing a second role model.
import {
  approvalWorkflowDefinitions, approvalWorkflowStepDefinitions,
  approvalWorkflowInstances, approvalWorkflowStepInstances, approvalWorkflowStepApprovals,
  users, entityRelationships, dynamicChains,
} from "@/lib/db"
import { withTenantContext, type TenantDb } from "@/lib/db/tenant-scoped"
import { and, eq, asc } from "drizzle-orm"
import { ServiceError } from "./compliance-service"
export { ServiceError }
import { ROLE_RANK, type UserRole } from "@/lib/supabase/auth-guard"
import { logActivity } from "@/lib/audit"

export type WorkflowContext = { orgId: string; userId: string; dbUser: typeof users.$inferSelect }

type StepDefInput = {
  stepOrder: number
  name: string
  approverRole: UserRole
  requiredApprovals?: number
  conditionField?: string
  conditionOperator?: 'gt' | 'gte' | 'lt' | 'lte' | 'eq'
  conditionValue?: number
}

export async function listWorkflowDefinitions(ctx: { orgId: string }, entityType?: string) {
  return withTenantContext({ orgId: ctx.orgId }, async (db) => {
    return db.query.approvalWorkflowDefinitions.findMany({
      where: entityType
        ? and(eq(approvalWorkflowDefinitions.orgId, ctx.orgId), eq(approvalWorkflowDefinitions.entityType, entityType))
        : eq(approvalWorkflowDefinitions.orgId, ctx.orgId),
      with: { steps: { orderBy: (t, { asc }) => asc(t.stepOrder) } },
      orderBy: (t, { desc }) => desc(t.createdAt),
    })
  })
}

export async function createWorkflowDefinition(
  ctx: WorkflowContext,
  input: { entityType: string; name: string; steps: StepDefInput[] }
) {
  if (!input.entityType?.trim()) throw new ServiceError("entityType is required", 400)
  if (!input.name?.trim()) throw new ServiceError("name is required", 400)
  if (!input.steps?.length) throw new ServiceError("At least one step is required", 400)

  return withTenantContext({ orgId: ctx.orgId, userId: ctx.userId }, async (db) => {
    const [def] = await db.insert(approvalWorkflowDefinitions).values({
      orgId: ctx.orgId, entityType: input.entityType, name: input.name, createdById: ctx.userId,
    }).returning()

    await db.insert(approvalWorkflowStepDefinitions).values(
      input.steps.map((s) => ({
        workflowDefinitionId: def.id,
        stepOrder: s.stepOrder,
        name: s.name,
        approverRole: s.approverRole,
        requiredApprovals: s.requiredApprovals ?? 1,
        conditionField: s.conditionField,
        conditionOperator: s.conditionOperator,
        conditionValue: s.conditionValue?.toString(),
      }))
    )

    await logActivity({ tx: db, orgId: ctx.orgId, dbUser: ctx.dbUser, action: "approval_workflow.created", entityType: "approval_workflow_definition", entityId: def.id })
    return def
  })
}

function evaluateCondition(operator: 'gt' | 'gte' | 'lt' | 'lte' | 'eq', fieldValue: number, threshold: number): boolean {
  switch (operator) {
    case 'gt': return fieldValue > threshold
    case 'gte': return fieldValue >= threshold
    case 'lt': return fieldValue < threshold
    case 'lte': return fieldValue <= threshold
    case 'eq': return fieldValue === threshold
  }
}

/**
 * Starts a workflow instance for the active workflow definition on
 * `entityType`, if one exists. Returns null (not an error) if no active
 * workflow is configured -- callers should treat "no workflow" as
 * "auto-approved," matching how every existing single-step status enum
 * in this codebase behaves today (submit -> immediately posted).
 *
 * Wave 173 (GAP-DCMD, "wire at least ONE real graph edge type into
 * entity_relationships for chains"): the optional dynamicChainId param is
 * new. When present AND a real workflow instance actually gets created (the
 * two null-return branches above are unaffected -- no chain, no edge), this
 * records the first real entity_relationships consumer for dynamic_chains:
 * a `dynamic_chain -> approval_workflow_instance` edge with
 * relationshipType 'triggers_approval', plus a denormalized index onto the
 * chain's own linkedApprovalWorkflowIds column. Every existing caller
 * (erp-procurement-workflow-service.ts, erp-accounting-service.ts) simply
 * omits dynamicChainId and behaves exactly as before.
 */
export async function startApprovalWorkflow(
  ctx: WorkflowContext,
  params: { entityType: string; entityId: string; entityData: Record<string, number>; dynamicChainId?: string | null }
) {
  return withTenantContext({ orgId: ctx.orgId, userId: ctx.userId }, async (db) => {
    const def = await db.query.approvalWorkflowDefinitions.findFirst({
      where: and(
        eq(approvalWorkflowDefinitions.orgId, ctx.orgId),
        eq(approvalWorkflowDefinitions.entityType, params.entityType),
        eq(approvalWorkflowDefinitions.isActive, true)
      ),
      with: { steps: { orderBy: (t, { asc }) => asc(t.stepOrder) } },
    })
    if (!def || def.steps.length === 0) return null

    const applicableSteps = def.steps.filter((step) => {
      if (!step.conditionField || !step.conditionOperator || step.conditionValue === null) return true
      const fieldValue = params.entityData[step.conditionField]
      if (fieldValue === undefined) return true // fail-safe: unknown field -> include the step rather than silently skip approval
      return evaluateCondition(step.conditionOperator, fieldValue, Number(step.conditionValue))
    })
    if (applicableSteps.length === 0) return null

    const [instance] = await db.insert(approvalWorkflowInstances).values({
      orgId: ctx.orgId, workflowDefinitionId: def.id, entityType: params.entityType, entityId: params.entityId, createdById: ctx.userId,
    }).returning()

    await db.insert(approvalWorkflowStepInstances).values(
      applicableSteps.map((step) => ({
        workflowInstanceId: instance.id,
        stepDefinitionId: step.id,
        stepOrder: step.stepOrder,
        approverRole: step.approverRole,
        requiredApprovals: step.requiredApprovals,
      }))
    )

    await logActivity({ tx: db, orgId: ctx.orgId, dbUser: ctx.dbUser, action: "approval_workflow.instance_started", entityType: params.entityType, entityId: params.entityId })

    if (params.dynamicChainId) {
      await recordChainTriggeredApprovalEdge(db, ctx.orgId, params.dynamicChainId, def.id, instance.id, params.entityType, params.entityId)
    }

    return instance
  })
}

// Best-effort, never blocks the real approval-workflow creation above on
// failure -- same "a graph-edge/index write degrades gracefully" posture
// this codebase already uses elsewhere (see capability-audit-service.ts's
// registerClosedCapabilityAsUmrAsset). Writes both the durable graph edge
// (entity_relationships, the real source of truth per GAP-DCMD) and a
// denormalized, human-readable index (dynamicChains.linkedApprovalWorkflowIds)
// so an admin looking at one chain's row doesn't need to query the graph
// table to see what workflows it has triggered.
async function recordChainTriggeredApprovalEdge(
  db: TenantDb, orgId: string, dynamicChainId: string, workflowDefinitionId: string, workflowInstanceId: string, entityType: string, entityId: string
): Promise<void> {
  try {
    await db.insert(entityRelationships).values({
      orgId,
      sourceType: "dynamic_chain",
      sourceId: dynamicChainId,
      targetType: "approval_workflow_instance",
      targetId: workflowInstanceId,
      relationshipType: "triggers_approval",
      metadata: { workflowDefinitionId, entityType, entityId },
    })

    const chain = await db.query.dynamicChains.findFirst({ where: eq(dynamicChains.id, dynamicChainId) })
    if (chain) {
      const existingIds = Array.isArray(chain.linkedApprovalWorkflowIds) ? (chain.linkedApprovalWorkflowIds as string[]) : []
      if (!existingIds.includes(workflowDefinitionId)) {
        await db.update(dynamicChains)
          .set({ linkedApprovalWorkflowIds: [...existingIds, workflowDefinitionId], updatedAt: new Date() })
          .where(eq(dynamicChains.id, dynamicChainId))
      }
    }
  } catch (err) {
    console.error(`[approval-workflow-service] Failed to record dynamic_chain->approval_workflow graph edge for chain ${dynamicChainId}:`, err)
  }
}

export async function getWorkflowInstanceForEntity(ctx: { orgId: string }, entityType: string, entityId: string) {
  return withTenantContext({ orgId: ctx.orgId }, async (db) => {
    return db.query.approvalWorkflowInstances.findFirst({
      where: and(eq(approvalWorkflowInstances.orgId, ctx.orgId), eq(approvalWorkflowInstances.entityType, entityType), eq(approvalWorkflowInstances.entityId, entityId)),
      with: { steps: { orderBy: (t, { asc }) => asc(t.stepOrder) } },
      orderBy: (t, { desc }) => desc(t.createdAt),
    })
  })
}

/** "My Approvals" inbox: pending steps this user's role qualifies to act on. */
export async function listMyPendingApprovals(ctx: WorkflowContext) {
  return withTenantContext({ orgId: ctx.orgId }, async (db) => {
    const userRank = ROLE_RANK[ctx.dbUser.role as UserRole] ?? 0
    const pendingSteps = await db.query.approvalWorkflowStepInstances.findMany({
      where: eq(approvalWorkflowStepInstances.status, "pending"),
      with: { instance: true },
    })
    return pendingSteps.filter((step) => {
      if (step.instance.orgId !== ctx.orgId) return false
      const requiredRank = ROLE_RANK[step.approverRole as UserRole] ?? 999
      return userRank >= requiredRank
    })
  })
}

async function advanceWorkflow(db: TenantDb, instanceId: string) {
  const nextStep = await db.query.approvalWorkflowStepInstances.findFirst({
    where: and(eq(approvalWorkflowStepInstances.workflowInstanceId, instanceId), eq(approvalWorkflowStepInstances.status, "pending")),
    orderBy: asc(approvalWorkflowStepInstances.stepOrder),
  })
  if (!nextStep) {
    await db.update(approvalWorkflowInstances).set({ status: "approved", completedAt: new Date() }).where(eq(approvalWorkflowInstances.id, instanceId))
  }
}

// tree4-unified/50-completion-plan area 3 "Guardrails", PLAN-16 re-scoped
// item (a) "Authority/Delegation guardrail beyond role-rank": ROLE_RANK
// alone answers "does this user hold enough RANK to approve this step" but
// never "is this user the same person who submitted the thing they're now
// approving" -- a real authority gap distinct from rank, since a manager
// with sufficient rank could both create and approve their own request
// with zero separation of duties. Mirrors the exact pattern this codebase
// already established for AI Team peer review (activity-log-service.ts's
// recordPeerReview: `self_review_not_allowed`, "no self-certification,
// mirrors AGENTS.md Rule 7c") -- same principle, human approval workflows
// instead of AI dispatch review. Pure so it's testable without a DB.
export function isSelfApproval(instanceCreatedById: string | null, approverId: string): boolean {
  return Boolean(instanceCreatedById) && instanceCreatedById === approverId
}

/**
 * Records one approver's decision on a step. Rejecting any step rejects
 * the whole instance immediately (no partial-rollback semantics needed --
 * matches how a single `rejected` status behaves everywhere else in this
 * codebase). Approving increments the step's quorum counter; once it
 * reaches requiredApprovals the step is marked approved and the instance
 * advances to the next pending step, or completes if none remain.
 */
export type DecideApprovalStepResult = { ok: true; entityType: string; entityId: string; instanceStatus: "pending" | "approved" | "rejected" }

export async function decideApprovalStep(
  ctx: WorkflowContext,
  stepInstanceId: string,
  decision: "approved" | "rejected",
  comment?: string
): Promise<DecideApprovalStepResult> {
  return withTenantContext({ orgId: ctx.orgId, userId: ctx.userId }, async (db): Promise<DecideApprovalStepResult> => {
    const step = await db.query.approvalWorkflowStepInstances.findFirst({
      where: eq(approvalWorkflowStepInstances.id, stepInstanceId),
      with: { instance: true },
    })
    if (!step || step.instance.orgId !== ctx.orgId) throw new ServiceError("Approval step not found", 404)
    if (step.status !== "pending") throw new ServiceError("This step has already been decided", 409)

    if (isSelfApproval(step.instance.createdById, ctx.userId)) {
      throw new ServiceError("You cannot approve or reject a request you submitted yourself -- an independent approver is required", 403)
    }

    const userRank = ROLE_RANK[ctx.dbUser.role as UserRole] ?? 0
    const requiredRank = ROLE_RANK[step.approverRole as UserRole] ?? 999
    if (userRank < requiredRank) throw new ServiceError(`This step requires ${step.approverRole} role or higher`, 403)

    await db.insert(approvalWorkflowStepApprovals).values({ stepInstanceId, approvedById: ctx.userId, decision, comment })

    let instanceStatus: "pending" | "approved" | "rejected" = "pending"
    if (decision === "rejected") {
      await db.update(approvalWorkflowStepInstances).set({ status: "rejected" }).where(eq(approvalWorkflowStepInstances.id, stepInstanceId))
      await db.update(approvalWorkflowInstances).set({ status: "rejected", completedAt: new Date() }).where(eq(approvalWorkflowInstances.id, step.workflowInstanceId))
      instanceStatus = "rejected"
    } else {
      const newCount = step.approvalsReceived + 1
      if (newCount >= step.requiredApprovals) {
        await db.update(approvalWorkflowStepInstances).set({ status: "approved", approvalsReceived: newCount }).where(eq(approvalWorkflowStepInstances.id, stepInstanceId))
        await advanceWorkflow(db, step.workflowInstanceId)
        const refreshed = await db.query.approvalWorkflowInstances.findFirst({ where: eq(approvalWorkflowInstances.id, step.workflowInstanceId) })
        instanceStatus = (refreshed?.status ?? "pending") as typeof instanceStatus
      } else {
        await db.update(approvalWorkflowStepInstances).set({ approvalsReceived: newCount }).where(eq(approvalWorkflowStepInstances.id, stepInstanceId))
      }
    }

    await logActivity({ tx: db, orgId: ctx.orgId, dbUser: ctx.dbUser, action: `approval_workflow.step_${decision}`, entityType: step.instance.entityType, entityId: step.instance.entityId })
    return { ok: true, entityType: step.instance.entityType, entityId: step.instance.entityId, instanceStatus }
  })
}
