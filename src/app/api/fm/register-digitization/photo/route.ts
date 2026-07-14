import { NextRequest, NextResponse } from "next/server"
import { requireAuth } from "@/lib/supabase/auth-guard"
import { parseAndExtractFromPhoto, ServiceError } from "@/lib/services/fm-register-digitization-service"

// VERI FM & CS AI OS -- minimal entry point wiring the previously-orphaned
// parseAndExtractFromPhoto() (Wave 107) to a real HTTP surface for the
// first time. Reuses /api/documents for the actual file upload/storage
// (same discipline the service file's own header describes -- reuse
// existing plumbing rather than standing up a parallel path); this route
// only takes an already-created documentId plus the same image bytes
// (already in memory client-side for the blur check) and runs extraction.
export async function POST(request: NextRequest) {
  const { response, dbUser, orgId } = await requireAuth()
  if (response) return response
  if (!orgId || !dbUser) return NextResponse.json({ error: "No organisation on this account" }, { status: 400 })

  try {
    const body = await request.json()
    const { documentId, imageBase64, mimeType } = body as { documentId?: string; imageBase64?: string; mimeType?: string }
    if (!documentId || !imageBase64 || !mimeType) {
      return NextResponse.json({ error: "documentId, imageBase64 and mimeType are required" }, { status: 400 })
    }

    const result = await parseAndExtractFromPhoto(
      { orgId, userId: dbUser.id, dbUser },
      { documentId, imageBase64, mimeType }
    )
    return NextResponse.json(result, { status: 201 })
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("FM register photo digitization error:", error)
    return NextResponse.json({ error: "Failed to digitize photo" }, { status: 500 })
  }
}
