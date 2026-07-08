import { NextResponse } from "next/server"
import { requireAuth } from "@/lib/supabase/auth-guard"
import { documents } from "@/lib/db"
import { withTenantContext, type TenantDb } from "@/lib/db/tenant-scoped"
import { eq, and } from "drizzle-orm"
import { createClient } from "@supabase/supabase-js"
import { diffDrawingRevisions, ServiceError } from "@/lib/services/construction-ai-service"

const BUCKET = "compliance-documents"

function getStorageAdminClient() {
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)
}

async function downloadImage(db: TenantDb, orgId: string, documentId: string) {
  const doc = await db.query.documents.findFirst({ where: and(eq(documents.id, documentId), eq(documents.orgId, orgId)) })
  if (!doc) throw new ServiceError(`Document ${documentId} not found`, 404)
  if (!doc.fileType?.startsWith("image/")) throw new ServiceError(`Document ${documentId} is not an image`, 400)

  const admin = getStorageAdminClient()
  const { data: fileData, error } = await admin.storage.from(BUCKET).download(doc.fileUrl)
  if (error || !fileData) throw new ServiceError(`Failed to download document ${documentId} from storage`, 500)
  return { imageBase64: Buffer.from(await fileData.arrayBuffer()).toString("base64"), mimeType: doc.fileType }
}

export async function POST(request: Request) {
  const { response, dbUser, orgId } = await requireAuth()
  if (response) return response
  if (!orgId || !dbUser) return NextResponse.json({ error: "No organisation found" }, { status: 400 })

  try {
    const body = await request.json()
    if (!body.documentIdA || !body.documentIdB) return NextResponse.json({ error: "documentIdA and documentIdB are required" }, { status: 400 })

    const result = await withTenantContext({ orgId, userId: dbUser.id }, async (db) => {
      const [a, b] = await Promise.all([
        downloadImage(db, orgId, body.documentIdA),
        downloadImage(db, orgId, body.documentIdB),
      ])
      return diffDrawingRevisions(
        { orgId, userId: dbUser.id },
        { imageBase64A: a.imageBase64, mimeTypeA: a.mimeType, imageBase64B: b.imageBase64, mimeTypeB: b.mimeType }
      )
    })
    return NextResponse.json(result)
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("Construction drawing diff error:", error)
    return NextResponse.json({ error: "Failed to diff drawing revisions" }, { status: 500 })
  }
}
