// Wave 26 (VERIDIAN AI PMS) service layer -- core issue CRUD, atomic
// per-project issue numbering, and multi-assignee sync. Callers must have
// already passed requirePmsEnabled() (enforced at the route layer).
import {
  pmsIssues, pmsIssueAssignees, pmsIssueRelations, pmsIssueLabels, pmsIssueStatuses, projects,
} from "@/lib/db"
import { withTenantContext, type TenantDb } from "@/lib/db/tenant-scoped"
import { and, eq, inArray, or, sql, type SQL } from "drizzle-orm"
import { ServiceError } from "./compliance-service"
export { ServiceError }
import type { users } from "@/lib/db"
import { resolveDefaultStatusId } from "./pms-taxonomy-service"
import { createQueryTimer } from "@/lib/query-timing"

// dbUser is optional/nullable: neither createIssue() nor updateIssue() below
// actually reads ctx.dbUser (only orgId/userId are used), but the type used
// to require it unconditionally. Wave 141 (PROJEXA Kanban board,
// /api/v1/projexa/board) needs to call updateIssue() from an API-key-only
// request context (requireAuthOrApiKey(), no real session/dbUser) -- this
// narrows the type to match actual usage instead of forcing a fake dbUser
// object at every API-key call site. Existing callers that do pass a real
// dbUser (src/app/api/pms/issues/[id]/route.ts) are unaffected.
export type PmsContext = { orgId: string; userId: string; dbUser?: typeof users.$inferSelect | null }

export type IssueInput = {
  projectId: string
  typeId: string
  statusId?: string
  priority?: string
  title: string
  description?: string
  clientId?: string
  assigneeIds?: string[]
  parentIssueId?: string
  milestoneId?: string
  estimatePointId?: string
  startDate?: string
  dueDate?: string
  labelIds?: string[]
}

/** Denormalized primary-assignee cache -- pmsIssueAssignees is authoritative, this mirrors the first row. Service-layer logic, not a DB trigger, matching this codebase's convention. */
async function syncAssignees(db: TenantDb, issueId: string, userIds: string[] | undefined) {
  if (userIds === undefined) return
  await db.delete(pmsIssueAssignees).where(eq(pmsIssueAssignees.issueId, issueId))
  if (userIds.length > 0) {
    await db.insert(pmsIssueAssignees).values(userIds.map((userId) => ({ issueId, userId })))
  }
  await db.update(pmsIssues).set({ assigneeId: userIds[0] ?? null }).where(eq(pmsIssues.id, issueId))
}

// Dependency-blocking enforcement (Owner directive
// PROJEXA_ERP_END_TO_END_REQUIREMENT_ANALYSIS_GAP_FILL_AND_IMPLEMENTATION):
// a 'blocks' row (issueId -> relatedIssueId) means issueId is the
// predecessor of relatedIssueId; a 'blocked_by' row is the mirror, stored
// from the successor's own perspective -- neither direction auto-creates
// the other (addIssueRelation() below inserts exactly the one row it's
// given), so both must be checked. Matches schedule-service.ts's own
// normalizeEdges() semantics exactly (kept independent here rather than
// imported, since it's a 6-line pure function and pms-issue-service.ts
// should not take on a dependency on the read-only Gantt layer).
export function predecessorIdsOf(
  relations: Pick<typeof pmsIssueRelations.$inferSelect, "issueId" | "relatedIssueId" | "relationType">[],
  issueId: string
): string[] {
  const ids: string[] = []
  for (const r of relations) {
    if (r.relationType === "blocked_by" && r.issueId === issueId) ids.push(r.relatedIssueId)
    else if (r.relationType === "blocks" && r.relatedIssueId === issueId) ids.push(r.issueId)
  }
  return ids
}

const COMPLETED_STATUS_GROUP = "completed" as const

// Task #47 (PM feature-parity gap analysis): deterministic project-level
// rollup, generalizing construction-dashboard-service.ts's
// getProjectDashboard() pattern ("average of each activity's latest logged
// percentComplete") from construction activities to pms_issues -- here the
// per-issue completionPercentage IS the live value (no separate log table
// to take "latest of" from), so the rollup is a straight average across the
// project's non-archived issues. Pure/no I/O so it's directly unit-testable.
export function calculateProjectRollupPercentage(
  issues: Pick<typeof pmsIssues.$inferSelect, "completionPercentage" | "isArchived">[]
): number {
  const active = issues.filter((i) => !i.isArchived)
  if (active.length === 0) return 0
  const sum = active.reduce((total, i) => total + i.completionPercentage, 0)
  return Math.round(sum / active.length)
}

/**
 * Recomputes and persists projects.rollupPercentage from the project's own
 * pms_issues -- called inline (not fire-and-forget) from createIssue()/
 * updateIssue() below whenever an issue's completionPercentage or archived
 * state can move the average, so the column is always current when read
 * back (never a stale write nobody re-reads).
 */
export async function recalculateProjectRollup(db: TenantDb, orgId: string, projectId: string): Promise<number> {
  const issues = await db.query.pmsIssues.findMany({
    where: and(eq(pmsIssues.orgId, orgId), eq(pmsIssues.projectId, projectId)),
    columns: { completionPercentage: true, isArchived: true },
  })
  const rollupPercentage = calculateProjectRollupPercentage(issues)
  await db.update(projects).set({ rollupPercentage, updatedAt: new Date() }).where(and(eq(projects.id, projectId), eq(projects.orgId, orgId)))
  return rollupPercentage
}

// Task #47 gap fix (PM-platform feature-parity gap analysis): pms_issues.
// parentIssueId (self-FK, schema.ts) already supports real subtask nesting
// and completionPercentage already exists as a column -- both written on
// createIssue()/updateIssue() -- but nothing ever read parentIssueId back
// to roll a parent's completion up from its children. Fixed here as a
// query-time (on-read) aggregation, deliberately matching the exact
// deterministic-averaging pattern construction-dashboard-service.ts's
// getProjectDashboard() already uses for progressPercent (plain JS math,
// no denormalized column, zero LLM/AI involvement per Owner mandate) --
// chosen over a write-back/trigger-style recompute-and-persist because (a)
// every other derived rollup in this codebase is query-time, not a stored
// column kept in sync by triggers (kpi-hub-service.ts, erp-budget-
// service.ts's getBudgetVariance, construction-dashboard-service.ts itself),
// and (b) a write-back would need to fire on every child update AND
// recursively fan out to grandparents, which the gap analysis does not ask
// for and which isn't needed while completionPercentage stays a read-time
// concern.
//
// Deliberately non-recursive / direct-children-only, matching the gap
// analysis's literal ask ("average of its direct children's
// completionPercentage"): a grandchild's own rollup is not re-derived when
// averaging its parent -- only immediate children's own stored
// completionPercentage values are averaged. Archived children are excluded
// (matches this file's existing isArchived-false convention, e.g.
// listIssues()'s default filter and construction-dashboard-service.ts's
// delayedTaskCount). Leaf issues (no children) keep their own
// manually-set completionPercentage completely untouched.
export function computeParentCompletionPercentage(ownCompletionPercentage: number, childCompletionPercentages: number[]): number {
  if (childCompletionPercentages.length === 0) return ownCompletionPercentage
  const total = childCompletionPercentages.reduce((sum, v) => sum + Number(v), 0)
  return Math.round(total / childCompletionPercentages.length)
}

/**
 * Batch-fetches direct children's completionPercentage for a set of parent
 * issue ids, grouped by parent. Shared by getIssue() (single issue),
 * getIssueRow() (create/update return value), and listIssues() (project
 * list) so every read path applies the exact same rollup rule -- also
 * reused by schedule-service.ts's calculateCriticalPath() (Gantt) rather
 * than duplicating this query there.
 */
export async function fetchChildCompletionByParent(db: TenantDb, parentIds: string[]): Promise<Map<string, number[]>> {
  const byParent = new Map<string, number[]>()
  if (parentIds.length === 0) return byParent
  const children = await db.query.pmsIssues.findMany({
    where: and(inArray(pmsIssues.parentIssueId, parentIds), eq(pmsIssues.isArchived, false)),
    columns: { parentIssueId: true, completionPercentage: true },
  })
  for (const c of children) {
    if (!c.parentIssueId) continue
    const arr = byParent.get(c.parentIssueId)
    if (arr) arr.push(Number(c.completionPercentage))
    else byParent.set(c.parentIssueId, [Number(c.completionPercentage)])
  }
  return byParent
}

async function syncLabels(db: TenantDb, issueId: string, labelIds: string[] | undefined) {
  if (labelIds === undefined) return
  await db.delete(pmsIssueLabels).where(eq(pmsIssueLabels.issueId, issueId))
  if (labelIds.length > 0) {
    await db.insert(pmsIssueLabels).values(labelIds.map((labelId) => ({ issueId, labelId })))
  }
}

export async function listIssues(
  ctx: { orgId: string },
  projectId: string,
  filters: { statusId?: string; assigneeId?: string; priority?: string; milestoneId?: string; includeArchived?: boolean } = {}
) {
  return withTenantContext({ orgId: ctx.orgId }, async (db) => {
    const project = await db.query.projects.findFirst({ where: and(eq(projects.id, projectId), eq(projects.orgId, ctx.orgId)) })
    if (!project) throw new ServiceError("Project not found", 404)

    const conditions: SQL[] = [eq(pmsIssues.orgId, ctx.orgId), eq(pmsIssues.projectId, projectId)]
    if (filters.statusId) conditions.push(eq(pmsIssues.statusId, filters.statusId))
    if (filters.assigneeId) conditions.push(eq(pmsIssues.assigneeId, filters.assigneeId))
    if (filters.priority) conditions.push(eq(pmsIssues.priority, filters.priority as typeof pmsIssues.$inferSelect.priority))
    if (filters.milestoneId) conditions.push(eq(pmsIssues.milestoneId, filters.milestoneId))
    if (!filters.includeArchived) conditions.push(eq(pmsIssues.isArchived, false))

    const rows = await db.query.pmsIssues.findMany({
      where: and(...conditions),
      orderBy: (t, { asc }) => asc(t.position),
    })
    const childMap = await fetchChildCompletionByParent(db, rows.map((r) => r.id))
    return rows.map((r) => ({ ...r, completionPercentage: computeParentCompletionPercentage(r.completionPercentage, childMap.get(r.id) ?? []) }))
  })
}

export async function getIssue(ctx: { orgId: string }, issueId: string) {
  return withTenantContext({ orgId: ctx.orgId }, async (db) => {
    const issue = await db.query.pmsIssues.findFirst({ where: and(eq(pmsIssues.id, issueId), eq(pmsIssues.orgId, ctx.orgId)) })
    if (!issue) throw new ServiceError("Issue not found", 404)
    const assignees = await db.query.pmsIssueAssignees.findMany({ where: eq(pmsIssueAssignees.issueId, issueId) })
    const labels = await db.query.pmsIssueLabels.findMany({ where: eq(pmsIssueLabels.issueId, issueId) })
    const relations = await db.query.pmsIssueRelations.findMany({ where: and(eq(pmsIssueRelations.orgId, ctx.orgId), eq(pmsIssueRelations.issueId, issueId)) })
    const childMap = await fetchChildCompletionByParent(db, [issueId])
    const completionPercentage = computeParentCompletionPercentage(issue.completionPercentage, childMap.get(issueId) ?? [])
    return { ...issue, completionPercentage, assigneeIds: assignees.map((a) => a.userId), labelIds: labels.map((l) => l.labelId), relations }
  })
}

// R67 F-33 (audit recommendation R-278) -- POST a schedule task under 1 s.
//
// WHAT THIS PATH USED TO COST, per create, all of it serial:
//   route  1. listIssueTypes()            -- its OWN withTenantContext, i.e. a
//                                            whole second transaction opened
//                                            before this one, because PROJEXA's
//                                            "New Task" dialog never sends a
//                                            typeId
//   here   2. projects.findFirst          -- "does this project exist"
//          3. statuses.findMany           -- "what status do new tasks start in"
//          4. projects.update ... RETURNING -- claim the next number
//          5. pmsIssues.insert
//          6. rollup findMany + 7. rollup update
//          8-11. getIssueRow(): re-read the issue, its assignees, its labels,
//                and its CHILDREN
// Eleven round trips over a remote pooler, on a five-connection pool.
//
// WHAT IT COSTS NOW, on a warm cache: four. Queries 1 and 3 are answered from
// schedule-lookup-cache.ts; query 2 is GONE because the RETURNING clause of
// query 4 already proves the project exists in this org (and now scopes the
// counter update by org_id, which it did not do before); queries 8-11 are gone
// because every value they read back is already known here -- see
// issueRowAfterCreate() below.
//
// WHAT DELIBERATELY DID NOT MOVE: the insert, the assignee/label rows and the
// project rollup all stay inside the one tenant transaction. They are the
// write, and a task that exists without its rows is worse than a slow one.
export async function createIssue(ctx: PmsContext, input: IssueInput) {
  const title = input.title?.trim()
  if (!title) throw new ServiceError("title is required", 400)
  if (!input.typeId) throw new ServiceError("typeId is required", 400)

  const timer = createQueryTimer("createIssue")
  try {
    return await withTenantContext({ orgId: ctx.orgId, userId: ctx.userId }, async (db) => {
      // ONE statement does two jobs: claims the next task number atomically and
      // proves the project exists IN THIS ORG. Zero rows back means no such
      // project -- the same 404 the separate findFirst used to give, one round
      // trip earlier. The increment is rolled back with everything else if any
      // later step throws, so an abandoned create does not burn a number.
      const [claimed] = await timer.time("project.claimNumber", () =>
        db.update(projects)
          .set({ issueSequence: sql`${projects.issueSequence} + 1` })
          .where(and(eq(projects.id, input.projectId), eq(projects.orgId, ctx.orgId)))
          .returning({ issueSequence: projects.issueSequence })
      )
      if (!claimed) throw new ServiceError("Project not found", 404)
      const number = claimed.issueSequence

      let statusId = input.statusId
      if (!statusId) {
        statusId = (await timer.time("status.resolveDefault", () =>
          resolveDefaultStatusId(db, ctx.orgId, input.projectId, {
            onCacheHit: () => timer.note("status.cacheHit"),
          })
        )) ?? undefined
      }
      if (!statusId) throw new ServiceError("statusId is required and no default status could be resolved", 400)

      const [issue] = await timer.time("issue.insert", () =>
        db.insert(pmsIssues).values({
          orgId: ctx.orgId, clientId: input.clientId || null, projectId: input.projectId, typeId: input.typeId, statusId,
          priority: (input.priority as typeof pmsIssues.$inferInsert.priority) || "no_priority",
          number, title, description: input.description || null,
          parentIssueId: input.parentIssueId || null, milestoneId: input.milestoneId || null,
          estimatePointId: input.estimatePointId || null, startDate: input.startDate || null, dueDate: input.dueDate || null,
          createdById: ctx.userId,
        }).returning()
      )

      await timer.time("issue.assignees", () => syncAssignees(db, issue.id, input.assigneeIds))
      await timer.time("issue.labels", () => syncLabels(db, issue.id, input.labelIds))
      await timer.time("project.rollup", () => recalculateProjectRollup(db, ctx.orgId, input.projectId))

      return issueRowAfterCreate(issue, input)
    })
  } finally {
    timer.finish({ projectId: input.projectId })
  }
}

/**
 * The row a create returns, built from what the create itself already knows
 * instead of re-reading it -- the same shape getIssueRow() produces, so a
 * client cannot tell a create's response from a subsequent GET.
 *
 * Every field is derivable here, and that is checked rather than assumed:
 *  - the INSERT's own RETURNING row is the stored row, defaults applied;
 *  - assignees and labels are exactly what was just written (syncAssignees()
 *    also sets issues.assignee_id to the first of them, mirrored here);
 *  - children: a row whose id did not exist a moment ago, inside the very
 *    transaction that created it, cannot have children -- so the parent rollup
 *    is the issue's own percentage. The shared rule is still applied by name so
 *    this can never drift from getIssueRow()'s.
 */
function issueRowAfterCreate(issue: typeof pmsIssues.$inferSelect, input: IssueInput) {
  const assigneeIds = input.assigneeIds ?? []
  return {
    ...issue,
    assigneeId: input.assigneeIds === undefined ? issue.assigneeId : (input.assigneeIds[0] ?? null),
    completionPercentage: computeParentCompletionPercentage(issue.completionPercentage, []),
    assigneeIds,
    labelIds: input.labelIds ?? [],
  }
}

async function getIssueRow(db: TenantDb, issueId: string) {
  const issue = await db.query.pmsIssues.findFirst({ where: eq(pmsIssues.id, issueId) })
  const assignees = await db.query.pmsIssueAssignees.findMany({ where: eq(pmsIssueAssignees.issueId, issueId) })
  const labels = await db.query.pmsIssueLabels.findMany({ where: eq(pmsIssueLabels.issueId, issueId) })
  // Rollup applied here too (not just getIssue()/listIssues()) so
  // createIssue()/updateIssue()'s own return value is never inconsistent
  // with what a subsequent GET would show for the same issue.
  const childMap = await fetchChildCompletionByParent(db, [issueId])
  const completionPercentage = issue ? computeParentCompletionPercentage(issue.completionPercentage, childMap.get(issueId) ?? []) : undefined
  return { ...issue, completionPercentage, assigneeIds: assignees.map((a) => a.userId), labelIds: labels.map((l) => l.labelId) }
}

export type IssuePatch = Partial<{
  title: string; description: string | null; statusId: string; priority: string;
  assigneeIds: string[]; labelIds: string[]; milestoneId: string | null; estimatePointId: string | null;
  startDate: string | null; dueDate: string | null; position: string; isArchived: boolean; assignedById: string;
  // Wave 116 (PROJEXA Schedule/Gantt): 0-100, read by the frappe-gantt UI and
  // by delay computation. Meaningless/unused outside construction-flavored
  // PMS projects, but additive to every pmsIssues row.
  completionPercentage: number;
}>

export async function updateIssue(ctx: PmsContext, issueId: string, patch: IssuePatch) {
  if (patch.completionPercentage !== undefined && (patch.completionPercentage < 0 || patch.completionPercentage > 100)) {
    throw new ServiceError("completionPercentage must be between 0 and 100", 400)
  }

  const result = await withTenantContext({ orgId: ctx.orgId, userId: ctx.userId }, async (db) => {
    const existing = await db.query.pmsIssues.findFirst({ where: and(eq(pmsIssues.id, issueId), eq(pmsIssues.orgId, ctx.orgId)) })
    if (!existing) throw new ServiceError("Issue not found", 404)

    // Dependency-blocking: only checked on a real status transition into
    // the "completed" group -- issues with no pmsIssueRelations rows are
    // untouched (predecessorIds is empty, the common case), matching this
    // task's own "must not break the no-relations workflow" constraint.
    if (patch.statusId !== undefined && patch.statusId !== existing.statusId) {
      const newStatus = await db.query.pmsIssueStatuses.findFirst({
        where: and(eq(pmsIssueStatuses.id, patch.statusId), eq(pmsIssueStatuses.orgId, ctx.orgId)),
      })
      if (!newStatus) throw new ServiceError("statusId not found", 404)

      if (newStatus.group === COMPLETED_STATUS_GROUP) {
        const relations = await db.query.pmsIssueRelations.findMany({
          where: and(
            eq(pmsIssueRelations.orgId, ctx.orgId),
            or(eq(pmsIssueRelations.issueId, issueId), eq(pmsIssueRelations.relatedIssueId, issueId))
          ),
        })
        const predecessorIds = predecessorIdsOf(relations, issueId)
        if (predecessorIds.length > 0) {
          const predecessors = await db.query.pmsIssues.findMany({
            where: and(eq(pmsIssues.orgId, ctx.orgId), inArray(pmsIssues.id, predecessorIds)),
          })
          const statusIds = [...new Set(predecessors.map((p) => p.statusId))]
          const statuses = await db.query.pmsIssueStatuses.findMany({
            where: and(eq(pmsIssueStatuses.orgId, ctx.orgId), inArray(pmsIssueStatuses.id, statusIds)),
          })
          const groupByStatusId = new Map(statuses.map((s) => [s.id, s.group]))
          const incomplete = predecessors.find((p) => groupByStatusId.get(p.statusId) !== COMPLETED_STATUS_GROUP)
          if (incomplete) {
            throw new ServiceError(
              `Cannot mark "${existing.title}" complete: predecessor issue "${incomplete.title}" (#${incomplete.number}) is not yet complete.`,
              409
            )
          }
        }
      }
    }

    const { assigneeIds, labelIds, ...rest } = patch
    const updateValues: Record<string, unknown> = { ...rest, updatedAt: new Date() }
    if (assigneeIds !== undefined && assigneeIds.length > 0) updateValues.assignedById = ctx.userId
    if (Object.keys(updateValues).length > 1) {
      await db.update(pmsIssues).set(updateValues).where(eq(pmsIssues.id, issueId))
    }
    await syncAssignees(db, issueId, assigneeIds)
    await syncLabels(db, issueId, labelIds)

    // Only recompute when this patch could actually move the average --
    // skip the extra query+write on every unrelated field edit (title,
    // description, assignees, ...).
    if (patch.completionPercentage !== undefined || patch.isArchived !== undefined) {
      await recalculateProjectRollup(db, ctx.orgId, existing.projectId)
    }

    const row = await getIssueRow(db, issueId)
    return { row, previousStatusId: existing.statusId }
  })

  // Wave 30: fire-and-forget automation rule evaluation on status change --
  // never blocks/breaks this update, matching evaluateAndRunRules()'s own
  // internal error-swallowing contract.
  if (patch.statusId !== undefined && patch.statusId !== result.previousStatusId) {
    void import("./automation-rule-service").then(({ evaluateAndRunRules }) =>
      evaluateAndRunRules({ orgId: ctx.orgId }, "pms_issue.status_changed", { issueId, previousStatusId: result.previousStatusId, newStatusId: patch.statusId })
    )
  }

  return result.row
}

export async function addIssueRelation(
  ctx: { orgId: string },
  issueId: string,
  input: { relatedIssueId: string; relationType: string }
) {
  return withTenantContext({ orgId: ctx.orgId }, async (db) => {
    const issue = await db.query.pmsIssues.findFirst({ where: and(eq(pmsIssues.id, issueId), eq(pmsIssues.orgId, ctx.orgId)) })
    if (!issue) throw new ServiceError("Issue not found", 404)

    // Conflict check: a 'blocks'/'blocked_by' relation implies a
    // predecessor/successor pair (see predecessorIdsOf()'s comment above
    // for the direction convention). Reject only the narrow case where
    // this new edge would leave an already-completed successor with an
    // incomplete predecessor -- the same invariant updateIssue() enforces
    // going forward, applied retroactively to the moment the edge itself
    // is created. 'duplicates'/'relates_to' carry no such semantics.
    if (input.relationType === "blocks" || input.relationType === "blocked_by") {
      const predecessorId = input.relationType === "blocks" ? issueId : input.relatedIssueId
      const successorId = input.relationType === "blocks" ? input.relatedIssueId : issueId

      const relatedIssue = await db.query.pmsIssues.findFirst({
        where: and(eq(pmsIssues.id, input.relatedIssueId), eq(pmsIssues.orgId, ctx.orgId)),
      })
      if (!relatedIssue) throw new ServiceError("relatedIssueId not found", 404)

      const predecessorIssue = predecessorId === issueId ? issue : relatedIssue
      const successorIssue = successorId === issueId ? issue : relatedIssue

      const statuses = await db.query.pmsIssueStatuses.findMany({
        where: and(
          eq(pmsIssueStatuses.orgId, ctx.orgId),
          inArray(pmsIssueStatuses.id, [...new Set([predecessorIssue.statusId, successorIssue.statusId])])
        ),
      })
      const groupByStatusId = new Map(statuses.map((s) => [s.id, s.group]))
      const successorComplete = groupByStatusId.get(successorIssue.statusId) === COMPLETED_STATUS_GROUP
      const predecessorComplete = groupByStatusId.get(predecessorIssue.statusId) === COMPLETED_STATUS_GROUP
      if (successorComplete && !predecessorComplete) {
        throw new ServiceError(
          `Cannot add this dependency: "${successorIssue.title}" (#${successorIssue.number}) is already complete, but its new predecessor "${predecessorIssue.title}" (#${predecessorIssue.number}) is not.`,
          409
        )
      }
    }

    const [row] = await db.insert(pmsIssueRelations).values({
      orgId: ctx.orgId, issueId, relatedIssueId: input.relatedIssueId,
      relationType: input.relationType as typeof pmsIssueRelations.$inferInsert.relationType,
    }).returning()
    return row
  })
}

export async function listIssueRelations(ctx: { orgId: string }, issueId: string) {
  return withTenantContext({ orgId: ctx.orgId }, (db) =>
    db.query.pmsIssueRelations.findMany({ where: and(eq(pmsIssueRelations.orgId, ctx.orgId), eq(pmsIssueRelations.issueId, issueId)) })
  )
}
