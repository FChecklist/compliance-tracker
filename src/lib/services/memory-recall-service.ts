// R68 (Institutional Memory Graph) Phase 4 -- THE RECALL LADDER.
//
// This is the function IMG exists to provide: "what does this organisation
// already know about X?", answered by trying progressively looser matching
// strategies and stopping at the first tier that produces a confident
// answer.
//
// ─────────────────────────────────────────────────────────────────────────
// THE BINDING CONSTRAINT: R-CRR-05
// ─────────────────────────────────────────────────────────────────────────
//
// Read verbatim off platform.crr_ruling on the live database before this
// file was written (ruling_id 'R-CRR-05', ruled 2026-08-25, is_binding
// true):
//
//   Q: "May the similar tier act, or only suggest?"
//   RULING: "SIMILAR MAY ONLY PROPOSE. ONLY EXACT MAY EXECUTE.
//            Software first, then AI."
//   RATIONALE: "A similar precedent is by definition not identical: a 0.95
//            cosine can still be the wrong client, the wrong period or the
//            wrong amount. Consistent with M26 - a model output that fails
//            validation is a FAIL, not a suggestion."
//
// That ruling is enforced HERE STRUCTURALLY, not by a comment asking
// callers to be careful:
//
//   1. RecallResult is a discriminated union. The `exact` variant is the
//      only one with a `record` field. The proposal variants declare
//      `record?: never`, so `result.record` on a keyword/vector/graph
//      result is a COMPILE ERROR, not a runtime surprise.
//   2. Proposal tiers carry their payload under a deliberately un-
//      executable name -- `proposals`, typed as RecallProposal[], a shape
//      that is NOT a MemoryRecord and cannot be passed anywhere a
//      MemoryRecord is expected. A caller cannot accidentally feed a
//      similar-tier hit into a code path expecting a resolved memory.
//   3. takeExecutableRecord() is the single accessor that yields an
//      auto-appliable value. It returns null for every tier except
//      `exact`, and re-checks `mayExecute` at runtime so a hand-built or
//      JSON-round-tripped result object cannot slip past the type system.
//   4. `mayExecute` is a literal type (`true` only on the exact variant),
//      so it cannot be widened by a caller constructing a result.
//
// There is deliberately NO option, flag, or override that lets tiers 2-4
// auto-execute. Adding one would require changing this file's types, which
// is the point.
//
// ─────────────────────────────────────────────────────────────────────────
// WHAT THIS FILE REUSES (verified present before writing, never rebuilt)
// ─────────────────────────────────────────────────────────────────────────
//
//   * resolveMemoryScope() / resolveMostSpecific() (Phase 3, memory-
//     service.ts) -- the ONE scope resolver. Tier 1 calls it rather than
//     re-deriving GLOBAL->ORGANIZATION->DEPARTMENT->USER precedence, so
//     there remains exactly one place that decision is made.
//   * compliance.memory_records.search_vector (Phase 4, drizzle/0546 --
//     added by this phase because it genuinely did not exist; see that
//     migration's header for the full check-first reasoning) and
//     compliance.document_chunk.search_vector (pre-existing, GIN-indexed).
//   * findSimilar() (Phase 5, embeddings.ts) -- already restricts a query
//     vector to its own embedding space (e.embedding_model = model) and to
//     is_real = true rows, so tier 3 inherits both guarantees for free.
//   * platform.graph_impact/graph_descendants (Phase 2) -- called WITH
//     their own p_max_depth/p_max_rows caps passed through, never bypassed.
//
// ─────────────────────────────────────────────────────────────────────────
// HONEST DEGRADATION (requirement 5: "works first as software, then with AI")
// ─────────────────────────────────────────────────────────────────────────
//
// Tiers 1 and 2 are pure SQL -- B-tree/scope resolution and a GIN tsvector
// scan. They involve no model, no embedding provider, and no network call,
// so they work identically whether or not OPENROUTER_API_KEY/GROQ_API_KEY
// are set. Tier 3 needs a real embedding provider; tier 4 is seeded by
// tier 3 and therefore inherits that need.
//
// When no real provider is configured, generateEmbeddingUncached() falls
// back to a deterministic hash pseudo-vector with isReal:false and
// model:'hash-pseudo-vector'. CRR-017's rule is that such a vector must
// never be presented as a real answer. Tier 3 therefore checks isReal
// FIRST and SKIPS itself with an explicit, machine-readable reason rather
// than scoring against a pseudo-vector -- the ladder degrades to "tiers
// 1-2 only", loudly, instead of silently returning plausible-looking
// nonsense. Every skip is recorded in `result.skipped` so a caller (or a
// test) can tell "searched and found nothing" apart from "could not
// search at all". Those are very different answers and this file never
// conflates them.
import type { TenantDb } from "@/lib/db/tenant-scoped"
import { sql } from "drizzle-orm"
import { db } from "@/lib/db"
import { findSimilar, generateEmbeddingUncached, HASH_PSEUDO_VECTOR_MODEL } from "@/lib/embeddings"
import type { ActorCtx } from "./actor-context"
import { resolveMemoryScope, type MemoryType, type ResolvedMemoryRecord } from "./memory-service"
import { assertImgEntitled } from "./memory-entitlement"

// ─── Tiers ───────────────────────────────────────────────────────────────

/** Ordered least-to-most permissive. The ladder tries them in this order. */
export const RECALL_TIERS = ["exact", "keyword", "vector", "graph"] as const
export type RecallTier = (typeof RECALL_TIERS)[number]

/**
 * The single tier R-CRR-05 permits to execute. Exported as a const so a
 * reader (and a test) can point at the one value that carries that
 * authority, rather than at a string literal repeated across the file.
 */
export const EXECUTABLE_TIER: RecallTier = "exact"

/**
 * Why a tier did not produce the answer. `miss` and `unavailable` are
 * deliberately different: a miss means the tier really ran and found
 * nothing (a fact about the data), `unavailable` means the tier could not
 * run at all (a fact about the environment, e.g. no embedding provider).
 * Collapsing the two is exactly the silent-degradation failure CRR-017
 * exists to prevent.
 */
export type RecallSkipKind = "miss" | "unavailable" | "not_requested"

export type RecallSkip = {
  tier: RecallTier
  kind: RecallSkipKind
  /** Human-readable, safe to log and to surface in a UI. */
  reason: string
}

// ─── Proposals (tiers 2-4) ───────────────────────────────────────────────

/** One edge walked while expanding a tier-3 seed, for tier 4's citation trail. */
export type RecallCitationEdge = {
  /** The graph node the walk started from (e.g. "table:compliance.projects"). */
  fromNodeKey: string
  /** The node reached at this hop. */
  toNodeKey: string
  depth: number
  /** platform.graph_impact reports the FK column an edge was derived from; null when the traversal does not expose one. */
  viaColumn: string | null
}

/**
 * A candidate the ladder is PROPOSING. Deliberately NOT a MemoryRecord and
 * deliberately not structurally assignable to one -- see rule 2 in this
 * file's header. A proposal names an entity and says why it surfaced; it
 * does not hand over a record a caller could act on.
 */
export type RecallProposal = {
  tier: Exclude<RecallTier, "exact">
  entityType: string
  entityId: string
  content: string
  /** Tier-2: ts_rank. Tier-3: cosine similarity. Tier-4: re-ranked, see rerankGraphExpanded(). */
  score: number
  /** Tier 4 only: the edges walked to reach this candidate. Empty for a seed that was itself a tier-3 hit. */
  citationTrail: RecallCitationEdge[]
}

// ─── Result ──────────────────────────────────────────────────────────────

/**
 * The ladder's answer. See rules 1-4 in this file's header: `record`
 * exists ONLY on the exact variant, `mayExecute` is `true` ONLY there, and
 * the proposal variants cannot be narrowed into the exact one by a caller.
 */
export type RecallResult =
  | {
      tier: "exact"
      mayExecute: true
      /** The resolved, scope-correct memory. Reachable via takeExecutableRecord(). */
      record: ResolvedMemoryRecord
      proposals?: never
      skipped: RecallSkip[]
    }
  | {
      tier: Exclude<RecallTier, "exact">
      mayExecute: false
      record?: never
      proposals: RecallProposal[]
      skipped: RecallSkip[]
    }
  | {
      tier: "none"
      mayExecute: false
      record?: never
      proposals: readonly []
      skipped: RecallSkip[]
    }

/**
 * The ONLY way to obtain a value from a RecallResult that a caller may
 * auto-apply. Returns the resolved memory record for an `exact` hit and
 * null for every other tier -- including a hand-constructed or
 * JSON-round-tripped object claiming tier "exact" without mayExecute, or
 * vice versa (both are re-checked at runtime, because a value that came
 * back from JSON.parse() has no compile-time guarantees left).
 *
 * This is the enforcement point for R-CRR-05: any code path that wants to
 * ACT on recall output has to come through here, and here only the exact
 * tier yields anything.
 */
export function takeExecutableRecord(result: RecallResult): ResolvedMemoryRecord | null {
  if (result.tier !== EXECUTABLE_TIER) return null
  if (result.mayExecute !== true) return null
  return result.record ?? null
}

/**
 * The complement of takeExecutableRecord(): everything the ladder found
 * that a human (or a higher-confidence tier) may CONSIDER but nothing may
 * auto-apply. Always returns an array, never a record.
 */
export function takeProposals(result: RecallResult): readonly RecallProposal[] {
  if (result.tier === EXECUTABLE_TIER) return []
  return result.proposals ?? []
}

// ─── Options ─────────────────────────────────────────────────────────────

export type RecallMemoryOptions = {
  /**
   * Tier 1's logical key. Without it tier 1 cannot run (there is no such
   * thing as an "exact" match on free text) and is skipped as
   * `not_requested` -- which is honest: the caller did not supply a key,
   * so no exact answer was possible, and nothing may auto-execute.
   */
  registryRef?: string
  memoryType?: MemoryType
  /** Per-tier candidate cap. Default 10. */
  limit?: number
  /** Highest tier the caller is willing to descend to. Default "graph". */
  maxTier?: RecallTier
  /**
   * Tier 2 also searches compliance.document_chunk.search_vector when true
   * (default false). Off by default so the ladder's tiers all speak about
   * the same corpus -- memories -- unless a caller explicitly wants
   * document chunks mixed in.
   */
  includeDocumentChunks?: boolean
  /** Tier 4 traversal depth, clamped to [1, GRAPH_EXPAND_MAX_DEPTH]. Default 1. */
  graphDepth?: number
  /** Tier 4 seed count: how many of tier 3's top candidates to expand from. Default 3. */
  graphSeedLimit?: number
  /** Minimum ts_rank for a tier-2 candidate to count as a hit. Default 0 (any match). */
  minKeywordRank?: number
  /** Minimum cosine similarity for a tier-3 candidate to count as a hit. Default 0. */
  minVectorScore?: number
}

/**
 * Injectable seams. Same dependency-injection style Phase 5 established on
 * findSimilar() (deps.embedQuery / deps.searchClient) rather than
 * mock.module() -- so the real branching logic in this file can be tested
 * against fixture data without a live Postgres, which this sandbox/CI does
 * not have.
 */
export type RecallDeps = {
  /** Defaults to generateEmbeddingUncached -- the UNCACHED path, because tier 3 must see `isReal`/`model`, which the content-hash cache does not record. */
  embedQuery?: (text: string) => Promise<{ vector: number[]; isReal: boolean; model: string }>
  /** Defaults to the real findSimilar(). */
  similaritySearch?: typeof findSimilar
  /** Defaults to the bypass-RLS `db` used for platform-tier graph reads (graph_node/graph_impact are platform catalog data, same posture as graph-impact-service.ts). */
  graphDb?: { execute: (query: unknown) => Promise<unknown> }
}

// Mirrors platform.graph_impact's own p_max_depth ceiling (graph_ancestors
// enforces it internally). Clamping here is defense in depth, NOT a new or
// competing limit -- the directive's "respect their own row/depth caps, do
// not bypass them" applies literally: this file passes the caps through and
// never raises them.
export const GRAPH_EXPAND_MAX_DEPTH = 2
export const GRAPH_EXPAND_DEFAULT_DEPTH = 1
/** Passed through as platform.graph_impact's p_max_rows. Never widened above the function's own default. */
export const GRAPH_EXPAND_MAX_ROWS = 500

export function clampGraphDepth(requested: number | null | undefined): number {
  if (requested === null || requested === undefined || !Number.isFinite(requested)) return GRAPH_EXPAND_DEFAULT_DEPTH
  return Math.min(Math.max(1, Math.trunc(requested)), GRAPH_EXPAND_MAX_DEPTH)
}

// ─── Tier 1: exact ───────────────────────────────────────────────────────

type KeywordRow = {
  entity_type: string
  entity_id: string
  content: string
  rank: number | string
}

/**
 * Tier 1. An exact match on the caller-supplied logical key
 * (registryRef) within the actor's resolved scope.
 *
 * Delegates entirely to resolveMemoryScope() for BOTH the fetch and the
 * GLOBAL->ORGANIZATION->DEPARTMENT->USER precedence -- this function
 * contains no scope logic of its own, by design. resolveMemoryScope()
 * already returns at most one winner per logical key (resolveMostSpecific()
 * groups by registryRef), so narrowing it to a single registryRef yields
 * either exactly one most-specific record or nothing.
 *
 * This is the only tier whose result may be auto-applied (R-CRR-05).
 */
export async function recallExact(
  tx: TenantDb,
  actor: ActorCtx,
  registryRef: string,
  options: { memoryType?: MemoryType } = {}
): Promise<ResolvedMemoryRecord | null> {
  const resolved = await resolveMemoryScope(tx, actor, {
    registryRef,
    memoryType: options.memoryType,
  })
  // resolveMostSpecific() sorts most-specific-first and collapses to one
  // entry per logical key, so [0] IS the winner -- not an arbitrary pick.
  return resolved[0] ?? null
}

// ─── Tier 2: keyword (full-text) ─────────────────────────────────────────

/**
 * Tier 2. Full-text search over compliance.memory_records.search_vector
 * (drizzle/0546, GIN-indexed) and optionally
 * compliance.document_chunk.search_vector, ranked by ts_rank.
 *
 * NO EMBEDDING PROVIDER IS INVOLVED. This is a pure Postgres text search,
 * which is precisely why it is the tier that keeps working when every
 * model is unavailable -- the "works first as software" half of
 * requirement 5.
 *
 * Scoping is left to RLS exactly as everywhere else in this codebase: the
 * caller's own withTenantContext transaction supplies the org/user GUCs,
 * and Phase 1's SELECT policy (own org or global, is_personal excluded
 * unless it is the caller's own) is what actually restricts rows. This
 * function adds no org filter of its own.
 *
 * PROPOSES ONLY (R-CRR-05).
 */
export async function recallKeyword(
  tx: TenantDb,
  query: string,
  options: { limit?: number; includeDocumentChunks?: boolean; memoryType?: MemoryType; minRank?: number } = {}
): Promise<RecallProposal[]> {
  const trimmed = query.trim()
  if (!trimmed) return []

  const limit = options.limit ?? 10
  const minRank = options.minRank ?? 0
  const memoryTypeFilter = options.memoryType ? sql`AND m.memory_type = ${options.memoryType}` : sql``

  // plainto_tsquery (not to_tsquery): it accepts raw user text and never
  // throws on punctuation/operators, which to_tsquery does. A recall query
  // is arbitrary user input.
  const memoryRows = (await tx.execute(sql`
    SELECT 'memory_record' AS entity_type, m.id AS entity_id, m.content,
           ts_rank(m.search_vector, plainto_tsquery('english', ${trimmed})) AS rank
    FROM compliance.memory_records m
    WHERE m.search_vector @@ plainto_tsquery('english', ${trimmed})
      AND m.lifecycle_state NOT IN ('ARCHIVED', 'SUPERSEDED')
      ${memoryTypeFilter}
    ORDER BY rank DESC
    LIMIT ${limit}
  `)) as KeywordRow[]

  const rows: KeywordRow[] = [...memoryRows]

  if (options.includeDocumentChunks) {
    // Pre-existing tsvector + GIN index (document_chunk_search_vector_gin),
    // same 'english' regconfig as memory_records.search_vector -- verified
    // live, see drizzle/0546's header.
    const chunkRows = (await tx.execute(sql`
      SELECT 'document_chunk' AS entity_type, c.id AS entity_id, c.content,
             ts_rank(c.search_vector, plainto_tsquery('english', ${trimmed})) AS rank
      FROM compliance.document_chunk c
      WHERE c.search_vector @@ plainto_tsquery('english', ${trimmed})
        AND c.content_erased_at IS NULL
      ORDER BY rank DESC
      LIMIT ${limit}
    `)) as KeywordRow[]
    rows.push(...chunkRows)
  }

  return rows
    .map((r) => ({
      tier: "keyword" as const,
      entityType: r.entity_type,
      entityId: r.entity_id,
      content: r.content,
      score: Number(r.rank),
      citationTrail: [] as RecallCitationEdge[],
    }))
    .filter((p) => p.score > minRank)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
}

// ─── Tier 3: vector ──────────────────────────────────────────────────────

/**
 * The reason tier 3 refused to run, or null when it ran. Returned rather
 * than thrown: a provider-less environment is a legitimate operating mode
 * for this ladder (requirement 5), not an error -- the ladder is supposed
 * to keep working on tiers 1-2. Throwing would take tiers 1-2 down with it.
 */
export type VectorTierUnavailable = { available: false; reason: string }
export type VectorTierResult = { available: true; proposals: RecallProposal[] } | VectorTierUnavailable

/**
 * Tier 3. Semantic search via findSimilar() (Phase 5), which already
 * restricts results to the query vector's OWN embedding space
 * (e.embedding_model = model) and to is_real = true rows.
 *
 * CRR-017 DISCIPLINE, THE LOAD-BEARING PART: this function embeds the
 * query through the UNCACHED path so it can see `isReal`. If no real
 * provider is configured, generateEmbeddingUncached() returns a
 * deterministic hash pseudo-vector (isReal:false, model
 * 'hash-pseudo-vector'). Scoring against that would produce cosine numbers
 * that LOOK like similarity but are meaningless -- exactly the "silently
 * substituting a hash-pseudo-vector into a real user-facing answer" that
 * CRR-017 forbids. So tier 3 returns {available:false} with an explicit
 * reason instead, and the ladder falls back to whatever tiers did work.
 *
 * Note this is belt-and-braces rather than the only line of defence:
 * because storeEmbedding() already refuses to PERSIST a pseudo-vector, no
 * row in compliance.embeddings can ever have is_real = true together with
 * model 'hash-pseudo-vector', so findSimilar() would return zero rows
 * anyway. That would be a silent, indistinguishable-from-a-real-miss empty
 * result. The explicit check exists to make the difference VISIBLE.
 *
 * The real vector is then handed to findSimilar() via its own
 * deps.embedQuery seam, so the provider is called exactly ONCE per recall,
 * not twice.
 *
 * PROPOSES ONLY (R-CRR-05).
 */
export async function recallVector(
  query: string,
  orgId: string,
  options: { limit?: number; minScore?: number } = {},
  deps: RecallDeps = {}
): Promise<VectorTierResult> {
  const trimmed = query.trim()
  if (!trimmed) return { available: true, proposals: [] }

  const limit = options.limit ?? 10
  const minScore = options.minScore ?? 0
  const embedQuery = deps.embedQuery ?? ((text: string) => generateEmbeddingUncached(text))

  const embedded = await embedQuery(trimmed)

  if (!embedded.isReal || embedded.model === HASH_PSEUDO_VECTOR_MODEL) {
    return {
      available: false,
      reason:
        "no real embedding provider is configured (OPENROUTER_API_KEY/GROQ_API_KEY unset) -- the query embedded to a deterministic hash pseudo-vector. Per CRR-017 a pseudo-vector must never back a real user-facing answer, so the vector tier was skipped rather than scored. Tiers 1-2 are unaffected and still authoritative.",
    }
  }

  const similaritySearch = deps.similaritySearch ?? findSimilar
  // Hand findSimilar the vector already generated above -- one provider
  // call per recall, not two.
  const hits = await similaritySearch(trimmed, orgId, limit, {
    embedQuery: async () => ({ vector: embedded.vector, model: embedded.model }),
  })

  return {
    available: true,
    proposals: hits
      .filter((h) => h.score > minScore)
      .map((h) => ({
        tier: "vector" as const,
        entityType: h.entityType,
        entityId: h.entityId,
        content: h.content,
        score: h.score,
        citationTrail: [] as RecallCitationEdge[],
      })),
  }
}

// ─── Tier 4: graph-expanded ──────────────────────────────────────────────

/**
 * Resolves one tier-3 candidate to a platform.graph_node node_key, or null
 * when that candidate has no node in the graph.
 *
 * WHY THIS IS A REAL LOOKUP AND NOT STRING CONCATENATION: platform.graph_node
 * currently holds only `table:` (598) and `asset_type:` (10) nodes --
 * verified live. There are no per-memory-record or per-document nodes yet
 * (Phase 2's own edge-types.ts header says the instance-tier vocabulary is
 * "SCHEMA/VOCABULARY ONLY ... no bulk-populate job reads or writes these
 * values yet"). Of the seven entity_types actually present in
 * compliance.embeddings, four map to a real `table:compliance.<type>s`
 * node and three (module, worker_agent, dynamic_chain) do not.
 *
 * So this checks whether the node EXISTS before claiming it, and returns
 * null otherwise. A fabricated node key would make graph_impact return
 * nothing while looking like a successful expansion -- the same class of
 * silent-degradation bug tier 3 guards against.
 */
export async function resolveSeedNodeKey(
  entityType: string,
  deps: RecallDeps = {}
): Promise<string | null> {
  const executor = deps.graphDb ?? db
  // Convention across this schema: an embedding entity_type is the
  // singular of its table name (project -> compliance.projects).
  const candidateKey = `table:compliance.${entityType}s`
  const rows = (await executor.execute(sql`
    SELECT node_key FROM platform.graph_node WHERE node_key = ${candidateKey} LIMIT 1
  `)) as { node_key: string }[]
  return rows[0]?.node_key ?? null
}

/**
 * Re-ranks a graph-expanded set. A candidate reached by walking N edges is
 * strictly less directly relevant than the seed it was reached from, so
 * its score is the seed's score decayed by depth. Exported standalone so
 * the ranking rule is unit-testable without a database.
 *
 * Deliberately monotonic and simple: expansion must never let a distant
 * node outrank the seed that found it. A 2-hop neighbour of a 0.9 seed
 * scores below that seed, always.
 */
export const GRAPH_DEPTH_DECAY = 0.5

export function rerankGraphExpanded(proposals: RecallProposal[]): RecallProposal[] {
  return [...proposals].sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score
    // Stable, deterministic tie-break -- never an arbitrary ordering.
    return a.entityId.localeCompare(b.entityId)
  })
}

/**
 * Tier 4. Seeds from tier 3's top candidates and expands 1-2 hops through
 * platform.graph_impact(), attaching a citation trail (which edges were
 * walked to reach each candidate) to every expanded proposal.
 *
 * CAPS ARE PASSED THROUGH, NEVER BYPASSED: graph_impact's own
 * p_max_depth/p_max_rows arguments are supplied explicitly with values
 * clamped to the function's OWN ceilings (GRAPH_EXPAND_MAX_DEPTH = 2,
 * matching graph_ancestors' internal limit; p_max_rows = 500, the
 * function's own default). This file never raises them and never reaches
 * around graph_impact into the raw edge tables to avoid them.
 *
 * Seeds whose entity type has no graph node are reported in the returned
 * `unmapped` list rather than silently dropped -- see resolveSeedNodeKey().
 *
 * PROPOSES ONLY (R-CRR-05). A citation trail makes a proposal auditable;
 * it does not make it executable.
 */
export async function recallGraphExpanded(
  seeds: RecallProposal[],
  options: { depth?: number; seedLimit?: number; limit?: number } = {},
  deps: RecallDeps = {}
): Promise<{ proposals: RecallProposal[]; unmapped: string[] }> {
  const depth = clampGraphDepth(options.depth)
  const seedLimit = options.seedLimit ?? 3
  const limit = options.limit ?? 10
  const executor = deps.graphDb ?? db

  const topSeeds = [...seeds].sort((a, b) => b.score - a.score).slice(0, seedLimit)
  const expanded: RecallProposal[] = []
  const unmapped: string[] = []
  // One entry per reached node -- keeps the best (highest-scoring) route
  // when two different seeds reach the same node.
  const bestByEntityId = new Map<string, RecallProposal>()

  for (const seed of topSeeds) {
    const nodeKey = await resolveSeedNodeKey(seed.entityType, deps)
    if (!nodeKey) {
      unmapped.push(seed.entityType)
      continue
    }

    // graph_impact takes a BARE qualified table name (it prefixes 'table:'
    // itself when calling graph_ancestors) -- see graph-impact-service.ts,
    // which calls it the same way against the same function.
    const qualifiedTable = nodeKey.replace(/^table:/, "")

    const rows = (await executor.execute(sql`
      SELECT dependent_table, depth, via_column
      FROM platform.graph_impact(${qualifiedTable}, ${depth}, ${GRAPH_EXPAND_MAX_ROWS})
    `)) as { dependent_table: string; depth: number; via_column: string | null }[]

    for (const row of rows) {
      const hopDepth = Number(row.depth)
      // Decay by depth so an expanded neighbour can never outrank its seed.
      const score = seed.score * Math.pow(GRAPH_DEPTH_DECAY, hopDepth)
      const candidate: RecallProposal = {
        tier: "graph",
        entityType: "graph_node",
        entityId: row.dependent_table,
        content: row.dependent_table,
        score,
        citationTrail: [
          {
            fromNodeKey: nodeKey,
            toNodeKey: row.dependent_table,
            depth: hopDepth,
            viaColumn: row.via_column,
          },
        ],
      }
      const existing = bestByEntityId.get(candidate.entityId)
      if (!existing || candidate.score > existing.score) {
        bestByEntityId.set(candidate.entityId, candidate)
      }
    }
  }

  expanded.push(...bestByEntityId.values())
  return { proposals: rerankGraphExpanded(expanded).slice(0, limit), unmapped }
}

// ─── The ladder ──────────────────────────────────────────────────────────

function tierIndex(tier: RecallTier): number {
  return RECALL_TIERS.indexOf(tier)
}

/**
 * THE RECALL LADDER. Tries exact -> keyword -> vector -> graph, returning
 * the FIRST tier that produces a confident answer and falling through on a
 * miss. Every tier that did not answer is recorded in `skipped` with a
 * reason, so the caller can always tell why the ladder landed where it did.
 *
 * R-CRR-05 (see this file's header): only the `exact` tier's result is
 * reachable through takeExecutableRecord(). Tiers 2-4 come back as
 * `proposals` and cannot be auto-applied -- not by convention, but because
 * the type has no field they could be read out of as a record.
 *
 * DEGRADATION: with no embedding provider, tiers 1-2 answer normally and
 * tiers 3-4 record `kind: "unavailable"` with a reason naming the missing
 * provider. The ladder returns tier "none" only when every tier genuinely
 * ran or was accounted for and none produced a candidate.
 *
 * `tx` must already be inside a withTenantContext({ orgId: actor.orgId,
 * userId: actor.userId }, ...) block -- the same contract every function
 * in memory-service.ts has, and what makes RLS see the right GUCs.
 */
export async function recallMemory(
  tx: TenantDb,
  actor: ActorCtx,
  query: string,
  options: RecallMemoryOptions = {},
  deps: RecallDeps = {}
): Promise<RecallResult> {
  // R68 Phase 8 (IMG-031) -- THE ENTITLEMENT GATE, ABOVE THE WHOLE LADDER.
  //
  // Placed before tier 1 rather than inside each tier, because the honest unit
  // of refusal is the recall, not the tier. A per-tier check would let a
  // non-entitled org receive `{ tier: "none", proposals: [], skipped: [...] }`
  // -- which reads as "we looked and found nothing", and is exactly the silent
  // partial answer IMG-031's gate_fail ("A non-entitled org can recall")
  // forbids. Throwing here means a non-entitled org gets a refusal it can act
  // on, and never a plausible-looking empty result.
  await assertImgEntitled(tx, actor.orgId)

  const skipped: RecallSkip[] = []
  const limit = options.limit ?? 10
  const maxTier = options.maxTier ?? "graph"
  const maxIdx = tierIndex(maxTier)

  // ── Tier 1: exact ──
  if (maxIdx >= tierIndex("exact")) {
    if (!options.registryRef) {
      skipped.push({
        tier: "exact",
        kind: "not_requested",
        reason:
          "no registryRef supplied -- an exact tier needs a logical key, and free text alone can never produce an exact match. Nothing may auto-execute from this recall.",
      })
    } else {
      const record = await recallExact(tx, actor, options.registryRef, { memoryType: options.memoryType })
      if (record) {
        return { tier: "exact", mayExecute: true, record, skipped }
      }
      skipped.push({
        tier: "exact",
        kind: "miss",
        reason: `no memory_records row with registry_ref '${options.registryRef}' is visible in this actor's resolved scope`,
      })
    }
  }

  // ── Tier 2: keyword ──
  if (maxIdx >= tierIndex("keyword")) {
    const proposals = await recallKeyword(tx, query, {
      limit,
      includeDocumentChunks: options.includeDocumentChunks,
      memoryType: options.memoryType,
      minRank: options.minKeywordRank,
    })
    if (proposals.length > 0) {
      return { tier: "keyword", mayExecute: false, proposals, skipped }
    }
    skipped.push({ tier: "keyword", kind: "miss", reason: "full-text search matched no rows" })
  } else {
    skipped.push({ tier: "keyword", kind: "not_requested", reason: `maxTier is '${maxTier}'` })
  }

  // ── Tier 3: vector ──
  let vectorProposals: RecallProposal[] = []
  if (maxIdx >= tierIndex("vector")) {
    const vectorResult = await recallVector(query, actor.orgId, { limit, minScore: options.minVectorScore }, deps)
    if (!vectorResult.available) {
      skipped.push({ tier: "vector", kind: "unavailable", reason: vectorResult.reason })
      // Tier 4 is seeded BY tier 3. With no seeds there is nothing honest
      // to expand, so it is unavailable for the same underlying reason
      // rather than reported as an independent miss.
      if (maxIdx >= tierIndex("graph")) {
        skipped.push({
          tier: "graph",
          kind: "unavailable",
          reason: "the graph tier expands tier-3 seeds, and the vector tier was unavailable, so there was nothing to expand from",
        })
      }
      return { tier: "none", mayExecute: false, proposals: [], skipped }
    }
    vectorProposals = vectorResult.proposals
    if (vectorProposals.length > 0) {
      return { tier: "vector", mayExecute: false, proposals: vectorProposals, skipped }
    }
    skipped.push({ tier: "vector", kind: "miss", reason: "semantic search returned no candidates above the score threshold" })
  } else {
    skipped.push({ tier: "vector", kind: "not_requested", reason: `maxTier is '${maxTier}'` })
  }

  // ── Tier 4: graph-expanded ──
  if (maxIdx >= tierIndex("graph")) {
    if (vectorProposals.length === 0) {
      skipped.push({
        tier: "graph",
        kind: "miss",
        reason: "the graph tier expands tier-3 seeds and tier 3 produced none",
      })
      return { tier: "none", mayExecute: false, proposals: [], skipped }
    }
    const { proposals, unmapped } = await recallGraphExpanded(
      vectorProposals,
      { depth: options.graphDepth, seedLimit: options.graphSeedLimit, limit },
      deps
    )
    if (unmapped.length > 0) {
      skipped.push({
        tier: "graph",
        kind: "miss",
        reason: `${unmapped.length} seed(s) had no platform.graph_node entry and could not be expanded: ${[...new Set(unmapped)].join(", ")}`,
      })
    }
    if (proposals.length > 0) {
      return { tier: "graph", mayExecute: false, proposals, skipped }
    }
    skipped.push({ tier: "graph", kind: "miss", reason: "graph expansion reached no new candidates" })
  } else {
    skipped.push({ tier: "graph", kind: "not_requested", reason: `maxTier is '${maxTier}'` })
  }

  return { tier: "none", mayExecute: false, proposals: [], skipped }
}
