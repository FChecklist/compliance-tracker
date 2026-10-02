// lf-b2-ai-crud GROUP 3: the permit edit and delete that PATCH and DELETE /api/v1/projexa/permits/{id} did inline, moved here so the route and
// the AI functions update_permit and delete_permit run ONE write path (src/lib/pipeline/executors/crud-permits.ts).
//
// A permit is a `documents` row with category "permit": its name, its expiry date (documents.expiryDate) and, inside metadata, its authority,
// number, issue date, notes and tags. The behaviour is the route's, unchanged:
//   - updatePermit changes only the keys it is given and keeps every other metadata key; a document that is not a permit of this organisation
//     is "Permit not found" (404);
//   - deletePermit removes the row (a hard delete, as the route always did). The stored file, if any, is not touched here (the route never removed it).
import { and, eq } from "drizzle-orm"
import { withTenantContext } from "@/lib/db/tenant-scoped"
import { documents } from "@/lib/db/schema"
import { ServiceError } from "./compliance-service"
export { ServiceError }

export type PermitPatch = {
  name?: string
  /** YYYY-MM-DD, or null to clear: the permit's expiry (the route calls it endDate). */
  endDate?: string | null
  permitAuthority?: unknown
  permitNumber?: unknown
  issueDate?: unknown
  notes?: unknown
  tags?: unknown
}

export async function updatePermit(ctx: { orgId: string; userId?: string }, permitId: string, patch: PermitPatch) {
  const updated = await withTenantContext({ orgId: ctx.orgId, userId: ctx.userId }, async (db) => {
    const existing = await db.query.documents.findFirst({ where: and(eq(documents.id, permitId), eq(documents.orgId, ctx.orgId), eq(documents.category, "permit")) })
    if (!existing) return null
    const existingMetadata = (existing.metadata ?? {}) as Record<string, unknown>
    const [row] = await db
      .update(documents)
      .set({
        ...(typeof patch.name === "string" ? { name: patch.name } : {}),
        ...(patch.endDate !== undefined ? { expiryDate: patch.endDate ? new Date(patch.endDate) : null } : {}),
        metadata: {
          ...existingMetadata,
          ...(patch.permitAuthority !== undefined ? { permitAuthority: patch.permitAuthority } : {}),
          ...(patch.permitNumber !== undefined ? { permitNumber: patch.permitNumber } : {}),
          ...(patch.issueDate !== undefined ? { issueDate: patch.issueDate } : {}),
          ...(patch.notes !== undefined ? { notes: patch.notes } : {}),
          ...(patch.tags !== undefined ? { tags: patch.tags } : {}),
        },
      })
      .where(eq(documents.id, permitId))
      .returning()
    return row ?? null
  })
  if (!updated) throw new ServiceError("Permit not found", 404)
  return updated
}

export async function deletePermit(ctx: { orgId: string }, permitId: string) {
  const deleted = await withTenantContext({ orgId: ctx.orgId }, async (db) => {
    const [row] = await db.delete(documents).where(and(eq(documents.id, permitId), eq(documents.orgId, ctx.orgId), eq(documents.category, "permit"))).returning({ id: documents.id })
    return row ?? null
  })
  if (!deleted) throw new ServiceError("Permit not found", 404)
  return { deleted: true as const, id: deleted.id }
}
