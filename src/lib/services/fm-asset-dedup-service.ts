// Wave 107 (VERI FM & CS AI OS) -- FM-specific asset deduplication.
// Deliberately NOT routed through Wave 93's mdm-quality-service.ts: that
// engine's assertEntityType() only accepts 'erp_customer'|'erp_supplier'
// and its scoring assumes gstin/pan_number columns that don't exist on
// physical assets -- confirmed via direct code read, genuinely the wrong
// tool for this job. Reuses the same pg_trgm similarity() mechanism (and
// the trigram index the migration creates on fm_assets.normalized_name),
// scoped to normalizedName + same category, since a DG set and a borewell
// should never be flagged as duplicates of each other just because their
// names happen to share tokens.
import { fmAssetDuplicateCandidates, fmAssets, fmPpmSchedules, fmAmcContracts } from "@/lib/db"
import { withTenantContext } from "@/lib/db/tenant-scoped"
import { and, eq, sql } from "drizzle-orm"
import { requireFmEnabled } from "./fm-enablement-service"
import { ServiceError } from "./compliance-service"
export { ServiceError }
import type { users } from "@/lib/db"

export type FmDedupContext = { orgId: string; userId: string; dbUser: typeof users.$inferSelect }

const SIMILARITY_THRESHOLD = 0.5

/** Pairwise scan of active assets within one category for name-similarity
 *  matches, upserting pending candidates. Existing 'not_duplicate'/'merged'
 *  rows are never re-raised (a human already decided that pair). */
export async function scanForDuplicateAssets(ctx: { orgId: string }, categoryId?: string) {
  return withTenantContext({ orgId: ctx.orgId }, async (db) => {
    const rows = (await db.execute(sql`
      SELECT a.id AS id_a, b.id AS id_b, similarity(a.normalized_name, b.normalized_name) AS name_score
      FROM compliance.fm_assets a
      JOIN compliance.fm_assets b ON a.id < b.id AND a.org_id = b.org_id AND a.category_id = b.category_id
      WHERE a.org_id = ${ctx.orgId}
        AND a.status != 'decommissioned' AND b.status != 'decommissioned'
        AND a.is_duplicate_of IS NULL AND b.is_duplicate_of IS NULL
        ${categoryId ? sql`AND a.category_id = ${categoryId}` : sql``}
        AND similarity(a.normalized_name, b.normalized_name) > ${SIMILARITY_THRESHOLD}
    `)) as { id_a: string; id_b: string; name_score: number }[]

    const existing = await db.query.fmAssetDuplicateCandidates.findMany({ where: eq(fmAssetDuplicateCandidates.orgId, ctx.orgId) })
    const existingByPair = new Map(existing.map((c) => [`${c.assetIdA}:${c.assetIdB}`, c]))

    let created = 0
    for (const row of rows) {
      const key = `${row.id_a}:${row.id_b}`
      const prior = existingByPair.get(key)
      if (prior && prior.status !== "pending") continue // a human already decided this pair

      if (prior) {
        await db.update(fmAssetDuplicateCandidates).set({ matchScore: String(row.name_score), matchReason: "trigram_name_similarity" }).where(eq(fmAssetDuplicateCandidates.id, prior.id))
      } else {
        await db.insert(fmAssetDuplicateCandidates).values({
          orgId: ctx.orgId, assetIdA: row.id_a, assetIdB: row.id_b,
          matchScore: String(row.name_score), matchReason: "trigram_name_similarity", status: "pending",
        })
        created++
      }
    }
    return { scanned: rows.length, created }
  })
}

/** Convenience wrapper: run scanForDuplicateAssets scoped to the single
 *  asset just created/committed (e.g. from register digitization commit),
 *  rather than a full org-wide rescan. */
export async function findDuplicateCandidates(ctx: { orgId: string }, assetId: string) {
  await requireFmEnabled(ctx.orgId)
  return withTenantContext({ orgId: ctx.orgId }, async (db) => {
    const asset = await db.query.fmAssets.findFirst({ where: and(eq(fmAssets.id, assetId), eq(fmAssets.orgId, ctx.orgId)) })
    if (!asset) throw new ServiceError("Asset not found", 404)
    return scanForDuplicateAssets(ctx, asset.categoryId)
  })
}

export async function listPendingDuplicateCandidates(ctx: { orgId: string }) {
  await requireFmEnabled(ctx.orgId)
  return withTenantContext({ orgId: ctx.orgId }, async (db) => {
    return db.query.fmAssetDuplicateCandidates.findMany({
      where: and(eq(fmAssetDuplicateCandidates.orgId, ctx.orgId), eq(fmAssetDuplicateCandidates.status, "pending")),
      orderBy: (t, { desc }) => desc(t.matchScore),
    })
  })
}

/** Confirms A/B are duplicates and soft-merges B into A: B is marked
 *  isDuplicateOf=A (never hard-deleted), and B's PPM schedules/AMC
 *  contracts are reassigned to A so maintenance history isn't orphaned.
 *  A itself is always kept as the survivor -- caller picks which id is
 *  "A" when calling confirmMerge if a different survivor is wanted. */
export async function confirmMerge(ctx: FmDedupContext, candidateId: string) {
  return withTenantContext({ orgId: ctx.orgId, userId: ctx.userId }, async (db) => {
    const candidate = await db.query.fmAssetDuplicateCandidates.findFirst({
      where: and(eq(fmAssetDuplicateCandidates.id, candidateId), eq(fmAssetDuplicateCandidates.orgId, ctx.orgId)),
    })
    if (!candidate) throw new ServiceError("Duplicate candidate not found", 404)
    if (candidate.status === "merged") throw new ServiceError("This candidate pair is already merged", 409)

    const survivorId = candidate.assetIdA
    const loserId = candidate.assetIdB

    await db.update(fmAssets).set({ isDuplicateOf: survivorId, updatedAt: new Date() }).where(eq(fmAssets.id, loserId))

    // Reassign the loser's schedules/contracts to the survivor rather than
    // leaving them orphaned against a soft-merged asset. Schedules need a
    // per-row check first: (assetId, checklistTemplateId) is unique, so a
    // loser schedule whose template the survivor already has scheduled
    // would violate that constraint on a blind bulk UPDATE -- those rows
    // are deliberately left on the loser (still queryable, just not moved)
    // rather than failing the whole merge.
    const survivorTemplateIds = new Set(
      (await db.query.fmPpmSchedules.findMany({ where: eq(fmPpmSchedules.assetId, survivorId) })).map((s) => s.checklistTemplateId)
    )
    const loserSchedules = await db.query.fmPpmSchedules.findMany({ where: eq(fmPpmSchedules.assetId, loserId) })
    for (const schedule of loserSchedules) {
      if (survivorTemplateIds.has(schedule.checklistTemplateId)) continue
      await db.update(fmPpmSchedules).set({ assetId: survivorId, updatedAt: new Date() }).where(eq(fmPpmSchedules.id, schedule.id))
    }
    await db.update(fmAmcContracts).set({ assetId: survivorId, updatedAt: new Date() }).where(eq(fmAmcContracts.assetId, loserId))

    const [updated] = await db.update(fmAssetDuplicateCandidates).set({
      status: "merged", reviewedById: ctx.userId, reviewedAt: new Date(),
    }).where(eq(fmAssetDuplicateCandidates.id, candidateId)).returning()

    return updated
  })
}

export async function dismissCandidate(ctx: FmDedupContext, candidateId: string) {
  return withTenantContext({ orgId: ctx.orgId, userId: ctx.userId }, async (db) => {
    const candidate = await db.query.fmAssetDuplicateCandidates.findFirst({
      where: and(eq(fmAssetDuplicateCandidates.id, candidateId), eq(fmAssetDuplicateCandidates.orgId, ctx.orgId)),
    })
    if (!candidate) throw new ServiceError("Duplicate candidate not found", 404)

    const [updated] = await db.update(fmAssetDuplicateCandidates).set({
      status: "not_duplicate", reviewedById: ctx.userId, reviewedAt: new Date(),
    }).where(eq(fmAssetDuplicateCandidates.id, candidateId)).returning()

    return updated
  })
}
