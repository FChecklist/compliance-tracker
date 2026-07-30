import { NextRequest, NextResponse } from "next/server"
import { requireAuth } from "@/lib/supabase/auth-guard"
import { localizePromptVersion, ServiceError } from "@/lib/services/prompt-localization-service"

// VERIDIAN_Architecture_v2.0 phase_8: engine-prompt-localization.
export async function POST(request: NextRequest) {
  const { response, dbUser } = await requireAuth()
  if (response) return response
  if (!dbUser) return NextResponse.json({ error: "No user found" }, { status: 400 })

  try {
    const body = await request.json()
    const result = await localizePromptVersion({ userId: dbUser.id, dbUser }, body)
    return NextResponse.json(result, { status: 201 })
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("Prompt localization error:", error)
    return NextResponse.json({ error: "Failed to localize prompt version" }, { status: 500 })
  }
}
