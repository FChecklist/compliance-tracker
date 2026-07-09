// Wave 11 service layer -- extracted from src/app/api/tasks/{route,
// [id]/route}.ts verbatim (behavior-identical refactor).
import { tasks, aiAssistants, workerAgents } from "@/lib/db"
import { withTenantContext } from "@/lib/db/tenant-scoped"
import { desc, eq, asc, and, ne, inArray } from "drizzle-orm"
import { executeTask } from "@/lib/task-execution-engine"
import { taskExecutionPlan, taskChatMessages } from "@/lib/db"
import { ServiceError } from "./compliance-service"
export { ServiceError }
import type { ServiceContext, ReadContext } from "./context"
import { detectHighImpactAction, HIGH_IMPACT_CATEGORY_LABELS } from "@/lib/high-impact-action-detector"

const VALID_STATUSES = ["pending", "in_progress", "completed", "failed", "cancelled"]

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
  // Wave 146 (VERIDIAN.docx joint implementation plan, Phase 2, High-Impact
  // Action Confirmation Gate): set true only on the caller's SECOND request,
  // after the user has explicitly confirmed a high-impact action detected on
  // the first request (see the detectHighImpactAction() check below).
  confirmed?: boolean
}) {
  const { orgId, actor } = ctx
  if (!actor.dbUser) throw new ServiceError("Task creation requires a real user session, not an API key", 400)
  const dbUser = actor.dbUser

  const title = input.title?.trim() ?? ""
  if (!title) throw new ServiceError("title is required", 400)
  const description = input.description?.trim() || null
  const assistantId = input.assistantId ?? null

  // Wave 146: VERIDIAN.docx CSV 205 §26's Human-in-Control Rules --
  // Delete/Payment/Approval/Rejection/Compliance-Submission/Access-Change/
  // Data-Export/Configuration-Change intents must never execute silently.
  // Deterministic keyword gate (no LLM call, cannot be prompt-injected
  // around) -- checked against title+description, the same text the task is
  // actually created from. Returns early with NO task row inserted and NO
  // execution triggered until the caller resubmits with confirmed: true.
  if (!input.confirmed) {
    const detection = detectHighImpactAction(`${title} ${description ?? ""}`)
    if (detection.isHighImpact) {
      return {
        needsConfirmation: true as const,
        category: detection.category,
        categoryLabel: detection.category ? HIGH_IMPACT_CATEGORY_LABELS[detection.category] : null,
        matchedPhrase: detection.matchedPhrase,
      }
    }
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

    const [created] = await db.insert(tasks).values({
      orgId, userId: dbUser.id, assignedById: dbUser.id, assistantId, projectId, title, description,
      status: "in_progress", resolvedWorkerAgentId,
    }).returning()
    return created
  })

  if (!result) throw new ServiceError("Assistant not found", 404)

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
    const [plan, chat] = await Promise.all([
      db.query.taskExecutionPlan.findMany({ where: eq(taskExecutionPlan.taskId, id), orderBy: asc(taskExecutionPlan.stepNumber) }),
      db.query.taskChatMessages.findMany({ where: eq(taskChatMessages.taskId, id), orderBy: asc(taskChatMessages.createdAt) }),
    ])
    return { task, plan, chat }
  })

  if (!result) throw new ServiceError("Task not found", 404)
  const { task, plan, chat } = result

  return {
    id: task.id, title: task.title, description: task.description, status: task.status, priority: task.priority, assistantId: task.assistantId,
    createdAt: task.createdAt.toISOString(), updatedAt: task.updatedAt.toISOString(),
    executionPlan: plan.map((p) => ({ id: p.id, stepNumber: p.stepNumber, workerAgentId: p.workerAgentId, description: p.description, status: p.status })),
    chat: chat.map((m) => ({ id: m.id, role: m.role, content: m.content, createdAt: m.createdAt.toISOString() })),
  }
}

const VALID_PRIORITIES = [0, 1, 2, 3] // Low, Normal, High, Urgent

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
    return { ok: true as const, updated }
  })

  if (!result) throw new ServiceError("Task not found", 404)
  if (!result.ok) throw new ServiceError(result.error, 400)
  const { updated } = result
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
