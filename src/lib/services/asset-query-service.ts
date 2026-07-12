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
import { and, desc, eq, sql } from "drizzle-orm"

export type AssetQueryContext = { orgId: string }

// Derived from the real table's own inferred row type rather than
// hand-copied, so this file can never silently drift from schema.ts's
// assetTypeEnum/assetStatusEnum once umr-core's PR lands.
export type PlatformAsset = typeof platformAssets.$inferSelect
export type AssetType = PlatformAsset["assetType"]
export type AssetStatus = PlatformAsset["status"]

const DEFAULT_LIMIT = 50

// ─── Index 2: btree(assetType) ──────────────────────────────────────────
export async function queryByAssetType(ctx: AssetQueryContext, assetType: AssetType): Promise<PlatformAsset[]> {
  return withTenantContext({ orgId: ctx.orgId }, (db) =>
    db.select().from(platformAssets)
      .where(and(eq(platformAssets.orgId, ctx.orgId), eq(platformAssets.assetType, assetType)))
      .orderBy(desc(platformAssets.updatedAt))
      .limit(DEFAULT_LIMIT)
  )
}

// ─── Index 3: btree(module) ─────────────────────────────────────────────
export async function queryByModule(ctx: AssetQueryContext, module: string): Promise<PlatformAsset[]> {
  if (!module?.trim()) return []
  return withTenantContext({ orgId: ctx.orgId }, (db) =>
    db.select().from(platformAssets)
      .where(and(eq(platformAssets.orgId, ctx.orgId), eq(platformAssets.module, module)))
      .orderBy(desc(platformAssets.updatedAt))
      .limit(DEFAULT_LIMIT)
  )
}

// ─── Index 7: btree(status) ─────────────────────────────────────────────
export async function queryByStatus(ctx: AssetQueryContext, status: AssetStatus): Promise<PlatformAsset[]> {
  return withTenantContext({ orgId: ctx.orgId }, (db) =>
    db.select().from(platformAssets)
      .where(and(eq(platformAssets.orgId, ctx.orgId), eq(platformAssets.status, status)))
      .orderBy(desc(platformAssets.updatedAt))
      .limit(DEFAULT_LIMIT)
  )
}

// ─── Index 6: GIN(tags) ──────────────────────────────────────────────────
// `@>` (jsonb containment) is the operator the GIN index on a jsonb column
// actually accelerates in Postgres -- this returns assets whose `tags`
// array contains ALL of the given tags, not "any of". Callers wanting
// "any of" semantics can call this once per tag and union client-side;
// not added here since no caller in this codebase needs it yet (YAGNI,
// matching this codebase's own discipline elsewhere of not building an
// unused parameter shape).
export async function queryByTags(ctx: AssetQueryContext, tags: string[]): Promise<PlatformAsset[]> {
  if (!tags?.length) return []
  return withTenantContext({ orgId: ctx.orgId }, (db) =>
    db.select().from(platformAssets)
      .where(and(
        eq(platformAssets.orgId, ctx.orgId),
        sql`${platformAssets.tags} @> ${JSON.stringify(tags)}::jsonb`
      ))
      .orderBy(desc(platformAssets.updatedAt))
      .limit(DEFAULT_LIMIT)
  )
}

// ─── No dedicated index (documented, see file header) ───────────────────
// Filters the aiCapabilities jsonb array via the same `@>` containment
// operator as queryByTags, but aiCapabilities has no GIN index in the real
// migration -- only orgId's btree index backs this query. Never call this
// as the first/only narrowing step on a large org; asset-routing-engine.ts
// always narrows by assetType/module/status first and only reaches for
// this on an already-small candidate set.
export async function queryByAiCapability(ctx: AssetQueryContext, capability: string): Promise<PlatformAsset[]> {
  if (!capability?.trim()) return []
  return withTenantContext({ orgId: ctx.orgId }, (db) =>
    db.select().from(platformAssets)
      .where(and(
        eq(platformAssets.orgId, ctx.orgId),
        eq(platformAssets.aiEnabled, true),
        sql`${platformAssets.aiCapabilities} @> ${JSON.stringify([capability])}::jsonb`
      ))
      .orderBy(desc(platformAssets.updatedAt))
      .limit(DEFAULT_LIMIT)
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
      sql`${platformAssets.orgId} = ${ctx.orgId} AND
        to_tsvector('english', coalesce(${platformAssets.name}, '') || ' ' || coalesce(${platformAssets.searchKeywords}, '') || ' ' || coalesce(${platformAssets.purpose}, ''))
        @@ plainto_tsquery('english', ${query})`
    ).orderBy(sql`ts_rank(
      to_tsvector('english', coalesce(${platformAssets.name}, '') || ' ' || coalesce(${platformAssets.searchKeywords}, '') || ' ' || coalesce(${platformAssets.purpose}, '')),
      plainto_tsquery('english', ${query})
    ) DESC`).limit(DEFAULT_LIMIT)
  )
}
