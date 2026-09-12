import { NextRequest, NextResponse } from "next/server"
import { requireAuth, requireRole } from "@/lib/supabase/auth-guard"
import { translatePromptVersion, listPromptTranslations, ServiceError } from "@/lib/services/prompt-translation-service"

// VERIDIAN_Architecture_v2.0 phase_8: engine-prompt-translation.
export async function GET(request: NextRequest) {
  const { response } = await requireAuth()
  if (response) return response

  const versionId = request.nextUrl.searchParams.get("versionId")
  if (!versionId) return NextResponse.json({ error: "versionId is required" }, { status: 400 })

  try {
    const translations = await listPromptTranslations(versionId)
    return NextResponse.json({ translations })
  } catch (error) {
    console.error("Prompt translations list error:", error)
    return NextResponse.json({ error: "Failed to fetch prompt translations" }, { status: 500 })
  }
}

export async function POST(request: NextRequest) {
  const { response, dbUser } = await requireAuth()
  if (response) return response
  if (!dbUser) return NextResponse.json({ error: "No user found" }, { status: 400 })

  const roleCheck = requireRole(dbUser, "veridian_admin")
  if (roleCheck) return roleCheck

  try {
    const body = await request.json()
    const result = await translatePromptVersion({ userId: dbUser.id, dbUser }, body)
    return NextResponse.json(result, { status: 201 })
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("Prompt translation error:", error)
    return NextResponse.json({ error: "Failed to translate prompt version" }, { status: 500 })
  }
}
