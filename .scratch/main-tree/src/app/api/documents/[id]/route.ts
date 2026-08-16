import { documents } from "@/lib/db"
import { withTenantContext } from "@/lib/db/tenant-scoped"
import { NextRequest, NextResponse } from "next/server"
import { eq } from "drizzle-orm"
import { requireAuth } from "@/lib/supabase/auth-guard"
import { logActivity } from "@/lib/audit"
import { createClient } from "@supabase/supabase-js"
import { updateDocumentMetadata, ServiceError } from "@/lib/services/document-service"

const BUCKET = "compliance-documents"
const SIGNED_URL_TTL_SECONDS = 300 // 5 minutes -- short-lived on purpose, re-requested per view

function getStorageAdminClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )
}

type RouteContext = { params: Promise<{ id: string }> }

// Returns a short-lived signed URL, never the raw storage path -- the
// bucket has no public/anon access at all, so this is the only way a
// document's bytes are ever retrievable, and every retrieval is logged
// (this IS the "usage log", not just create/update/delete).
export async function GET(request: NextRequest, context: RouteContext) {
  const { response, dbUser, orgId } = await requireAuth()
  if (response) return response
  if (!orgId || !dbUser) return NextResponse.json({ error: "No organisation on this account" }, { status: 400 })

  try {
    const { id } = await context.params

    const result = await withTenantContext({ orgId, userId: dbUser.id }, async (db) => {
      const doc = await db.query.documents.findFirst({ where: eq(documents.id, id) })
      if (!doc) return null

      await logActivity({
        tx: db,
        action: "view",
        entityType: "Document",
        entityId: doc.id,
        details: `Viewed/downloaded document: ${doc.name}`,
        orgId,
        clientId: doc.clientId,
        dbUser,
        request,
      })

      return doc
    })

    if (!result) return NextResponse.json({ error: "Document not found" }, { status: 404 })

    const admin = getStorageAdminClient()
    const { data, error } = await admin.storage.from(BUCKET).createSignedUrl(result.fileUrl, SIGNED_URL_TTL_SECONDS)
    if (error || !data) {
      console.error("Signed URL error:", error)
      return NextResponse.json({ error: "Failed to generate download link" }, { status: 500 })
    }

    return NextResponse.json({
      id: result.id,
      name: result.name,
      fileType: result.fileType,
      fileSize: result.fileSize,
      signedUrl: data.signedUrl,
      expiresInSeconds: SIGNED_URL_TTL_SECONDS,
    })
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("Document GET error:", error)
    return NextResponse.json({ error: "Failed to retrieve document" }, { status: 500 })
  }
}

// Wave 61: metadata-only edit (category/expiryDate/linkedEntity) -- never
// touches the underlying file. Replacing the file itself goes through
// POST /api/documents with versionOfId, which creates a new version row.
export async function PATCH(request: NextRequest, context: RouteContext) {
  const { response, dbUser, orgId } = await requireAuth()
  if (response) return response
  if (!orgId || !dbUser) return NextResponse.json({ error: "No organisation on this account" }, { status: 400 })

  try {
    const { id } = await context.params
    const body = await request.json()
    const updated = await updateDocumentMetadata({ orgId, userId: dbUser.id }, id, {
      category: body.category,
      expiryDate: body.expiryDate,
      linkedEntityType: body.linkedEntityType,
      linkedEntityId: body.linkedEntityId,
    })
    return NextResponse.json(updated)
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("Document metadata update error:", error)
    return NextResponse.json({ error: "Failed to update document" }, { status: 500 })
  }
}
