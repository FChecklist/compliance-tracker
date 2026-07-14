// Priority 13 (Permits as a first-class module): thin alias over
// document-service.ts's listExpiringDocuments(ctx, withinDays, 'permit').
// Permit data already has a home -- the generic documents table with
// category='permit' and permitAuthority/permitNumber in its metadata jsonb
// column (Wave 117) -- but the only existing reader, /api/documents/expiring,
// uses cookie-based requireAuth(), which PROJEXA's Bearer-token
// callVeridian() client cannot use. This route is the requireAuthOrApiKey
// twin of that route, permit-scoped by default.
//
// Document bytes live in a private Supabase Storage bucket with no anon
// access at all (see /api/documents/[id]/route.ts) -- a caller reading this
// list still needs a real, short-lived signed URL per document, so this
// route generates one per row the same way that route does. That's the one
// piece of logic beyond a pure alias; everything else (which documents
// qualify, how "expiring" is computed) stays entirely inside
// listExpiringDocuments.
import { NextRequest, NextResponse } from "next/server"
import { requireAuthOrApiKey } from "@/lib/supabase/auth-guard"
import { listExpiringDocuments, ServiceError } from "@/lib/services/document-service"
import { createClient } from "@supabase/supabase-js"

const BUCKET = "compliance-documents"
const SIGNED_URL_TTL_SECONDS = 300 // matches /api/documents/[id]/route.ts

function getStorageAdminClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )
}

export async function GET(request: NextRequest) {
  const ctx = await requireAuthOrApiKey(request)
  if (ctx.response) return ctx.response
  if (!ctx.orgId) return NextResponse.json({ permits: [] })

  try {
    const { searchParams } = request.nextUrl
    const withinDaysRaw = searchParams.get("withinDays")
    const withinDays = withinDaysRaw ? Number(withinDaysRaw) : 30

    const docs = await listExpiringDocuments({ orgId: ctx.orgId }, withinDays, "permit")

    const admin = getStorageAdminClient()
    const now = Date.now()
    const permits = await Promise.all(
      docs.map(async (doc) => {
        const metadata = (doc.metadata ?? {}) as { permitAuthority?: string; permitNumber?: string }
        const { data } = await admin.storage.from(BUCKET).createSignedUrl(doc.fileUrl, SIGNED_URL_TTL_SECONDS)
        const daysToExpiry = doc.expiryDate ? Math.ceil((new Date(doc.expiryDate).getTime() - now) / (1000 * 60 * 60 * 24)) : null
        return {
          id: doc.id,
          name: doc.name,
          permitNumber: metadata.permitNumber ?? null,
          permitAuthority: metadata.permitAuthority ?? null,
          expiryDate: doc.expiryDate,
          daysToExpiry,
          documentUrl: data?.signedUrl ?? null,
        }
      })
    )
    return NextResponse.json({ permits })
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("v1 projexa permits list error:", error)
    return NextResponse.json({ error: "Failed to fetch permits" }, { status: 500 })
  }
}
