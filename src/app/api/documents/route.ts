import { documents } from "@/lib/db"
import { withTenantContext } from "@/lib/db/tenant-scoped"
import { NextRequest, NextResponse } from "next/server"
import { requireAuth, requireRole } from "@/lib/supabase/auth-guard"
import { logActivity } from "@/lib/audit"
import { createClient } from "@supabase/supabase-js"
import { createId } from "@paralleldrive/cuid2"

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
      }).returning()

      await logActivity({
        tx: db,
        action: "create",
        entityType: "Document",
        entityId: doc.id,
        details: `Uploaded document: ${doc.name}`,
        orgId,
        clientId: clientId ?? undefined,
        dbUser,
        request,
      })

      return doc
    })

    return NextResponse.json({
      id: result.id,
      name: result.name,
      fileType: result.fileType,
      fileSize: result.fileSize,
      createdAt: result.createdAt.toISOString(),
    }, { status: 201 })
  } catch (error) {
    console.error("Document upload error:", error)
    // Best-effort cleanup isn't attempted here -- an orphaned storage object
    // with no documents row is a harmless dangling file, not a data-integrity
    // risk (the reverse, a documents row with no real file, would be worse).
    return NextResponse.json({ error: "Failed to upload document" }, { status: 500 })
  }
}
