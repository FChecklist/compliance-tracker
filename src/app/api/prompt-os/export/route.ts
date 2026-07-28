import { NextRequest, NextResponse } from "next/server"
import { requireAuth } from "@/lib/supabase/auth-guard"
import { exportPromptBundle, ServiceError } from "@/lib/services/prompt-export-import-service"

// VERIDIAN_Architecture_v2.0 phase_8: engine-prompt-export. Read-only, no
// admin gate (same posture as GET /api/settings/prompts' listPromptVersions
// -- exporting a template a user can already read via that endpoint grants
// no new access).
export async function GET(request: NextRequest) {
  const { response } = await requireAuth()
  if (response) return response

  const templateKey = request.nextUrl.searchParams.get("templateKey")
  if (!templateKey) return NextResponse.json({ error: "templateKey is required" }, { status: 400 })

  try {
    const bundle = await exportPromptBundle(templateKey)
    return NextResponse.json(bundle)
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("Prompt export error:", error)
    return NextResponse.json({ error: "Failed to export prompt bundle" }, { status: 500 })
  }
}
