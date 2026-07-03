import { NextRequest, NextResponse } from "next/server"
import { requireAuth } from "@/lib/supabase/auth-guard"
import { createPromptVersion, listPromptVersions, ServiceError } from "@/lib/services/prompt-os-service"

// Wave 22: Prompt Operating System. GET lists all templates + version
// history (optionally filtered to one templateKey); POST creates a new
// version (veridian_admin-gated in the service layer).
export async function GET(request: NextRequest) {
  const { response } = await requireAuth()
  if (response) return response

  try {
    const templateKey = request.nextUrl.searchParams.get("templateKey") ?? undefined
    const templates = await listPromptVersions(templateKey)
    return NextResponse.json({ templates })
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("Prompt templates list error:", error)
    return NextResponse.json({ error: "Failed to fetch prompt templates" }, { status: 500 })
  }
}

export async function POST(request: NextRequest) {
  const { response, dbUser } = await requireAuth()
  if (response) return response
  if (!dbUser) return NextResponse.json({ error: "No user found" }, { status: 400 })

  try {
    const body = await request.json()
    const result = await createPromptVersion({ userId: dbUser.id, dbUser }, body)
    return NextResponse.json(result, { status: 201 })
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("Prompt version create error:", error)
    return NextResponse.json({ error: "Failed to create prompt version" }, { status: 500 })
  }
}
