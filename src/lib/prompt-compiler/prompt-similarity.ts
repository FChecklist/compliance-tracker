// VERIDIAN_Architecture_v2.0 phase_2: engine-prompt-similarity. Wraps the
// `prompt_version` capability-entity-type extension added to
// capability-registry-service.ts (same real embeddings.ts/pgvector
// infrastructure findSimilarCapabilities already uses for worker_agent/
// automation_rule/module/prompt_pattern/dynamic_chain -- no parallel
// embedding store built here, per the gap analysis' explicit reuse note).
import { findSimilarPromptVersions, indexPromptVersion, type CapabilityMatch } from "@/lib/services/capability-registry-service"

export type PromptVersionMatch = { promptVersionId: string; score: number; machinePrompt: string }

/**
 * Indexes a newly-compiled prompt version's machine_prompt so future
 * compiles can find it as a semantic-similarity match. Call this after
 * prompt-os-service.ts's createPromptVersion() returns a real row id.
 */
export async function indexCompiledPromptVersion(promptVersionId: string, machinePrompt: string, orgId: string): Promise<void> {
  await indexPromptVersion(promptVersionId, machinePrompt, orgId)
}

/**
 * The real semantic-cache lookup pipeline-prompt-construction's own gap
 * analysis entry calls for: before minting a brand new prompt_versions row,
 * check whether a near-identical machine_prompt was already compiled and
 * indexed. Returns the best match (if any) above `threshold`.
 */
export async function findSemanticCacheHit(
  machinePrompt: string,
  orgId: string,
  threshold = 0.95
): Promise<PromptVersionMatch | null> {
  const matches = await findSimilarPromptVersions(machinePrompt, orgId, 3)
  const best = matches.find((m) => m.score >= threshold)
  return best ? { promptVersionId: best.entityId, score: best.score, machinePrompt: best.content } : null
}

/** Cross-version similarity search, no cache-hit threshold gate -- used by ranking/recommendation. */
export async function findSimilarPromptVersionsFor(machinePrompt: string, orgId: string, limit = 5): Promise<CapabilityMatch[]> {
  return findSimilarPromptVersions(machinePrompt, orgId, limit)
}

export type SimilarityPair = { aId: string; bId: string; score: number }
export type SimilarityCluster = { members: string[]; maxScore: number }

/**
 * Pure clustering over a pre-computed set of pairwise similarity scores
 * (union-find over pairs at or above `threshold`) -- duplicate-detection
 * across more than 2 prompt versions, not just the single best match
 * findSemanticCacheHit() returns. Kept DB-free/pure so it is unit-testable
 * without embeddings.ts's live pgvector query, matching this repo's
 * established .test.ts convention.
 */
export function clusterBySimilarity(pairs: SimilarityPair[], threshold = 0.92): SimilarityCluster[] {
  const parent = new Map<string, string>()
  const maxScoreForRoot = new Map<string, number>()

  function find(x: string): string {
    if (!parent.has(x)) parent.set(x, x)
    let root = x
    while (parent.get(root) !== root) root = parent.get(root)!
    parent.set(x, root)
    return root
  }

  function union(a: string, b: string, score: number) {
    const ra = find(a)
    const rb = find(b)
    const merged = Math.max(maxScoreForRoot.get(ra) ?? 0, maxScoreForRoot.get(rb) ?? 0, score)
    if (ra !== rb) parent.set(ra, rb)
    maxScoreForRoot.set(find(a), merged)
  }

  for (const { aId, bId, score } of pairs) {
    if (score < threshold) continue
    find(aId)
    find(bId)
    union(aId, bId, score)
  }

  const groups = new Map<string, Set<string>>()
  for (const id of parent.keys()) {
    const root = find(id)
    if (!groups.has(root)) groups.set(root, new Set())
    groups.get(root)!.add(id)
  }

  const clusters: SimilarityCluster[] = []
  for (const [root, members] of groups) {
    if (members.size < 2) continue
    clusters.push({ members: [...members].sort(), maxScore: maxScoreForRoot.get(root) ?? threshold })
  }
  return clusters
}
