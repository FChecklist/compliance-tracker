import { NextRequest, NextResponse } from "next/server"
import { requireAuth, requireRole } from "@/lib/supabase/auth-guard"
import { importPromptBundle, ServiceError } from "@/lib/services/prompt-export-import-service"

// VERIDIAN_Architecture_v2.0 phase_8: engine-prompt-import.
export async function POST(request: NextRequest) {
  const { response, dbUser } = await requireAuth()
  if (response) return response
  if (!dbUser) return NextResponse.json({ error: "No user found" }, { status: 400 })

  const roleCheck = requireRole(dbUser, "admin")
  if (roleCheck) return roleCheck

  try {
    const bundle = await request.json()
    const result = await importPromptBundle({ userId: dbUser.id, dbUser }, bundle)
    return NextResponse.json(result, { status: 201 })
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("Prompt import error:", error)
    return NextResponse.json({ error: "Failed to import prompt bundle" }, { status: 500 })
  }
}
