// Wave 119: read-only originally -- file upload stayed internal-only because
// the internal POST /api/documents handler had ~120 lines of upload/
// versioning logic never extracted into document-service.ts.
// Wave 143 (PROJEXA Permits/Drawings/Documents real create+upload): that
// extraction happened -- createDocumentRecord() in document-service.ts now
// carries the real storage-upload path, shared by this route and the
// permits/drawings routes, so this is no longer read-only. Deliberately a
// narrower contract than the internal route (no versioning/auto-
// classification/AI-extraction side effects) -- see createDocumentRecord's
// own header comment for why that's an acceptable, not accidental, gap.
import { NextRequest, NextResponse } from "next/server"
import { requireAuthOrApiKey, requireRoleOrScope } from "@/lib/supabase/auth-guard"
import { listDocuments, createDocumentRecord, ServiceError } from "@/lib/services/document-service"

export async function GET(request: NextRequest) {
  const ctx = await requireAuthOrApiKey(request)
  if (ctx.response) return ctx.response
  if (!ctx.orgId) return NextResponse.json({ documents: [] })

  try {
    const { searchParams } = request.nextUrl
    const docs = await listDocuments({ orgId: ctx.orgId }, {
      category: searchParams.get("category") ?? undefined,
      linkedEntityType: searchParams.get("linkedEntityType") ?? undefined,
      linkedEntityId: searchParams.get("linkedEntityId") ?? undefined,
    })
    return NextResponse.json({ documents: docs })
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("v1 documents list error:", error)
    return NextResponse.json({ error: "Failed to fetch documents" }, { status: 500 })
  }
}

export async function POST(request: NextRequest) {
  const ctx = await requireAuthOrApiKey(request)
  if (ctx.response) return ctx.response
  const roleErr = requireRoleOrScope(ctx, "member", "write")
  if (roleErr) return roleErr
  const actorId = ctx.dbUser?.id ?? ctx.apiKey?.id
  if (!ctx.orgId || !actorId) return NextResponse.json({ error: "No organisation on this account" }, { status: 400 })

  try {
    const formData = await request.formData()
    const file = formData.get("file")
    const externalUrl = (formData.get("externalUrl") as string | null) || null
    const name = (formData.get("name") as string | null)?.trim() || (file instanceof File ? file.name : null)
    if (!name) return NextResponse.json({ error: "name is required" }, { status: 400 })
    const category = (formData.get("category") as string | null) || "other"
    const expiryDate = (formData.get("expiryDate") as string | null) || null
    const linkedEntityType = (formData.get("linkedEntityType") as string | null) || null
    const linkedEntityId = (formData.get("linkedEntityId") as string | null) || null
    const metadataRaw = (formData.get("metadata") as string | null) || null
    let metadata: unknown = null
    if (metadataRaw) {
      try {
        metadata = JSON.parse(metadataRaw)
      } catch {
        return NextResponse.json({ error: "metadata must be valid JSON" }, { status: 400 })
      }
    }

    if (!(file instanceof File) && !externalUrl) {
      return NextResponse.json({ error: "Either a file or externalUrl is required" }, { status: 400 })
    }

    const doc = await createDocumentRecord({ orgId: ctx.orgId, userId: actorId }, {
      name, category, expiryDate, linkedEntityType, linkedEntityId, metadata,
      ...(file instanceof File ? { file } : { externalUrl: externalUrl! }),
    })

    return NextResponse.json(doc, { status: 201 })
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("v1 documents create error:", error)
    return NextResponse.json({ error: "Failed to create document" }, { status: 500 })
  }
}
