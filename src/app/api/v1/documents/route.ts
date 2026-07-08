// Wave 119: read-only for now. File upload (multipart + Supabase Storage)
// stays internal-only -- the internal POST /api/documents handler has
// ~120 lines of upload/versioning logic that was never extracted into
// document-service.ts, so duplicating it here rather than refactoring it
// out first would be a real behavioral-drift risk. Listing/searching what's
// already there (drawings, permits, site photos by category) is what
// PROJEXA needs first; upload-via-v1 is a natural, separately-scoped follow-up.
import { NextRequest, NextResponse } from "next/server"
import { requireAuthOrApiKey } from "@/lib/supabase/auth-guard"
import { listDocuments, ServiceError } from "@/lib/services/document-service"

export async function GET(request: NextRequest) {
  const ctx = await requireAuthOrApiKey(request)
  if (ctx.response) return ctx.response
  if (!ctx.orgId) return NextResponse.json({ documents: [] })

  try {
    const { searchParams } = request.nextUrl
    const docs = await listDocuments({ orgId: ctx.orgId }, {
      category: searchParams.get("category") ?? undefined,
      linkedEntityType: searchParams.get("linkedEntityType") ?? undefined,
      linkedEntityId: searchParams.get("linkedEntityId") ?? undefined,
    })
    return NextResponse.json({ documents: docs })
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("v1 documents list error:", error)
    return NextResponse.json({ error: "Failed to fetch documents" }, { status: 500 })
  }
}
