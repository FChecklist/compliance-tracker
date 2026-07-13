// Wave 171 (tree4-unified/50-completion-plan area 1, U-D6): the Dynamic
// Chain Master Directory's "intelligent search/recommendation, missing-
// chain detection, version control" requirement (U-D6.B2.S1) -- confirmed
// absent before this wave (dynamic_chains only had a find-or-create
// resolver, task-service.ts's resolveDynamicChainId, reused here verbatim
// per that function's own established convention, never duplicated).
//
// Deterministic only, no LLM call -- matches this codebase's guardrail
// design discipline everywhere else (see ai-reply-gate.ts's header for why
// no LLM self-certification exists anywhere in this codebase).
import { dynamicChains, entityRelationships } from "@/lib/db"
import { withTenantContext, type TenantDb } from "@/lib/db/tenant-scoped"
import { eq, and } from "drizzle-orm"

export type ChainSearchResult = {
  id: string
  modePill: string
  pathLabels: unknown
  description: string | null
  score: number
}

/**
 * Keyword search across modePill/pathLabels/description -- a real but
 * intentionally simple relevance score (exact modePill match weighted
 * highest, then substring hits in path labels, then description),
 * consistent with this codebase's "deterministic first" bias rather than
 * reaching for embeddings for what a straightforward text match already
 * serves adequately.
 */
export async function searchChains(orgId: string, query: string, limit = 10): Promise<ChainSearchResult[]> {
  const normalized = query.trim().toLowerCase()
  if (!normalized) return []
  return withTenantContext({ orgId }, async (db) => {
    const candidates = await db.query.dynamicChains.findMany({
      where: and(eq(dynamicChains.orgId, orgId), eq(dynamicChains.status, "approved")),
    })
    const scored = candidates
      .map((c) => {
        let score = 0
        if (c.modePill.toLowerCase() === normalized) score += 10
        else if (c.modePill.toLowerCase().includes(normalized)) score += 5
        const labels = Array.isArray(c.pathLabels) ? (c.pathLabels as unknown[]).map((l) => String(l).toLowerCase()) : []
        if (labels.some((l) => l.includes(normalized))) score += 4
        if (c.description?.toLowerCase().includes(normalized)) score += 2
        return { id: c.id, modePill: c.modePill, pathLabels: c.pathLabels, description: c.description, score }
      })
      .filter((c) => c.score > 0)
      .sort((a, b) => b.score - a.score)
    return scored.slice(0, limit)
  })
}

export type MissingChainCheckResult =
  | { exists: true; chainId: string }
  | { exists: false; nearMatches: ChainSearchResult[]; likelyMissing: boolean }

/**
 * Checks whether an exact (modePill, pathKeys) chain exists -- same
 * dedup key task-service.ts's resolveDynamicChainId uses. If not, looks
 * for near-matches (same modePill, any path-label overlap) to distinguish
 * "this chain genuinely doesn't exist yet" from "the caller is one step
 * off from an existing chain" -- likelyMissing is true only when there are
 * zero near-matches, i.e. this modePill has no chains resembling the
 * requested path at all.
 */
export async function detectMissingChain(orgId: string, modePill: string, pathKeys: unknown[]): Promise<MissingChainCheckResult> {
  return withTenantContext({ orgId }, async (db) => {
    const pathKeysJson = JSON.stringify(pathKeys)
    const exact = await db.query.dynamicChains.findFirst({
      where: and(
        eq(dynamicChains.orgId, orgId),
        eq(dynamicChains.modePill, modePill),
        eq(dynamicChains.status, "approved"),
      ),
    })
    if (exact && JSON.stringify(exact.pathKeys) === pathKeysJson) {
      return { exists: true as const, chainId: exact.id }
    }

    const sameModePill = await db.query.dynamicChains.findMany({
      where: and(eq(dynamicChains.orgId, orgId), eq(dynamicChains.modePill, modePill), eq(dynamicChains.status, "approved")),
    })
    const nearMatches: ChainSearchResult[] = sameModePill
      .map((c) => {
        const keys = Array.isArray(c.pathKeys) ? (c.pathKeys as unknown[]) : []
        const overlap = keys.filter((k) => pathKeys.includes(k)).length
        return { id: c.id, modePill: c.modePill, pathLabels: c.pathLabels, description: c.description, score: overlap }
      })
      .filter((c) => c.score > 0)
      .sort((a, b) => b.score - a.score)

    return { exists: false as const, nearMatches, likelyMissing: nearMatches.length === 0 }
  })
}

export type CreateChainVersionResult =
  | { created: true; newChainId: string; version: number }
  | { created: false; reason: "not_found" }

/**
 * Creates a new version of an existing chain, linking previousVersionId
 * and marking the old row 'retired' (the existing status enum already has
 * this value -- reused, not extended). The new row inherits every field
 * from the previous version except the ones explicitly overridden.
 *
 * GAP-DCMD, 3rd real entity_relationships graph edge for chains (after
 * Priority 9's dynamic_chain -> approval_workflow_instance and Priority
 * 10's dynamic_chain -> worker_agent): dynamic_chain -> dynamic_chain,
 * relationshipType 'supersedes'. previousVersionId (Wave 171) already
 * carries this exact fact as a denormalized FK-shaped column, but this
 * is the only real chokepoint that ever writes it -- every version of
 * every chain is created here, never anywhere else (task-service.ts's
 * resolveDynamicChainId only find-or-creates version-1 rows) -- so it's
 * the same "genuine chokepoint already exercised by production code"
 * bar the first two edges used, not a contrived one. Non-blocking: a
 * failure here must never break chain versioning itself, same posture
 * as approval-workflow-service.ts/task-execution-engine.ts's own edge
 * writers.
 */
export async function createChainVersion(
  orgId: string,
  userId: string,
  existingChainId: string,
  updates: Partial<{ description: string; moduleRef: string; linkedModuleRefs: unknown[]; businessRules: unknown; permissions: unknown; workflowRef: string; aiBehaviorRef: string; reportsKpisSlas: unknown }>
): Promise<CreateChainVersionResult> {
  return withTenantContext({ orgId, userId }, async (db) => {
    const existing = await db.query.dynamicChains.findFirst({ where: and(eq(dynamicChains.id, existingChainId), eq(dynamicChains.orgId, orgId)) })
    if (!existing) return { created: false as const, reason: "not_found" as const }

    const nextVersion = existing.version + 1
    const [created] = await db.insert(dynamicChains).values({
      orgId,
      modePill: existing.modePill,
      pathKeys: existing.pathKeys,
      pathLabels: existing.pathLabels,
      moduleRef: updates.moduleRef ?? existing.moduleRef,
      description: updates.description ?? existing.description,
      createdById: userId,
      status: "approved",
      linkedModuleRefs: updates.linkedModuleRefs ?? existing.linkedModuleRefs,
      businessRules: updates.businessRules ?? existing.businessRules,
      permissions: updates.permissions ?? existing.permissions,
      workflowRef: updates.workflowRef ?? existing.workflowRef,
      aiBehaviorRef: updates.aiBehaviorRef ?? existing.aiBehaviorRef,
      reportsKpisSlas: updates.reportsKpisSlas ?? existing.reportsKpisSlas,
      version: nextVersion,
      previousVersionId: existing.id,
    }).returning()

    await db.update(dynamicChains).set({ status: "retired", updatedAt: new Date() }).where(eq(dynamicChains.id, existing.id))

    try {
      await db.insert(entityRelationships).values({
        orgId,
        sourceType: "dynamic_chain",
        sourceId: created!.id,
        targetType: "dynamic_chain",
        targetId: existing.id,
        relationshipType: "supersedes",
        metadata: { newVersion: nextVersion, previousVersion: existing.version },
      })
    } catch (err) {
      console.error(`[dynamic-chain-directory-service] Failed to record dynamic_chain->dynamic_chain graph edge for chain ${existingChainId} -> ${created!.id}:`, err)
    }

    return { created: true as const, newChainId: created!.id, version: nextVersion }
  })
}

/** Walks previousVersionId back to the first version, oldest first. */
export async function getChainVersionHistory(orgId: string, chainId: string) {
  return withTenantContext({ orgId }, async (db) => {
    const history: (typeof dynamicChains.$inferSelect)[] = []
    let currentId: string | null = chainId
    const seen = new Set<string>()
    while (currentId && !seen.has(currentId)) {
      seen.add(currentId)
      const row = await db.query.dynamicChains.findFirst({ where: and(eq(dynamicChains.id, currentId), eq(dynamicChains.orgId, orgId)) })
      if (!row) break
      history.unshift(row)
      currentId = row.previousVersionId
    }
    return history
  })
}
