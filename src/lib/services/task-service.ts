// Wave 11 service layer -- extracted from src/app/api/tasks/{route,
// [id]/route}.ts verbatim (behavior-identical refactor).
import { tasks, aiAssistants } from "@/lib/db"
import { withTenantContext } from "@/lib/db/tenant-scoped"
import { desc, eq, asc } from "drizzle-orm"
import { executeTask } from "@/lib/task-execution-engine"
import { taskExecutionPlan, taskChatMessages } from "@/lib/db"
import { ServiceError } from "./compliance-service"
export { ServiceError }
import type { ServiceContext, ReadContext } from "./context"

const VALID_STATUSES = ["pending", "in_progress", "completed", "failed", "cancelled"]

export async function listTasks(ctx: ReadContext & { userId?: string }, filters: { assistantId?: string }) {
  const { orgId, userId } = ctx
  const result = await withTenantContext({ orgId, userId }, (db) =>
    db.query.tasks.findMany({
      where: filters.assistantId ? eq(tasks.assistantId, filters.assistantId) : undefined,
      orderBy: desc(tasks.createdAt),
    })
  )
  return {
    tasks: result.map((t) => ({
      id: t.id, title: t.title, description: t.description, status: t.status,
      assistantId: t.assistantId, createdAt: t.createdAt.toISOString(), updatedAt: t.updatedAt.toISOString(),
    })),
  }
}

export async function createTask(ctx: ServiceContext, input: { title: string; description?: string; assistantId?: string }) {
  const { orgId, actor } = ctx
  if (!actor.dbUser) throw new ServiceError("Task creation requires a real user session, not an API key", 400)
  const dbUser = actor.dbUser

  const title = input.title?.trim() ?? ""
  if (!title) throw new ServiceError("title is required", 400)
  const description = input.description?.trim() || null
  const assistantId = input.assistantId ?? null

  const result = await withTenantContext({ orgId, userId: dbUser.id }, async (db) => {
    if (assistantId) {
      const assistant = await db.query.aiAssistants.findFirst({ where: eq(aiAssistants.id, assistantId) })
      if (!assistant) return null
    }
    const [created] = await db.insert(tasks).values({ orgId, userId: dbUser.id, assistantId, title, description, status: "in_progress" }).returning()
    return created
  })

  if (!result) throw new ServiceError("Assistant not found", 404)

  await executeTask(orgId, dbUser.id, result.id, result.title, result.description)
  const final = await withTenantContext({ orgId, userId: dbUser.id }, (db) => db.query.tasks.findFirst({ where: eq(tasks.id, result.id) }))

  return {
    id: result.id, title: result.title, description: result.description,
    status: final?.status ?? result.status, assistantId: result.assistantId, createdAt: result.createdAt.toISOString(),
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
    id: task.id, title: task.title, description: task.description, status: task.status, assistantId: task.assistantId,
    createdAt: task.createdAt.toISOString(), updatedAt: task.updatedAt.toISOString(),
    executionPlan: plan.map((p) => ({ id: p.id, stepNumber: p.stepNumber, workerAgentId: p.workerAgentId, description: p.description, status: p.status })),
    chat: chat.map((m) => ({ id: m.id, role: m.role, content: m.content, createdAt: m.createdAt.toISOString() })),
  }
}

export async function updateTask(ctx: ServiceContext, id: string, input: { status?: string; title?: string; description?: string }) {
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

    const [updated] = await db.update(tasks).set(updates).where(eq(tasks.id, id)).returning()
    return { ok: true as const, updated }
  })

  if (!result) throw new ServiceError("Task not found", 404)
  if (!result.ok) throw new ServiceError(result.error, 400)
  const { updated } = result
  return { id: updated.id, title: updated.title, description: updated.description, status: updated.status, updatedAt: updated.updatedAt.toISOString() }
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
