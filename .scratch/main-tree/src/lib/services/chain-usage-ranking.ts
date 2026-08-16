// tree4-unified U-D5.B2.S3 ("predict likely selections, learn user
// behaviour, prioritize frequent chains... recommend previous selections,
// auto-select obvious options") and U-D5.B2.S4 ("per-user Library,
// auto-generated from ... History/Behaviour"). Confirmed absent before this
// wave: capability-tree-service.ts's buildCapabilityTree() returned nodes in
// a fixed registration/DB order with zero notion of which chains a given
// user actually uses (grep for "sort"/"frequency"/"recent" across that file
// turned up nothing).
//
// This module deliberately does NOT attempt the full literal ask (a real
// prediction/ML "learning" model) -- that is a genuinely separate,
// multi-week initiative (a trained or online-learned ranking model, not a
// narrow slice of this codebase's existing patterns). What it builds is the
// same class of thing this codebase's own history repeatedly ratifies as
// the honest close call: a deterministic proxy that satisfies the concrete,
// testable behavior (frequent/recent selections rank first, per-user) using
// only real, already-collected data (tasks.dynamicChainId + the
// dynamicChains row's pathKeys), with zero LLM call and zero hidden state.
//
// Recency-weighted frequency (exponential half-life decay) is the proxy:
// a chain used many times recently outranks one used once long ago, and a
// chain never used by this user contributes no score at all -- which is
// exactly "prioritize frequent chains" / "recommend previous selections"
// stated in scoring terms. "Auto-select obvious options" (a single-child
// node needs no ranking, it's the only choice) and "learn user behaviour"
// beyond this recency/frequency proxy are out of this module's scope --
// see this file's own tests and capability-tree-service.ts's call site for
// exactly what's wired.
//
// Pure scoring/sorting functions (no DB access) + one real DB aggregation
// function, matching monitoring-engine.ts's established split in this
// codebase.
import { dynamicChains, tasks } from "@/lib/db"
import { withTenantContext } from "@/lib/db/tenant-scoped"
import { and, eq, gte, inArray, isNotNull } from "drizzle-orm"
import type { CapabilityNode } from "./capability-tree-service"

export type ChainUsageEvent = {
  /** A dynamicChains row's pathKeys -- e.g. ["compliance", "gst_return", "file"]. */
  pathKeys: unknown[]
  createdAt: Date
}

/** Half-life in days for the recency decay -- a chain used 30 days ago counts half as much as one used today. Not configurable via input on purpose: a single, documented constant is easier to reason about than a per-call knob nothing yet needs. */
export const USAGE_HALF_LIFE_DAYS = 30

/**
 * Recency-weighted frequency score, keyed by the JSON-stringified path
 * PREFIX (not just the leaf key) -- so both a top-level Mode Pill and every
 * deeper node the user actually traversed to reach it accumulate real
 * score, and identically-named keys under different parents never collide
 * (e.g. a "file" leaf under "gst_return" vs. under "tds_return" are scored
 * independently).
 */
export function computePathUsageScores(
  events: ChainUsageEvent[],
  now: Date = new Date(),
  halfLifeDays: number = USAGE_HALF_LIFE_DAYS,
): Map<string, number> {
  const scores = new Map<string, number>()
  for (const ev of events) {
    if (!Array.isArray(ev.pathKeys) || ev.pathKeys.length === 0) continue
    const ageDays = Math.max(0, (now.getTime() - ev.createdAt.getTime()) / 86_400_000)
    const weight = Math.pow(0.5, ageDays / halfLifeDays)
    if (weight <= 0) continue
    for (let i = 1; i <= ev.pathKeys.length; i++) {
      const prefixKey = JSON.stringify(ev.pathKeys.slice(0, i))
      scores.set(prefixKey, (scores.get(prefixKey) ?? 0) + weight)
    }
  }
  return scores
}

/**
 * Sorts one level of nodes by usage score, highest first. Ties (including
 * the all-zero/no-data case) preserve the original array order -- this is
 * the fast, deliberate no-op path: an org/user with no usage history yet
 * gets back exactly the pre-existing registration order, not an arbitrary
 * shuffle.
 */
export function rankNodesByUsage(nodes: CapabilityNode[], parentPath: string[], scores: Map<string, number>): CapabilityNode[] {
  if (scores.size === 0) return nodes
  return nodes
    .map((node, index) => ({ node, index, score: scores.get(JSON.stringify([...parentPath, node.key])) ?? 0 }))
    .sort((a, b) => b.score - a.score || a.index - b.index)
    .map((entry) => entry.node)
}

/**
 * Recursively applies rankNodesByUsage at every depth of the tree. Returns
 * the exact same array reference (no-op) when there is no usage data at
 * all, so callers with no scores never pay a mapping cost or risk changing
 * node identity for unrelated code (e.g. React key stability).
 */
export function applyUsageRanking(nodes: CapabilityNode[], scores: Map<string, number>, parentPath: string[] = []): CapabilityNode[] {
  if (scores.size === 0) return nodes
  const ranked = rankNodesByUsage(nodes, parentPath, scores)
  return ranked.map((node) =>
    node.children && node.children.length > 0
      ? { ...node, children: applyUsageRanking(node.children, scores, [...parentPath, node.key]) }
      : node
  )
}

/**
 * Real DB aggregation: this user's own task history (tasks.dynamicChainId,
 * scoped to this org+user, last `days` days) joined to the dynamicChains
 * rows it points at for their pathKeys, fed into computePathUsageScores().
 * Per-USER on purpose (not per-org) -- U-D5.B2.S4's "per-user Library" and
 * U-D5.B2.S3's "learn user behaviour" both name the individual user, not
 * the org, as the scope. Deliberately excludes the org-wide "everyone's
 * most-used chain" ranking some read of "prioritize frequent chains" might
 * imply -- that's a distinct, un-requested feature (surfacing what OTHER
 * users do), not built here.
 */
export async function getUserChainUsageScores(orgId: string, userId: string, days = 90): Promise<Map<string, number>> {
  return withTenantContext({ orgId, userId }, async (db) => {
    const cutoff = new Date(Date.now() - days * 86_400_000)
    const rows = await db.query.tasks.findMany({
      where: and(eq(tasks.orgId, orgId), eq(tasks.userId, userId), gte(tasks.createdAt, cutoff), isNotNull(tasks.dynamicChainId)),
      columns: { dynamicChainId: true, createdAt: true },
    })
    if (rows.length === 0) return new Map()

    const chainIds = [...new Set(rows.map((r) => r.dynamicChainId!))]
    const chains = await db.query.dynamicChains.findMany({ where: inArray(dynamicChains.id, chainIds) })
    const chainById = new Map(chains.map((c) => [c.id, c]))

    const events: ChainUsageEvent[] = rows
      .map((r) => ({ pathKeys: (chainById.get(r.dynamicChainId!)?.pathKeys as unknown[]) ?? [], createdAt: r.createdAt }))
      .filter((e) => e.pathKeys.length > 0)

    return computePathUsageScores(events)
  })
}

export type PersonalChainLibraryEntry = {
  id: string
  modePill: string
  pathKeys: unknown
  pathLabels: unknown
  description: string | null
  score: number
}

/**
 * U-D5.B2.S4's "per-user Library, auto-generated from ... History/
 * Behaviour" -- the org's Global Library (every approved dynamicChains row)
 * filtered down to the ones this user has actually used before, ranked by
 * the same recency-weighted score, real DB data only. Role/Department/
 * Projects/Permissions/Teams/Location/Organization-based personalization
 * (the requirement's other 7 named inputs) is NOT built here -- dynamicChains
 * .permissions is currently a free-form, unconsumed jsonb field (see
 * schema.ts's own comment: "narrow schema deferred until a real consumer
 * needs a specific shape"), so matching it against a user's real
 * role/department would mean designing that schema first, a separate,
 * larger initiative, not a narrow extension of this function.
 */
export async function getUserChainLibrary(orgId: string, userId: string, days = 90, limit = 20): Promise<PersonalChainLibraryEntry[]> {
  const scores = await getUserChainUsageScores(orgId, userId, days)
  if (scores.size === 0) return []
  return withTenantContext({ orgId }, async (db) => {
    const approved = await db.query.dynamicChains.findMany({ where: and(eq(dynamicChains.orgId, orgId), eq(dynamicChains.status, "approved")) })
    return approved
      .map((c) => ({
        id: c.id, modePill: c.modePill, pathKeys: c.pathKeys, pathLabels: c.pathLabels, description: c.description,
        score: scores.get(JSON.stringify(c.pathKeys)) ?? 0,
      }))
      .filter((c) => c.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, limit)
  })
}
