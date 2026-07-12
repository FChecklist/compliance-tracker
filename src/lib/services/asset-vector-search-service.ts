// Priority 3 UMR dispatch (agent 3): vector-search wiring.
//
// Extends the entity-agnostic embeddings.ts (src/lib/embeddings.ts,
// backing the real `embeddings` table) to platform_assets, using the exact
// same storeEmbedding()/findSimilar() calls every other real consumer in
// this codebase uses (documents' full-text search, capability-registry-
// service.ts's worker_agent/automation_rule/module/prompt_pattern search)
// -- no new embedding-generation code path, no new table.
//
// This is the "Vector Index" layer named in the Owner's UMR architecture:
// the fallback for genuinely ambiguous natural-language asset lookups.
// Deterministic/keyword-based classification against structured columns
// (assetType/module/tags, via btree/GIN/tsvector indexes) is
// subagent/umr-routing's routing engine; this file only handles "I don't
// know which structured filter applies, find whatever's semantically
// closest to this text."
//
// Deliberately its own file rather than living inside asset-registry-
// service.ts (where registerAsset()/getAssetByAssetId() live, owned by
// subagent/umr-core) -- that file's PR was still in flight while this one
// was written, so this avoids two agents editing the same file
// concurrently. Worth reconsidering a merge into asset-registry-service.ts
// once both branches land, purely for discoverability -- not required
// functionally, since this file already imports getAssetByAssetId() rather
// than reimplementing asset lookup.
import { storeEmbedding, findSimilar } from "@/lib/embeddings"
import { getAssetByAssetId } from "./asset-registry-service"
import { db, platformAssets } from "@/lib/db"
import { and, inArray, isNull, or, eq } from "drizzle-orm"
import { ServiceError } from "./compliance-service"
import { buildAssetSearchContent } from "./asset-search-content"

export { buildAssetSearchContent }

export const ASSET_ENTITY_TYPE = "platform_asset"

// Same RELEVANCE_THRESHOLD concept as capability-registry-service.ts:
// findSimilar()'s <=> operator always returns the *closest* rows in the
// whole embeddings table, never necessarily *close* ones -- without a
// floor, every search "succeeds" even when nothing in the index is
// actually related to the query.
const RELEVANCE_THRESHOLD = 0.5

/**
 * Generates and stores an embedding for one asset's name+purpose+
 * searchKeywords, under entityType='platform_asset' in the existing
 * `embeddings` table. Takes only an assetId (not a full row) per the UMR
 * dispatch contract -- loads the row itself via subagent/umr-core's
 * getAssetByAssetId(), the one real lookup function for platform_assets,
 * instead of re-deriving asset lookup here.
 */
export async function indexAssetForSearch(assetId: string): Promise<void> {
  const asset = await getAssetByAssetId(assetId)
  if (!asset) throw new ServiceError(`Asset ${assetId} not found`, 404)

  const content = buildAssetSearchContent(asset)
  await storeEmbedding(ASSET_ENTITY_TYPE, asset.assetId, content, asset.orgId ?? undefined)
}

export type AssetSearchMatch = typeof platformAssets.$inferSelect & { score: number }

/**
 * Real vector similarity search scoped to entityType='platform_asset'.
 * Over-fetches from findSimilar() (not itself type-filtered) then narrows
 * to this entity type and the relevance floor, same over-fetch-then-filter
 * shape as findSimilarCapabilities()/findSimilarPromptPatterns() -- then
 * joins matches back to platformAssets so callers get full rows, not bare
 * entityId strings.
 */
export async function searchAssetsBySimilarity(queryText: string, orgId: string, limit = 10): Promise<AssetSearchMatch[]> {
  const results = await findSimilar(queryText, orgId, limit * 3)
  const matches = results
    .filter((r) => r.entityType === ASSET_ENTITY_TYPE && r.score > RELEVANCE_THRESHOLD)
    .slice(0, limit)
  if (matches.length === 0) return []

  const assetIds = matches.map((m) => m.entityId)
  const rows = await db.query.platformAssets.findMany({
    where: and(inArray(platformAssets.assetId, assetIds), or(eq(platformAssets.orgId, orgId), isNull(platformAssets.orgId))),
  })
  const byAssetId = new Map(rows.map((r) => [r.assetId, r]))

  return matches
    .map((m) => {
      const asset = byAssetId.get(m.entityId)
      if (!asset) return null // stale embedding row for a since-deleted asset -- skip, don't surface a broken reference
      return { ...asset, score: m.score }
    })
    .filter((r): r is AssetSearchMatch => r !== null)
}
