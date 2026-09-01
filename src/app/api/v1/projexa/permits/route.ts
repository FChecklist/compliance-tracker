// Priority 13 (Permits as a first-class module): thin alias over
// document-service.ts's listExpiringDocuments(ctx, withinDays, 'permit').
// Permit data already has a home -- the generic documents table with
// category='permit' and permitAuthority/permitNumber in its metadata jsonb
// column (Wave 117) -- but the only existing reader, /api/documents/expiring,
// uses cookie-based requireAuth(), which PROJEXA's Bearer-token
// callVeridian() client cannot use. This route is the requireAuthOrApiKey
// twin of that route, permit-scoped by default.
//
// Wave 143 (PROJEXA Permits real create+list): the original GET only ever
// covered "expiring soon", org-wide -- no way to list ALL of one project's
// permits (a freshly-created permit wouldn't show up until it was near
// expiry), and no create route existed via this Bearer-key surface at all.
// Both gaps closed here: `projectId` scopes the list to one project (via
// documents.linkedEntityType='project'/linkedEntityId), and `all=true`
// returns every permit for that project rather than only the ones expiring
// within `withinDays`. POST creates a new permit the same way -- a PDF
// upload plus permit name/issue date/end date, matching the real
// field-level spec (not invented fields).
//
// Document bytes live in a private Supabase Storage bucket with no anon
// access at all (see /api/documents/[id]/route.ts) -- a caller reading this
// list still needs a real, short-lived signed URL per document, so this
// route generates one per row the same way that route does. That's the one
// piece of logic beyond a pure alias; everything else (which documents
// qualify, how "expiring" is computed) stays entirely inside
// listExpiringDocuments/listDocuments.
import { NextRequest, NextResponse } from "next/server"
import { requireAuthOrApiKey, requireRoleOrScope, requireOrg } from "@/lib/supabase/auth-guard"
import { listExpiringDocuments, listDocuments, createDocumentRecord, ServiceError } from "@/lib/services/document-service"
import { createClient } from "@supabase/supabase-js"

const BUCKET = "compliance-documents"
const SIGNED_URL_TTL_SECONDS = 300 // matches /api/documents/[id]/route.ts

function getStorageAdminClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )
}

async function toPermitDto(doc: { id: string; name: string; metadata: unknown; expiryDate: Date | string | null; fileUrl: string }, admin: ReturnType<typeof getStorageAdminClient>) {
  const metadata = (doc.metadata ?? {}) as { permitAuthority?: string; permitNumber?: string; issueDate?: string }
  const { data } = await admin.storage.from(BUCKET).createSignedUrl(doc.fileUrl, SIGNED_URL_TTL_SECONDS)
  const now = Date.now()
  const daysToExpiry = doc.expiryDate ? Math.ceil((new Date(doc.expiryDate).getTime() - now) / (1000 * 60 * 60 * 24)) : null
  return {
    id: doc.id,
    name: doc.name,
    permitNumber: metadata.permitNumber ?? null,
    permitAuthority: metadata.permitAuthority ?? null,
    issueDate: metadata.issueDate ?? null,
    endDate: doc.expiryDate,
    expiryDate: doc.expiryDate, // back-compat alias for `endDate` -- see docs/API_CHANGELOG.md's permits field-rename entry
    daysToExpiry,
    documentUrl: data?.signedUrl ?? null,
  }
}

export async function GET(request: NextRequest) {
  const ctx = await requireAuthOrApiKey(request)
  if (ctx.response) return ctx.response
  if (!ctx.orgId) return requireOrg(ctx)!

  try {
    const { searchParams } = request.nextUrl
    const projectId = searchParams.get("projectId") ?? undefined
    const admin = getStorageAdminClient()

    let docs
    if (searchParams.get("all") === "true") {
      docs = await listDocuments({ orgId: ctx.orgId }, { category: "permit", linkedEntityType: projectId ? "project" : undefined, linkedEntityId: projectId })
    } else {
      const withinDaysRaw = searchParams.get("withinDays")
      const withinDays = withinDaysRaw ? Number(withinDaysRaw) : 30
      docs = await listExpiringDocuments({ orgId: ctx.orgId }, withinDays, "permit", projectId)
    }

    const permits = await Promise.all(docs.map((doc) => toPermitDto(doc, admin)))
    return NextResponse.json({ permits })
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("v1 projexa permits list error:", error)
    return NextResponse.json({ error: "Failed to fetch permits" }, { status: 500 })
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
    const file = formData.get("file")
    if (!(file instanceof File)) return NextResponse.json({ error: "A PDF file is required" }, { status: 400 })

    const name = (formData.get("name") as string | null)?.trim()
    if (!name) return NextResponse.json({ error: "Permit name is required" }, { status: 400 })
    const projectId = (formData.get("projectId") as string | null)?.trim()
    if (!projectId) return NextResponse.json({ error: "projectId is required" }, { status: 400 })
    const issueDate = (formData.get("issueDate") as string | null) || null
    const endDate = (formData.get("endDate") as string | null) || null
    const permitAuthority = (formData.get("permitAuthority") as string | null) || null
    const permitNumber = (formData.get("permitNumber") as string | null) || null

    const doc = await createDocumentRecord({ orgId: ctx.orgId, userId: actorId }, {
      name, file, category: "permit",
      expiryDate: endDate,
      linkedEntityType: "project", linkedEntityId: projectId,
      metadata: { permitAuthority, permitNumber, issueDate },
    })

    const admin = getStorageAdminClient()
    return NextResponse.json(await toPermitDto(doc, admin), { status: 201 })
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("v1 projexa permits create error:", error)
    return NextResponse.json({ error: "Failed to create permit" }, { status: 500 })
  }
}
