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
import { requireAuthOrApiKey, requireRoleOrScope, requireOrg } from "@/lib/supabase/auth-guard"
import { listDocuments, createDocumentRecord, ServiceError } from "@/lib/services/document-service"

export async function GET(request: NextRequest) {
  const ctx = await requireAuthOrApiKey(request)
  if (ctx.response) return ctx.response
  if (!ctx.orgId) return requireOrg(ctx)!

  try {
    const { searchParams } = request.nextUrl
    const docs = await listDocuments({ orgId: ctx.orgId }, {
      category: searchParams.get("category") ?? undefined,
      linkedEntityType: searchParams.get("linkedEntityType") ?? undefined,
      linkedEntityId: searchParams.get("linkedEntityId") ?? undefined,
      // R67 D-14: "everything that belongs to this project", including the rows
      // filed against one of its permits, RFIs or meetings. PROJEXA's Documents
      // list sends this instead of linkedEntityType=project.
      projectScopeId: searchParams.get("projectScopeId") ?? undefined,
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
  // R39/R-C14: ctx.apiKey?.id is NOT a real compliance.users row -- falling
  // back to it here used to violate documents.uploaded_by_id's FK on every
  // API-key-authenticated upload (confirmed live, real 500). null is the
  // honest "no real user" value now that the column is nullable.
  const actorId = ctx.dbUser?.id ?? null
  if (!ctx.orgId) return NextResponse.json({ error: "No organisation on this account" }, { status: 400 })

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

    // R67 D-14. `projectId` is the project the document belongs to, which is no
    // longer the same question as what it is RELATED to (linkedEntityType is now
    // one of PROJEXA_DOCUMENT_LINK_TYPES, chosen in the "Relates to" combobox).
    // The three email fields are only ever sent for category 'email'; the
    // service drops the empty ones rather than storing blanks.
    const projectId = (formData.get("projectId") as string | null) || null
    const email = {
      from: (formData.get("emailFrom") as string | null) || null,
      receivedOn: (formData.get("emailReceivedOn") as string | null) || null,
      subject: (formData.get("emailSubject") as string | null) || null,
    }

    const doc = await createDocumentRecord({ orgId: ctx.orgId, userId: actorId }, {
      name, category, expiryDate, linkedEntityType, linkedEntityId, projectId, email, metadata,
      ...(file instanceof File ? { file } : { externalUrl: externalUrl! }),
    })

    return NextResponse.json(doc, { status: 201 })
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("v1 documents create error:", error)
    return NextResponse.json({ error: "Failed to create document" }, { status: 500 })
  }
}
