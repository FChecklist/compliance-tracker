// Priority 3 UMR dispatch (agent 3): relationship-graph wiring.
//
// entity-graph-service.ts's createRelationship() has had zero callers since
// Phase 3 (its own file header: "deliberately NOT wired into any
// production call site yet"). The one existing consumer,
// /api/v1/brain/entity-relationships (Wave 153), only ever calls the READ
// side (getNeighbors) -- nothing has ever written a real edge. This file is
// that first real writer, scoped to platform_assets (Priority 3's UMR
// schema, built in parallel on subagent/umr-core) the same way
// capability-registry-service.ts narrows the entity-agnostic embeddings.ts
// down to worker_agent/automation_rule/module/prompt_pattern -- a thin,
// typed wrapper over a wider generic store, not a reimplementation of it.
//
// Identifier convention: every function here takes/returns the PUBLIC
// 'AST-000001'-format assetId (platformAssets.assetId), never the internal
// cuid2 row id. entity_relationships.sourceId/targetId are stored as this
// public assetId too. That's deliberate: assetId is the one identifier the
// whole UMR is built around ("every object gets one universal Asset ID"),
// so a graph edge keyed on it stays resolvable by anything that only ever
// holds the public ID -- an AI agent reading a manifest, an external API
// caller, a future cross-repo reference -- without needing the internal row
// id at all.
import { createRelationship, getNeighbors } from "./entity-graph-service"
import { platformAssets } from "@/lib/db"
import { withTenantContext } from "@/lib/db/tenant-scoped"
import { and, eq, inArray, isNull, or } from "drizzle-orm"
import { ServiceError } from "./compliance-service"
import { mergeDependency } from "./asset-dependency-utils"

export const ASSET_ENTITY_TYPE = "platform_asset"

type Ctx = { orgId: string; userId: string }

// Org-scoped lookup that also surfaces platform-tier assets (orgId IS
// NULL) -- mirrors the org-match-or-null pattern embeddings.ts/
// capability-registry-service.ts already use, since platformAssets.orgId
// is nullable for the exact same reason embeddings.orgId is (Priority 3
// tracker's seed plan includes platform-wide assets like worker_agents'
// global-tier roles, which have no single owning org).
async function loadAssetByAssetId(ctx: Ctx, assetId: string) {
  return withTenantContext(ctx, (db) =>
    db.query.platformAssets.findFirst({
      where: and(eq(platformAssets.assetId, assetId), or(eq(platformAssets.orgId, ctx.orgId), isNull(platformAssets.orgId))),
    })
  )
}

/**
 * Records "assetId depends on dependsOnAssetId" in two places, on purpose:
 *
 * 1. entity_relationships (via createRelationship(), sourceType/targetType
 *    = 'platform_asset', relationshipType = 'depends_on') -- the
 *    normalized source of truth. This is what getRelatedAssets() and any
 *    future multi-hop graph traversal actually reads.
 * 2. platformAssets.dependencies (jsonb string[] on the source row) -- a
 *    denormalized, maintained copy for the fast path: answering "what does
 *    this asset depend on?" from the manifest endpoint should be a
 *    single-row read, not a join through entity_relationships every time.
 *
 * Same tradeoff this codebase already makes elsewhere: workerAgents.
 * usageCount (schema.ts:768) is a maintained counter instead of a live
 * COUNT() over a usage-log table on every read, because the read path
 * (dashboards, manifests, anything an AI agent queries live) is far hotter
 * than the write path, and the write path can afford the extra update to
 * keep both representations in sync. If the two ever drift -- e.g. an edge
 * gets deleted directly via entity-graph-service.ts without going through
 * this function -- the graph edge is the one that's actually correct;
 * dependencies is a cache of it, not an independent fact.
 */
export async function linkAssetDependency(ctx: Ctx, assetId: string, dependsOnAssetId: string) {
  if (assetId === dependsOnAssetId) throw new ServiceError("An asset cannot depend on itself", 400)

  const source = await loadAssetByAssetId(ctx, assetId)
  if (!source) throw new ServiceError(`Asset ${assetId} not found`, 404)
  const target = await loadAssetByAssetId(ctx, dependsOnAssetId)
  if (!target) throw new ServiceError(`Asset ${dependsOnAssetId} not found`, 404)

  const edge = await createRelationship(ctx, {
    sourceType: ASSET_ENTITY_TYPE,
    sourceId: assetId,
    targetType: ASSET_ENTITY_TYPE,
    targetId: dependsOnAssetId,
    relationshipType: "depends_on",
  })

  const nextDependencies = mergeDependency((source.dependencies as string[] | null) ?? [], dependsOnAssetId)
  await withTenantContext(ctx, (db) =>
    db.update(platformAssets).set({ dependencies: nextDependencies, updatedAt: new Date() }).where(eq(platformAssets.id, source.id))
  )

  return edge
}

/**
 * Generic edge creator for relationship types other than 'depends_on' --
 * what the POST route actually calls, so it isn't hardcoded to the
 * dependency case. Delegates to linkAssetDependency() for that one type
 * (to get the denormalized-array bookkeeping above); every other
 * relationship type is graph-only, same as every other
 * entity-graph-service.ts consumer today -- 'dependencies' is the only
 * relationship platformAssets denormalizes onto the row itself.
 */
export async function linkAssetRelationship(ctx: Ctx, assetId: string, relatedAssetId: string, relationshipType: string) {
  if (relationshipType === "depends_on") return linkAssetDependency(ctx, assetId, relatedAssetId)
  if (assetId === relatedAssetId) throw new ServiceError("An asset cannot relate to itself", 400)

  const source = await loadAssetByAssetId(ctx, assetId)
  if (!source) throw new ServiceError(`Asset ${assetId} not found`, 404)
  const target = await loadAssetByAssetId(ctx, relatedAssetId)
  if (!target) throw new ServiceError(`Asset ${relatedAssetId} not found`, 404)

  return createRelationship(ctx, {
    sourceType: ASSET_ENTITY_TYPE,
    sourceId: assetId,
    targetType: ASSET_ENTITY_TYPE,
    targetId: relatedAssetId,
    relationshipType,
  })
}

export type RelatedAsset = typeof platformAssets.$inferSelect & {
  relationshipType: string
  direction: "outgoing" | "incoming"
}

/**
 * "If AI reaches Customer, it instantly knows every related object" --
 * made real. getNeighbors() (entity-graph-service.ts) returns raw edge rows
 * (just type/id pairs, no context about what's on the other end); this
 * joins each neighbor's assetId back to platformAssets so callers get full
 * asset rows (name, purpose, assetType, module...) in one call instead of a
 * second round trip per neighbor.
 *
 * Returns one row PER EDGE, not per neighbor -- if two assets are linked by
 * more than one relationshipType, both edges are real and both should be
 * visible in the result, not silently collapsed into one.
 */
export async function getRelatedAssets(ctx: Ctx, assetId: string): Promise<RelatedAsset[]> {
  const edges = await getNeighbors(ctx, { entityType: ASSET_ENTITY_TYPE, entityId: assetId })
  if (edges.length === 0) return []

  const neighborIds = Array.from(new Set(edges.map((e) => (e.sourceId === assetId ? e.targetId : e.sourceId))))
  if (neighborIds.length === 0) return []

  const rows = await withTenantContext(ctx, (db) =>
    db.query.platformAssets.findMany({
      where: and(inArray(platformAssets.assetId, neighborIds), or(eq(platformAssets.orgId, ctx.orgId), isNull(platformAssets.orgId))),
    })
  )
  const byAssetId = new Map(rows.map((r) => [r.assetId, r]))

  const related: RelatedAsset[] = []
  for (const edge of edges) {
    const neighborId = edge.sourceId === assetId ? edge.targetId : edge.sourceId
    const asset = byAssetId.get(neighborId)
    // Edge points at an assetId that isn't visible to this org (or has
    // since been deleted) -- skip rather than surface a broken reference.
    if (!asset) continue
    related.push({ ...asset, relationshipType: edge.relationshipType, direction: edge.sourceId === assetId ? "outgoing" : "incoming" })
  }
  return related
}
