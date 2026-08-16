// Wave 107 (VERI FM & CS AI OS) -- asset registry CRUD. Every write
// computes `normalizedName` server-side (never trusts a client-supplied
// value) so fm-asset-dedup-service.ts's trigram matching always runs
// against a consistent key, regardless of how the row was created (manual
// entry vs. register digitization commit).
import { fmAssets, fmAssetCategories } from "@/lib/db"
import { withTenantContext } from "@/lib/db/tenant-scoped"
import { and, eq } from "drizzle-orm"
import { requireFmEnabled } from "./fm-enablement-service"
import { ServiceError } from "./compliance-service"
export { ServiceError }
import type { users } from "@/lib/db"

export type FmAssetContext = { orgId: string; userId: string; dbUser: typeof users.$inferSelect }

// Lowercase, trim, collapse internal whitespace -- deliberately simple.
// This is the join key fm-asset-dedup-service.ts's pg_trgm similarity()
// query runs against; it is NOT meant to fully resolve "Non VRV AC" vs
// "Non VRV Ac-2" vs "Borewel-1" on its own (that's what trigram fuzzy
// matching + human review is for) -- it only removes the zero-effort
// noise (case, whitespace) so the fuzzy match isn't fighting formatting
// differences on top of real naming differences.
export function normalizeAssetName(rawName: string): string {
  return rawName.trim().toLowerCase().replace(/\s+/g, " ")
}

export type FmAssetInput = {
  categoryId: string
  assetName: string
  locationLabel?: string | null
  assetCode?: string | null
  capacitySpec?: string | null
  make?: string | null
  model?: string | null
  serialNumber?: string | null
  installedDate?: string | null
  notes?: string | null
}

export async function getFmAssetCategories(ctx: { orgId: string }) {
  return withTenantContext({ orgId: ctx.orgId }, async (db) => {
    return db.query.fmAssetCategories.findMany({
      where: eq(fmAssetCategories.isActive, true),
      orderBy: (t, { asc }) => asc(t.displayName),
    })
  })
}

export async function listFmAssets(ctx: { orgId: string }, filters?: { categoryId?: string; status?: string }) {
  await requireFmEnabled(ctx.orgId)
  return withTenantContext({ orgId: ctx.orgId }, async (db) => {
    const conditions = [eq(fmAssets.orgId, ctx.orgId)]
    if (filters?.categoryId) conditions.push(eq(fmAssets.categoryId, filters.categoryId))
    if (filters?.status) conditions.push(eq(fmAssets.status, filters.status))
    return db.query.fmAssets.findMany({
      where: and(...conditions),
      orderBy: (t, { desc }) => desc(t.createdAt),
    })
  })
}

export async function getFmAsset(ctx: { orgId: string }, assetId: string) {
  await requireFmEnabled(ctx.orgId)
  return withTenantContext({ orgId: ctx.orgId }, async (db) => {
    const asset = await db.query.fmAssets.findFirst({ where: and(eq(fmAssets.id, assetId), eq(fmAssets.orgId, ctx.orgId)) })
    if (!asset) throw new ServiceError("Asset not found", 404)
    return asset
  })
}

export async function createFmAsset(ctx: FmAssetContext, input: FmAssetInput) {
  await requireFmEnabled(ctx.orgId)
  if (!input.assetName?.trim()) throw new ServiceError("assetName is required", 400)
  if (!input.categoryId) throw new ServiceError("categoryId is required", 400)

  return withTenantContext({ orgId: ctx.orgId, userId: ctx.userId }, async (db) => {
    const category = await db.query.fmAssetCategories.findFirst({ where: eq(fmAssetCategories.id, input.categoryId) })
    if (!category) throw new ServiceError("Unknown asset category", 400)

    const [asset] = await db.insert(fmAssets).values({
      orgId: ctx.orgId,
      categoryId: input.categoryId,
      assetName: input.assetName.trim(),
      normalizedName: normalizeAssetName(input.assetName),
      locationLabel: input.locationLabel ?? null,
      assetCode: input.assetCode ?? null,
      capacitySpec: input.capacitySpec ?? null,
      make: input.make ?? null,
      model: input.model ?? null,
      serialNumber: input.serialNumber ?? null,
      installedDate: input.installedDate ?? null,
      notes: input.notes ?? null,
      sourceType: "manual",
      createdById: ctx.userId,
    }).returning()

    return asset
  })
}

export type FmAssetPatch = Partial<FmAssetInput> & { status?: string; qrCodeValue?: string | null }

export async function updateFmAsset(ctx: FmAssetContext, assetId: string, patch: FmAssetPatch) {
  await requireFmEnabled(ctx.orgId)
  return withTenantContext({ orgId: ctx.orgId, userId: ctx.userId }, async (db) => {
    const existing = await db.query.fmAssets.findFirst({ where: and(eq(fmAssets.id, assetId), eq(fmAssets.orgId, ctx.orgId)) })
    if (!existing) throw new ServiceError("Asset not found", 404)

    const update: Partial<typeof fmAssets.$inferInsert> = { updatedAt: new Date() }
    if (patch.assetName !== undefined) {
      update.assetName = patch.assetName.trim()
      update.normalizedName = normalizeAssetName(patch.assetName)
    }
    if (patch.categoryId !== undefined) update.categoryId = patch.categoryId
    if (patch.locationLabel !== undefined) update.locationLabel = patch.locationLabel
    if (patch.assetCode !== undefined) update.assetCode = patch.assetCode
    if (patch.capacitySpec !== undefined) update.capacitySpec = patch.capacitySpec
    if (patch.make !== undefined) update.make = patch.make
    if (patch.model !== undefined) update.model = patch.model
    if (patch.serialNumber !== undefined) update.serialNumber = patch.serialNumber
    if (patch.installedDate !== undefined) update.installedDate = patch.installedDate
    if (patch.notes !== undefined) update.notes = patch.notes
    if (patch.status !== undefined) update.status = patch.status
    if (patch.qrCodeValue !== undefined) update.qrCodeValue = patch.qrCodeValue

    const [updated] = await db.update(fmAssets).set(update).where(eq(fmAssets.id, assetId)).returning()
    return updated
  })
}
