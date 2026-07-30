// VERIDIAN_Architecture_v2.0 phase_8 (2026-07-28): engine-prompt-marketplace.
// Prompt templates/versions are platform-wide, not tenant data (see
// prompt-os-service.ts's own header) -- so "marketplace" here is realistic
// as a platform-wide browse/list surface over which Production-lifecycle
// prompt versions an admin has opted to list, not a new cross-tenant
// data-sharing mechanism (there is no per-org prompt data to share in the
// first place). publishedByOrgId/publishedByUserId are attribution only,
// same posture as workerAgents.orgId (schema.ts) -- every authenticated
// user across every org can read a 'listed' entry.
import { db, promptVersions, promptMarketplaceListings } from "@/lib/db"
import { eq } from "drizzle-orm"
import { ServiceError } from "./compliance-service"
export { ServiceError }
import { requirePromptPermissionForUser } from "./permission-service"
import type { PromptOsContext } from "./prompt-os-service"

export type PromptMarketplaceListing = {
  id: string
  promptVersionId: string
  title: string
  description: string | null
  tags: string[]
  status: string
  publishedByOrgId: string | null
  createdAt: string
  updatedAt: string
}

function serializeListing(row: typeof promptMarketplaceListings.$inferSelect): PromptMarketplaceListing {
  return {
    id: row.id, promptVersionId: row.promptVersionId, title: row.title, description: row.description,
    tags: row.tags as string[], status: row.status, publishedByOrgId: row.publishedByOrgId,
    createdAt: row.createdAt.toISOString(), updatedAt: row.updatedAt.toISOString(),
  }
}

/** Only a version that has actually reached Production may be listed -- a marketplace surfacing a Draft/Review prompt would share unvetted content. */
export async function publishToMarketplace(
  ctx: PromptOsContext,
  input: { versionId: string; title: string; description?: string; tags?: string[] }
): Promise<PromptMarketplaceListing> {
  requirePromptPermissionForUser(ctx.dbUser, "prompt.marketplace.publish")

  const title = input.title?.trim()
  if (!title) throw new ServiceError("title is required", 400)

  const version = await db.query.promptVersions.findFirst({ where: eq(promptVersions.id, input.versionId) })
  if (!version) throw new ServiceError("Unknown prompt version", 404)
  if (version.lifecycleState !== "Production") {
    throw new ServiceError("Only a Production-lifecycle prompt version may be listed on the marketplace", 400)
  }

  const [row] = await db.insert(promptMarketplaceListings).values({
    promptVersionId: version.id, title, description: input.description ?? null, tags: input.tags ?? [],
    publishedByOrgId: ctx.dbUser.orgId ?? null, publishedByUserId: ctx.userId,
  }).returning()

  return serializeListing(row)
}

export async function unlistFromMarketplace(ctx: PromptOsContext, listingId: string): Promise<PromptMarketplaceListing> {
  requirePromptPermissionForUser(ctx.dbUser, "prompt.marketplace.publish")

  const [row] = await db.update(promptMarketplaceListings)
    .set({ status: "unlisted", updatedAt: new Date() })
    .where(eq(promptMarketplaceListings.id, listingId))
    .returning()
  if (!row) throw new ServiceError("Unknown marketplace listing", 404)
  return serializeListing(row)
}

/** Real browse surface -- readable by any authenticated user (no admin gate), only 'listed' entries, newest first. */
export async function listMarketplaceListings(): Promise<PromptMarketplaceListing[]> {
  const rows = await db.query.promptMarketplaceListings.findMany({
    where: eq(promptMarketplaceListings.status, "listed"),
    orderBy: (t, { desc: descOrder }) => descOrder(t.createdAt),
  })
  return rows.map(serializeListing)
}
