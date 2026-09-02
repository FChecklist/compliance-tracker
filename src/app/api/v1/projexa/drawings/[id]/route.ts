// R67 D-11 (audit R-024/R-029). Two gaps on one screen, both of them here.
//
// EDIT: the drawing object page had none at all -- its own header comment said
// so ("No Edit: updateDocumentMetadata() doesn't accept a metadata/discipline
// patch"). It does now (document-service.ts), so this route exposes it: PATCH
// name, discipline and category for a drawing, and nothing else.
//
// REMOVE: the page's only destructive action was Dispose, which is gated on
// records-management fields, so a drawing uploaded a minute ago with a null
// disposalDate reported "No retention policy set" and its own uploader could
// not undo his own mistake. DELETE here is the grace-window hard delete: within
// RECENT_WINDOW_HOURS of upload, with nothing referencing the row, the row AND
// its storage object go. Everything outside that window still goes through
// Dispose and the retention policy, untouched.
import { NextRequest, NextResponse } from "next/server"
import { and, eq, or, sql } from "drizzle-orm"
import { documents, projects } from "@/lib/db"
import { withTenantContext } from "@/lib/db/tenant-scoped"
import { requireAuthOrApiKey, requireRoleOrScope, requireOrg } from "@/lib/supabase/auth-guard"
import { updateDocumentMetadata, ServiceError } from "@/lib/services/document-service"
import { isDrawingCategory, isRecentDrawing, readDrawingMetadata, toDrawingDto } from "@/lib/drawings-register"
import { createClient } from "@supabase/supabase-js"

const BUCKET = "compliance-documents"
// The object screen's own file link, longer-lived than the list's 5-minute
// row URLs -- same figure permits/[id]/route.ts uses, for the same reason.
const SIGNED_URL_TTL_SECONDS = 3600

type RouteContext = { params: Promise<{ id: string }> }

function getStorageAdminClient() {
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)
}

/**
 * Everything the object screen needs to decide what it may offer, resolved in
 * ONE tenant transaction: the row, the project it belongs to (so a confirm can
 * name it), and how many other records point at it.
 */
async function loadDrawing(orgId: string, id: string) {
  return withTenantContext({ orgId }, async (db) => {
    const doc = await db.query.documents.findFirst({ where: and(eq(documents.id, id), eq(documents.orgId, orgId)) })
    if (!doc || !isDrawingCategory(doc.category)) return null

    const project = doc.linkedEntityId
      ? await db.query.projects.findFirst({
          where: and(eq(projects.id, doc.linkedEntityId), eq(projects.orgId, orgId)),
          columns: { id: true, name: true },
        })
      : null

    // What "references" means, stated rather than assumed: a later version of
    // this drawing (parentDocumentId), or any document filed AGAINST it
    // (linkedEntityType='drawing'). Both are rows that would be orphaned by a
    // hard delete, which is exactly what the grace window must refuse.
    const [{ count }] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(documents)
      .where(
        and(
          eq(documents.orgId, orgId),
          or(
            eq(documents.parentDocumentId, id),
            and(eq(documents.linkedEntityType, "drawing"), eq(documents.linkedEntityId, id))
          )
        )
      )

    // R67 D-12: the revision this one replaced, so the object page can offer a
    // "Supersedes" facet that actually goes somewhere. Resolved in this same
    // transaction rather than as a second round trip from the browser.
    const supersedesId = readDrawingMetadata(doc.metadata).supersedesId
    const supersedes = supersedesId
      ? await db.query.documents.findFirst({
          where: and(eq(documents.id, supersedesId), eq(documents.orgId, orgId)),
          columns: { id: true, name: true, metadata: true },
        })
      : null

    return { doc, project, references: count ?? 0, supersedes: supersedes ?? null }
  })
}

async function toObjectDto(loaded: NonNullable<Awaited<ReturnType<typeof loadDrawing>>>) {
  const { doc, project, references, supersedes } = loaded
  const isExternalLink = ((doc.metadata ?? {}) as { isExternalLink?: boolean }).isExternalLink === true
  let documentUrl: string | null = null
  if (isExternalLink) {
    documentUrl = doc.fileUrl
  } else if (doc.fileUrl && !doc.isDisposed) {
    const admin = getStorageAdminClient()
    documentUrl = (await admin.storage.from(BUCKET).createSignedUrl(doc.fileUrl, SIGNED_URL_TTL_SECONDS)).data?.signedUrl ?? null
  }
  return {
    ...toDrawingDto(doc, documentUrl),
    category: doc.category,
    projectId: project?.id ?? doc.linkedEntityId,
    projectName: project?.name ?? null,
    isDisposed: doc.isDisposed,
    legalHold: doc.legalHold,
    disposalDate: doc.disposalDate,
    // R67 D-11: the two facts the screen's Remove gate is built from, computed
    // here rather than inferred in the browser from a createdAt string.
    isRecent: isRecentDrawing(doc.createdAt),
    references,
    versionNumber: doc.versionNumber,
    // The raw fields, not a formatted label: how a drawing is named on screen is
    // the screen's decision (projexa's drawingLabel), and formatting it twice in
    // two repos is how the two start disagreeing.
    supersedes: supersedes
      ? {
          id: supersedes.id,
          name: supersedes.name,
          drawingNo: readDrawingMetadata(supersedes.metadata).drawingNo,
          rev: readDrawingMetadata(supersedes.metadata).rev,
        }
      : null,
    expiresInSeconds: SIGNED_URL_TTL_SECONDS,
  }
}

export async function GET(request: NextRequest, { params }: RouteContext) {
  const ctx = await requireAuthOrApiKey(request)
  if (ctx.response) return ctx.response
  if (!ctx.orgId) return requireOrg(ctx)!

  try {
    const { id } = await params
    const loaded = await loadDrawing(ctx.orgId, id)
    if (!loaded) return NextResponse.json({ error: "Drawing not found" }, { status: 404 })
    return NextResponse.json(await toObjectDto(loaded))
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("v1 projexa drawing get error:", error)
    return NextResponse.json({ error: "Failed to retrieve this drawing" }, { status: 500 })
  }
}

export async function PATCH(request: NextRequest, { params }: RouteContext) {
  const ctx = await requireAuthOrApiKey(request)
  if (ctx.response) return ctx.response
  const roleErr = requireRoleOrScope(ctx, "member", "write")
  if (roleErr) return roleErr
  if (!ctx.orgId) return NextResponse.json({ error: "No organisation on this account" }, { status: 400 })

  try {
    const { id } = await params
    const body = await request.json().catch(() => ({}))
    if (body.category !== undefined && !isDrawingCategory(body.category)) {
      return NextResponse.json({ error: "A drawing's category must be drawing or drawing_3d" }, { status: 400 })
    }

    const existing = await loadDrawing(ctx.orgId, id)
    if (!existing) return NextResponse.json({ error: "Drawing not found" }, { status: 404 })

    await updateDocumentMetadata({ orgId: ctx.orgId, userId: ctx.dbUser?.id ?? ctx.apiKey!.id }, id, {
      ...(typeof body.name === "string" ? { name: body.name } : {}),
      ...(body.category !== undefined ? { category: body.category } : {}),
      // Only the drawing-specific keys are forwarded: a PATCH must not be able
      // to overwrite isExternalLink (which decides whether fileUrl is a storage
      // path or a URL) or any other key the service merges around.
      ...(body.discipline !== undefined ? { metadata: { discipline: body.discipline || null } } : {}),
    })

    // Re-select rather than trusting UPDATE ... RETURNING alone (E-52), and so
    // the response carries the same shape GET does.
    const reloaded = await loadDrawing(ctx.orgId, id)
    if (!reloaded) return NextResponse.json({ error: "Drawing not found" }, { status: 404 })
    return NextResponse.json(await toObjectDto(reloaded))
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("v1 projexa drawing update error:", error)
    return NextResponse.json({ error: "Failed to update this drawing" }, { status: 500 })
  }
}

export async function DELETE(request: NextRequest, { params }: RouteContext) {
  const ctx = await requireAuthOrApiKey(request)
  if (ctx.response) return ctx.response
  const roleErr = requireRoleOrScope(ctx, "member", "write")
  if (roleErr) return roleErr
  if (!ctx.orgId) return NextResponse.json({ error: "No organisation on this account" }, { status: 400 })

  try {
    const { id } = await params
    const loaded = await loadDrawing(ctx.orgId, id)
    if (!loaded) return NextResponse.json({ error: "Drawing not found" }, { status: 404 })
    const { doc, references } = loaded

    // The same three gates the screen states as reasons, enforced here too --
    // a disabled button is a courtesy, not a permission system.
    if (doc.legalHold) {
      return NextResponse.json({ error: "This drawing is on legal hold and cannot be removed" }, { status: 409 })
    }
    if (!isRecentDrawing(doc.createdAt)) {
      return NextResponse.json(
        { error: "This drawing is past its first 24 hours; it is kept under the retention policy and can only be disposed" },
        { status: 409 }
      )
    }
    if (references > 0) {
      return NextResponse.json(
        { error: `${references} other record${references === 1 ? "" : "s"} reference this drawing, so it cannot be removed` },
        { status: 409 }
      )
    }

    const isExternalLink = ((doc.metadata ?? {}) as { isExternalLink?: boolean }).isExternalLink === true

    const deleted = await withTenantContext({ orgId: ctx.orgId }, async (db) => {
      const [row] = await db
        .delete(documents)
        .where(and(eq(documents.id, id), eq(documents.orgId, ctx.orgId!)))
        .returning({ id: documents.id })
      return row ?? null
    })
    if (!deleted) return NextResponse.json({ error: "Drawing not found" }, { status: 404 })

    // The file goes with the row -- a hard delete that left the bytes behind
    // would be a promise this product did not keep. Best-effort AFTER the row
    // is gone and logged when it fails: an orphaned object is a storage cost,
    // whereas a row pointing at a deleted object is a broken screen.
    if (!isExternalLink && doc.fileUrl) {
      const admin = getStorageAdminClient()
      const { error: storageError } = await admin.storage.from(BUCKET).remove([doc.fileUrl])
      if (storageError) console.error("v1 projexa drawing delete: storage object not removed:", doc.fileUrl, storageError)
    }

    return NextResponse.json({ deleted: true, id: deleted.id })
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("v1 projexa drawing delete error:", error)
    return NextResponse.json({ error: "Failed to remove this drawing" }, { status: 500 })
  }
}
