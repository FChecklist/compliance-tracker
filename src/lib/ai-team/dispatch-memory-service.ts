// VERIDIAN_CONSOLIDATED_COMPLETION Stage 12 -- closes the AI Dev Team
// dispatch system's confirmed persistent-memory gap (SYSTEM_MEMORY_
// ARCHITECTURE.yaml's own honest layer_5 entry: zero persistent memory of
// past dispatch outcomes, so nothing could ever check "have we dispatched
// something like this before" prior to a new dispatch). See schema.ts's
// dispatchOutcomes comment for the full table rationale.
//
// Platform-wide, NOT tenant-scoped: team-service.ts's own file header says
// it plainly ("the AI Dev Team builds VERIDIAN, it doesn't run inside" a
// customer org), and dispatch-repo.ts's dispatchRepoTask() never takes an
// orgId either -- every real caller of runRole()/dispatchRepoTask() for an
// AI Dev Team role is platform-internal work, never a customer org's
// workflow. That means there is no tenant dimension to scope this table
// by, so it deliberately does NOT go through withTenantContext (which
// requires an orgId) -- same posture as roster-overrides.ts's direct `db`
// use for platform.ai_team_role_overrides, and token-usage-service.ts's
// own comment on why tokenUsageLedger "was never a fit for
// withTenantContext's org-scoped model" for its platform-internal rows.
//
// Dedup mirrors this session's two already-proven mechanisms rather than
// inventing a third:
//  - objectiveHash: exact sha256 match on the normalized objective text,
//    same "hash detects identity" role as knowledge_engine's content_hash
//    (ai-os/scripts/superboss-register.py's check_duplicate()/register
//    functions).
//  - pg_trgm similarity() on objectiveSummary for the "similar, not
//    identical" case a bare hash can't catch -- same mechanism as
//    fm-asset-dedup-service.ts / mdm-quality-service.ts's Wave 93
//    duplicate-detection queries. pg_trgm is already installed
//    (drizzle/0079), so this adds no new extension dependency.
import { createHash } from "crypto"
import { and, eq, sql } from "drizzle-orm"
import { db, dispatchOutcomes } from "@/lib/db"

export type DispatchSurface = "team_service_run_role" | "dispatch_repo_task"
export type DispatchOutcomeStatus = "completed" | "dispatched" | "failed"

export type RecordDispatchOutcomeInput = {
  roleKey: string
  /** Free-text task/objective description -- the same `input` string passed to runRole(), or task.objective for dispatchRepoTask(). */
  objective: string
  status: DispatchOutcomeStatus
  model?: string | null
  errorMessage?: string | null
  dispatchSurface: DispatchSurface
}

/**
 * Normalizes objective text before hashing/storing for exact-match
 * comparison: trim, lowercase, collapse internal whitespace runs to a
 * single space. Two objectives that differ only in casing or incidental
 * whitespace hash identically -- a real duplicate dispatch is rarely
 * byte-for-byte identical to the string that produced it originally.
 */
export function normalizeObjective(objective: string): string {
  return objective.trim().toLowerCase().replace(/\s+/g, " ")
}

/**
 * sha256 of the normalized objective -- the exact-match dedup key. Two
 * dispatches with the same role_key + objectiveHash are, for this
 * function's purposes, the SAME dispatch attempted twice.
 */
export function hashObjective(objective: string): string {
  return createHash("sha256").update(normalizeObjective(objective)).digest("hex")
}

// Same threshold fm-asset-dedup-service.ts uses for its own pg_trgm scan --
// not re-derived here, reused as-is (0.0-1.0 scale, 1.0 == identical).
const SIMILARITY_THRESHOLD = 0.5

/**
 * Records one dispatch outcome row. Fire-and-forget-safe: never throws
 * past a caught/logged failure, same convention as logTokenUsage
 * (token-usage-service.ts) -- a persistent-memory write failing must never
 * be the reason a real dispatch call site itself fails.
 */
export async function recordDispatchOutcome(input: RecordDispatchOutcomeInput): Promise<void> {
  try {
    await db.insert(dispatchOutcomes).values({
      roleKey: input.roleKey,
      // Bounded the same way token-usage-service.ts bounds taskSummary --
      // this is a lookup/audit field, not a full task transcript store.
      objectiveSummary: input.objective.slice(0, 2000),
      objectiveHash: hashObjective(input.objective),
      dispatchSurface: input.dispatchSurface,
      status: input.status,
      model: input.model ?? null,
      errorMessage: input.errorMessage ?? null,
    })
  } catch (err) {
    console.error("[dispatch-memory] failed to record dispatch outcome (non-fatal):", err)
  }
}

export type PriorDispatchMatch = {
  id: string
  matchType: "exact" | "similar"
  objectiveSummary: string
  status: string
  createdAt: Date
  /** Only present for matchType 'similar' -- the pg_trgm similarity() score that produced this match. */
  score?: number
}

/**
 * "Have we dispatched something like this before?" -- the real
 * check-before-dispatch function. Two-stage, scoped to the SAME role_key
 * in both stages (a duplicate is only meaningful within the same role --
 * two different roles legitimately working on similarly-worded objectives
 * is normal, not a duplicate):
 *
 *  1. Exact match: same role_key + objectiveHash. Fast, unambiguous --
 *     checked first so an identical retry never falls through to the
 *     fuzzier stage 2 and gets a lower-confidence 'similar' label instead
 *     of the 'exact' one it deserves.
 *  2. Similar match: pg_trgm similarity() on objectiveSummary > 0.5,
 *     highest-scoring row wins. Only reached when stage 1 finds nothing.
 *
 * Returns null when neither stage finds a match. Platform-wide query (no
 * tenant scoping) -- see this module's file header and dispatchOutcomes'
 * schema.ts comment for why.
 */
export async function checkPriorDispatch(roleKey: string, objective: string): Promise<PriorDispatchMatch | null> {
  const hash = hashObjective(objective)

  const exact = await db.query.dispatchOutcomes.findFirst({
    where: and(eq(dispatchOutcomes.roleKey, roleKey), eq(dispatchOutcomes.objectiveHash, hash)),
  })
  if (exact) {
    return {
      id: exact.id,
      matchType: "exact",
      objectiveSummary: exact.objectiveSummary,
      status: exact.status,
      createdAt: exact.createdAt,
    }
  }

  const normalized = normalizeObjective(objective)
  const rows = (await db.execute(sql`
    SELECT id, objective_summary, status, created_at, similarity(objective_summary, ${normalized}) AS score
    FROM platform.dispatch_outcomes
    WHERE role_key = ${roleKey}
      AND similarity(objective_summary, ${normalized}) > ${SIMILARITY_THRESHOLD}
    ORDER BY score DESC
    LIMIT 1
  `)) as Array<{ id: string; objective_summary: string; status: string; created_at: Date | string; score: number }>

  const best = rows[0]
  if (!best) return null
  return {
    id: best.id,
    matchType: "similar",
    objectiveSummary: best.objective_summary,
    status: best.status,
    createdAt: new Date(best.created_at),
    score: best.score,
  }
}
