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
import { createClient } from "@supabase/supabase-js"
import { withRouteTiming } from "@/lib/route-timing"

const BUCKET = "compliance-documents"
const SIGNED_URL_TTL_SECONDS = 300

function getStorageAdminClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )
}

const DRAWING_CATEGORIES = ["drawing", "drawing_3d"] as const
type DrawingCategory = (typeof DRAWING_CATEGORIES)[number]

async function toDrawingDto(
  doc: { id: string; name: string; category: string | null; metadata: unknown; fileUrl: string; fileType: string | null; createdAt: Date },
  admin: ReturnType<typeof getStorageAdminClient>
) {
  const metadata = (doc.metadata ?? {}) as { isExternalLink?: boolean; discipline?: string }
  const documentUrl = metadata.isExternalLink
    ? doc.fileUrl
    : (await admin.storage.from(BUCKET).createSignedUrl(doc.fileUrl, SIGNED_URL_TTL_SECONDS)).data?.signedUrl ?? null
  return {
    id: doc.id,
    name: doc.name,
    kind: doc.category === "drawing_3d" ? "3d_walkthrough" : "dwg",
    discipline: metadata.discipline ?? null,
    isExternalLink: !!metadata.isExternalLink,
    fileType: doc.fileType,
    documentUrl,
    createdAt: doc.createdAt,
  }
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
    const admin = getStorageAdminClient()
    const lists = await Promise.all(
      (category ? [category] : [...DRAWING_CATEGORIES]).map((c) =>
        listDocuments({ orgId: ctx.orgId! }, { category: c, linkedEntityType: "project", linkedEntityId: projectId })
      )
    )
    const docs = lists.flat().sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
    const drawings = await Promise.all(docs.map((doc) => toDrawingDto(doc, admin)))
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

    const admin = getStorageAdminClient()
    return NextResponse.json(await toDrawingDto(doc, admin), { status: 201 })
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("v1 projexa drawings create error:", error)
    return NextResponse.json({ error: "Failed to create drawing" }, { status: 500 })
  }
}
