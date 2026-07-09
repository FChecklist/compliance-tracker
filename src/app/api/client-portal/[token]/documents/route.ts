// Client self-service document upload through the portal token -- same
// storage mechanism as /api/documents (service-role client, private
// 'compliance-documents' bucket, no public bucket policies), org/client
// resolved from the token instead of a session since there is none here.
import { NextRequest, NextResponse } from "next/server"
import { getPortalClientId, ServiceError } from "@/lib/services/firm-client-portal-service"
import { documents } from "@/lib/db"
import { withTenantContext } from "@/lib/db/tenant-scoped"
import { createClient } from "@supabase/supabase-js"
import { createId } from "@paralleldrive/cuid2"

const BUCKET = "compliance-documents"
const MAX_SIZE_BYTES = 25 * 1024 * 1024

function getStorageAdminClient() {
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)
}

function sanitizeFileName(name: string): string {
  return name.replace(/[^a-zA-Z0-9._-]/g, "_").slice(-120)
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  try {
    const { token } = await params
    const { orgId, clientId } = await getPortalClientId(token)

    const formData = await request.formData()
    const file = formData.get("file")
    if (!(file instanceof File)) return NextResponse.json({ error: "A file is required" }, { status: 400 })
    if (file.size > MAX_SIZE_BYTES) return NextResponse.json({ error: "File exceeds 25 MB limit" }, { status: 400 })
    const category = (formData.get("category") as string | null) || "client_upload"
    const engagementId = (formData.get("engagementId") as string | null) || null

    const objectPath = `${orgId}/${createId()}-${sanitizeFileName(file.name)}`
    const bytes = new Uint8Array(await file.arrayBuffer())

    const admin = getStorageAdminClient()
    const { error: uploadError } = await admin.storage.from(BUCKET).upload(objectPath, bytes, { contentType: file.type || "application/octet-stream", upsert: false })
    if (uploadError) {
      console.error("Client portal storage upload error:", uploadError)
      return NextResponse.json({ error: "Failed to upload file" }, { status: 500 })
    }

    const result = await withTenantContext({ orgId }, async (db) => {
      const [doc] = await db.insert(documents).values({
        name: file.name, fileUrl: objectPath, fileType: file.type || null, fileSize: file.size,
        category, linkedEntityType: engagementId ? "firm_engagement" : null, linkedEntityId: engagementId,
        // uploadedById is NOT NULL but there's no real "client user" row in
        // this schema to attribute it to -- a sentinel string (not an actual
        // users.id, no FK enforces it) rather than crediting the portal
        // link's creator, which would misleadingly imply staff uploaded it.
        uploadedById: "client-portal-self-service",
        orgId, clientId,
      }).returning()
      return doc
    })

    return NextResponse.json({ document: result }, { status: 201 })
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("Client portal document upload error:", error)
    return NextResponse.json({ error: "Failed to upload document" }, { status: 500 })
  }
}
