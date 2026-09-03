// Wave 61 (Unified Document Management, ERP benchmark Tier 3 #15): turns the
// existing compliance.documents table (Wave 7, previously scoped to
// complianceItemId/noticeId attachments) into a real central repository --
// versioning, expiry tracking, and generic cross-module linking -- rather
// than adding a parallel table. See the code comment on schema.ts's
// `documents` table for why linkedEntityType/linkedEntityId are free-text
// discriminators instead of a per-module FK.
import { documents } from "@/lib/db"
import { withTenantContext, type TenantDb } from "@/lib/db/tenant-scoped"
import { and, eq, inArray, isNotNull, lte, sql } from "drizzle-orm"
import type { DrawingStatus } from "@/lib/drawings-register"
import { ServiceError } from "./compliance-service"
import { createClient } from "@supabase/supabase-js"
import { createId } from "@paralleldrive/cuid2"
export { ServiceError }

const BUCKET = "compliance-documents"
const MAX_SIZE_BYTES = 25 * 1024 * 1024 // matches the bucket's file_size_limit, same cap as /api/documents

function getStorageAdminClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )
}

function sanitizeFileName(name: string): string {
  return name.replace(/[^a-zA-Z0-9._-]/g, "_").slice(-120)
}

/**
 * R67 D-14: what PROJEXA's "Relates to" combobox offers. linkedEntityType stays
 * a free-text discriminator on the table (see the schema comment on
 * documents.linkedEntityType -- ERP and HR modules use their own values), so
 * this is NOT an allow-list that rejects anything else; it is the set the
 * Documents create screen can produce, exported so the screen and the route
 * cannot drift apart, and so a reader can see what "Relates to" means here.
 */
export const PROJEXA_DOCUMENT_LINK_TYPES = ["project", "permit", "rfi", "mom", "boq_line"] as const
export type ProjexaDocumentLinkType = (typeof PROJEXA_DOCUMENT_LINK_TYPES)[number]

/** R67 D-14: the three fields an .eml can answer for itself, kept in the metadata jsonb. */
export type DocumentEmailFields = {
  from?: string | null
  receivedOn?: string | null
  subject?: string | null
}

export type CreateDocumentRecordInput = {
  name: string
  category: string
  expiryDate?: string | null
  linkedEntityType?: string | null
  linkedEntityId?: string | null
  /**
   * R67 D-14. The project this document belongs to, INDEPENDENT of what it is
   * related to. Before this, PROJEXA filed every document with
   * linkedEntityType='project' because that was the only way the project's
   * Documents list could find it again; the moment "Relates to" can name a
   * permit, an RFI or a meeting, the project link is gone and the document
   * disappears from the list it was uploaded on. This keeps the project
   * recoverable (metadata.projectId) whatever the row is related to -- see
   * DocumentFilters.projectScopeId below, which is the read side of it.
   */
  projectId?: string | null
  /** Only meaningful for category 'email'; empty fields are not stored. */
  email?: DocumentEmailFields
  metadata?: unknown
} & (
  | { file: File; externalUrl?: never }
  | { file?: never; externalUrl: string } // link-only record (e.g. a 3D walkthrough URL) -- no bucket bytes
)

// The one real upload/storage code path this task's Permits/Drawings/
// Documents modules all share, per KNOWN_CONTEXT's "reuse the existing
// upload pattern" instruction. Mirrors /api/documents's POST handler
// (bytes -> private 'compliance-documents' Supabase Storage bucket, then a
// documents row), deliberately NOT calling that route's handler directly --
// it's cookie-session-only (requireAuth), this is the Bearer/API-key-callable
// twin new v1 routes need. Intentionally does not replicate that route's
// versioning/auto-classification/AI-extraction/achievement side effects --
// those are enhancements over the core "store a categorized file" contract,
// not something a bearer-key upload from PROJEXA depends on.
// R39/R-C14: userId is nullable -- callers must pass ctx.dbUser?.id ?? null,
// never ctx.apiKey?.id (that id has no row in compliance.users; see
// schema.ts's own comment on documents.uploadedById for the real production
// FK-violation this caused, and why null is the honest value instead).
type PreparedStorage = { objectPath: string; fileType: string | null; fileSize: number | null; meta: Record<string, unknown> }

/**
 * The bytes half of creating a document: upload the file (or record the
 * external URL) and return what the row needs. Extracted in R67 D-12 so
 * createDrawingRecord() below can share it -- a second copy of the upload path
 * is a second place for the bucket name, the size cap and the isExternalLink
 * flag to drift.
 *
 * Deliberately runs BEFORE (and outside) any transaction: uploading bytes with
 * a tenant transaction open would hold one of the pool's five connections for
 * the length of a 50 MB upload.
 */
async function prepareDocumentStorage(
  orgId: string,
  input: { name: string; metadata?: unknown } & ({ file: File; externalUrl?: never } | { file?: never; externalUrl: string })
): Promise<PreparedStorage> {
  let objectPath: string
  let fileType: string | null = null
  let fileSize: number | null = null
  const meta = (input.metadata && typeof input.metadata === "object" ? { ...input.metadata as Record<string, unknown> } : {}) as Record<string, unknown>

  if (input.file) {
    if (input.file.size > MAX_SIZE_BYTES) throw new ServiceError("File exceeds 25 MB limit", 400)
    objectPath = `${orgId}/${createId()}-${sanitizeFileName(input.file.name)}`
    const bytes = new Uint8Array(await input.file.arrayBuffer())
    const admin = getStorageAdminClient()
    const { error: uploadError } = await admin.storage.from(BUCKET).upload(objectPath, bytes, {
      contentType: input.file.type || "application/octet-stream",
      upsert: false,
    })
    if (uploadError) throw new ServiceError("Failed to upload file", 500)
    fileType = input.file.type || null
    fileSize = input.file.size
  } else {
    // Link-only record -- fileUrl holds the raw external URL directly
    // instead of a bucket object path. isExternalLink in metadata tells
    // readers (e.g. the permits/drawings routes' signed-URL step) not to
    // try to sign it as a storage object.
    objectPath = input.externalUrl
    meta.isExternalLink = true
  }

  return { objectPath, fileType, fileSize, meta }
}

/**
 * R67 D-14. The email header fields and the owning project, merged into the
 * metadata jsonb rather than added as columns.
 *
 * WHY NOT THREE COLUMNS. compliance.documents already carries per-category
 * fields in metadata by design -- permits keep permitNumber/permitAuthority
 * there, and R67 D-12 put the whole drawing register (drawingNo/rev/status/
 * supersedesId) there in this same file, for the reason the table's own schema
 * comment gives: these are per-module fields, not facts about every document.
 * Three sparse columns read by one category would be the first exception to
 * that, and the honest one is not to make it. Empty values are not stored at
 * all, so a non-email document's metadata is unchanged.
 */
export function buildDocumentMetadata(
  base: Record<string, unknown>,
  input: { projectId?: string | null; email?: DocumentEmailFields }
): Record<string, unknown> {
  const meta = { ...base }
  if (input.projectId?.trim()) meta.projectId = input.projectId.trim()
  const email = input.email ?? {}
  if (email.from?.trim()) meta.emailFrom = email.from.trim()
  if (email.receivedOn?.trim()) meta.emailReceivedOn = email.receivedOn.trim()
  if (email.subject?.trim()) meta.emailSubject = email.subject.trim()
  return meta
}

export async function createDocumentRecord(ctx: { orgId: string; userId: string | null }, input: CreateDocumentRecordInput) {
  if (!input.name?.trim()) throw new ServiceError("name is required", 400)
  // R67 D-14: "related to a permit" with no permit id is not a relation, it is
  // a lost document. The two fields have always been written together by every
  // caller; nothing enforced it until now.
  if (input.linkedEntityType && !input.linkedEntityId) {
    throw new ServiceError(`A document related to a ${input.linkedEntityType} needs that ${input.linkedEntityType}'s id`, 400)
  }

  const { objectPath, fileType, fileSize, meta } = await prepareDocumentStorage(ctx.orgId, input)
  const metadata = buildDocumentMetadata(meta, input)

  return withTenantContext({ orgId: ctx.orgId, userId: ctx.userId ?? undefined }, async (db) => {
    const [doc] = await db.insert(documents).values({
      name: input.name.trim(),
      fileUrl: objectPath,
      fileType,
      fileSize,
      uploadedById: ctx.userId,
      orgId: ctx.orgId,
      category: input.category,
      expiryDate: input.expiryDate ? new Date(input.expiryDate) : null,
      linkedEntityType: input.linkedEntityType ?? null,
      linkedEntityId: input.linkedEntityId ?? null,
      versionNumber: 1,
      isLatestVersion: true,
      metadata: Object.keys(metadata).length ? metadata : undefined,
    }).returning()
    return doc
  })
}

// ─── R67 D-12: the drawing register (drawingNo / rev / status / supersedes) ──

export type CreateDrawingRecordInput = {
  name: string
  category: "drawing" | "drawing_3d"
  projectId: string
  discipline?: string | null
  drawingNo?: string | null
  rev?: string | null
  /** Defaults to 'for_approval' -- a new upload is not the build set until someone says so. */
  status?: DrawingStatus
} & ({ file: File; externalUrl?: never } | { file?: never; externalUrl: string })

/**
 * R67 D-12 (audit R-034). "A register that cannot answer 'is this the one I
 * build from?' is not a register." The four fields that answer it live in the
 * documents row's metadata jsonb -- no table change -- and this is the one
 * place a drawing row is created, because the supersede has to happen in the
 * SAME transaction as the insert.
 *
 * The rule: a new drawing that is itself 'current' takes over the build set
 * from the existing 'current' row with the same Drawing No. on the same
 * project -- that row becomes 'superseded', and the new row records which row
 * it replaced (supersedesId). A drawing uploaded 'for_approval' disturbs
 * nothing: it is not the build set yet, so superseding the drawing people are
 * building from would be exactly wrong.
 *
 * ONE transaction, not two: withTenantContext opens a transaction, and D-06's
 * nesting guard throws on a second one entered inside the first (and, guard or
 * no guard, two transactions here would mean a window in which two rows are
 * 'current' -- or none is).
 */
export async function createDrawingRecord(ctx: { orgId: string; userId: string | null }, input: CreateDrawingRecordInput) {
  if (!input.name?.trim()) throw new ServiceError("name is required", 400)
  if (!input.projectId?.trim()) throw new ServiceError("projectId is required", 400)

  const status: DrawingStatus = input.status ?? "for_approval"
  const drawingNo = input.drawingNo?.trim() || null
  const rev = input.rev?.trim() || null

  const { objectPath, fileType, fileSize, meta } = await prepareDocumentStorage(ctx.orgId, {
    name: input.name,
    metadata: { discipline: input.discipline ?? null },
    ...(input.file ? { file: input.file } : { externalUrl: input.externalUrl! }),
  })

  return withTenantContext({ orgId: ctx.orgId, userId: ctx.userId ?? undefined }, async (db) => {
    let supersedesId: string | null = null

    if (drawingNo && status === "current") {
      const previous = await db.query.documents.findFirst({
        where: and(
          eq(documents.orgId, ctx.orgId),
          eq(documents.linkedEntityType, "project"),
          eq(documents.linkedEntityId, input.projectId),
          inArray(documents.category, ["drawing", "drawing_3d"]),
          sql`${documents.metadata}->>'drawingNo' = ${drawingNo}`,
          sql`${documents.metadata}->>'status' = 'current'`
        ),
      })
      if (previous) {
        const previousMeta = (previous.metadata ?? {}) as Record<string, unknown>
        await db
          .update(documents)
          .set({ metadata: { ...previousMeta, status: "superseded" } })
          .where(eq(documents.id, previous.id))
        supersedesId = previous.id
      }
    }

    const [doc] = await db.insert(documents).values({
      name: input.name.trim(),
      fileUrl: objectPath,
      fileType,
      fileSize,
      uploadedById: ctx.userId,
      orgId: ctx.orgId,
      category: input.category,
      linkedEntityType: "project",
      linkedEntityId: input.projectId,
      versionNumber: 1,
      isLatestVersion: true,
      metadata: { ...meta, drawingNo, rev, status, supersedesId },
    }).returning()

    return doc
  })
}

export type DocumentFilters = {
  category?: string
  linkedEntityType?: string
  linkedEntityId?: string
  /**
   * R67 D-14: "every document that belongs to this project", whatever it is
   * RELATED to -- the project's own documents (linkedEntityId = the project,
   * which is how every row written before D-14 is filed) plus the ones filed
   * against one of its permits, RFIs or meetings (metadata.projectId). Without
   * this, giving the create screen a real "Relates to" would make a document
   * vanish from the list it was uploaded on the moment it was related to
   * anything other than the project itself.
   */
  projectScopeId?: string
  latestOnly?: boolean
}

// Extracted (R62 B7) so the AND-filter shape -- each of category/
// linkedEntityType/linkedEntityId/latestOnly is an independent, composable
// condition, not a group that all-or-nothing applies -- can be asserted by a
// real test without a live DB. This is deliberate design, not a bug: a
// caller that knows only linkedEntityId (not its type) can still find the
// document by ID alone. See platform.r43_faults
// R60_T2_DOCUMENTS_TYPE_FILTER_REGRESSION for the live re-verification this
// codifies, and document-service.filters.test.ts for the regression test.
export function buildDocumentFilterConditions(orgId: string, filters: DocumentFilters = {}) {
  const conditions = [eq(documents.orgId, orgId)]
  if (filters.category) conditions.push(eq(documents.category, filters.category))
  if (filters.linkedEntityType) conditions.push(eq(documents.linkedEntityType, filters.linkedEntityType))
  if (filters.linkedEntityId) conditions.push(eq(documents.linkedEntityId, filters.linkedEntityId))
  // R67 D-14. The one OR in this set, and deliberately so: it is a single
  // question ("does this row belong to that project?") that two columns can
  // answer, not two independent filters.
  if (filters.projectScopeId) {
    conditions.push(
      sql`(${documents.linkedEntityId} = ${filters.projectScopeId} OR ${documents.metadata}->>'projectId' = ${filters.projectScopeId})`
    )
  }
  if (filters.latestOnly !== false) conditions.push(eq(documents.isLatestVersion, true))
  return conditions
}

export async function listDocuments(ctx: { orgId: string }, filters: DocumentFilters = {}) {
  return withTenantContext({ orgId: ctx.orgId }, async (db) => {
    const conditions = buildDocumentFilterConditions(ctx.orgId, filters)

    return db.query.documents.findMany({
      where: and(...conditions),
      orderBy: (d, { desc }) => desc(d.createdAt),
    })
  })
}

// "Expiring soon" is the whole point of tracking expiryDate at all -- a
// dashboard widget/settings page surfaces this so a license/contract/
// certificate renewal is never missed silently.
export async function listExpiringDocuments(ctx: { orgId: string }, withinDays: number = 30, category?: string, linkedEntityId?: string) {
  return withTenantContext({ orgId: ctx.orgId }, async (db) => {
    const cutoff = new Date()
    cutoff.setDate(cutoff.getDate() + withinDays)
    const conditions = [
      eq(documents.orgId, ctx.orgId),
      eq(documents.isLatestVersion, true),
      isNotNull(documents.expiryDate),
      lte(documents.expiryDate, cutoff),
    ]
    // Wave 117 (PROJEXA Permit Management): reuses this same expiring-
    // documents widget for permit-expiry reminders rather than a new
    // endpoint -- permits are just documents with category='permit'.
    if (category) conditions.push(eq(documents.category, category))
    // Wave 143 (PROJEXA Permits real create+list): permits are per-project
    // (linkedEntityType='project'), so a caller listing one project's
    // permits must be able to filter to it -- omitted, this stays an
    // org-wide expiring-soon feed (the original Wave 117 use case).
    if (linkedEntityId) conditions.push(eq(documents.linkedEntityId, linkedEntityId))
    return db.query.documents.findMany({
      where: and(...conditions),
      orderBy: (d, { asc }) => asc(d.expiryDate),
    })
  })
}

/**
 * Walks the parentDocumentId chain back to the original upload, newest first.
 *
 * R67 D-15: extracted so a caller that ALREADY holds a tenant transaction can
 * read the chain inside it. The document object page needs the row and its
 * versions in one answer, and opening a second withTenantContext inside the
 * first is exactly what D-06's nesting guard throws on.
 */
export async function readVersionChain(db: TenantDb, orgId: string, documentId: string) {
  const chain: (typeof documents.$inferSelect)[] = []
  let currentId: string | null = documentId
  // Bounded walk (documents are only ever created here, so a cycle would
  // mean a bug elsewhere, not real data) -- 50 versions is far beyond any
  // realistic document's revision count.
  for (let i = 0; i < 50 && currentId; i++) {
    const doc: typeof documents.$inferSelect | undefined = await db.query.documents.findFirst({
      where: and(eq(documents.id, currentId), eq(documents.orgId, orgId)),
    })
    if (!doc) break
    chain.push(doc)
    currentId = doc.parentDocumentId
  }
  return chain
}

export async function getDocumentVersionHistory(ctx: { orgId: string }, documentId: string) {
  return withTenantContext({ orgId: ctx.orgId }, async (db) => readVersionChain(db, ctx.orgId, documentId))
}

/**
 * R67 D-15 (audit R-040). "Replace file": a new VERSION of an existing
 * document, not a second document.
 *
 * The object page had no way to correct a file uploaded by mistake -- the only
 * lifecycle action on it was Dispose, which is retention-gated and therefore
 * refused for exactly the fresh upload someone wants to fix. The versioning
 * columns this needs already exist and are already maintained (parentDocumentId,
 * versionNumber, isLatestVersion, markSupersededVersion) -- the internal
 * cookie-session route has used them since Wave 61 through its `versionOfId`
 * form field. Nothing on the Bearer-key surface PROJEXA calls ever exposed them,
 * which is the whole gap.
 *
 * The new row INHERITS the previous version's name, category, expiry, links and
 * metadata: "version 2" means the same logical document, still filed the same
 * way, with different bytes. Both writes are in ONE transaction, so there is
 * never a moment with two latest versions or none.
 */
export async function createDocumentVersion(
  ctx: { orgId: string; userId: string | null },
  documentId: string,
  input: { file: File }
) {
  if (!(input.file instanceof File)) throw new ServiceError("A file is required", 400)

  // Bytes first, outside any transaction -- a 25 MB upload must not hold one of
  // the pool's five connections (same rule as prepareDocumentStorage's own).
  const { objectPath, fileType, fileSize } = await prepareDocumentStorage(ctx.orgId, {
    name: input.file.name,
    file: input.file,
  })

  return withTenantContext({ orgId: ctx.orgId, userId: ctx.userId ?? undefined }, async (db) => {
    const previous = await markSupersededVersion(db, ctx.orgId, documentId)
    // These two refusals come after the flip rather than before it because both
    // are inside the same transaction: a throw here rolls the flip back, and
    // markSupersededVersion is also the 404/409 gate ("not found", "already
    // superseded by a newer version") that has to run first anyway.
    if (previous.isDisposed) throw new ServiceError("A disposed document cannot be replaced", 409)
    if (previous.legalHold) throw new ServiceError("Document is under legal hold and cannot be replaced", 409)

    const [doc] = await db.insert(documents).values({
      name: previous.name,
      fileUrl: objectPath,
      fileType,
      fileSize,
      uploadedById: ctx.userId,
      orgId: ctx.orgId,
      clientId: previous.clientId,
      category: previous.category,
      expiryDate: previous.expiryDate,
      linkedEntityType: previous.linkedEntityType,
      linkedEntityId: previous.linkedEntityId,
      parentDocumentId: previous.id,
      versionNumber: previous.versionNumber + 1,
      isLatestVersion: true,
      metadata: previous.metadata ?? undefined,
    }).returning()

    return doc
  })
}

export type UpdateDocumentMetadataInput = {
  /** R67 D-11: a name typed wrong at upload time was unfixable before this. */
  name?: string
  category?: string | null
  expiryDate?: string | null
  linkedEntityType?: string | null
  linkedEntityId?: string | null
  /**
   * R67 D-11: a PARTIAL patch of the metadata jsonb, MERGED over what is
   * already there. Drawings-only (see METADATA_PATCHABLE_CATEGORIES): the only
   * metadata key any screen edits today is a drawing's discipline, and a
   * generic "replace the metadata blob" patch on this table would let a caller
   * drop isExternalLink -- the flag that decides whether fileUrl is a storage
   * path or a URL -- and silently break the file link on every read.
   */
  metadata?: Record<string, unknown>
}

/**
 * The categories whose metadata this function will patch. Deliberately narrow:
 * permits keep their own dedicated route (permits/[id]) precisely so that
 * widening this contract to carry per-module fields never became necessary,
 * and R67 D-11 only needs the drawings' discipline.
 */
export const METADATA_PATCHABLE_CATEGORIES = ["drawing", "drawing_3d"] as const

export async function updateDocumentMetadata(
  ctx: { orgId: string; userId: string },
  documentId: string,
  input: UpdateDocumentMetadataInput
) {
  if (input.name !== undefined && !input.name.trim()) throw new ServiceError("name cannot be empty", 400)

  return withTenantContext({ orgId: ctx.orgId, userId: ctx.userId }, async (db) => {
    const existing = await db.query.documents.findFirst({ where: and(eq(documents.id, documentId), eq(documents.orgId, ctx.orgId)) })
    if (!existing) throw new ServiceError("Document not found", 404)

    // The category the row will HAVE after this patch is what the gate is
    // measured against, so a caller cannot move a permit into a drawing
    // category and patch its metadata in the same call, nor patch a drawing's
    // discipline while moving it out of the drawing categories.
    const effectiveCategory = input.category !== undefined ? input.category : existing.category
    if (input.metadata !== undefined && !(METADATA_PATCHABLE_CATEGORIES as readonly (string | null)[]).includes(effectiveCategory)) {
      throw new ServiceError(
        `Only ${METADATA_PATCHABLE_CATEGORIES.join(" and ")} documents carry editable metadata; this one is ${effectiveCategory ?? "uncategorised"}`,
        400
      )
    }

    const existingMetadata = (existing.metadata ?? {}) as Record<string, unknown>

    const [updated] = await db.update(documents).set({
      ...(input.name !== undefined ? { name: input.name.trim() } : {}),
      ...(input.category !== undefined ? { category: input.category } : {}),
      ...(input.expiryDate !== undefined ? { expiryDate: input.expiryDate ? new Date(input.expiryDate) : null } : {}),
      ...(input.linkedEntityType !== undefined ? { linkedEntityType: input.linkedEntityType } : {}),
      ...(input.linkedEntityId !== undefined ? { linkedEntityId: input.linkedEntityId } : {}),
      ...(input.metadata !== undefined ? { metadata: { ...existingMetadata, ...input.metadata } } : {}),
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

// ─── Wave 91: Retention & Disposal (DMS008) ───────────────────────────────

export async function setRetentionPolicy(ctx: { orgId: string }, documentId: string, retentionPeriodDays: number) {
  if (retentionPeriodDays <= 0) throw new ServiceError("retentionPeriodDays must be positive", 400)
  return withTenantContext({ orgId: ctx.orgId }, async (db) => {
    const doc = await db.query.documents.findFirst({ where: and(eq(documents.id, documentId), eq(documents.orgId, ctx.orgId)) })
    if (!doc) throw new ServiceError("Document not found", 404)

    const disposalDate = new Date(doc.createdAt)
    disposalDate.setDate(disposalDate.getDate() + retentionPeriodDays)

    const [updated] = await db.update(documents).set({
      retentionPeriodDays, disposalDate: disposalDate.toISOString().slice(0, 10),
    }).where(eq(documents.id, documentId)).returning()
    return updated
  })
}

export async function setLegalHold(ctx: { orgId: string }, documentId: string, legalHold: boolean) {
  return withTenantContext({ orgId: ctx.orgId }, async (db) => {
    const doc = await db.query.documents.findFirst({ where: and(eq(documents.id, documentId), eq(documents.orgId, ctx.orgId)) })
    if (!doc) throw new ServiceError("Document not found", 404)
    const [updated] = await db.update(documents).set({ legalHold }).where(eq(documents.id, documentId)).returning()
    return updated
  })
}

// Documents whose retention period has lapsed and are eligible for
// disposal -- excludes anything already disposed or under legal hold, so
// this list is exactly "what a records manager should act on today."
export async function listPendingDisposal(ctx: { orgId: string }) {
  return withTenantContext({ orgId: ctx.orgId }, async (db) => {
    const today = new Date().toISOString().slice(0, 10)
    return db.query.documents.findMany({
      where: and(
        eq(documents.orgId, ctx.orgId), eq(documents.isDisposed, false), eq(documents.legalHold, false),
        isNotNull(documents.disposalDate), lte(documents.disposalDate, today),
      ),
      orderBy: (d, { asc }) => asc(d.disposalDate),
    })
  })
}

/** A real gate, not a UI-only checkbox: refuses to dispose a document that isn't past its disposal date or is under legal hold, matching Wave 82's period-closing precedent. */
export async function disposeDocument(ctx: { orgId: string; userId: string }, documentId: string) {
  return withTenantContext({ orgId: ctx.orgId, userId: ctx.userId }, async (db) => {
    const doc = await db.query.documents.findFirst({ where: and(eq(documents.id, documentId), eq(documents.orgId, ctx.orgId)) })
    if (!doc) throw new ServiceError("Document not found", 404)
    if (doc.isDisposed) throw new ServiceError("Document has already been disposed", 409)
    if (doc.legalHold) throw new ServiceError("Document is under legal hold and cannot be disposed", 409)
    if (!doc.disposalDate) throw new ServiceError("Document has no retention policy set", 400)
    if (doc.disposalDate > new Date().toISOString().slice(0, 10)) throw new ServiceError("Document has not yet reached its disposal date", 409)

    const [updated] = await db.update(documents).set({
      isDisposed: true, disposedAt: new Date(), disposedById: ctx.userId,
    }).where(eq(documents.id, documentId)).returning()
    return updated
  })
}

// ─── Wave 91: Full-text search (DMS006) ───────────────────────────────────
// Real content search over name + the vision-extraction summary (Wave 35/76),
// not the metadata/category filtering listDocuments() already provides.
// Computed at query time against the functional GIN index from the Wave 91
// migration -- no stored tsvector column to keep in sync.
export async function searchDocuments(ctx: { orgId: string }, query: string) {
  if (!query?.trim()) return []
  return withTenantContext({ orgId: ctx.orgId }, async (db) => {
    return db.select().from(documents).where(
      sql`${documents.orgId} = ${ctx.orgId} AND ${documents.isLatestVersion} = true AND
        to_tsvector('english', coalesce(${documents.name}, '') || ' ' || coalesce(${documents.extractedData}->>'summary', ''))
        @@ plainto_tsquery('english', ${query})`
    ).orderBy(sql`ts_rank(
      to_tsvector('english', coalesce(${documents.name}, '') || ' ' || coalesce(${documents.extractedData}->>'summary', '')),
      plainto_tsquery('english', ${query})
    ) DESC`)
  })
}
