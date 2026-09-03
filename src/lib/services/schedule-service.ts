// Wave 140 (PROJEXA gap analysis): Gantt/critical-path/baseline/
// resource-leveling parity with Asana/Monday/MS Project. Pure read/compute
// layer over the existing pms_issues + pms_issue_relations graph (Wave 25/
// 116) -- critical path is never stored, only computed on request from
// startDate/dueDate + typed relations/lagDays that already exist.
import {
  pmsIssues, pmsIssueRelations, pmsIssueBoqLinks, constructionBoqLineItems,
  pmsScheduleBaselines, pmsBaselineIssueSnapshots, pmsResourceAllocations,
  constructionWorkProgressEntries,
} from "@/lib/db"
import { withTenantContext } from "@/lib/db/tenant-scoped"
import { and, eq, inArray } from "drizzle-orm"
import { ServiceError } from "./compliance-service"
export { ServiceError }
import { createIssue, type IssueInput, type PmsContext } from "./pms-issue-service"
// Task #47 gap fix: reuse the same direct-children completion rollup
// pms-issue-service.ts already exposes (getIssue()/listIssues()) instead of
// duplicating the aggregation query/math here -- the Gantt chart's
// completionPercentage per task should reflect the same rolled-up value a
// project's issue list/detail view shows, not a second, divergent
// computation. listMilestones() is reused for the same reason (it now
// carries a computed completionPercentage per milestone, see
// pms-taxonomy-service.ts) instead of this file querying pmsMilestones raw.
import { fetchChildCompletionByParent, computeParentCompletionPercentage } from "./pms-issue-service"
import { listMilestones } from "./pms-taxonomy-service"

export type GanttTask = {
  id: string
  title: string
  startDate: string | null
  dueDate: string | null
  completionPercentage: number
  // R67 lane D22 (item D-49, rec R-125): WHERE that percentage came from, and
  // WHEN. Without it the Gantt shows a number with no provenance, and the two
  // ways it can arrive -- a site engineer's recorded quantities against the
  // linked BOQ lines, or a PM typing over them -- are indistinguishable, which
  // is exactly the ambiguity that makes people retype the figure. 'manual' is
  // the literal truth for every row written before pms_issue_boq_links
  // existed (see drizzle/0531's own default), never a retroactive claim.
  completionSource: string
  /** entry_date of the work-progress entry this completion was derived from; null for a manual one. */
  lastProgressAt: string | null
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

    const childCompletionMap = await fetchChildCompletionByParent(db, issueIds)

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
        completionPercentage: computeParentCompletionPercentage(issue.completionPercentage, childCompletionMap.get(issue.id) ?? []),
        completionSource: issue.completionSource,
        // Filled in by getGanttData(), which is the one place that may reach
        // into the construction work-progress domain -- this function stays a
        // pure pms_issues/pms_issue_relations computation.
        lastProgressAt: null,
        milestoneId: issue.milestoneId,
        parentIssueId: issue.parentIssueId,
        isCritical: floatDays !== null && floatDays <= 0,
        floatDays,
      }
    })
  })
}

export async function getGanttData(ctx: { orgId: string }, projectId: string) {
  const [tasks, edgesAndLinks, milestones] = await Promise.all([
    calculateCriticalPath(ctx, projectId),
    // R67 D-56: the BOQ links are read INSIDE this same transaction, off the
    // issue-id list it already had to build for the relations query. A fourth
    // parallel withTenantContext would be a fourth connection out of five for
    // one screen, and a nested one is forbidden outright (programme decision
    // D-06). Two statements, one transaction, no extra round trip to the pool.
    withTenantContext({ orgId: ctx.orgId }, async (db) => {
      const issues = await db.query.pmsIssues.findMany({
        where: and(eq(pmsIssues.orgId, ctx.orgId), eq(pmsIssues.projectId, projectId)),
        columns: { id: true },
      })
      const issueIds = issues.map((i) => i.id)
      const relations = await db.query.pmsIssueRelations.findMany({
        where: and(eq(pmsIssueRelations.orgId, ctx.orgId), inArray(pmsIssueRelations.issueId, issueIds)),
      })
      const boqLinks = issueIds.length
        ? await db.query.pmsIssueBoqLinks.findMany({
          where: and(eq(pmsIssueBoqLinks.orgId, ctx.orgId), inArray(pmsIssueBoqLinks.issueId, issueIds)),
          columns: { issueId: true, boqLineItemId: true },
        })
        : []
      return { relations, boqLinks }
    }),
    listMilestones({ orgId: ctx.orgId }, projectId),
  ])
  const taskIds = new Set(tasks.map((t) => t.id))
  const dependencies = normalizeEdges(edgesAndLinks.relations).filter((e) => taskIds.has(e.predecessorId) && taskIds.has(e.successorId))
  // R67 D-56 x R67 lane D22 (D-49): BOTH enrichments, in this order. D-56
  // stamps each bar with the BOQ line that owns its progress (so the Timeline
  // knows which rows it may not edit); D-49 then dates the site-derived
  // completions. Neither reads the other's field, so the order is only about
  // keeping the async hop last.
  const tasksWithLinks = attachBoqLinks(tasks, edgesAndLinks.boqLinks)
  const tasksWithProvenance = await attachLastProgressAt(ctx, projectId, tasksWithLinks)
  return { tasks: tasksWithProvenance, dependencies, milestones }
}

/**
 * R67 lane D22 (item D-49): dates the site-derived completions.
 *
 * pms_issues.completed_from_entry_id names the work-progress entry a derived
 * completion came from (WS-I item I-04), so "last entry 01-09-2026" is a real
 * lookup of that entry's own date, not the issue's updated_at -- which any
 * unrelated edit would move. One grouped query for the whole project, never
 * one per task. A manual completion has no entry and honestly reads null.
 */
// Generic in the row type because D-56's attachBoqLinks() runs first and widens
// it -- typing this to GanttTask would silently drop boqLineItemId back off
// every task on its way out, and the Timeline would lose the flag that tells it
// which bars it may not edit.
async function attachLastProgressAt<T extends { id: string; lastProgressAt: string | null }>(
  ctx: { orgId: string },
  projectId: string,
  tasks: T[]
): Promise<T[]> {
  if (tasks.length === 0) return tasks
  return withTenantContext({ orgId: ctx.orgId }, async (db) => {
    const issues = await db.query.pmsIssues.findMany({
      where: and(eq(pmsIssues.orgId, ctx.orgId), eq(pmsIssues.projectId, projectId)),
      columns: { id: true, completedFromEntryId: true },
    })
    const entryIdByIssue = new Map(issues.filter((i) => i.completedFromEntryId).map((i) => [i.id, i.completedFromEntryId!]))
    const entryIds = [...new Set(entryIdByIssue.values())]
    if (entryIds.length === 0) return tasks
    const entries = await db.query.constructionWorkProgressEntries.findMany({
      where: and(eq(constructionWorkProgressEntries.orgId, ctx.orgId), inArray(constructionWorkProgressEntries.id, entryIds)),
      columns: { id: true, entryDate: true },
    })
    const dateByEntry = new Map(entries.map((e) => [e.id, e.entryDate]))
    return tasks.map((t) => {
      const entryId = entryIdByIssue.get(t.id)
      return entryId ? { ...t, lastProgressAt: dateByEntry.get(entryId) ?? null } : t
    })
  })
}

/**
 * R67 D-56. Pure: stamps each Gantt task with the BOQ line its progress is
 * owned by, or null when nothing owns it.
 *
 * WHY THE UI NEEDS THIS. D-56 makes '% complete' inline-editable on the
 * Timeline, but only for activities NOBODY ELSE is writing. An activity linked
 * to a BOQ line takes its progress from the Work Progress report; letting the
 * Timeline overwrite it there would give one number two authors and no way to
 * tell which one you are looking at. So the linked rows are read-only and say
 * why, and this is the flag that decides which is which.
 *
 * An activity may legitimately be linked to more than one BOQ line (a weight
 * column exists for exactly that). The Timeline only needs to know WHETHER its
 * progress is owned elsewhere, so the first link is the one it names; the full
 * set stays readable through pms_issue_boq_links for anything that needs it.
 */
export function attachBoqLinks<T extends { id: string }>(
  tasks: readonly T[],
  links: readonly { issueId: string; boqLineItemId: string }[]
): (T & { boqLineItemId: string | null })[] {
  const byIssue = new Map<string, string>()
  for (const link of links) {
    if (!byIssue.has(link.issueId)) byIssue.set(link.issueId, link.boqLineItemId)
  }
  return tasks.map((t) => ({ ...t, boqLineItemId: byIssue.get(t.id) ?? null }))
}

// ─── R67 D-47 (audit R-121) -- creating an ACTIVITY, not just an issue ──────
//
// /schedule/tasks/new could set a title, a type, a priority and a due date.
// A programme needs a START, a DURATION, what an activity FOLLOWS, and which
// BOQ line it earns its value from -- and none of those could be sent at all,
// so the Timeline it feeds could not draw a bar, could not draw a dependency
// line, and could not roll a BOQ line's progress up from the work that
// delivers it.
//
// This lives in schedule-service.ts rather than pms-issue-service.ts because it
// is schedule semantics (duration, predecessor, BOQ link) composed over the
// generic issue create, not a change to what an issue IS. createIssue() keeps
// its own contract untouched.

/** Whole days from `start` to `due`; null when either is missing. Pure. */
export function deriveDurationDays(startDate?: string | null, dueDate?: string | null): number | null {
  if (!startDate || !dueDate) return null
  return daysBetween(startDate, dueDate)
}

/**
 * The finish date to store, from whichever of finish/duration the caller sent.
 *
 * An explicit dueDate always wins -- a caller that sent both meant the date.
 * A duration without a start cannot derive anything and is not an error here
 * (the start is validated separately, with its own message).
 * Pure, so the rule is testable without a database.
 */
export function deriveDueDate(
  startDate?: string | null,
  dueDate?: string | null,
  durationDays?: number | null
): string | null {
  if (dueDate) return dueDate
  if (!startDate) return null
  if (durationDays === undefined || durationDays === null) return null
  if (!Number.isFinite(durationDays) || durationDays < 0) return null
  return addDays(startDate, Math.round(durationDays))
}

export type ScheduleActivityInput = Omit<IssueInput, "dueDate"> & {
  dueDate?: string
  /** Days from Start; used only when no explicit finish date is given. */
  durationDays?: number
  /** The activity this one follows. Stored as a 'blocked_by' relation, which is the direction the Gantt reads. */
  predecessorId?: string
  /** The BOQ line this activity delivers, stored in pms_issue_boq_links. */
  boqLineItemId?: string
}

/**
 * Creates a schedule activity and its two optional edges.
 *
 * SEQUENCING, and why it is three steps rather than one transaction: both
 * createIssue() and this function's own writes open their own
 * withTenantContext, and nesting one inside another is exactly what programme
 * decision D-06 forbids (it deadlocks the 5-connection pool). So the two ids
 * the caller supplied are VALIDATED FIRST, in one read transaction, before
 * anything is written -- which turns the common failure ("that BOQ line is not
 * on this project") into a clean 404 with nothing created, rather than an
 * orphaned activity. If the edge write itself still fails afterwards, the error
 * says the activity was created and what did not attach, instead of pretending
 * the whole call failed.
 */
export async function createScheduleActivity(ctx: PmsContext, input: ScheduleActivityInput) {
  if (!input.startDate) throw new ServiceError("startDate is required", 400)

  const dueDate = deriveDueDate(input.startDate, input.dueDate, input.durationDays) ?? undefined
  if (dueDate && daysBetween(input.startDate, dueDate)! < 0) {
    throw new ServiceError("Due date is before the start date", 400)
  }

  if (input.predecessorId || input.boqLineItemId) {
    await withTenantContext({ orgId: ctx.orgId }, async (db) => {
      if (input.predecessorId) {
        const predecessor = await db.query.pmsIssues.findFirst({
          where: and(eq(pmsIssues.id, input.predecessorId!), eq(pmsIssues.orgId, ctx.orgId)),
          columns: { id: true, projectId: true },
        })
        if (!predecessor) throw new ServiceError("Predecessor activity not found", 404)
        if (predecessor.projectId !== input.projectId) {
          throw new ServiceError("The predecessor belongs to a different project", 400)
        }
      }
      if (input.boqLineItemId) {
        const line = await db.query.constructionBoqLineItems.findFirst({
          where: and(
            eq(constructionBoqLineItems.id, input.boqLineItemId!),
            eq(constructionBoqLineItems.orgId, ctx.orgId)
          ),
          columns: { id: true },
        })
        if (!line) throw new ServiceError("BOQ line item not found", 404)
      }
    })
  }

  const { durationDays: _duration, predecessorId, boqLineItemId, ...issueInput } = input
  const issue = await createIssue(ctx, { ...issueInput, dueDate })

  if (predecessorId || boqLineItemId) {
    try {
      await withTenantContext({ orgId: ctx.orgId, userId: ctx.userId }, async (db) => {
        if (predecessorId) {
          // 'blocked_by' from the NEW activity's own perspective: predecessorIdsOf()
          // and normalizeEdges() both read that direction as
          // predecessor -> successor, so the Gantt draws the line without a
          // mirror row being invented here.
          await db.insert(pmsIssueRelations).values({
            orgId: ctx.orgId,
            issueId: issue.id!,
            relatedIssueId: predecessorId,
            relationType: "blocked_by",
          })
        }
        if (boqLineItemId) {
          await db.insert(pmsIssueBoqLinks).values({
            orgId: ctx.orgId,
            issueId: issue.id!,
            boqLineItemId,
          })
        }
      })
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error)
      throw new ServiceError(
        `Activity #${issue.number} was created, but its predecessor/BOQ link could not be saved: ${detail}`,
        500
      )
    }
  }

  return issue
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

// Gap closure (2026-07-27, DEEP_ERP_FUNCTIONALITY_COMPLETION_VIA_ODOO_ERPNEXT_REFERENCE):
// "Resource-allocation conflict/over-allocation detection". getWorkload()
// above is deliberately scoped to a SINGLE projectId (a per-project
// workload view) -- the real, previously-undetected gap is that a user can
// look fine within every individual project's workload view while still
// being double- or triple-booked once their allocations across ALL of an
// org's projects are summed together for the same day. detectResourceConflicts
// closes that: it sums allocatedHoursPerDay per user per calendar day
// across every allocation passed in, regardless of which project it
// belongs to.
export type ResourceConflict = { userId: string; date: string; totalAllocatedHours: number; capacityHours: number; projectIds: string[] }
export type ResourceAllocationRow = { userId: string; projectId: string; allocatedHoursPerDay: string | number; startDate: string; endDate: string }

/** Pure function, no DB access -- independently unit-testable. See header comment above this section for what this detects and why it's distinct from getWorkload(). */
export function detectResourceConflicts(allocations: ResourceAllocationRow[], dailyCapacityHours = 8): ResourceConflict[] {
  const byUserDate = new Map<string, { total: number; projectIds: Set<string> }>()
  for (const a of allocations) {
    let cursor = a.startDate
    const hours = Number(a.allocatedHoursPerDay)
    while (cursor <= a.endDate) {
      const key = `${a.userId}__${cursor}`
      const entry = byUserDate.get(key) ?? { total: 0, projectIds: new Set<string>() }
      entry.total += hours
      entry.projectIds.add(a.projectId)
      byUserDate.set(key, entry)
      cursor = addDays(cursor, 1)
    }
  }
  const conflicts: ResourceConflict[] = []
  for (const [key, { total, projectIds }] of byUserDate.entries()) {
    if (total > dailyCapacityHours) {
      const [userId, date] = key.split("__")
      conflicts.push({ userId, date, totalAllocatedHours: total, capacityHours: dailyCapacityHours, projectIds: Array.from(projectIds) })
    }
  }
  return conflicts.sort((a, b) => a.userId.localeCompare(b.userId) || a.date.localeCompare(b.date))
}

/** Org-wide (all projects) over-allocation check; pass userId to scope it to one person -- e.g. right after createResourceAllocation, to warn on the allocation that was just created. */
export async function getResourceConflicts(ctx: { orgId: string }, options: { userId?: string; dailyCapacityHours?: number } = {}): Promise<ResourceConflict[]> {
  const allocations = await withTenantContext({ orgId: ctx.orgId }, (db) =>
    db.query.pmsResourceAllocations.findMany({
      where: options.userId
        ? and(eq(pmsResourceAllocations.orgId, ctx.orgId), eq(pmsResourceAllocations.userId, options.userId))
        : eq(pmsResourceAllocations.orgId, ctx.orgId),
    })
  )
  return detectResourceConflicts(allocations, options.dailyCapacityHours ?? 8)
}
