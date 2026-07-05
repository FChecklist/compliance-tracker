// Wave 61 (Unified Document Management, ERP benchmark Tier 3 #15): turns the
// existing compliance.documents table (Wave 7, previously scoped to
// complianceItemId/noticeId attachments) into a real central repository --
// versioning, expiry tracking, and generic cross-module linking -- rather
// than adding a parallel table. See the code comment on schema.ts's
// `documents` table for why linkedEntityType/linkedEntityId are free-text
// discriminators instead of a per-module FK.
import { documents } from "@/lib/db"
import { withTenantContext, type TenantDb } from "@/lib/db/tenant-scoped"
import { and, eq, isNotNull, lte } from "drizzle-orm"
import { ServiceError } from "./compliance-service"
export { ServiceError }

export type DocumentFilters = {
  category?: string
  linkedEntityType?: string
  linkedEntityId?: string
  latestOnly?: boolean
}

export async function listDocuments(ctx: { orgId: string }, filters: DocumentFilters = {}) {
  return withTenantContext({ orgId: ctx.orgId }, async (db) => {
    const conditions = [eq(documents.orgId, ctx.orgId)]
    if (filters.category) conditions.push(eq(documents.category, filters.category))
    if (filters.linkedEntityType) conditions.push(eq(documents.linkedEntityType, filters.linkedEntityType))
    if (filters.linkedEntityId) conditions.push(eq(documents.linkedEntityId, filters.linkedEntityId))
    if (filters.latestOnly !== false) conditions.push(eq(documents.isLatestVersion, true))

    return db.query.documents.findMany({
      where: and(...conditions),
      orderBy: (d, { desc }) => desc(d.createdAt),
    })
  })
}

// "Expiring soon" is the whole point of tracking expiryDate at all -- a
// dashboard widget/settings page surfaces this so a license/contract/
// certificate renewal is never missed silently.
export async function listExpiringDocuments(ctx: { orgId: string }, withinDays: number = 30) {
  return withTenantContext({ orgId: ctx.orgId }, async (db) => {
    const cutoff = new Date()
    cutoff.setDate(cutoff.getDate() + withinDays)
    return db.query.documents.findMany({
      where: and(
        eq(documents.orgId, ctx.orgId),
        eq(documents.isLatestVersion, true),
        isNotNull(documents.expiryDate),
        lte(documents.expiryDate, cutoff),
      ),
      orderBy: (d, { asc }) => asc(d.expiryDate),
    })
  })
}

// Walks the parentDocumentId chain back to the original upload, newest first.
export async function getDocumentVersionHistory(ctx: { orgId: string }, documentId: string) {
  return withTenantContext({ orgId: ctx.orgId }, async (db) => {
    const chain: (typeof documents.$inferSelect)[] = []
    let currentId: string | null = documentId
    // Bounded walk (documents are only ever created here, so a cycle would
    // mean a bug elsewhere, not real data) -- 50 versions is far beyond any
    // realistic document's revision count.
    for (let i = 0; i < 50 && currentId; i++) {
      const doc = await db.query.documents.findFirst({ where: and(eq(documents.id, currentId), eq(documents.orgId, ctx.orgId)) })
      if (!doc) break
      chain.push(doc)
      currentId = doc.parentDocumentId
    }
    return chain
  })
}

export async function updateDocumentMetadata(
  ctx: { orgId: string; userId: string },
  documentId: string,
  input: { category?: string | null; expiryDate?: string | null; linkedEntityType?: string | null; linkedEntityId?: string | null }
) {
  return withTenantContext({ orgId: ctx.orgId, userId: ctx.userId }, async (db) => {
    const existing = await db.query.documents.findFirst({ where: and(eq(documents.id, documentId), eq(documents.orgId, ctx.orgId)) })
    if (!existing) throw new ServiceError("Document not found", 404)

    const [updated] = await db.update(documents).set({
      ...(input.category !== undefined ? { category: input.category } : {}),
      ...(input.expiryDate !== undefined ? { expiryDate: input.expiryDate ? new Date(input.expiryDate) : null } : {}),
      ...(input.linkedEntityType !== undefined ? { linkedEntityType: input.linkedEntityType } : {}),
      ...(input.linkedEntityId !== undefined ? { linkedEntityId: input.linkedEntityId } : {}),
    }).where(eq(documents.id, documentId)).returning()

    return updated
  })
}

// Called from the upload route when the caller passes `versionOfId` --
// flips the previous latest row's isLatestVersion to false inside the same
// transaction as the new row's insert, so there's never a moment with two
// "latest" rows for one logical document.
export async function markSupersededVersion(db: TenantDb, orgId: string, previousDocumentId: string) {
  const previous = await db.query.documents.findFirst({ where: and(eq(documents.id, previousDocumentId), eq(documents.orgId, orgId)) })
  if (!previous) throw new ServiceError("Document being replaced was not found", 404)
  if (!previous.isLatestVersion) throw new ServiceError("This document has already been superseded by a newer version", 409)

  await db.update(documents).set({ isLatestVersion: false }).where(eq(documents.id, previousDocumentId))
  return previous
}
