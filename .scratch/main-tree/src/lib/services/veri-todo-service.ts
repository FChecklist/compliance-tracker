// Wave 33 (VERI To Do, PLATFORM_STRATEGY.md §16). Formalizes a RULE (what
// counts as "pending work" for a user) rather than adding new schema.
// task-service.ts's listMyTodos() -- confirmed by reading it -- only ever
// queried the bare `tasks` table, despite Wave 15's Home page describing
// itself as a "universal To Do." This is the concrete fix: a genuine union
// across tasks, pending instruction_commitments, and assigned pms_issues
// whose status isn't in the completed/cancelled group. listMyTodos() itself
// is left untouched (other callers depend on its exact existing shape) --
// this is a new, additive function.
import {
  tasks, instructionCommitments, pmsIssues, pmsIssueAssignees, pmsIssueStatuses, projects,
} from "@/lib/db"
import { withTenantContext } from "@/lib/db/tenant-scoped"
import { eq, and, inArray } from "drizzle-orm"

export type VeriTodoContext = { orgId: string; userId: string }

export type VeriTodoItem = {
  id: string
  source: "task" | "instruction" | "pms_issue"
  title: string
  description: string | null
  status: string
  dueDate: string | null
  createdAt: string
  href: string
  // Wave 148 (Phase4_Implementation_Plan.md, "task queue + priority"): only
  // `task`-sourced items have a real priority column today (instructions/
  // pms_issues don't) -- null for those, treated as priority 0 for sorting
  // so they don't jump ahead of or fall behind a default-priority task.
  priority: number | null
}

export async function listVeriTodos(ctx: VeriTodoContext): Promise<{ items: VeriTodoItem[] }> {
  return withTenantContext({ orgId: ctx.orgId, userId: ctx.userId }, async (db) => {
    const taskRows = await db.query.tasks.findMany({
      where: and(eq(tasks.userId, ctx.userId), inArray(tasks.status, ["pending", "in_progress"])),
    })

    const commitmentRows = await db.query.instructionCommitments.findMany({
      where: and(eq(instructionCommitments.orgId, ctx.orgId), eq(instructionCommitments.assigneeId, ctx.userId), eq(instructionCommitments.status, "pending")),
    })

    const assigneeRows = await db.query.pmsIssueAssignees.findMany({ where: eq(pmsIssueAssignees.userId, ctx.userId) })
    const issueIds = assigneeRows.map((a) => a.issueId)
    const issueRows = issueIds.length
      ? await db.query.pmsIssues.findMany({ where: and(eq(pmsIssues.orgId, ctx.orgId), inArray(pmsIssues.id, issueIds), eq(pmsIssues.isArchived, false)) })
      : []
    const statusIds = [...new Set(issueRows.map((i) => i.statusId))]
    const statusRows = statusIds.length
      ? await db.query.pmsIssueStatuses.findMany({ where: inArray(pmsIssueStatuses.id, statusIds) })
      : []
    const statusById = new Map(statusRows.map((s) => [s.id, s]))
    const openIssues = issueRows.filter((i) => {
      const group = statusById.get(i.statusId)?.group
      return group !== "completed" && group !== "cancelled"
    })
    const projectIds = [...new Set(openIssues.map((i) => i.projectId))]
    const projectRows = projectIds.length
      ? await db.query.projects.findMany({ where: inArray(projects.id, projectIds) })
      : []
    const projectById = new Map(projectRows.map((p) => [p.id, p]))

    const items: VeriTodoItem[] = [
      ...taskRows.map((t) => ({
        id: t.id, source: "task" as const, title: t.title, description: t.description, status: t.status,
        dueDate: null, createdAt: t.createdAt.toISOString(), href: "/tasks", priority: t.priority,
      })),
      ...commitmentRows.map((c) => ({
        id: c.id, source: "instruction" as const, title: c.describedAction, description: null, status: c.status,
        dueDate: c.dueDate?.toISOString() ?? null, createdAt: c.createdAt.toISOString(), href: "/chat", priority: null,
      })),
      ...openIssues.map((i) => ({
        id: i.id, source: "pms_issue" as const, title: i.title, description: i.description, status: statusById.get(i.statusId)?.name ?? "Open",
        dueDate: i.dueDate ? new Date(i.dueDate).toISOString() : null, createdAt: i.createdAt.toISOString(),
        href: `/pms/${projectById.get(i.projectId)?.id ?? i.projectId}/issues`, priority: null,
      })),
    ]

    // Wave 148: this is the real "queue" -- higher priority first, then
    // oldest-first within the same priority (first in, first out), matching
    // "user can give one task after another, all tasks become in queue...
    // can prioritize which task to be done earlier." Previously sorted
    // newest-first by createdAt alone; a deliberate behavior change.
    items.sort((a, b) => {
      const priorityDiff = (b.priority ?? 0) - (a.priority ?? 0)
      if (priorityDiff !== 0) return priorityDiff
      return new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
    })
    return { items }
  })
}
