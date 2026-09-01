// Real-screen conversion (2026-08-30): the Documents module never had a
// single-document route on the v1/projexa surface -- only list+upload
// (documents/route.ts) existed, so an uploaded file could never actually be
// viewed/downloaded or have its metadata edited from PROJEXA. Mirrors the
// internal api/documents/[id]/route.ts's own signed-URL + metadata-update
// logic exactly, swapped to requireAuthOrApiKey so it works from PROJEXA's
// Bearer-key context (the internal route is session-only requireAuth()).
import { documents } from "@/lib/db"
import { withTenantContext } from "@/lib/db/tenant-scoped"
import { NextRequest, NextResponse } from "next/server"
import { eq } from "drizzle-orm"
import { requireAuthOrApiKey, requireRoleOrScope, requireOrg } from "@/lib/supabase/auth-guard"
import { logActivity } from "@/lib/audit"
import { createClient } from "@supabase/supabase-js"
import { updateDocumentMetadata, ServiceError } from "@/lib/services/document-service"

const BUCKET = "compliance-documents"
const SIGNED_URL_TTL_SECONDS = 300 // matches the internal route + permits/route.ts

function getStorageAdminClient() {
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)
}

type RouteContext = { params: Promise<{ id: string }> }

export async function GET(request: NextRequest, context: RouteContext) {
  const ctx = await requireAuthOrApiKey(request)
  if (ctx.response) return ctx.response
  if (!ctx.orgId) return requireOrg(ctx)!

  try {
    const { id } = await context.params
    const result = await withTenantContext({ orgId: ctx.orgId, userId: ctx.dbUser?.id ?? ctx.apiKey!.id }, async (db) => {
      const doc = await db.query.documents.findFirst({ where: eq(documents.id, id) })
      if (!doc) return null
      await logActivity({
        tx: db, action: "view", entityType: "Document", entityId: doc.id,
        details: `Viewed/downloaded document: ${doc.name}`, orgId: ctx.orgId!, clientId: doc.clientId,
        ...(ctx.dbUser ? { dbUser: ctx.dbUser } : { apiKey: ctx.apiKey! }),
        request,
      })
      return doc
    })
    if (!result) return NextResponse.json({ error: "Document not found" }, { status: 404 })

    // Drawings & 3D module (2026-08-30 real-screen conversion) reuses this
    // same route -- a 3D walkthrough can be an externally-linked URL
    // (metadata.isExternalLink, e.g. a Matterport share link) rather than a
    // real storage object. Signing an external URL as a bucket path would
    // either error or produce garbage -- same check toDrawingDto()/
    // toPermitDto() already make in their own routes, applied here too so
    // this generic route is correct for every category, not just plain
    // uploaded files.
    const metadata = (result.metadata ?? {}) as { isExternalLink?: boolean; discipline?: string }
    let signedUrl: string | null
    if (metadata.isExternalLink) {
      signedUrl = result.fileUrl
    } else {
      const admin = getStorageAdminClient()
      const { data, error } = await admin.storage.from(BUCKET).createSignedUrl(result.fileUrl, SIGNED_URL_TTL_SECONDS)
      if (error || !data) {
        console.error("v1 projexa document signed URL error:", error)
        return NextResponse.json({ error: "Failed to generate download link" }, { status: 500 })
      }
      signedUrl = data.signedUrl
    }

    return NextResponse.json({
      id: result.id, name: result.name, category: result.category, fileType: result.fileType, fileSize: result.fileSize,
      expiryDate: result.expiryDate, versionNumber: result.versionNumber, createdAt: result.createdAt,
      isDisposed: result.isDisposed, legalHold: result.legalHold, disposalDate: result.disposalDate,
      metadata, isExternalLink: !!metadata.isExternalLink,
      signedUrl, expiresInSeconds: SIGNED_URL_TTL_SECONDS,
    })
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("v1 projexa document get error:", error)
    return NextResponse.json({ error: "Failed to retrieve document" }, { status: 500 })
  }
}

export async function PATCH(request: NextRequest, context: RouteContext) {
  const ctx = await requireAuthOrApiKey(request)
  if (ctx.response) return ctx.response
  const roleErr = requireRoleOrScope(ctx, "member", "write")
  if (roleErr) return roleErr
  if (!ctx.orgId) return NextResponse.json({ error: "No organisation on this account" }, { status: 400 })

  try {
    const { id } = await context.params
    const body = await request.json()
    const updated = await updateDocumentMetadata({ orgId: ctx.orgId, userId: ctx.dbUser?.id ?? ctx.apiKey!.id }, id, {
      category: body.category, expiryDate: body.expiryDate,
      linkedEntityType: body.linkedEntityType, linkedEntityId: body.linkedEntityId,
    })
    return NextResponse.json(updated)
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("v1 projexa document update error:", error)
    return NextResponse.json({ error: "Failed to update document" }, { status: 500 })
  }
}
