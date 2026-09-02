// R67 F-02 (R-018/R-021/R-030/R-035). The drawings register no longer mints a
// Supabase Storage signed URL per row (see ../../route.ts): it reports
// `hasDocument`, and this is where the URL is minted -- once, for the one
// drawing a human just clicked. Permits already had an equivalent: its
// register's rows resolve through the existing GET /permits/{id} object DTO,
// which signs exactly one URL. Drawings has no [id] detail route, so this
// narrow endpoint is that route's stand-in rather than a second detail DTO.
//
// Scoped identically to the register itself: the document must belong to the
// caller's org AND be one of the two drawing categories, so this cannot be
// used to fish a signed URL for an arbitrary document id.
import { NextRequest, NextResponse } from "next/server"
import { and, eq, inArray } from "drizzle-orm"
import { requireAuthOrApiKey, requireOrg } from "@/lib/supabase/auth-guard"
import { withTenantContext } from "@/lib/db/tenant-scoped"
import { documents } from "@/lib/db/schema"
import { signDocumentUrl } from "@/lib/storage/signed-document-url"

type RouteContext = { params: Promise<{ id: string }> }

export async function GET(request: NextRequest, { params }: RouteContext) {
  const ctx = await requireAuthOrApiKey(request)
  if (ctx.response) return ctx.response
  if (!ctx.orgId) return requireOrg(ctx)!
  const { id } = await params

  try {
    const doc = await withTenantContext({ orgId: ctx.orgId }, (db) =>
      db.query.documents.findFirst({
        where: and(
          eq(documents.id, id),
          eq(documents.orgId, ctx.orgId!),
          inArray(documents.category, ["drawing", "drawing_3d"])
        ),
        columns: { id: true, fileUrl: true, metadata: true },
      })
    )
    if (!doc) return NextResponse.json({ error: "Drawing not found" }, { status: 404 })

    const metadata = (doc.metadata ?? {}) as { isExternalLink?: boolean }
    // An external link is already a URL -- nothing to sign, no Storage call.
    const documentUrl = metadata.isExternalLink
      ? doc.fileUrl || null
      : await signDocumentUrl(doc.fileUrl, "v1 projexa drawings document-url")

    if (!documentUrl) {
      // Honest, specific, and NOT a 500: the row is fine, its file link is
      // not. The client shows this sentence rather than a blank link.
      return NextResponse.json(
        { error: "This drawing's file could not be opened right now. Please retry." },
        { status: 502 }
      )
    }
    return NextResponse.json({ documentUrl, isExternalLink: !!metadata.isExternalLink })
  } catch (error) {
    console.error("v1 projexa drawing document-url error:", error)
    return NextResponse.json({ error: "Failed to resolve the drawing's document link" }, { status: 500 })
  }
}
