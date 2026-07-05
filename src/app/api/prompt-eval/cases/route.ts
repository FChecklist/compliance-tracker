import { NextRequest, NextResponse } from "next/server"
import { requireAuth } from "@/lib/supabase/auth-guard"
import { createEvalCase, listEvalCases, ServiceError } from "@/lib/services/prompt-eval-service"

export async function GET(request: NextRequest) {
  const { response } = await requireAuth()
  if (response) return response

  try {
    const templateKey = request.nextUrl.searchParams.get("templateKey") ?? undefined
    const cases = await listEvalCases(templateKey)
    return NextResponse.json({ cases })
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("Prompt eval cases list error:", error)
    return NextResponse.json({ error: "Failed to fetch eval cases" }, { status: 500 })
  }
}

export async function POST(request: NextRequest) {
  const { response, dbUser } = await requireAuth()
  if (response) return response
  if (!dbUser) return NextResponse.json({ error: "No user found" }, { status: 400 })

  try {
    const body = await request.json()
    const result = await createEvalCase({ userId: dbUser.id, dbUser }, body)
    return NextResponse.json(result, { status: 201 })
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("Prompt eval case create error:", error)
    return NextResponse.json({ error: "Failed to create eval case" }, { status: 500 })
  }
}
