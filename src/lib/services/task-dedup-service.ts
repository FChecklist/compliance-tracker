// VERIDIAN Review Framework gap closure, 2026-07-18 ("Duplicate Work
// Detection" -- no duplicate-task/duplicate-work detection for ordinary
// business tasks, e.g. two people independently starting the same
// compliance filing). Confirmed genuinely missing before writing anything:
// src/lib/loop-prevention.ts's own header says duplicate-task detection
// "doesn't exist yet ... that graph doesn't exist yet."
//
// Deliberately a SIBLING to, not part of, capability-registry-service.ts:
// that file's CAPABILITY_ENTITY_TYPES (worker_agent/automation_rule/
// module/prompt_pattern/dynamic_chain) are internal-system-capability
// concepts -- the finding itself calls that "a narrower, different
// concept" from ordinary business tasks. This module reuses the same
// underlying entity-agnostic src/lib/embeddings.ts (storeEmbedding/
// findSimilar) with its own 'task' entityType, the same way capability-
// registry-service.ts is itself just a thin typed wrapper over that infra
// for its 5 entity types -- no new embeddings table, no schema change.
//
// Threshold defaults to 0.92, the exact pattern the finding names
// (auditDuplicateCapabilities()'s own default). Scoped per org + optional
// projectId -- tasks has no separate "module" column; projectId (Wave 19,
// optional Product/Project L2 scope) is the closest real scoping concept
// that exists on the table today.
import { db, tasks, embeddings } from "@/lib/db"
import { withTenantContext } from "@/lib/db/tenant-scoped"
import { storeEmbedding, findSimilar } from "@/lib/embeddings"
import { and, eq, inArray } from "drizzle-orm"

const TASK_ENTITY_TYPE = "task"

// Mirrors capability-registry-service.ts's RELEVANCE_THRESHOLD: pgvector's
// <=> operator always returns the *closest* rows even when nothing in the
// index is actually related, so a floor is needed before a match is
// treated as real at all (independent of the stricter DUPLICATE_THRESHOLD
// used to actually flag something as a likely duplicate).
const RELEVANCE_THRESHOLD = 0.5
const DUPLICATE_THRESHOLD = 0.92

// Only active work can be duplicated in the sense this feature cares about
// ("two people independently STARTING the same work") -- a completed/
// failed/cancelled task matching a new one isn't a collision to prevent.
const ACTIVE_STATUSES = ["pending", "in_progress"] as const

export function buildTaskDedupContent(title: string, description: string | null): string {
  return [title, description].filter(Boolean).join(" | ")
}

/** Best-effort, fire-and-forget from callers (same contract as indexCapability()) -- a failed embedding call must never block task creation/update. */
export async function indexTaskForDedup(orgId: string, taskId: string, title: string, description: string | null): Promise<void> {
  await storeEmbedding(TASK_ENTITY_TYPE, taskId, buildTaskDedupContent(title, description), orgId)
}

async function listActiveTasks(ctx: { orgId: string; projectId?: string | null }) {
  return withTenantContext({ orgId: ctx.orgId }, (tdb) =>
    tdb.query.tasks.findMany({
      where: and(
        inArray(tasks.status, [...ACTIVE_STATUSES]),
        ctx.projectId ? eq(tasks.projectId, ctx.projectId) : undefined,
      ),
    })
  )
}

export type TaskMatch = { taskId: string; title: string; score: number }

/** Single on-demand check: does an active task already exist that looks like this one? The pairwise building block scanForDuplicateTasks() below reuses, and also directly usable as a pre-creation warning. */
export async function findSimilarActiveTasks(
  ctx: { orgId: string; projectId?: string | null; excludeTaskId?: string },
  query: string,
  limit = 5
): Promise<TaskMatch[]> {
  const activeTasks = await listActiveTasks(ctx)
  if (activeTasks.length === 0) return []
  const titleById = new Map(activeTasks.map((t) => [t.id, t.title] as const))

  // findSimilar() isn't type-filtered at the SQL level (same reason
  // capability-registry-service.ts over-fetches then filters) -- the
  // embeddings table holds compliance items/notices/documents/knowledge
  // base/capability entities alongside tasks.
  const results = await findSimilar(query, ctx.orgId, limit * 3)
  const matches: TaskMatch[] = []
  for (const r of results) {
    if (r.entityType !== TASK_ENTITY_TYPE) continue
    if (r.score <= RELEVANCE_THRESHOLD) continue
    if (r.entityId === ctx.excludeTaskId) continue
    const title = titleById.get(r.entityId)
    if (!title) continue // not an active task in this org/project scope
    matches.push({ taskId: r.entityId, title, score: r.score })
  }
  return matches.slice(0, limit)
}

export type DuplicateTaskCandidate = { a: TaskMatch; b: TaskMatch; score: number }

/** On-demand audit, not a background job -- same rationale as auditDuplicateCapabilities(): each row costs one real embedding-similarity search. Never cancels/blocks a task itself; surfaces candidates for a human (a manager) to decide. */
export async function scanForDuplicateTasks(
  ctx: { orgId: string; projectId?: string | null },
  threshold = DUPLICATE_THRESHOLD
): Promise<DuplicateTaskCandidate[]> {
  const activeTasks = await listActiveTasks(ctx)
  if (activeTasks.length < 2) return []
  const activeIds = new Set(activeTasks.map((t) => t.id))
  const titleById = new Map(activeTasks.map((t) => [t.id, t.title] as const))

  const rows = await db.query.embeddings.findMany({
    where: and(eq(embeddings.entityType, TASK_ENTITY_TYPE), eq(embeddings.orgId, ctx.orgId)),
  })

  const seen = new Set<string>()
  const duplicates: DuplicateTaskCandidate[] = []

  for (const row of rows) {
    if (!row.content || !activeIds.has(row.entityId)) continue
    const matches = await findSimilarActiveTasks({ orgId: ctx.orgId, projectId: ctx.projectId, excludeTaskId: row.entityId }, row.content, 3)
    for (const match of matches) {
      if (match.score < threshold) continue
      const pairKey = [row.entityId, match.taskId].sort().join("::")
      if (seen.has(pairKey)) continue
      seen.add(pairKey)
      duplicates.push({
        a: { taskId: row.entityId, title: titleById.get(row.entityId) ?? row.entityId, score: 1 },
        b: match,
        score: match.score,
      })
    }
  }
  return duplicates
}
