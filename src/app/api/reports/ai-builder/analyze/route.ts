import { NextRequest, NextResponse } from "next/server"
import { requireAuth, requireRole } from "@/lib/supabase/auth-guard"
import { proposeReportFromUpload, ServiceError } from "@/lib/services/ai-report-builder-service"

const MAX_FILE_SIZE = 10 * 1024 * 1024 // matches gst-reconciliation/import's own upload cap

export async function POST(request: NextRequest) {
  const { response, dbUser, orgId } = await requireAuth()
  if (response) return response
  if (!orgId || !dbUser) return NextResponse.json({ error: "No organisation found" }, { status: 400 })

  // R75 Part 2 Phase 5 (G4 reports): this triggers a real, costly AI vision/
  // text call over an uploaded file with no role floor at all. Matches
  // construction/ai/estimate-progress's own requireRole(dbUser, "member")
  // gate (R75 Phase 5 G1) -- the same class of action, an AI call consuming
  // org/user-supplied data, gated at the same minimum.
  const roleCheck = requireRole(dbUser, "member")
  if (roleCheck) return roleCheck

  try {
    const formData = await request.formData()
    const file = formData.get("file") as File | null
    if (!file) return NextResponse.json({ error: "No file provided" }, { status: 400 })
    if (file.size > MAX_FILE_SIZE) return NextResponse.json({ error: "File too large (max 10 MB)" }, { status: 400 })

    const buffer = Buffer.from(await file.arrayBuffer())
    const result = await proposeReportFromUpload(
      { orgId, userId: dbUser.id },
      { buffer, mimeType: file.type, fileName: file.name }
    )
    return NextResponse.json({ ...result, fileName: file.name })
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("AI report builder analyze error:", error)
    return NextResponse.json({ error: "Failed to analyze the uploaded file" }, { status: 500 })
  }
}
