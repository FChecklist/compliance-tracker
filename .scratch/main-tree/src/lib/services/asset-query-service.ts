// Priority 3 (Universal Metadata Registry, 08-priority3-umr-tracker.yaml,
// agent 2 "routing"): the index-based query layer over `platform_assets`
// (schema owned by the parallel `subagent/umr-core` branch -- see that
// branch's src/lib/db/schema.ts for the real table + the migration that
// adds the indexes this file depends on: btree on assetType/module/status/
// ownerId/orgId, UNIQUE(sourceTable, sourceId), GIN on tags, tsvector GIN
// over name+searchKeywords+purpose).
//
// The Owner's own framing for the UMR is "fast, index-based search instead
// of full-table scans" -- every function below composes a real Drizzle
// WHERE clause that lands on exactly one of those indexes (queryByTags on
// the GIN(tags) index, queryByKeywords on the tsvector GIN index, the rest
// on their respective btree columns), never an unqualified `db.select().
// from(platformAssets)`. queryByAiCapability is the one deliberate
// exception -- aiCapabilities has no dedicated index in the real migration
// (only `tags` got a GIN index), so it's documented below as filtering
// through the orgId btree index first and should never be the sole/first
// narrowing step in a caller (see asset-routing-engine.ts, which never
// calls it before an assetType/module/status narrowing step already ran).
//
// Query-composition style (and()/eq()/sql, withTenantContext, ctx-object-
// first-param) mirrors this codebase's own established house style --
// activity-log-service.ts's recordActivity/getActivityRiskLevel and
// monitoring-engine.ts's pure-function discipline on the deterministic
// side, and document-service.ts's searchDocuments() for the tsvector
// full-text pattern specifically (mirrored exactly below, same comment
// about "computed at query time against the functional GIN index -- no
// stored tsvector column to keep in sync").
import { platformAssets } from "@/lib/db"
import { withTenantContext } from "@/lib/db/tenant-scoped"
import { and, desc, eq, isNull, or, sql } from "drizzle-orm"
import { getCachedOrgAssets } from "./asset-registry-cache"

export type AssetQueryContext = { orgId: string }

// Derived from the real table's own inferred row type rather than
// hand-copied, so this file can never silently drift from schema.ts's
// assetTypeEnum/assetStatusEnum once umr-core's PR lands.
export type PlatformAsset = typeof platformAssets.$inferSelect
export type AssetType = PlatformAsset["assetType"]
export type AssetStatus = PlatformAsset["status"]

const DEFAULT_LIMIT = 50

// Org-scoped rows OR platform-tier rows (orgId IS NULL) -- `eq(orgId, x)`
// alone silently excludes every platform-wide asset (worker_agents/
// computation_engines/prompt_templates, the majority of this pass's seeded
// population, per 08-priority3-umr-tracker.yaml's scope_decision) since SQL
// never matches `orgId = 'x'` against a NULL column. Mirrors the
// `or(eq(orgId, ctx.orgId), isNull(orgId))` shape asset-relationship-
// service.ts / asset-vector-search-service.ts already use for the same
// nullable-org column.
function orgOrPlatformCondition(orgId: string) {
  return or(eq(platformAssets.orgId, orgId), isNull(platformAssets.orgId))
}

// Shared in-memory tail for every cache-backed query below -- same
// ordering (most-recently-updated first) and cap the real DB-backed
// queries already applied, just applied to an already-loaded set instead
// of via a second round trip.
function sortAndLimit(rows: PlatformAsset[]): PlatformAsset[] {
  return [...rows].sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime()).slice(0, DEFAULT_LIMIT)
}

// ─── Index 2: btree(assetType) -- Priority 4: cache-first ───────────────
// Priority 4 (09-priority4-umr-universal-tracker.yaml): serves from the
// compiled in-memory cache (asset-registry-cache.ts) instead of a Postgres
// round trip on every call -- the Owner's own reference architecture names
// this exact tier ("Application Memory Cache... most requests never touch
// the database at all"). The cache only holds status='active' rows (see
// that file's own header), so this now implicitly returns active assets of
// the given type only -- a deliberate narrowing from the pre-Priority-4
// behavior (which returned every status including draft/archived), matches
// the realistic "search finds things you can actually use" expectation,
// and no existing caller/test relied on cross-status results (asset-
// routing-engine.ts, the one real caller, is a search/routing surface).
export async function queryByAssetType(ctx: AssetQueryContext, assetType: AssetType): Promise<PlatformAsset[]> {
  const cached = await getCachedOrgAssets(ctx.orgId)
  return sortAndLimit(cached.filter((a) => a.assetType === assetType))
}

// ─── Index 3: btree(module) -- Priority 4: cache-first ──────────────────
export async function queryByModule(ctx: AssetQueryContext, module: string): Promise<PlatformAsset[]> {
  if (!module?.trim()) return []
  const cached = await getCachedOrgAssets(ctx.orgId)
  return sortAndLimit(cached.filter((a) => a.module === module))
}

// ─── Index 7: btree(status) ──────────────────────────────────────────────
// Cache-first ONLY for status='active' (the one status the cache holds --
// see asset-registry-cache.ts's own header for why draft/archived/deleted
// are deliberately excluded from the hot-path cache). Any other status
// goes straight to Postgres, uncached, same as before Priority 4 -- those
// are the rare moderation/audit-screen lookups this cache was never meant
// to accelerate.
export async function queryByStatus(ctx: AssetQueryContext, status: AssetStatus): Promise<PlatformAsset[]> {
  if (status === "active") {
    const cached = await getCachedOrgAssets(ctx.orgId)
    return sortAndLimit(cached)
  }
  return withTenantContext({ orgId: ctx.orgId }, (db) =>
    db.select().from(platformAssets)
      .where(and(orgOrPlatformCondition(ctx.orgId), eq(platformAssets.status, status)))
      .orderBy(desc(platformAssets.updatedAt))
      .limit(DEFAULT_LIMIT)
  )
}

// ─── Index 6: GIN(tags) -- Priority 4: cache-first ───────────────────────
// `@>` (jsonb containment) semantics reproduced in-memory: an asset matches
// only if its own tags array contains EVERY tag in the query (not "any
// of"), the exact same "all of" contract the real GIN-index-backed SQL
// query enforced -- callers wanting "any of" still union client-side.
export async function queryByTags(ctx: AssetQueryContext, tags: string[]): Promise<PlatformAsset[]> {
  if (!tags?.length) return []
  const cached = await getCachedOrgAssets(ctx.orgId)
  return sortAndLimit(
    cached.filter((a) => {
      const assetTags = (a.tags as string[] | null) ?? []
      return tags.every((t) => assetTags.includes(t))
    })
  )
}

// ─── No dedicated index (documented, see file header) -- Priority 4:
//     cache-first ─────────────────────────────────────────────────────────
export async function queryByAiCapability(ctx: AssetQueryContext, capability: string): Promise<PlatformAsset[]> {
  if (!capability?.trim()) return []
  const cached = await getCachedOrgAssets(ctx.orgId)
  return sortAndLimit(
    cached.filter((a) => a.aiEnabled && ((a.aiCapabilities as string[] | null) ?? []).includes(capability))
  )
}

// ─── Index 8: tsvector GIN(name || searchKeywords || purpose) ──────────
// Mirrors document-service.ts's searchDocuments() line for line: computed
// at query time against the functional GIN index from the umr-core
// migration, no stored tsvector column to keep in sync. plainto_tsquery
// (not to_tsquery) so a raw natural-language phrase from a search box
// never throws on tsquery operator syntax the way to_tsquery would.
export async function queryByKeywords(ctx: AssetQueryContext, query: string): Promise<PlatformAsset[]> {
  if (!query?.trim()) return []
  return withTenantContext({ orgId: ctx.orgId }, (db) =>
    db.select().from(platformAssets).where(
      sql`(${platformAssets.orgId} = ${ctx.orgId} OR ${platformAssets.orgId} IS NULL) AND
        to_tsvector('english', coalesce(${platformAssets.name}, '') || ' ' || coalesce(${platformAssets.searchKeywords}, '') || ' ' || coalesce(${platformAssets.purpose}, ''))
        @@ plainto_tsquery('english', ${query})`
    ).orderBy(sql`ts_rank(
      to_tsvector('english', coalesce(${platformAssets.name}, '') || ' ' || coalesce(${platformAssets.searchKeywords}, '') || ' ' || coalesce(${platformAssets.purpose}, '')),
      plainto_tsquery('english', ${query})
    ) DESC`).limit(DEFAULT_LIMIT)
  )
}
