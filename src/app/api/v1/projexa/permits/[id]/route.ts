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
import { requireAuthOrApiKey, requireRoleOrScope, resolveActingUser } from "@/lib/supabase/auth-guard"
import { withTenantContext } from "@/lib/db/tenant-scoped"
import { documents } from "@/lib/db/schema"
import { signDocumentUrl } from "@/lib/storage/signed-document-url"
import { discardDraft } from "@/lib/screens/draft-service"

type RouteContext = { params: Promise<{ id: string }> }

// R67 F-02 (review fix). This used to construct its own Storage admin client
// and `await admin.storage...createSignedUrl(...)` unguarded. F-02 made this
// route the ONLY path by which a permit's file is opened -- the register hands
// out `hasDocument` and the screen comes here on click -- so an unguarded call
// here does not remove the "a Storage misconfiguration 500s a whole screen"
// failure mode, it relocates it onto the object screen. signDocumentUrl()
// resolves every failure to null with an operator log (its own TTL is already
// the 3600 s this route used), so a signing outage costs the reader the file
// link and nothing else on the permit.
async function toPermitDto(doc: typeof documents.$inferSelect) {
  const metadata = (doc.metadata ?? {}) as { permitAuthority?: string; permitNumber?: string; issueDate?: string; notes?: string; tags?: string[] }
  const documentUrl = await signDocumentUrl(doc.fileUrl, "v1 projexa permit detail")
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

  // R67 F-02 (review fix): none of the three handlers in this file had a
  // try/catch, so any unexpected throw left Next to render its own opaque 500.
  // That mattered little while this route was one of several ways to reach a
  // permit; F-02 made it the ONLY way to open a permit's file, so it is now on
  // a user's click path and owes them a real message. Matches every sibling
  // route under /api/v1/**, and satisfies the repo's own Route Error Handling
  // gate (scripts/check-route-error-handling.mjs).
  try {
    const doc = await withTenantContext({ orgId: ctx.orgId }, (db) =>
      db.query.documents.findFirst({ where: and(eq(documents.id, id), eq(documents.orgId, ctx.orgId!), eq(documents.category, "permit")) })
    )
    if (!doc) return NextResponse.json({ error: "Permit not found" }, { status: 404 })
    return NextResponse.json(await toPermitDto(doc))
  } catch (error) {
    console.error("v1 projexa permit detail error:", error)
    return NextResponse.json({ error: "Failed to fetch this permit" }, { status: 500 })
  }
}

export async function PATCH(request: NextRequest, { params }: RouteContext) {
  const ctx = await requireAuthOrApiKey(request)
  if (ctx.response) return ctx.response
  const roleErr = requireRoleOrScope(ctx, "member", "write")
  if (roleErr) return roleErr
  if (!ctx.orgId) return NextResponse.json({ error: "No organisation on this account" }, { status: 400 })
  const { id } = await params
  const body = await request.json().catch(() => ({}))
  try {
    // R42 seq21 live-oracle finding: draft discard on save silently never fired
    // for PROJEXA's real (API-key) caller -- actorId was always null, same
    // shared-API-key gap already fixed on timesheets submit/approve/reject.
    // Only resolved (and only required) when a draft is actually in play.
    let actorId: string | null = ctx.dbUser?.id ?? null
    if (!actorId && typeof body.draftId === "string") {
      const { user: actingUser, error: actingUserErr } = await resolveActingUser(ctx, body?.actorEmail)
      if (actingUserErr) return actingUserErr
      actorId = actingUser!.id
    }

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
  } catch (error) {
    console.error("v1 projexa permit update error:", error)
    return NextResponse.json({ error: "Failed to update this permit" }, { status: 500 })
  }
}

export async function DELETE(request: NextRequest, { params }: RouteContext) {
  const ctx = await requireAuthOrApiKey(request)
  if (ctx.response) return ctx.response
  const roleErr = requireRoleOrScope(ctx, "member", "write")
  if (roleErr) return roleErr
  if (!ctx.orgId) return NextResponse.json({ error: "No organisation on this account" }, { status: 400 })
  const { id } = await params

  try {
    const deleted = await withTenantContext({ orgId: ctx.orgId }, async (db) => {
      const [row] = await db.delete(documents).where(and(eq(documents.id, id), eq(documents.orgId, ctx.orgId!), eq(documents.category, "permit"))).returning({ id: documents.id })
      return row ?? null
    })
    if (!deleted) return NextResponse.json({ error: "Permit not found" }, { status: 404 })
    return NextResponse.json({ deleted: true, id: deleted.id })
  } catch (error) {
    console.error("v1 projexa permit delete error:", error)
    return NextResponse.json({ error: "Failed to delete this permit" }, { status: 500 })
  }
}
