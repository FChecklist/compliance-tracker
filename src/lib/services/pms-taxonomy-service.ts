// Wave 26 (VERIDIAN AI PMS) service layer -- issue types (org-wide),
// issue statuses (per-project), workflow transitions, labels, estimate
// schemes/points, milestones. All read/write paths assume the caller has
// already passed requirePmsEnabled() (enforced at the route layer).
import {
  pmsIssueTypes, pmsIssueStatuses, pmsWorkflowTransitions, pmsLabels,
  pmsEstimateSchemes, pmsEstimatePoints, pmsMilestones, pmsIssues, projects,
} from "@/lib/db"
import { withTenantContext, type TenantDb } from "@/lib/db/tenant-scoped"
import { and, eq, inArray } from "drizzle-orm"
import { hasRole } from "@/lib/supabase/auth-guard"
import { ServiceError } from "./compliance-service"
export { ServiceError }
import type { users } from "@/lib/db"
import {
  bustScheduleLookupCache, issueStatusCacheKey, issueTypeCacheKey,
  readScheduleLookup, writeScheduleLookup,
} from "./schedule-lookup-cache"

export type PmsContext = { orgId: string; userId: string; dbUser: typeof users.$inferSelect }

const DEFAULT_STATUSES: Array<{ name: string; group: "backlog" | "unstarted" | "started" | "completed" | "cancelled"; position: number; isDefault?: boolean }> = [
  { name: "Backlog", group: "backlog", position: 0, isDefault: true },
  { name: "Todo", group: "unstarted", position: 1 },
  { name: "In Progress", group: "started", position: 2 },
  { name: "Done", group: "completed", position: 3 },
  { name: "Cancelled", group: "cancelled", position: 4 },
]

/**
 * Copy-on-first-use: a project has no PMS statuses until the first time
 * it's actually used for PMS work (statuses are per-project, unlike
 * org-wide issue types seeded once at org-enable time in
 * pms-enablement-service.ts). Idempotent -- safe to call on every read.
 */
export async function ensureDefaultStatusesForProject(db: TenantDb, orgId: string, projectId: string) {
  const existing = await db.query.pmsIssueStatuses.findMany({ where: eq(pmsIssueStatuses.projectId, projectId) })
  if (existing.length > 0) return existing
  return db.insert(pmsIssueStatuses).values(DEFAULT_STATUSES.map((s) => ({ orgId, projectId, ...s }))).returning()
}

export async function listIssueTypes(ctx: { orgId: string }) {
  return withTenantContext({ orgId: ctx.orgId }, (db) =>
    db.query.pmsIssueTypes.findMany({ where: eq(pmsIssueTypes.orgId, ctx.orgId), orderBy: (t, { asc }) => asc(t.name) })
  )
}

/**
 * Which issue type a task goes under when the caller did not name one.
 *
 * Pure selection rule, extracted so the choice is testable without a DB and so
 * the cached path and the uncached path can never disagree: the org's own
 * default type, else its first type by name (the order listIssueTypes()
 * returns), else nothing.
 */
export function pickDefaultIssueTypeId(
  types: Array<{ id: string; isDefault: boolean | null }>
): string | null {
  return types.find((t) => t.isDefault)?.id ?? types[0]?.id ?? null
}

/**
 * R67 F-33 (R-278): the issue-type lookup on the task-create hot path, cached
 * per org for 60 s.
 *
 * PROJEXA's "New Task" dialog never sends a typeId, so before this every single
 * POST opened a WHOLE EXTRA TRANSACTION (listIssueTypes() has its own
 * withTenantContext) just to read a configuration row that changes when an
 * admin edits it and at no other time. On a warm cache the create path now asks
 * Postgres nothing at all for this.
 *
 * A MISS IS NOT CACHED. "This org has no issue types" is the answer that makes
 * the route refuse the write; caching it would keep refusing for a minute after
 * an admin fixed it. See schedule-lookup-cache.ts.
 */
export async function resolveDefaultIssueTypeId(
  ctx: { orgId: string },
  options: { onCacheHit?: () => void } = {}
): Promise<string | null> {
  const key = issueTypeCacheKey(ctx.orgId)
  const cached = readScheduleLookup(key)
  if (cached) {
    options.onCacheHit?.()
    return cached
  }
  const types = await listIssueTypes(ctx)
  const typeId = pickDefaultIssueTypeId(types)
  if (typeId) writeScheduleLookup(key, typeId)
  return typeId
}

/**
 * R67 F-33 (R-278): the status a new task starts in, cached per org+project for
 * 60 s.
 *
 * Takes the CALLER'S `db` rather than opening its own transaction, because on a
 * miss it must run inside the create's own transaction -- copy-on-first-use
 * (ensureDefaultStatusesForProject) writes the five default statuses, and that
 * write belongs to the same transaction the task is inserted in, so a failed
 * create does not leave a half-configured project behind.
 */
export async function resolveDefaultStatusId(
  db: TenantDb,
  orgId: string,
  projectId: string,
  options: { onCacheHit?: () => void } = {}
): Promise<string | null> {
  const key = issueStatusCacheKey(orgId, projectId)
  const cached = readScheduleLookup(key)
  if (cached) {
    options.onCacheHit?.()
    return cached
  }
  const statuses = await ensureDefaultStatusesForProject(db, orgId, projectId)
  const statusId = statuses.find((s) => s.isDefault)?.id ?? statuses[0]?.id ?? null
  if (statusId) writeScheduleLookup(key, statusId)
  return statusId
}

export async function createIssueType(ctx: PmsContext, input: { name: string; icon?: string; color?: string; isEpic?: boolean }) {
  if (!hasRole(ctx.dbUser, "admin")) throw new ServiceError("Creating an issue type requires admin role or higher", 403)
  const name = input.name?.trim()
  if (!name) throw new ServiceError("name is required", 400)

  const row = await withTenantContext({ orgId: ctx.orgId }, async (db) => {
    const [created] = await db.insert(pmsIssueTypes).values({
      orgId: ctx.orgId, name, icon: input.icon || null, color: input.color || null, isEpic: input.isEpic ?? false,
    }).returning()
    return created
  })
  // R67 F-33: a new type can change which type resolveDefaultIssueTypeId()
  // picks (it orders by name), so the cached answer is dropped the moment the
  // taxonomy moves -- busted AFTER the transaction commits, never before, so a
  // rolled-back create cannot leave the cache emptied for a change that did not
  // happen.
  bustScheduleLookupCache(ctx.orgId, issueTypeCacheKey(ctx.orgId))
  return row
}

export async function listIssueStatuses(ctx: { orgId: string }, projectId: string) {
  return withTenantContext({ orgId: ctx.orgId }, async (db) => {
    const project = await db.query.projects.findFirst({ where: and(eq(projects.id, projectId), eq(projects.orgId, ctx.orgId)) })
    if (!project) throw new ServiceError("Project not found", 404)
    const statuses = await ensureDefaultStatusesForProject(db, ctx.orgId, projectId)
    return [...statuses].sort((a, b) => a.position - b.position)
  })
}

export async function createIssueStatus(
  ctx: PmsContext,
  projectId: string,
  input: { name: string; group: string; color?: string; position?: number }
) {
  if (!hasRole(ctx.dbUser, "admin")) throw new ServiceError("Creating an issue status requires admin role or higher", 403)
  const name = input.name?.trim()
  if (!name) throw new ServiceError("name is required", 400)
  const validGroups = new Set(["backlog", "unstarted", "started", "completed", "cancelled", "triage"])
  if (!validGroups.has(input.group)) throw new ServiceError(`group must be one of: ${[...validGroups].join(", ")}`, 400)

  const row = await withTenantContext({ orgId: ctx.orgId }, async (db) => {
    const project = await db.query.projects.findFirst({ where: and(eq(projects.id, projectId), eq(projects.orgId, ctx.orgId)) })
    if (!project) throw new ServiceError("Project not found", 404)

    const [created] = await db.insert(pmsIssueStatuses).values({
      orgId: ctx.orgId, projectId, name,
      group: input.group as "backlog" | "unstarted" | "started" | "completed" | "cancelled" | "triage",
      color: input.color || null, position: input.position ?? 0,
    }).returning()
    return created
  })
  // R67 F-33: a new status can change which status a new task starts in
  // (resolveDefaultStatusId() falls back to the first row when none is marked
  // default), so the cached answer for THIS project is dropped once the write
  // has actually committed.
  bustScheduleLookupCache(ctx.orgId, issueStatusCacheKey(ctx.orgId, projectId))
  return row
}

export async function createWorkflowTransition(
  ctx: PmsContext,
  input: { issueTypeId: string; fromStatusId: string; toStatusId: string; role?: string }
) {
  if (!hasRole(ctx.dbUser, "admin")) throw new ServiceError("Creating a workflow transition requires admin role or higher", 403)

  return withTenantContext({ orgId: ctx.orgId }, async (db) => {
    const [row] = await db.insert(pmsWorkflowTransitions).values({
      orgId: ctx.orgId, issueTypeId: input.issueTypeId, fromStatusId: input.fromStatusId,
      toStatusId: input.toStatusId, role: input.role as typeof pmsWorkflowTransitions.$inferInsert.role,
    }).returning()
    return row
  })
}

export async function listWorkflowTransitions(ctx: { orgId: string }, issueTypeId?: string) {
  return withTenantContext({ orgId: ctx.orgId }, (db) =>
    db.query.pmsWorkflowTransitions.findMany({
      where: issueTypeId
        ? and(eq(pmsWorkflowTransitions.orgId, ctx.orgId), eq(pmsWorkflowTransitions.issueTypeId, issueTypeId))
        : eq(pmsWorkflowTransitions.orgId, ctx.orgId),
    })
  )
}

export async function listLabels(ctx: { orgId: string }, projectId: string) {
  return withTenantContext({ orgId: ctx.orgId }, (db) =>
    db.query.pmsLabels.findMany({ where: and(eq(pmsLabels.orgId, ctx.orgId), eq(pmsLabels.projectId, projectId)), orderBy: (t, { asc }) => asc(t.name) })
  )
}

export async function createLabel(ctx: PmsContext, projectId: string, input: { name: string; color?: string }) {
  const name = input.name?.trim()
  if (!name) throw new ServiceError("name is required", 400)

  return withTenantContext({ orgId: ctx.orgId }, async (db) => {
    const [row] = await db.insert(pmsLabels).values({ orgId: ctx.orgId, projectId, name, color: input.color || null }).returning()
    return row
  })
}

// Task #47 gap fix (PM-platform feature-parity gap analysis): pms_milestones
// already has the right shape and links from pms_issues.milestoneId, but
// nothing computed/derived a milestone's completion percentage from its
// linked issues. Fixed as a query-time (on-read) aggregation -- same
// deterministic-averaging pattern as construction-dashboard-service.ts's
// progressPercent and pms-issue-service.ts's computeParentCompletionPercentage
// (plain JS math, no denormalized column on pms_milestones, zero LLM/AI
// involvement) -- not a stored column, matching this codebase's existing
// convention for derived rollups.
//
// Averages each DIRECTLY linked issue's own stored completionPercentage
// (not that issue's own subtask rollup) -- consistent with
// computeParentCompletionPercentage's own "direct only, non-recursive"
// scope decision, and avoids an extra N+1 fan-out query per milestone.
// Zero linked issues returns 0 (not null): matches
// construction-dashboard-service.ts's getProjectDashboard(), which also
// defaults progressPercent to 0 when there's nothing to average yet,
// rather than surfacing a "no data" null through this API.
export function computeMilestoneCompletionPercentage(issueCompletionPercentages: number[]): number {
  if (issueCompletionPercentages.length === 0) return 0
  const total = issueCompletionPercentages.reduce((sum, v) => sum + Number(v), 0)
  return Math.round(total / issueCompletionPercentages.length)
}

/** Batch-fetches linked issues' completionPercentage for a set of milestone ids, grouped by milestone. Excludes archived issues, matching pms-issue-service.ts's own isArchived-false convention. */
async function fetchIssueCompletionByMilestone(db: TenantDb, milestoneIds: string[]): Promise<Map<string, number[]>> {
  const byMilestone = new Map<string, number[]>()
  if (milestoneIds.length === 0) return byMilestone
  const linkedIssues = await db.query.pmsIssues.findMany({
    where: and(inArray(pmsIssues.milestoneId, milestoneIds), eq(pmsIssues.isArchived, false)),
    columns: { milestoneId: true, completionPercentage: true },
  })
  for (const issue of linkedIssues) {
    if (!issue.milestoneId) continue
    const arr = byMilestone.get(issue.milestoneId)
    if (arr) arr.push(Number(issue.completionPercentage))
    else byMilestone.set(issue.milestoneId, [Number(issue.completionPercentage)])
  }
  return byMilestone
}

export async function listMilestones(ctx: { orgId: string }, projectId: string) {
  return withTenantContext({ orgId: ctx.orgId }, async (db) => {
    const milestones = await db.query.pmsMilestones.findMany({ where: and(eq(pmsMilestones.orgId, ctx.orgId), eq(pmsMilestones.projectId, projectId)), orderBy: (t, { asc }) => asc(t.targetDate) })
    const issueMap = await fetchIssueCompletionByMilestone(db, milestones.map((m) => m.id))
    return milestones.map((m) => ({ ...m, completionPercentage: computeMilestoneCompletionPercentage(issueMap.get(m.id) ?? []) }))
  })
}

export async function createMilestone(
  ctx: PmsContext,
  projectId: string,
  input: { name: string; description?: string; targetDate?: string }
) {
  const name = input.name?.trim()
  if (!name) throw new ServiceError("name is required", 400)

  return withTenantContext({ orgId: ctx.orgId }, async (db) => {
    const [row] = await db.insert(pmsMilestones).values({
      orgId: ctx.orgId, projectId, name, description: input.description || null, targetDate: input.targetDate || null,
    }).returning()
    // A brand-new milestone has no linked issues yet -- 0 by construction,
    // kept explicit here so create/list response shapes always match.
    return { ...row, completionPercentage: 0 }
  })
}

export async function listEstimateSchemes(ctx: { orgId: string }, projectId: string) {
  return withTenantContext({ orgId: ctx.orgId }, async (db) => {
    const schemes = await db.query.pmsEstimateSchemes.findMany({ where: and(eq(pmsEstimateSchemes.orgId, ctx.orgId), eq(pmsEstimateSchemes.projectId, projectId)) })
    const points = await db.query.pmsEstimatePoints.findMany({
      where: (t, { inArray }) => inArray(t.schemeId, schemes.map((s) => s.id)),
    })
    return schemes.map((s) => ({ ...s, points: points.filter((p) => p.schemeId === s.id).sort((a, b) => a.position - b.position) }))
  })
}

export async function createEstimateScheme(ctx: PmsContext, projectId: string, input: { name: string; points: string[] }) {
  const name = input.name?.trim()
  if (!name) throw new ServiceError("name is required", 400)
  if (!Array.isArray(input.points) || input.points.length === 0) throw new ServiceError("points must be a non-empty array", 400)

  return withTenantContext({ orgId: ctx.orgId }, async (db) => {
    const [scheme] = await db.insert(pmsEstimateSchemes).values({ orgId: ctx.orgId, projectId, name }).returning()
    const points = await db.insert(pmsEstimatePoints).values(
      input.points.map((value, i) => ({ schemeId: scheme.id, value, position: i }))
    ).returning()
    return { ...scheme, points }
  })
}
