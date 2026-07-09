// Wave 140 (PROJEXA gap analysis): Gantt/critical-path/baseline/
// resource-leveling parity with Asana/Monday/MS Project. Pure read/compute
// layer over the existing pms_issues + pms_issue_relations graph (Wave 25/
// 116) -- critical path is never stored, only computed on request from
// startDate/dueDate + typed relations/lagDays that already exist.
import {
  pmsIssues, pmsIssueRelations, pmsMilestones,
  pmsScheduleBaselines, pmsBaselineIssueSnapshots, pmsResourceAllocations,
} from "@/lib/db"
import { withTenantContext } from "@/lib/db/tenant-scoped"
import { and, eq, inArray } from "drizzle-orm"
import { ServiceError } from "./compliance-service"
export { ServiceError }

export type GanttTask = {
  id: string
  title: string
  startDate: string | null
  dueDate: string | null
  completionPercentage: number
  milestoneId: string | null
  parentIssueId: string | null
  isCritical: boolean
  floatDays: number | null
}

export type GanttDependency = { predecessorId: string; successorId: string; lagDays: number }

// A 'blocks' row (issueId -> relatedIssueId) means issueId is the
// predecessor. A 'blocked_by' row is the mirror-image, stored from the
// other issue's perspective when a caller records it that way -- neither
// direction is auto-created for the other (confirmed in
// pms-issue-service.ts's addIssueRelation()), so both must be normalized
// into the same predecessor->successor edge shape here.
function normalizeEdges(relations: (typeof pmsIssueRelations.$inferSelect)[]): GanttDependency[] {
  const edges: GanttDependency[] = []
  for (const r of relations) {
    if (r.relationType === "blocks") {
      edges.push({ predecessorId: r.issueId, successorId: r.relatedIssueId, lagDays: r.lagDays ?? 0 })
    } else if (r.relationType === "blocked_by") {
      edges.push({ predecessorId: r.relatedIssueId, successorId: r.issueId, lagDays: r.lagDays ?? 0 })
    }
  }
  return edges
}

function daysBetween(a: string, b: string): number {
  return Math.round((new Date(b).getTime() - new Date(a).getTime()) / 86400000)
}
function addDays(date: string, days: number): string {
  const d = new Date(date)
  d.setDate(d.getDate() + days)
  return d.toISOString().slice(0, 10)
}

/**
 * Critical Path Method: forward pass (earliest start/finish) then backward
 * pass (latest start/finish) over the predecessor->successor DAG. Float =
 * LS - ES; float 0 (within a day of rounding) marks the critical path.
 * Issues with no relations at all get float=null (not part of any chain,
 * "critical" is meaningless for an isolated task).
 */
export async function calculateCriticalPath(ctx: { orgId: string }, projectId: string): Promise<GanttTask[]> {
  return withTenantContext({ orgId: ctx.orgId }, async (db) => {
    const issues = await db.query.pmsIssues.findMany({
      where: and(eq(pmsIssues.orgId, ctx.orgId), eq(pmsIssues.projectId, projectId), eq(pmsIssues.isArchived, false)),
    })
    const issueIds = issues.map((i) => i.id)
    if (issueIds.length === 0) return []

    const relations = await db.query.pmsIssueRelations.findMany({
      where: and(eq(pmsIssueRelations.orgId, ctx.orgId), inArray(pmsIssueRelations.issueId, issueIds)),
    })
    const edges = normalizeEdges(relations).filter((e) => issueIds.includes(e.predecessorId) && issueIds.includes(e.successorId))

    // Duration in days; issues missing both dates get a nominal 1-day
    // duration so they can still sit in the graph without dividing by zero.
    const duration = new Map<string, number>()
    const es = new Map<string, number>() // earliest start, in days from project epoch
    const ef = new Map<string, number>()
    for (const issue of issues) {
      const dur = issue.startDate && issue.dueDate ? Math.max(1, daysBetween(issue.startDate, issue.dueDate)) : 1
      duration.set(issue.id, dur)
    }

    const successors = new Map<string, GanttDependency[]>()
    const predecessors = new Map<string, GanttDependency[]>()
    for (const e of edges) {
      if (!successors.has(e.predecessorId)) successors.set(e.predecessorId, [])
      successors.get(e.predecessorId)!.push(e)
      if (!predecessors.has(e.successorId)) predecessors.set(e.successorId, [])
      predecessors.get(e.successorId)!.push(e)
    }

    // Topological order via Kahn's algorithm -- a cycle (shouldn't happen
    // with real construction dependencies, but user data can be wrong)
    // just leaves the remaining nodes unordered at the end; they get
    // float=null rather than crashing the whole calculation.
    const inDegree = new Map<string, number>(issueIds.map((id) => [id, 0]))
    for (const e of edges) inDegree.set(e.successorId, (inDegree.get(e.successorId) ?? 0) + 1)
    const queue = issueIds.filter((id) => (inDegree.get(id) ?? 0) === 0)
    const topoOrder: string[] = []
    const inDegreeWork = new Map(inDegree)
    while (queue.length > 0) {
      const id = queue.shift()!
      topoOrder.push(id)
      for (const e of successors.get(id) ?? []) {
        const remaining = (inDegreeWork.get(e.successorId) ?? 0) - 1
        inDegreeWork.set(e.successorId, remaining)
        if (remaining === 0) queue.push(e.successorId)
      }
    }
    const hasCycle = topoOrder.length !== issueIds.length
    const orderedIds = hasCycle ? issueIds : topoOrder

    // Forward pass
    for (const id of orderedIds) {
      const preds = predecessors.get(id) ?? []
      const startFromPreds = preds.length === 0 ? 0 : Math.max(...preds.map((p) => (ef.get(p.predecessorId) ?? 0) + p.lagDays))
      es.set(id, startFromPreds)
      ef.set(id, startFromPreds + duration.get(id)!)
    }
    const projectEnd = Math.max(...orderedIds.map((id) => ef.get(id) ?? 0))

    // Backward pass
    const ls = new Map<string, number>()
    const lf = new Map<string, number>()
    for (const id of [...orderedIds].reverse()) {
      const succs = successors.get(id) ?? []
      const finishFromSuccs = succs.length === 0 ? projectEnd : Math.min(...succs.map((s) => (ls.get(s.successorId) ?? projectEnd) - s.lagDays))
      lf.set(id, finishFromSuccs)
      ls.set(id, finishFromSuccs - duration.get(id)!)
    }

    return issues.map((issue) => {
      const inChain = (predecessors.get(issue.id)?.length ?? 0) > 0 || (successors.get(issue.id)?.length ?? 0) > 0
      const floatDays = !inChain || hasCycle ? null : (ls.get(issue.id) ?? 0) - (es.get(issue.id) ?? 0)
      return {
        id: issue.id,
        title: issue.title,
        startDate: issue.startDate,
        dueDate: issue.dueDate,
        completionPercentage: issue.completionPercentage,
        milestoneId: issue.milestoneId,
        parentIssueId: issue.parentIssueId,
        isCritical: floatDays !== null && floatDays <= 0,
        floatDays,
      }
    })
  })
}

export async function getGanttData(ctx: { orgId: string }, projectId: string) {
  const [tasks, relationsRaw, milestones] = await Promise.all([
    calculateCriticalPath(ctx, projectId),
    withTenantContext({ orgId: ctx.orgId }, (db) =>
      db.query.pmsIssues.findMany({ where: and(eq(pmsIssues.orgId, ctx.orgId), eq(pmsIssues.projectId, projectId)), columns: { id: true } })
        .then((issues) => db.query.pmsIssueRelations.findMany({ where: and(eq(pmsIssueRelations.orgId, ctx.orgId), inArray(pmsIssueRelations.issueId, issues.map((i) => i.id))) }))
    ),
    withTenantContext({ orgId: ctx.orgId }, (db) =>
      db.query.pmsMilestones.findMany({ where: and(eq(pmsMilestones.orgId, ctx.orgId), eq(pmsMilestones.projectId, projectId)) })
    ),
  ])
  const taskIds = new Set(tasks.map((t) => t.id))
  const dependencies = normalizeEdges(relationsRaw).filter((e) => taskIds.has(e.predecessorId) && taskIds.has(e.successorId))
  return { tasks, dependencies, milestones }
}

export async function captureBaseline(ctx: { orgId: string; userId: string }, projectId: string, name: string) {
  return withTenantContext({ orgId: ctx.orgId, userId: ctx.userId }, async (db) => {
    const issues = await db.query.pmsIssues.findMany({
      where: and(eq(pmsIssues.orgId, ctx.orgId), eq(pmsIssues.projectId, projectId), eq(pmsIssues.isArchived, false)),
    })
    if (issues.length === 0) throw new ServiceError("No issues to baseline for this project", 400)

    const [baseline] = await db.insert(pmsScheduleBaselines).values({
      orgId: ctx.orgId, projectId, name, capturedById: ctx.userId,
    }).returning()

    await db.insert(pmsBaselineIssueSnapshots).values(
      issues.map((issue) => ({
        baselineId: baseline.id, issueId: issue.id,
        baselineStartDate: issue.startDate, baselineDueDate: issue.dueDate,
      }))
    )
    return baseline
  })
}

export type BaselineVariance = {
  issueId: string
  title: string
  baselineStartDate: string | null
  baselineDueDate: string | null
  actualStartDate: string | null
  actualDueDate: string | null
  startVarianceDays: number | null
  dueVarianceDays: number | null
}

export async function compareBaseline(ctx: { orgId: string }, baselineId: string): Promise<{ baseline: typeof pmsScheduleBaselines.$inferSelect; variances: BaselineVariance[] }> {
  return withTenantContext({ orgId: ctx.orgId }, async (db) => {
    const baseline = await db.query.pmsScheduleBaselines.findFirst({ where: and(eq(pmsScheduleBaselines.id, baselineId), eq(pmsScheduleBaselines.orgId, ctx.orgId)) })
    if (!baseline) throw new ServiceError("Baseline not found", 404)

    const snapshots = await db.query.pmsBaselineIssueSnapshots.findMany({ where: eq(pmsBaselineIssueSnapshots.baselineId, baselineId) })
    const issueIds = snapshots.map((s) => s.issueId)
    const issues = issueIds.length ? await db.query.pmsIssues.findMany({ where: inArray(pmsIssues.id, issueIds) }) : []
    const issueById = new Map(issues.map((i) => [i.id, i]))

    const variances: BaselineVariance[] = snapshots.map((snap) => {
      const issue = issueById.get(snap.issueId)
      return {
        issueId: snap.issueId,
        title: issue?.title ?? "(deleted issue)",
        baselineStartDate: snap.baselineStartDate,
        baselineDueDate: snap.baselineDueDate,
        actualStartDate: issue?.startDate ?? null,
        actualDueDate: issue?.dueDate ?? null,
        startVarianceDays: snap.baselineStartDate && issue?.startDate ? daysBetween(snap.baselineStartDate, issue.startDate) : null,
        dueVarianceDays: snap.baselineDueDate && issue?.dueDate ? daysBetween(snap.baselineDueDate, issue.dueDate) : null,
      }
    })
    return { baseline, variances }
  })
}

export async function listBaselines(ctx: { orgId: string }, projectId: string) {
  return withTenantContext({ orgId: ctx.orgId }, (db) =>
    db.query.pmsScheduleBaselines.findMany({ where: and(eq(pmsScheduleBaselines.orgId, ctx.orgId), eq(pmsScheduleBaselines.projectId, projectId)) })
  )
}

export type ResourceAllocationInput = { userId: string; issueId?: string; allocatedHoursPerDay: number; startDate: string; endDate: string }

export async function createResourceAllocation(ctx: { orgId: string }, projectId: string, input: ResourceAllocationInput) {
  return withTenantContext({ orgId: ctx.orgId }, async (db) => {
    const [row] = await db.insert(pmsResourceAllocations).values({
      orgId: ctx.orgId, projectId, userId: input.userId, issueId: input.issueId ?? null,
      allocatedHoursPerDay: String(input.allocatedHoursPerDay), startDate: input.startDate, endDate: input.endDate,
    }).returning()
    return row
  })
}

export type WorkloadDay = { userId: string; date: string; allocatedHours: number; overAllocated: boolean }

/** Sums every active allocation per user per calendar day; flags days over an 8h/day default capacity. */
export async function getWorkload(ctx: { orgId: string }, projectId: string, dailyCapacityHours = 8): Promise<WorkloadDay[]> {
  const allocations = await withTenantContext({ orgId: ctx.orgId }, (db) =>
    db.query.pmsResourceAllocations.findMany({ where: and(eq(pmsResourceAllocations.orgId, ctx.orgId), eq(pmsResourceAllocations.projectId, projectId)) })
  )
  const byUserDate = new Map<string, number>()
  for (const a of allocations) {
    let cursor = a.startDate
    const hours = Number(a.allocatedHoursPerDay)
    while (cursor <= a.endDate) {
      const key = `${a.userId}__${cursor}`
      byUserDate.set(key, (byUserDate.get(key) ?? 0) + hours)
      cursor = addDays(cursor, 1)
    }
  }
  return Array.from(byUserDate.entries()).map(([key, allocatedHours]) => {
    const [userId, date] = key.split("__")
    return { userId, date, allocatedHours, overAllocated: allocatedHours > dailyCapacityHours }
  })
}
