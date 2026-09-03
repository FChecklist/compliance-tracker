// Wave 143 (PROJEXA Drawings & 3D module): new route, same reuse pattern as
// permits/route.ts -- drawings/3D-walkthrough entries are documents rows
// with category='drawing' (an uploaded DWG file) or category='drawing_3d'
// (a 3D walkthrough, which may be either an uploaded file or an external
// link -- e.g. a Matterport/SketchUp share URL -- hence createDocumentRecord's
// file-or-externalUrl union). No new table: same rationale as permits
// (schema.ts's documents table comment, Wave 117/142) -- a dedicated
// `constructionDrawings` table would fragment retention/versioning/
// auto-classification that this row already gets for free.
//
// R67 D-10: the register's own vocabulary (what a Kind is, what the Discipline
// filter keeps, what a row looks like) now lives in src/lib/drawings-register.ts
// and is shared with the export route and the single-drawing route, so three
// endpoints cannot drift into three answers. This route keeps what only a route
// should hold: the service-role storage client that signs a file URL.
import { NextRequest, NextResponse } from "next/server"
import { requireAuthOrApiKey, requireRoleOrScope, requireOrg } from "@/lib/supabase/auth-guard"
import { listDocuments, createDrawingRecord, ServiceError } from "@/lib/services/document-service"
import {
  DRAWING_CATEGORIES,
  DRAWING_STATUSES,
  categoryFilterForKind,
  categoryForKind,
  matchesDiscipline,
  matchesStatus,
  toDrawingDto,
  type DrawingCategory,
  type DrawingDto,
  type DrawingRow,
} from "@/lib/drawings-register"
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

// R67 MERGE (D-11, lane D1 x lane F1, 2026-09-03). F-02 and D-12 both rewrote
// this shaping, for different reasons, and BOTH rules survive here:
//
//   * F-02 (R-018/R-021/R-030/R-035): the list no longer mints one Supabase
//     Storage signed URL per uploaded drawing. A register's first byte used to
//     wait on N sequential Storage round trips, and a Storage misconfiguration
//     500'd the whole register. An EXTERNAL-LINK row keeps its documentUrl --
//     that value is the stored string itself and costs no I/O -- while a
//     storage-backed row reports hasDocument and the UI fetches its signed URL
//     on click from GET /drawings/{id}/document-url.
//   * D-12: the row shape is the SHARED toDrawingDto() in
//     src/lib/drawings-register.ts, so the register's four new fields
//     (drawingNo, rev, status, supersedesId) are present and the list, the
//     object page and the export cannot disagree about a drawing.
//
// The two compose because toDrawingDto() takes documentUrl as a PARAMETER
// rather than resolving it -- which is exactly what that signature is for.
function toDrawingListDto(doc: DrawingRow): DrawingDto & { hasDocument: boolean } {
  const dto = toDrawingDto(doc, null)
  return {
    ...dto,
    // Present only when it costs nothing to produce -- see above.
    documentUrl: dto.isExternalLink ? doc.fileUrl : null,
    hasDocument: Boolean(doc.fileUrl),
  }
}

// Single-row signing for the create response. A Next.js route.ts may only
// export HTTP method handlers, so the shared version the on-click endpoint
// also uses lives in src/lib/storage/signed-document-url.ts.
// R67 merge (D-11, D1 x F1): typed against the shared DrawingRow now, since
// F1's local DrawingDocRow was folded into src/lib/drawings-register.ts's own
// row type at this merge -- one description of a drawing row, not two.
async function signOneDrawing(doc: DrawingRow): Promise<string | null> {
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
  const category = categoryFilterForKind(request.nextUrl.searchParams.get("kind"))
  // R67 D-10: the register's Filter offers Kind AND Discipline. Discipline
  // lives in the metadata jsonb, so it is applied to this project's own rows
  // rather than as a WHERE clause -- see matchesDiscipline's own comment.
  const discipline = request.nextUrl.searchParams.get("discipline")
  // R67 D-12: the register's "Current only" chip, which the screen turns on by
  // default so the list shows the build set. Omitted (or "all") means every
  // state, so no existing caller loses rows.
  const status = request.nextUrl.searchParams.get("status")

  try {
    const lists = await Promise.all(
      (category ? [category] : [...DRAWING_CATEGORIES]).map((c) =>
        listDocuments({ orgId: ctx.orgId! }, { category: c, linkedEntityType: "project", linkedEntityId: projectId })
      )
    )
    const docs = lists.flat().sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
    // Synchronous now -- no per-row Storage round trip left to await (F-02),
    // and still filtered by D-10's Discipline and D-12's "Current only".
    const drawings = docs.map(toDrawingListDto).filter(
      (d) => matchesDiscipline(d, discipline) && matchesStatus(d, status)
    )
    return NextResponse.json({ drawings })
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
    const category: DrawingCategory = categoryForKind(kind)
    const discipline = (formData.get("discipline") as string | null) || null
    const externalUrl = (formData.get("externalUrl") as string | null) || null
    // R67 D-12: the register fields. An unknown status is refused rather than
    // stored -- a status nobody can filter on is worse than none.
    const drawingNo = (formData.get("drawingNo") as string | null) || null
    const rev = (formData.get("rev") as string | null) || null
    const rawStatus = (formData.get("status") as string | null) || null
    if (rawStatus && !(DRAWING_STATUSES as readonly string[]).includes(rawStatus)) {
      return NextResponse.json({ error: `status must be one of ${DRAWING_STATUSES.join(", ")}` }, { status: 400 })
    }
    const file = formData.get("file")
    const name = (formData.get("name") as string | null)?.trim() || (file instanceof File ? file.name : null)
    if (!name) return NextResponse.json({ error: "name is required" }, { status: 400 })

    if (!(file instanceof File) && !externalUrl) {
      return NextResponse.json({ error: "Either a file or externalUrl is required" }, { status: 400 })
    }
    if (category === "drawing" && !(file instanceof File)) {
      return NextResponse.json({ error: "DWG drawings require a file upload" }, { status: 400 })
    }

    // R67 D-12: createDrawingRecord, not createDocumentRecord -- the supersede
    // of the previous 'current' revision has to happen in the SAME transaction
    // as the insert (see the service's own comment).
    const doc = await createDrawingRecord({ orgId: ctx.orgId, userId: actorId }, {
      name, category, projectId, discipline, drawingNo, rev,
      ...(rawStatus ? { status: rawStatus as (typeof DRAWING_STATUSES)[number] } : {}),
      ...(file instanceof File ? { file } : { externalUrl: externalUrl! }),
    })

    // The create response DOES sign, once, for the row just made -- the client
    // opens it immediately, so deferring it here would only add a round trip.
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
