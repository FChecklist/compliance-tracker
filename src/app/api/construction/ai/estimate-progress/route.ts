import { NextResponse } from "next/server"
import { requireAuth } from "@/lib/supabase/auth-guard"
import { documents } from "@/lib/db"
import { withTenantContext } from "@/lib/db/tenant-scoped"
import { eq, and } from "drizzle-orm"
import { createClient } from "@supabase/supabase-js"
import { estimateProgressFromPhoto, ServiceError } from "@/lib/services/construction-ai-service"

const BUCKET = "compliance-documents"

// Same service-role, requireAuth()-gated-only storage access pattern as
// src/app/api/documents/route.ts's POST handler.
function getStorageAdminClient() {
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)
}

export async function POST(request: Request) {
  const { response, dbUser, orgId } = await requireAuth()
  if (response) return response
  if (!orgId || !dbUser) return NextResponse.json({ error: "No organisation found" }, { status: 400 })

  try {
    const body = await request.json()
    if (!body.documentId) return NextResponse.json({ error: "documentId is required" }, { status: 400 })
    if (!body.activityName) return NextResponse.json({ error: "activityName is required" }, { status: 400 })

    const doc = await withTenantContext({ orgId, userId: dbUser.id }, (db) =>
      db.query.documents.findFirst({ where: and(eq(documents.id, body.documentId), eq(documents.orgId, orgId)) })
    )
    if (!doc) return NextResponse.json({ error: "Document not found" }, { status: 404 })
    if (!doc.fileType?.startsWith("image/")) return NextResponse.json({ error: "Only image documents can be progress-estimated" }, { status: 400 })

    const admin = getStorageAdminClient()
    const { data: fileData, error: downloadError } = await admin.storage.from(BUCKET).download(doc.fileUrl)
    if (downloadError || !fileData) return NextResponse.json({ error: "Failed to download document from storage" }, { status: 500 })
    const imageBase64 = Buffer.from(await fileData.arrayBuffer()).toString("base64")

    const estimate = await estimateProgressFromPhoto({
      orgId, userId: dbUser.id, documentId: doc.id, imageBase64, mimeType: doc.fileType, activityName: body.activityName,
    })
    if (!estimate) return NextResponse.json({ error: "No AI model configured for this organisation, or no vision-capable model available for its provider" }, { status: 400 })
    return NextResponse.json(estimate)
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("Construction AI progress estimation error:", error)
    return NextResponse.json({ error: "Failed to estimate progress from photo" }, { status: 500 })
  }
}
