import { documents } from "@/lib/db"
import { withTenantContext } from "@/lib/db/tenant-scoped"
import { NextRequest, NextResponse, after } from "next/server"
import { requireAuth, requireRole } from "@/lib/supabase/auth-guard"
import { logActivity } from "@/lib/audit"
import { createClient } from "@supabase/supabase-js"
import { createId } from "@paralleldrive/cuid2"
import { isDocumentExtractable, extractDocumentContent } from "@/lib/services/document-extraction-service"
import { listDocuments, markSupersededVersion, ServiceError } from "@/lib/services/document-service"
import { classifyBusinessObjectType } from "@/lib/business-object-classifier"
import { applyClassificationWithDb } from "@/lib/services/document-classification-service"
import { checkAndUnlockAchievements } from "@/lib/services/veri-reward-service"
import { createSourceObject } from "@/lib/crr/capture"
import { and, eq, sql } from "drizzle-orm"

const BUCKET = "compliance-documents"
const MAX_SIZE_BYTES = 25 * 1024 * 1024 // matches the bucket's file_size_limit

// CRR-089 (P3-BRIDGE): this route's fire-and-forget extraction (after(),
// kept per CRR-085) now runs the full chunk+embed bridge (CRR-079/081/082)
// for every text-extractable upload, not just the compliance-field LLM
// call -- a real budget is needed instead of the platform's small implicit
// default. Team plan confirmed "pro" via the Vercel MCP (list_teams). Could
// NOT confirm via any available tool whether this specific project has
// Fluid Compute toggled on (that's a project-level dashboard setting, not
// surfaced by get_project, and neither vercel.json nor next.config.ts
// declares `fluid: true`) -- so this deliberately uses 300s, the ceiling
// that is valid for a Pro-plan function EITHER way, rather than assuming
// the 800s ceiling Fluid Compute would allow without verifying it. If a
// human confirms Fluid Compute is on for this project, this can safely be
// raised toward 800.
export const maxDuration = 300

// service-role client, used ONLY server-side after requireAuth() has already
// verified the caller -- the bucket itself has no anon/authenticated storage
// policies at all (see the wave7_documents_storage_bucket migration), so
// this is the only code path that can ever touch it.
function getStorageAdminClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )
}

function sanitizeFileName(name: string): string {
  return name.replace(/[^a-zA-Z0-9._-]/g, "_").slice(-120)
}

// Upload a file and create its documents row in one call -- evidence
// (receipts, dispatch proofs, general attachments) always goes through this,
// never a bare fileUrl insert, so every document on the platform actually
// has real bytes behind it in the private bucket, not just a claimed link.
export async function POST(request: NextRequest) {
  const { response, dbUser, orgId } = await requireAuth()
  if (response) return response
  const roleErr = requireRole(dbUser, "member")
  if (roleErr) return roleErr
  if (!orgId || !dbUser) return NextResponse.json({ error: "No organisation on this account" }, { status: 400 })

  try {
    const formData = await request.formData()
    const file = formData.get("file")
    if (!(file instanceof File)) {
      return NextResponse.json({ error: "A file is required" }, { status: 400 })
    }
    if (file.size > MAX_SIZE_BYTES) {
      return NextResponse.json({ error: "File exceeds 25 MB limit" }, { status: 400 })
    }

    const complianceItemId = (formData.get("complianceItemId") as string | null) || null
    const noticeId = (formData.get("noticeId") as string | null) || null
    const clientId = (formData.get("clientId") as string | null) || null
    const label = (formData.get("name") as string | null)?.trim() || file.name
    // Wave 61 fields -- all optional, so every pre-existing upload call site
    // (compliance items, notices) keeps working unchanged.
    const category = (formData.get("category") as string | null) || null
    const expiryDateRaw = (formData.get("expiryDate") as string | null) || null
    const linkedEntityType = (formData.get("linkedEntityType") as string | null) || null
    const linkedEntityId = (formData.get("linkedEntityId") as string | null) || null
    const versionOfId = (formData.get("versionOfId") as string | null) || null
    // Wave 117 (PROJEXA Permits/Drawings/Site Photos): category-specific
    // fields (permitAuthority/permitNumber, a floor/area/activity location
    // path, etc.) that aren't generic enough for a dedicated column.
    const metadataRaw = (formData.get("metadata") as string | null) || null
    let metadata: unknown = null
    if (metadataRaw) {
      try {
        metadata = JSON.parse(metadataRaw)
      } catch {
        return NextResponse.json({ error: "metadata must be valid JSON" }, { status: 400 })
      }
    }

    const objectPath = `${orgId}/${createId()}-${sanitizeFileName(file.name)}`
    const bytes = new Uint8Array(await file.arrayBuffer())

    // CRR-086: the one authorized classification call for this upload --
    // computed once, reused for both source_object.business_object_type
    // below and the response's own businessObjectType field (previously
    // re-derived a second time from result.fileType/result.name after the
    // insert). Minor, disclosed behavior refinement: the fileName fallback
    // signal is now the real uploaded file's own name (file.name) rather
    // than the human-editable `label` (result.name, from the optional
    // "name" form field) -- mimeType is checked first either way
    // (classifyBusinessObjectType's own fallback-only comment on fileName),
    // so this only changes anything when mimeType is missing/generic AND a
    // caller renamed the file via the "name" field to something whose
    // extension no longer matches the real upload -- the real file's own
    // name is the more honest signal for what the bytes actually are.
    const businessObjectType = classifyBusinessObjectType({ mimeType: file.type, fileName: file.name })

    // CRR-084: createSourceObject FIRST -- captures these exact bytes into
    // compliance.source_object (its own sha256-hash + upload + insert,
    // extract_status=PENDING) before this route does anything else with
    // them. Deliberately a SEPARATE upload from the admin.storage.upload
    // just below (disclosed, not accidental): source_object's own storage
    // path/bucket-object is independent of documents.fileUrl's -- capture.ts
    // (CRR-078) intentionally has no return value beyond the row id, so
    // there is no path here to hand to documents.fileUrl even if this route
    // wanted to reuse the same object. Consolidating the two into a single
    // upload is out of this point's own what_to_do (it only asks to call
    // createSourceObject, persist the id, and pass it to extraction) and is
    // left for whichever later CRR point actually retires documents.fileUrl
    // in favor of source_object.storage_path as the one real file location.
    const sourceObjectId = await createSourceObject({
      orgId,
      clientId,
      origin: "upload",
      mimeType: file.type || null,
      bytes,
      title: label,
      linkedEntityType,
      linkedEntityId,
      businessObjectType,
      createdById: dbUser.id,
    })

    const admin = getStorageAdminClient()
    const { error: uploadError } = await admin.storage.from(BUCKET).upload(objectPath, bytes, {
      contentType: file.type || "application/octet-stream",
      upsert: false,
    })
    if (uploadError) {
      console.error("Storage upload error:", uploadError)
      return NextResponse.json({ error: "Failed to upload file" }, { status: 500 })
    }

    const result = await withTenantContext({ orgId, userId: dbUser.id }, async (db) => {
      let versionNumber = 1
      let inheritedLinkType = linkedEntityType
      let inheritedLinkId = linkedEntityId
      let inheritedCategory = category

      if (versionOfId) {
        const previous = await markSupersededVersion(db, orgId, versionOfId)
        versionNumber = previous.versionNumber + 1
        // A new version inherits the previous version's category/link unless
        // the caller explicitly overrides them -- the point of "version 2"
        // is that it's the same logical document, still filed the same way.
        inheritedLinkType = linkedEntityType ?? previous.linkedEntityType
        inheritedLinkId = linkedEntityId ?? previous.linkedEntityId
        inheritedCategory = category ?? previous.category
      }

      const [doc] = await db.insert(documents).values({
        name: label,
        fileUrl: objectPath,
        fileType: file.type || null,
        fileSize: file.size,
        complianceItemId,
        noticeId,
        uploadedById: dbUser.id,
        orgId,
        clientId,
        category: inheritedCategory,
        expiryDate: expiryDateRaw ? new Date(expiryDateRaw) : null,
        linkedEntityType: inheritedLinkType,
        linkedEntityId: inheritedLinkId,
        parentDocumentId: versionOfId,
        versionNumber,
        isLatestVersion: true,
        metadata: metadata ?? undefined,
        // CRR-084: the durable link from this documents row to its
        // compliance.source_object capture, so a later reader (the CRR-090
        // catch-up worker, retrieval-citation lookups) can go from "the
        // document a user sees" to "the chunks/embeddings behind it"
        // without re-deriving anything.
        sourceObjectId,
      }).returning()

      await logActivity({
        tx: db,
        action: "create",
        entityType: "Document",
        entityId: doc.id,
        details: versionOfId ? `Uploaded new version (v${versionNumber}) of document: ${doc.name}` : `Uploaded document: ${doc.name}`,
        orgId,
        clientId: clientId ?? undefined,
        dbUser,
        request,
      })

      // Priority 13 (Document Correspondent/Type Auto-Classification):
      // filename-only pass, run inline (cheap, no OCR/AI dependency) --
      // never overrides an explicit category/link the caller just set above
      // (see applyClassificationWithDb's own additive-only discipline). A
      // second, content-based pass runs after Document AI vision extraction
      // completes for image uploads (document-extraction-service.ts).
      await applyClassificationWithDb(db, orgId, doc.id, {}).catch((err) =>
        console.error("Document auto-classification (filename pass) failed:", err)
      )

      // VERI Reward: nudge the 'first_document_upload' achievement the
      // moment this user's upload count hits 1. No existing per-user
      // document count to reuse (document-service.ts only exposes
      // org-scoped listing), so this is a narrowly-scoped count(*) against
      // the row just inserted, not a full table scan. Wrapped so a
      // points-engine failure can never break the actual upload (logged,
      // not thrown) -- same discipline as compliance-service.ts's
      // first_compliance_item wiring.
      try {
        const [{ count }] = await db
          .select({ count: sql<number>`count(*)::int` })
          .from(documents)
          .where(and(eq(documents.orgId, orgId), eq(documents.uploadedById, dbUser.id)))
        if (count === 1) {
          await checkAndUnlockAchievements(db, { orgId, userId: dbUser.id, achievementKey: "first_document_upload" })
        }
      } catch (err) {
        console.error("[veri-reward] failed to check first_document_upload achievement", err)
      }

      return doc
    })

    // Wave 35 (Document AI): fire-and-forget extraction -- never blocks or
    // fails the upload response. Covers both the vision path (images) and
    // the text-extraction path (PDF/Word/PowerPoint/email -- see
    // document-extraction-service.ts's own header for why those were added
    // and why video is not).
    //
    // Bug fix (2026-07-06): wrapped in after() -- a bare un-awaited promise
    // here could be killed by Vercel before it ran, same root cause found in
    // Meeting Intelligence (see veri-meeting-service.ts).
    if (isDocumentExtractable(file.type)) {
      const fileBase64 = Buffer.from(bytes).toString("base64")
      // CRR-084: sourceObjectId/businessObjectType now passed straight
      // through -- chunkAndEmbedSourceObject (document-extraction-
      // service.ts) uses ctx.sourceObjectId instead of creating its own
      // stand-in source_object row (its own header comment on this was the
      // "not yet done as of this point's own closure" -- now done).
      after(() => extractDocumentContent({
        orgId, userId: dbUser.id, documentId: result.id, fileBase64, mimeType: file.type,
        sourceObjectId, businessObjectType,
      }).catch((err) =>
        console.error("Fire-and-forget document extraction failed to even start:", err)
      ))
    }

    return NextResponse.json({
      id: result.id,
      name: result.name,
      fileType: result.fileType,
      businessObjectType,
      fileSize: result.fileSize,
      createdAt: result.createdAt.toISOString(),
    }, { status: 201 })
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("Document upload error:", error)
    // Best-effort cleanup isn't attempted here -- an orphaned storage object
    // with no documents row is a harmless dangling file, not a data-integrity
    // risk (the reverse, a documents row with no real file, would be worse).
    return NextResponse.json({ error: "Failed to upload document" }, { status: 500 })
  }
}

// Wave 61: central repository listing -- filterable by category/linked
// entity, latest-version-only by default so superseded versions don't
// clutter the main list (use /versions for history).
export async function GET(request: NextRequest) {
  const { response, orgId } = await requireAuth()
  if (response) return response
  if (!orgId) return NextResponse.json({ documents: [] })

  try {
    const { searchParams } = new URL(request.url)
    const category = searchParams.get("category") || undefined
    const linkedEntityType = searchParams.get("linkedEntityType") || undefined
    const linkedEntityId = searchParams.get("linkedEntityId") || undefined

    const docs = await listDocuments({ orgId }, { category, linkedEntityType, linkedEntityId })
    // U-D26.B3.S1: attach the normalized 4-type classification alongside the
    // raw fileType -- callers should read businessObjectType, not re-derive
    // it from fileType/name themselves.
    const withBusinessObjectType = docs.map((doc) => ({
      ...doc,
      businessObjectType: classifyBusinessObjectType({ mimeType: doc.fileType, fileName: doc.name }),
    }))
    return NextResponse.json({ documents: withBusinessObjectType })
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("Document list error:", error)
    return NextResponse.json({ error: "Failed to fetch documents" }, { status: 500 })
  }
}
