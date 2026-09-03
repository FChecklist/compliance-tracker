// Wave 143 (PROJEXA Drawings & 3D module): new route, same reuse pattern as
// permits/route.ts -- drawings/3D-walkthrough entries are documents rows
// with category='drawing' (an uploaded DWG file) or category='drawing_3d'
// (a 3D walkthrough, which may be either an uploaded file or an external
// link -- e.g. a Matterport/SketchUp share URL -- hence createDocumentRecord's
// file-or-externalUrl union). No new table: same rationale as permits
// (schema.ts's documents table comment, Wave 117/142) -- a dedicated
// `constructionDrawings` table would fragment retention/versioning/
// auto-classification that this row already gets for free.
import { NextRequest, NextResponse } from "next/server"
import { requireAuthOrApiKey, requireRoleOrScope, requireOrg } from "@/lib/supabase/auth-guard"
import { listDocuments, createDocumentRecord, ServiceError } from "@/lib/services/document-service"
import { signDocumentUrl } from "@/lib/storage/signed-document-url"
import { withRouteTiming } from "@/lib/route-timing"

// R67 F-02 x F-28, reconciled by the integration train. The local
// getStorageAdminClient()/BUCKET/SIGNED_URL_TTL_SECONDS trio is GONE, not
// merged: F-02 moved every signing call in this file onto the shared
// signDocumentUrl() helper (which is also what the on-click
// /drawings/{id}/document-url endpoint uses, so one register row and its own
// detail request cannot disagree about how a URL is signed), and nothing in
// this route constructs a Storage client directly any more. F-28's
// Server-Timing wrapper is untouched by that and is kept as it is on main.

const DRAWING_CATEGORIES = ["drawing", "drawing_3d"] as const
type DrawingCategory = (typeof DRAWING_CATEGORIES)[number]

type DrawingDocRow = { id: string; name: string; category: string | null; metadata: unknown; fileUrl: string; fileType: string | null; createdAt: Date }

// R67 F-02 (R-018/R-021/R-030/R-035), same fix as permits/route.ts: the list
// used to mint one Supabase Storage signed URL per uploaded drawing, inside
// the list request, so a register's first byte waited on N sequential Storage
// round trips and a Storage misconfiguration 500'd the whole register.
//
// An EXTERNAL-LINK row (a Matterport/SketchUp share URL) keeps its
// documentUrl: that value is the stored string itself, costs no I/O, and is
// what the row's link has always pointed at. A storage-backed row reports
// `hasDocument` and the UI fetches its signed URL on click, from
// GET /drawings/{id}/document-url. A register that is external links only
// therefore never constructs the storage admin client at all.
function toDrawingListDto(doc: DrawingDocRow) {
  const metadata = (doc.metadata ?? {}) as { isExternalLink?: boolean; discipline?: string }
  const isExternalLink = !!metadata.isExternalLink
  return {
    id: doc.id,
    name: doc.name,
    kind: doc.category === "drawing_3d" ? "3d_walkthrough" : "dwg",
    discipline: metadata.discipline ?? null,
    isExternalLink,
    fileType: doc.fileType,
    // Present only when it costs nothing to produce -- see above.
    documentUrl: isExternalLink ? doc.fileUrl : null,
    hasDocument: Boolean(doc.fileUrl),
    createdAt: doc.createdAt,
  }
}

// Single-row signing for the create response. A Next.js route.ts may only
// export HTTP method handlers, so the shared version the on-click endpoint
// also uses lives in src/lib/storage/signed-document-url.ts.
async function signOneDrawing(doc: DrawingDocRow): Promise<string | null> {
  const metadata = (doc.metadata ?? {}) as { isExternalLink?: boolean }
  if (metadata.isExternalLink) return doc.fileUrl || null
  return signDocumentUrl(doc.fileUrl, "v1 projexa drawings create")
}

// R67 F-28 (R-249): the exported handler is unchanged in shape -- both CI
// route guards read it with a regex -- and delegates to its original body so
// the response carries Server-Timing: app;dur=<ms> measured HERE. See
// src/lib/route-timing.ts for why the export is not rewritten instead.
export async function GET(...args: Parameters<typeof GET_impl>) {
  return withRouteTiming("GET", () => GET_impl(...args))
}

async function GET_impl(request: NextRequest) {
  const ctx = await requireAuthOrApiKey(request)
  if (ctx.response) return ctx.response
  if (!ctx.orgId) return requireOrg(ctx)!

  const projectId = request.nextUrl.searchParams.get("projectId")
  if (!projectId) return NextResponse.json({ error: "projectId query param is required" }, { status: 400 })
  const kind = request.nextUrl.searchParams.get("kind") // 'dwg' | '3d_walkthrough' | omitted for both
  const category: DrawingCategory | undefined = kind === "3d_walkthrough" ? "drawing_3d" : kind === "dwg" ? "drawing" : undefined

  try {
    const lists = await Promise.all(
      (category ? [category] : [...DRAWING_CATEGORIES]).map((c) =>
        listDocuments({ orgId: ctx.orgId! }, { category: c, linkedEntityType: "project", linkedEntityId: projectId })
      )
    )
    const docs = lists.flat().sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
    // Synchronous now -- no per-row Storage round trip left to await.
    return NextResponse.json({ drawings: docs.map(toDrawingListDto) })
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("v1 projexa drawings list error:", error)
    return NextResponse.json({ error: "Failed to fetch drawings" }, { status: 500 })
  }
}

// R67 F-28 (R-249): the exported handler is unchanged in shape -- both CI
// route guards read it with a regex -- and delegates to its original body so
// the response carries Server-Timing: app;dur=<ms> measured HERE. See
// src/lib/route-timing.ts for why the export is not rewritten instead.
export async function POST(...args: Parameters<typeof POST_impl>) {
  return withRouteTiming("POST", () => POST_impl(...args))
}

async function POST_impl(request: NextRequest) {
  const ctx = await requireAuthOrApiKey(request)
  if (ctx.response) return ctx.response
  const roleErr = requireRoleOrScope(ctx, "member", "write")
  if (roleErr) return roleErr
  // R39/R-C14: ctx.apiKey?.id is not a real compliance.users row -- see
  // documents.uploadedById's schema.ts comment for the real production FK
  // violation this fallback caused.
  const actorId = ctx.dbUser?.id ?? null
  if (!ctx.orgId) return NextResponse.json({ error: "No organisation on this account" }, { status: 400 })

  try {
    const formData = await request.formData()
    const projectId = (formData.get("projectId") as string | null)?.trim()
    if (!projectId) return NextResponse.json({ error: "projectId is required" }, { status: 400 })
    const kind = (formData.get("kind") as string | null) || "dwg" // 'dwg' | '3d_walkthrough'
    const category: DrawingCategory = kind === "3d_walkthrough" ? "drawing_3d" : "drawing"
    const discipline = (formData.get("discipline") as string | null) || null
    const externalUrl = (formData.get("externalUrl") as string | null) || null
    const file = formData.get("file")
    const name = (formData.get("name") as string | null)?.trim() || (file instanceof File ? file.name : null)
    if (!name) return NextResponse.json({ error: "name is required" }, { status: 400 })

    if (!(file instanceof File) && !externalUrl) {
      return NextResponse.json({ error: "Either a file or externalUrl is required" }, { status: 400 })
    }
    if (category === "drawing" && !(file instanceof File)) {
      return NextResponse.json({ error: "DWG drawings require a file upload" }, { status: 400 })
    }

    const doc = await createDocumentRecord({ orgId: ctx.orgId, userId: actorId }, {
      name, category,
      linkedEntityType: "project", linkedEntityId: projectId,
      metadata: { discipline },
      ...(file instanceof File ? { file } : { externalUrl: externalUrl! }),
    })

    return NextResponse.json(
      { ...toDrawingListDto(doc), documentUrl: await signOneDrawing(doc) },
      { status: 201 }
    )
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("v1 projexa drawings create error:", error)
    return NextResponse.json({ error: "Failed to create drawing" }, { status: 500 })
  }
}
