import { documents } from "@/lib/db"
import { withTenantContext } from "@/lib/db/tenant-scoped"
import { NextRequest, NextResponse, after } from "next/server"
import { requireAuth, requireRole } from "@/lib/supabase/auth-guard"
import { logActivity } from "@/lib/audit"
import { createClient } from "@supabase/supabase-js"
import { createId } from "@paralleldrive/cuid2"
import { isVisionExtractable, extractDocumentContent } from "@/lib/services/document-extraction-service"
import { listDocuments, markSupersededVersion, ServiceError } from "@/lib/services/document-service"

const BUCKET = "compliance-documents"
const MAX_SIZE_BYTES = 25 * 1024 * 1024 // matches the bucket's file_size_limit

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

    const objectPath = `${orgId}/${createId()}-${sanitizeFileName(file.name)}`
    const bytes = new Uint8Array(await file.arrayBuffer())

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

      return doc
    })

    // Wave 35 (Document AI): fire-and-forget vision extraction -- never
    // blocks or fails the upload response. Image types only this pass (see
    // document-extraction-service.ts for why PDF is deliberately deferred).
    //
    // Bug fix (2026-07-06): wrapped in after() -- a bare un-awaited promise
    // here could be killed by Vercel before it ran, same root cause found in
    // Meeting Intelligence (see veri-meeting-service.ts).
    if (isVisionExtractable(file.type)) {
      const imageBase64 = Buffer.from(bytes).toString("base64")
      after(() => extractDocumentContent({ orgId, userId: dbUser.id, documentId: result.id, imageBase64, mimeType: file.type }).catch((err) =>
        console.error("Fire-and-forget document extraction failed to even start:", err)
      ))
    }

    return NextResponse.json({
      id: result.id,
      name: result.name,
      fileType: result.fileType,
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
    return NextResponse.json({ documents: docs })
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("Document list error:", error)
    return NextResponse.json({ error: "Failed to fetch documents" }, { status: 500 })
  }
}
