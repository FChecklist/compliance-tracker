// R42 seq21/22 live-oracle finding: no permit detail route existed at all
// (confirmed live via screen_spec's own PERMITS.OBJECT row: "no detail
// route exists today; only 3 [id] routes exist across the whole app
// group"). This is the real GET/PATCH/DELETE this module needs to back
// ObjectScreen -- direct queries against `documents`, matching this
// route's own createDocumentRecord/list neighbours' directness rather than
// widening updateDocumentMetadata's contract for fields (name, permit
// authority/number/issue date inside metadata) it was never meant to carry.
import { NextRequest, NextResponse } from "next/server"
import { and, eq } from "drizzle-orm"
import { requireAuthOrApiKey, requireRoleOrScope } from "@/lib/supabase/auth-guard"
import { withTenantContext } from "@/lib/db/tenant-scoped"
import { documents } from "@/lib/db/schema"
import { createClient } from "@supabase/supabase-js"
import { discardDraft } from "@/lib/screens/draft-service"

const BUCKET = "compliance-documents"
const SIGNED_URL_TTL_SECONDS = 3600 // M31/GLOBAL: signed URLs, 1h -- this is the OBJECT screen's own file preview, longer-lived than the list's 5-minute thumbnail URLs

type RouteContext = { params: Promise<{ id: string }> }

function getStorageAdminClient() {
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)
}

async function toPermitDto(doc: typeof documents.$inferSelect) {
  const metadata = (doc.metadata ?? {}) as { permitAuthority?: string; permitNumber?: string; issueDate?: string; notes?: string; tags?: string[] }
  let documentUrl: string | null = null
  if (doc.fileUrl) {
    const admin = getStorageAdminClient()
    const { data } = await admin.storage.from(BUCKET).createSignedUrl(doc.fileUrl, SIGNED_URL_TTL_SECONDS)
    documentUrl = data?.signedUrl ?? null
  }
  return {
    id: doc.id,
    name: doc.name,
    permitNumber: metadata.permitNumber ?? null,
    permitAuthority: metadata.permitAuthority ?? null,
    issueDate: metadata.issueDate ?? null,
    endDate: doc.expiryDate,
    notes: metadata.notes ?? null,
    tags: metadata.tags ?? [],
    projectId: doc.linkedEntityId,
    createdAt: doc.createdAt,
    documentUrl,
  }
}

export async function GET(request: NextRequest, { params }: RouteContext) {
  const ctx = await requireAuthOrApiKey(request)
  if (ctx.response) return ctx.response
  if (!ctx.orgId) return NextResponse.json({ error: "No organisation on this account" }, { status: 400 })
  const { id } = await params

  const doc = await withTenantContext({ orgId: ctx.orgId }, (db) =>
    db.query.documents.findFirst({ where: and(eq(documents.id, id), eq(documents.orgId, ctx.orgId!), eq(documents.category, "permit")) })
  )
  if (!doc) return NextResponse.json({ error: "Permit not found" }, { status: 404 })
  return NextResponse.json(await toPermitDto(doc))
}

export async function PATCH(request: NextRequest, { params }: RouteContext) {
  const ctx = await requireAuthOrApiKey(request)
  if (ctx.response) return ctx.response
  const roleErr = requireRoleOrScope(ctx, "member", "write")
  if (roleErr) return roleErr
  if (!ctx.orgId) return NextResponse.json({ error: "No organisation on this account" }, { status: 400 })
  const { id } = await params
  const actorId = ctx.dbUser?.id ?? null

  const body = await request.json().catch(() => ({}))

  const updated = await withTenantContext({ orgId: ctx.orgId, userId: actorId ?? undefined }, async (db) => {
    const existing = await db.query.documents.findFirst({ where: and(eq(documents.id, id), eq(documents.orgId, ctx.orgId!), eq(documents.category, "permit")) })
    if (!existing) return null
    const existingMetadata = (existing.metadata ?? {}) as Record<string, unknown>
    const [row] = await db
      .update(documents)
      .set({
        ...(typeof body.name === "string" ? { name: body.name } : {}),
        ...(body.endDate !== undefined ? { expiryDate: body.endDate ? new Date(body.endDate) : null } : {}),
        metadata: {
          ...existingMetadata,
          ...(body.permitAuthority !== undefined ? { permitAuthority: body.permitAuthority } : {}),
          ...(body.permitNumber !== undefined ? { permitNumber: body.permitNumber } : {}),
          ...(body.issueDate !== undefined ? { issueDate: body.issueDate } : {}),
          ...(body.notes !== undefined ? { notes: body.notes } : {}),
          ...(body.tags !== undefined ? { tags: body.tags } : {}),
        },
      })
      .where(eq(documents.id, id))
      .returning()
    return row
  })
  if (!updated) return NextResponse.json({ error: "Permit not found" }, { status: 404 })
  // RE-SELECT AND CONFIRM PERSISTENCE (E-52) -- fetch fresh rather than trusting the UPDATE...RETURNING alone.
  const reselected = await withTenantContext({ orgId: ctx.orgId }, (db) => db.query.documents.findFirst({ where: eq(documents.id, id) }))

  // Save = validate+write (above) THEN delete the draft (M29) -- never
  // before. draftId is optional: a plain PATCH with no draft in play (e.g.
  // a future non-UI caller) still works unchanged.
  if (typeof body.draftId === "string" && actorId) {
    await discardDraft({ orgId: ctx.orgId, userId: actorId }, body.draftId)
  }

  return NextResponse.json(await toPermitDto(reselected!))
}

export async function DELETE(request: NextRequest, { params }: RouteContext) {
  const ctx = await requireAuthOrApiKey(request)
  if (ctx.response) return ctx.response
  const roleErr = requireRoleOrScope(ctx, "member", "write")
  if (roleErr) return roleErr
  if (!ctx.orgId) return NextResponse.json({ error: "No organisation on this account" }, { status: 400 })
  const { id } = await params

  const deleted = await withTenantContext({ orgId: ctx.orgId }, async (db) => {
    const [row] = await db.delete(documents).where(and(eq(documents.id, id), eq(documents.orgId, ctx.orgId!), eq(documents.category, "permit"))).returning({ id: documents.id })
    return row ?? null
  })
  if (!deleted) return NextResponse.json({ error: "Permit not found" }, { status: 404 })
  return NextResponse.json({ deleted: true, id: deleted.id })
}
