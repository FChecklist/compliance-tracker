// Wave 11 service layer -- extracted from src/app/api/tasks/{route,
// [id]/route}.ts verbatim (behavior-identical refactor).
import { tasks, aiAssistants, workerAgents, dynamicChains, users, db, notifications } from "@/lib/db"
import { withTenantContext, type TenantDb } from "@/lib/db/tenant-scoped"
import { desc, eq, asc, and, ne, inArray, lt, notInArray, sql } from "drizzle-orm"
import { executeTask } from "@/lib/task-execution-engine"
import { taskExecutionPlan, taskChatMessages } from "@/lib/db"
import { ServiceError } from "./compliance-service"
export { ServiceError }
import type { ServiceContext, ReadContext } from "./context"
import { detectHighImpactAction, checkHighImpactConfirmation } from "@/lib/high-impact-action-detector"
import { logHighImpactClassification } from "@/lib/high-impact-classification-logger"
import { checkApprovalPreference, saveApprovalPreference } from "@/lib/approval-preference-service"
import { didFeatureComplete, recordAuditTrigger } from "@/lib/audit-event-triggers"
import { runTaskCompletionMonitor } from "@/lib/monitors/task-completion-monitor"
// Wave 173 (GAP-DYNAMIC-CHAIN-DEDUP): dynamic_chain is now a 5th
// CapabilityEntityType -- indexed at the one real creation point
// (resolveDynamicChainId below), same "index at creation" pattern
// worker-agent-service.ts/automation-rule-service.ts already follow for
// their own entity types.
import { indexCapability, buildCapabilityContent } from "./capability-registry-service"
// VERIDIAN Review Framework gap closure, 2026-07-18 ("Duplicate Work
// Detection"): index every task at creation/edit so
// task-dedup-service.ts's on-demand audit has something real to compare
// against -- deliberately a separate 'task' entityType from the capability
// registry's own indexCapability() above (see that file's own header for
// why business tasks are a different concept from capabilities).
import { indexTaskForDedup } from "./task-dedup-service"
// Wave 173 (GAP-DCMD graph edge): best-effort -- when a chain-originated
// task's org has configured a real approval_workflow_definitions row for
// entityType 'tasks', starting a workflow instance here is what makes
// "a chain's task creates an approval" real instead of just a schema
// column. Orgs with no such definition see startApprovalWorkflow() return
// null (see that function's own header) -- zero behavior change for them.
import { startApprovalWorkflow } from "./approval-workflow-service"

const VALID_STATUSES = ["pending", "in_progress", "completed", "failed", "cancelled"]

// D8/D5.B4.S2 minimum 2-level chain selection gate, extracted as a pure
// predicate (rather than left inline in createTask) so it's directly unit
// testable without a DB -- this repo's established pattern for guardrail-
// style logic (see handover-protocol.test.ts's own note on why nothing in
// this codebase's test suite touches withTenantContext). undefined
// chainPathKeys means the caller never claimed a Chain-Selector-based
// dispatch at all (free-text/API task creation) and is deliberately let
// through untouched -- only a caller that DID send chainPathKeys is held to
// the 2-level minimum.
export function validateChainDepth(chainPathKeys: unknown[] | undefined): { valid: true } | { valid: false; reason: string } {
  if (chainPathKeys !== undefined && chainPathKeys.length < 2) {
    return { valid: false, reason: "Select at least 2 levels of the chain (a category and a sub-option) before starting this task." }
  }
  return { valid: true }
}

// Wave 161 (VERIDIAN_DMP_DCF_CONSTITUTION.md, "Dynamic Chain as the Primary
// System Object -- Phase 1"): find-or-create so repeatedly selecting the
// same chain (the common case -- most tasks reuse a handful of frequent
// chains) doesn't grow dynamic_chains unboundedly with duplicate rows.
// Dedupes on (orgId, modePill, pathKeys) via a jsonb equality compare.
//
// Priority 5 (10-priority5-software-orchestrator-tracker.yaml, dispatch 4,
// item E1): exported (was module-private) so chat-service.ts's
// createConversation()/createWorkflowThread() can call the exact same
// find-or-create resolver for the Dynamic Chain gate on VERI conversations
// (VERI_CHAT_GOVERNANCE.md §5), instead of duplicating this dedup logic.
export async function resolveDynamicChainId(
  db: TenantDb, orgId: string, userId: string,
  modePill: string, pathKeys: unknown[], pathLabels: unknown[]
): Promise<string | null> {
  if (!modePill || !pathKeys.length) return null
  const pathKeysJson = JSON.stringify(pathKeys)
  const existing = await db.query.dynamicChains.findFirst({
    where: and(
      eq(dynamicChains.orgId, orgId),
      eq(dynamicChains.modePill, modePill),
      sql`${dynamicChains.pathKeys} = ${pathKeysJson}::jsonb`
    ),
  })
  if (existing) return existing.id

  // Priority 14 (GAP-DCMD rich schema slice): compute the path-label domain
  // string once, before the insert, so it can seed classification.domain on
  // the same write -- genuine reuse of a value this chokepoint already
  // derives for capability-embedding indexing below (Wave 173), not a new
  // fabricated computation. See ai-os/DCMD-SCHEMA-DESIGN.md's classification
  // section for why this is the one DCMD sub-field with real wiring this
  // pass rather than schema-only.
  const labels = Array.isArray(pathLabels) ? pathLabels.map((l) => String(l)) : []
  const domain = labels.join(" > ") || null

  const [created] = await db.insert(dynamicChains).values({
    orgId, modePill, pathKeys, pathLabels, createdById: userId, status: "approved",
    classification: { domain },
  }).returning()

  // Wave 173 (GAP-DYNAMIC-CHAIN-DEDUP): index the newly created chain the
  // same way worker agents/automation rules/modules are indexed at their
  // own creation points -- best-effort, never blocks chain creation on a
  // failed embedding call.
  if (created) {
    indexCapability(
      "dynamic_chain",
      created.id,
      buildCapabilityContent({ name: modePill, domain }),
      orgId
    ).catch((err) => console.error(`Failed to index dynamic chain ${created.id}:`, err))
  }

  return created?.id ?? null
}

export async function listTasks(ctx: ReadContext & { userId?: string }, filters: { assistantId?: string }) {
  const { orgId, userId } = ctx
  const result = await withTenantContext({ orgId, userId }, (db) =>
    db.query.tasks.findMany({
      where: filters.assistantId ? eq(tasks.assistantId, filters.assistantId) : undefined,
      // Wave 148 (Phase4_Implementation_Plan.md, "task queue + priority"):
      // higher priority first, oldest-first as the tiebreaker within the
      // same priority -- this ordering IS the queue, no separate queue
      // table. Every existing row has priority 0, so this is a no-op
      // reorder for pre-Wave-148 data (falls back to pure createdAt order).
      orderBy: [desc(tasks.priority), asc(tasks.createdAt)],
    })
  )
  return {
    tasks: result.map((t) => ({
      id: t.id, title: t.title, description: t.description, status: t.status, priority: t.priority,
      assistantId: t.assistantId, createdAt: t.createdAt.toISOString(), updatedAt: t.updatedAt.toISOString(),
    })),
  }
}

export async function createTask(ctx: ServiceContext, input: {
  title: string; description?: string; assistantId?: string; projectId?: string
  // Structured (non-LLM) dispatch: set when the task was created from a
  // completed VERI Chat chain selection rather than free text -- the worker
  // agent (or VCEL calculator) is already known, so executeTask() can skip
  // LLM planning entirely. Never trust these IDs from the client alone --
  // re-verified against the real registry below before being trusted.
  workerAgentId?: string
  agentInputs?: Record<string, unknown>
  engineKey?: string
  engineInputs?: Record<string, unknown>
  // Wave 161 (Dynamic Chain ID Phase 1): the resolved Chain Selector path,
  // sent by VeriComposer alongside the task. Optional -- a free-text or
  // API-created task simply has no dynamicChainId, same as before this wave.
  modePill?: string
  chainPathKeys?: unknown[]
  chainPathLabels?: unknown[]
  // Wave 146 (VERIDIAN.docx joint implementation plan, Phase 2, High-Impact
  // Action Confirmation Gate): set true only on the caller's SECOND request,
  // after the user has explicitly confirmed a high-impact action detected on
  // the first request (see the detectHighImpactAction() check below).
  confirmed?: boolean
  // Wave 161: set on the confirmed resubmission when the user chose "Always
  // Approve"/"Always Reject" instead of a one-off confirm. highImpactCategory
  // is the category the FIRST response already told the client about --
  // resent rather than re-detected, since detection is skipped once
  // confirmed:true short-circuits past it.
  savePreference?: "always_approve" | "always_reject"
  highImpactCategory?: string
}) {
  const { orgId, actor } = ctx
  if (!actor.dbUser) throw new ServiceError("Task creation requires a real user session, not an API key", 400)
  const dbUser = actor.dbUser

  const title = input.title?.trim() ?? ""
  if (!title) throw new ServiceError("title is required", 400)
  const description = input.description?.trim() || null
  const assistantId = input.assistantId ?? null

  // D8/D5.B4.S2 (tree4-unified 50-completion-plan, areas 1+2, "minimum
  // 2-level chain selection gate"): the real, non-bypassable enforcement
  // point -- this is the sole place a dynamic_chains row (and the task
  // itself) gets created (see resolveDynamicChainId below), so gating here
  // covers every caller, not just VeriComposer's own client-side check.
  const chainDepthCheck = validateChainDepth(input.chainPathKeys)
  if (!chainDepthCheck.valid) throw new ServiceError(chainDepthCheck.reason, 400)

  // Wave 146: VERIDIAN.docx CSV 205 §26's Human-in-Control Rules --
  // Delete/Payment/Approval/Rejection/Compliance-Submission/Access-Change/
  // Data-Export/Configuration-Change intents must never execute silently.
  // Deterministic keyword gate (no LLM call, cannot be prompt-injected
  // around) -- checked against title+description, the same text the task is
  // actually created from. Returns early with NO task row inserted and NO
  // execution triggered until the caller resubmits with confirmed: true.
  if (!input.confirmed) {
    // AI Architecture / Explainability & Transparency gap-closure
    // (2026-07-18): "Explain Risks Before Actions" -- logs every
    // classification (matched or not) for later sample audit of misses,
    // not just the ones that already trip the confirmation gate below.
    // detectHighImpactAction stays a pure, side-effect-free function (per
    // its own doc comment) so it's safe to call here purely for the audit
    // trail, separately from the real gating decision below.
    const detection = detectHighImpactAction(`${title} ${description ?? ""}`)
    logHighImpactClassification({
      orgId, userId: dbUser.id, layerKey: "task_oa", eventType: "task.create",
      text: `${title} ${description ?? ""}`, detection,
    })
    // Human Override & Approval (HAB-02 gap closure, 2026-07-18): the
    // detect-and-shape logic itself now lives in checkHighImpactConfirmation
    // (high-impact-action-detector.ts), the one shared, reusable gate, not
    // reimplemented inline here. What stays here is the part that IS
    // genuinely task/chat-specific: the saved always-approve/always-reject
    // preference lookup below.
    const confirmationCheck = checkHighImpactConfirmation({ text: `${title} ${description ?? ""}` })
    if (confirmationCheck.needsConfirmation) {
      // Wave 161 (VERI_CHAT_GOVERNANCE.md, "VERI-Assisted Communication
      // Protocol"): a user who already said "always approve"/"always
      // reject" for this action category shouldn't be asked again every
      // single time. Type-level only (scopeId omitted) -- per-conversation/
      // task/workflow scoping is real but not wired into any UI yet (task
      // #20's "deferred" note), so only the simplest, highest-value scope
      // is checked here.
      const preference = await withTenantContext({ orgId, userId: dbUser.id }, (db) =>
        checkApprovalPreference(db, orgId, dbUser.id, confirmationCheck.category, "communication_type")
      )
      if (preference === "always_reject") {
        throw new ServiceError(`This action type is set to always-reject per your saved preference. Change it in Settings if that's no longer right.`, 403)
      }
      if (preference !== "always_approve") {
        return {
          needsConfirmation: true as const,
          category: confirmationCheck.category,
          categoryLabel: confirmationCheck.categoryLabel,
          matchedPhrase: confirmationCheck.matchedPhrase,
        }
      }
      // preference === "always_approve": fall through exactly as if the
      // caller had sent confirmed: true.
    }
  } else if (input.savePreference && input.highImpactCategory) {
    // Confirmed resubmission carrying an explicit "always approve/reject"
    // choice -- persist it before proceeding. Never activated automatically
    // (VERI_CHAT_GOVERNANCE.md's own rule); this only runs because the user
    // just clicked that specific button.
    await withTenantContext({ orgId, userId: dbUser.id }, (db) =>
      saveApprovalPreference(db, orgId, dbUser.id, input.highImpactCategory!, "communication_type", undefined, input.savePreference!)
    )
  }
  const projectId = input.projectId ?? null // Wave 19: optional Product/Project (L2) scope

  const result = await withTenantContext({ orgId, userId: dbUser.id }, async (db) => {
    if (assistantId) {
      const assistant = await db.query.aiAssistants.findFirst({ where: eq(aiAssistants.id, assistantId) })
      if (!assistant) return null
    }

    // Defense in depth: the composer already only ever sends a workerAgentId
    // it pulled off a real capability-tree leaf, but a client is never
    // trusted for authorization -- re-verify server-side that this id
    // resolves to a real, human-approved, dispatchable agent before storing
    // it as the task's resolved dispatch target. If it doesn't check out,
    // silently fall through to the ordinary LLM-planning path rather than
    // failing the whole task creation.
    let resolvedWorkerAgentId: string | null = null
    if (input.workerAgentId) {
      const agent = await db.query.workerAgents.findFirst({
        where: and(
          eq(workerAgents.id, input.workerAgentId),
          eq(workerAgents.tier, "global"),
          inArray(workerAgents.lifecycleStatus, ["approved", "published"])
        ),
      })
      if (agent?.codeReference) resolvedWorkerAgentId = agent.id
    }

    const dynamicChainId = input.modePill && input.chainPathKeys?.length
      ? await resolveDynamicChainId(db, orgId, dbUser.id, input.modePill, input.chainPathKeys, input.chainPathLabels ?? input.chainPathKeys)
      : null

    const [created] = await db.insert(tasks).values({
      orgId, userId: dbUser.id, assignedById: dbUser.id, assistantId, projectId, title, description,
      status: "in_progress", resolvedWorkerAgentId, dynamicChainId,
    }).returning()
    return created
  })

  if (!result) throw new ServiceError("Assistant not found", 404)

  // Best-effort, additive -- never blocks task creation on a failed
  // embedding call, same contract as the dynamic-chain indexing below.
  indexTaskForDedup(orgId, result.id, result.title, result.description)
    .catch((err) => console.error(`Failed to index task ${result.id} for duplicate detection:`, err))

  // Wave 173 (GAP-DCMD, "a chain's task creates an approval"): best-effort,
  // additive -- only fires when this task actually resolved a dynamicChainId
  // AND the org has configured a real approval_workflow_definitions row for
  // entityType 'tasks' (startApprovalWorkflow returns null otherwise, per
  // its own documented "no workflow configured = auto-approved" contract).
  // Never blocks or delays the task's own creation/execution below.
  if (result.dynamicChainId) {
    startApprovalWorkflow(
      { orgId, userId: dbUser.id, dbUser },
      { entityType: "tasks", entityId: result.id, entityData: {}, dynamicChainId: result.dynamicChainId }
    ).catch((err) => console.error(`Failed to start approval workflow for chain-originated task ${result.id}:`, err))
  }

  await executeTask(
    orgId, dbUser.id, result.id, result.title, result.description, result.projectId, result.assistantId,
    result.resolvedWorkerAgentId, input.engineKey, input.engineInputs, input.agentInputs
  )
  const final = await withTenantContext({ orgId, userId: dbUser.id }, (db) => db.query.tasks.findFirst({ where: eq(tasks.id, result.id) }))

  return {
    id: result.id, title: result.title, description: result.description,
    status: final?.status ?? result.status, priority: result.priority, assistantId: result.assistantId, createdAt: result.createdAt.toISOString(),
  }
}

export async function getTask(ctx: ReadContext & { userId?: string }, id: string) {
  const { orgId, userId } = ctx
  const result = await withTenantContext({ orgId, userId }, async (db) => {
    const task = await db.query.tasks.findFirst({ where: eq(tasks.id, id) })
    if (!task) return null
    const [plan, chat, owner] = await Promise.all([
      db.query.taskExecutionPlan.findMany({ where: eq(taskExecutionPlan.taskId, id), orderBy: asc(taskExecutionPlan.stepNumber) }),
      db.query.taskChatMessages.findMany({ where: eq(taskChatMessages.taskId, id), orderBy: asc(taskChatMessages.createdAt) }),
      // D5.B6 (persistent visibility panel, "Owner"): tasks has no single
      // owner column -- userId is the assignee, assignedById is who assigned
      // it. Assignee is what "Owner" means in every other owner-facing
      // surface in this app (ToDoTab, listMyTodos), so that's what's
      // resolved here, additive to the response shape.
      task.userId ? db.query.users.findFirst({ where: eq(users.id, task.userId), columns: { id: true, name: true } }) : Promise.resolve(null),
    ])
    return { task, plan, chat, owner }
  })

  if (!result) throw new ServiceError("Task not found", 404)
  const { task, plan, chat, owner } = result

  return {
    id: task.id, title: task.title, description: task.description, status: task.status, priority: task.priority, assistantId: task.assistantId,
    owner: owner ? { id: owner.id, name: owner.name } : null,
    createdAt: task.createdAt.toISOString(), updatedAt: task.updatedAt.toISOString(),
    executionPlan: plan.map((p) => ({ id: p.id, stepNumber: p.stepNumber, workerAgentId: p.workerAgentId, description: p.description, status: p.status })),
    chat: chat.map((m) => ({ id: m.id, role: m.role, content: m.content, createdAt: m.createdAt.toISOString() })),
  }
}

// Exported so task-reprioritization-service.ts's deterministic recalculation
// validates against the exact same bound this codebase already enforces on
// human-set priority, instead of re-declaring its own copy of "0-3."
export const VALID_PRIORITIES = [0, 1, 2, 3] // Low, Normal, High, Urgent

export async function updateTask(ctx: ServiceContext, id: string, input: { status?: string; title?: string; description?: string; priority?: number }) {
  const { orgId, actor } = ctx
  const userId = actor.dbUser?.id
  const result = await withTenantContext({ orgId, userId }, async (db) => {
    const existing = await db.query.tasks.findFirst({ where: eq(tasks.id, id) })
    if (!existing) return null

    const updates: Record<string, unknown> = { updatedAt: new Date() }
    if (input.status !== undefined) {
      if (!VALID_STATUSES.includes(input.status)) return { ok: false as const, error: `status must be one of: ${VALID_STATUSES.join(", ")}` }
      updates.status = input.status
    }
    if (input.title !== undefined) {
      const trimmed = input.title.trim()
      if (!trimmed) return { ok: false as const, error: "title cannot be empty" }
      updates.title = trimmed
    }
    if (input.description !== undefined) updates.description = input.description?.trim() ?? null
    // Wave 148: user-controlled queue reordering. Bounded to a known small
    // range (0-3) rather than accepting an arbitrary integer -- keeps the
    // "queue" meaningfully ordered instead of drifting to unbounded values.
    if (input.priority !== undefined) {
      if (!VALID_PRIORITIES.includes(input.priority)) return { ok: false as const, error: `priority must be one of: ${VALID_PRIORITIES.join(", ")}` }
      updates.priority = input.priority
    }

    const [updated] = await db.update(tasks).set(updates).where(eq(tasks.id, id)).returning()

    // D15.B2.S1 named event #2, "Feature Completed -> Functional Audit":
    // fires exactly once, on the real transition into 'completed' (not on
    // every save of an already-completed task) -- see
    // audit-event-triggers.ts's didFeatureComplete() for the pure gate.
    // Best-effort: a logging failure must never break the status update
    // that already committed above.
    if (didFeatureComplete(existing.status, updated.status)) {
      await recordAuditTrigger({
        tx: db, event: "feature_completed", entityType: "task", entityId: updated.id, orgId,
        ...actor, details: `Task "${updated.title}" marked completed.`,
      }).catch((err) => console.error(`[audit-trigger] failed to record feature_completed for task ${updated.id}:`, err))

      // RES-02 Phase 1 (PLATFORM_STRATEGY.md 29.3): the same real
      // transition as feature_completed above, fed into the Narrow Monitor
      // registry instead of the audit-trigger one. Best-effort, same
      // posture as the recordAuditTrigger call above.
      await runTaskCompletionMonitor(db, orgId, actor, {
        taskId: updated.id, title: updated.title, dueDate: updated.dueDate, completedAt: updated.updatedAt,
      }).catch((err) => console.error(`[task-completion-monitor] failed for task ${updated.id}:`, err))
    }

    return { ok: true as const, updated }
  })

  if (!result) throw new ServiceError("Task not found", 404)
  if (!result.ok) throw new ServiceError(result.error, 400)
  const { updated } = result

  if (input.title !== undefined || input.description !== undefined) {
    indexTaskForDedup(orgId, updated.id, updated.title, updated.description)
      .catch((err) => console.error(`Failed to re-index task ${updated.id} for duplicate detection:`, err))
  }

  return { id: updated.id, title: updated.title, description: updated.description, status: updated.status, priority: updated.priority, updatedAt: updated.updatedAt.toISOString() }
}

// Wave 11: a lightweight status-only read, for the new MCP get_task_status
// tool -- deliberately narrower than getTask() (no plan/chat) since a
// customer's AI asking "is this task done" doesn't need the full detail.
export async function getTaskStatus(ctx: ReadContext & { userId?: string }, id: string) {
  const { orgId, userId } = ctx
  const task = await withTenantContext({ orgId, userId }, (db) => db.query.tasks.findFirst({ where: eq(tasks.id, id) }))
  if (!task) throw new ServiceError("Task not found", 404)
  return { id: task.id, title: task.title, status: task.status, updatedAt: task.updatedAt.toISOString() }
}

// Wave 15: Home Page's "To Do" tab -- tasks genuinely assigned TO this
// person, distinct from listTasks() (which returns every task in the org
// tasks RLS lets through, unfiltered by owner).
export async function listMyTodos(ctx: ReadContext & { userId: string }) {
  const { orgId, userId } = ctx
  const result = await withTenantContext({ orgId, userId }, (db) =>
    db.query.tasks.findMany({
      where: eq(tasks.userId, userId),
      orderBy: [desc(tasks.priority), asc(tasks.createdAt)],
    })
  )
  return {
    tasks: result.map((t) => ({
      id: t.id, title: t.title, description: t.description, status: t.status, priority: t.priority,
      createdAt: t.createdAt.toISOString(), updatedAt: t.updatedAt.toISOString(),
    })),
  }
}

// Tasks this person handed to someone else -- kept separate from
// listMyTodos() so a manager's own personal to-do list never gets padded
// out with work they only delegated, per the plan's explicit distinction.
export async function listAssignedByMe(ctx: ReadContext & { userId: string }) {
  const { orgId, userId } = ctx
  const result = await withTenantContext({ orgId, userId }, (db) =>
    db.query.tasks.findMany({
      where: and(eq(tasks.assignedById, userId), ne(tasks.userId, userId)),
      orderBy: [desc(tasks.priority), asc(tasks.createdAt)],
    })
  )
  return {
    tasks: result.map((t) => ({
      id: t.id, title: t.title, description: t.description, status: t.status, priority: t.priority,
      assigneeId: t.userId, createdAt: t.createdAt.toISOString(), updatedAt: t.updatedAt.toISOString(),
    })),
  }
}

// subagent/audit-lifecycle (tree4-unified/50-completion-plan Priority 2
// item 3, D22/U-D22.B1.S1 "Follow-up, SLA & Continuous Planning"): before
// this, `tasks` -- the single most fundamental Work Object in this
// codebase -- had a dueDate column (Wave 44) and ZERO overdue detection of
// any kind, confirmed by direct search; only compliance_items
// (compliance-service.ts's syncOverdue) and tickets (ticket-service.ts's
// checkTicketSlaBreaches) had this coverage. Mirrors checkTicketSlaBreaches'
// exact shape: re-notifies once per scheduled run until the task leaves a
// non-terminal status (matching that function's own re-alert-until-resolved
// precedent), not a fire-once flag. Honest scope, stated plainly: this
// closes "Missed-timelines" for one more domain object, not the sub-branch's
// full "any Work Object" generality -- Blocked/Delegated/Waiting-dependency/
// Inactive states have no equivalent in `tasks.status`'s 5-value enum
// (pending/in_progress/completed/failed/cancelled has no "blocked" or
// "delegated" value), so those 4 of the requirement's 6 named monitored-
// state categories remain genuinely out of reach without a schema change
// this pass didn't attempt.

/** Pure decision: is this task's dueDate/status combination one checkTaskOverdue should notify on right now? Extracted so the actual notify condition is unit-testable without a DB, matching validateChainDepth's own precedent above. */
export function isTaskOverdue(task: { dueDate: Date | null; status: string }, now: Date): boolean {
  if (!task.dueDate) return false
  if (task.status === "completed" || task.status === "cancelled") return false
  return task.dueDate.getTime() < now.getTime()
}

/**
 * Cross-org by necessity (a cron job, not a request scoped to one tenant) --
 * uses the raw db client, same posture as ticket-service.ts's
 * checkTicketSlaBreaches and audit-cadence-scan.ts's scanForL2Violations.
 * Notifies the task's assignee (userId) and whoever assigned it
 * (assignedById), when the two differ, using the existing
 * 'deadline_reminder' notificationTypeEnum value (already defined in
 * schema.ts, previously unused by any tasks-domain writer).
 */
export async function checkTaskOverdue(): Promise<{ overdue: number }> {
  const now = new Date()
  const overdue = await db.query.tasks.findMany({
    where: and(lt(tasks.dueDate, now), notInArray(tasks.status, ["completed", "cancelled"])),
  })

  for (const task of overdue) {
    const notifyIds = new Set([task.userId, task.assignedById].filter((id): id is string => Boolean(id)))
    for (const userId of notifyIds) {
      await db.insert(notifications).values({
        userId,
        title: `Task overdue: ${task.title}`,
        message: `Task "${task.title}" missed its due date (${task.dueDate?.toISOString()}) and is still ${task.status}.`,
        type: "deadline_reminder",
        metadata: { taskId: task.id },
      })
    }
  }

  return { overdue: overdue.length }
}
