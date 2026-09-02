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
import { listDocuments, createDocumentRecord, ServiceError } from "@/lib/services/document-service"
import {
  DRAWING_CATEGORIES,
  categoryFilterForKind,
  categoryForKind,
  matchesDiscipline,
  toDrawingDto,
  type DrawingCategory,
  type DrawingDto,
  type DrawingRow,
} from "@/lib/drawings-register"
import { createClient } from "@supabase/supabase-js"

const BUCKET = "compliance-documents"
const SIGNED_URL_TTL_SECONDS = 300

function getStorageAdminClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )
}

async function signDrawing(doc: DrawingRow, admin: ReturnType<typeof getStorageAdminClient>): Promise<DrawingDto> {
  const isExternalLink = ((doc.metadata ?? {}) as { isExternalLink?: boolean }).isExternalLink === true
  const documentUrl = isExternalLink
    ? doc.fileUrl
    : (await admin.storage.from(BUCKET).createSignedUrl(doc.fileUrl, SIGNED_URL_TTL_SECONDS)).data?.signedUrl ?? null
  return toDrawingDto(doc, documentUrl)
}

export async function GET(request: NextRequest) {
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

  try {
    const admin = getStorageAdminClient()
    const lists = await Promise.all(
      (category ? [category] : [...DRAWING_CATEGORIES]).map((c) =>
        listDocuments({ orgId: ctx.orgId! }, { category: c, linkedEntityType: "project", linkedEntityId: projectId })
      )
    )
    const docs = lists.flat().sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
    const drawings = (await Promise.all(docs.map((doc) => signDrawing(doc, admin)))).filter((d) =>
      matchesDiscipline(d, discipline)
    )
    return NextResponse.json({ drawings })
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("v1 projexa drawings list error:", error)
    return NextResponse.json({ error: "Failed to fetch drawings" }, { status: 500 })
  }
}

export async function POST(request: NextRequest) {
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

    const admin = getStorageAdminClient()
    return NextResponse.json(await signDrawing(doc, admin), { status: 201 })
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("v1 projexa drawings create error:", error)
    return NextResponse.json({ error: "Failed to create drawing" }, { status: 500 })
  }
}
