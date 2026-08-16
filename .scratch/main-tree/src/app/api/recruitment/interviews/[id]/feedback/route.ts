import { NextRequest, NextResponse } from "next/server"
import { requireAuth } from "@/lib/supabase/auth-guard"
import { submitInterviewFeedback, ServiceError } from "@/lib/services/recruitment-service"

type RouteContext = { params: Promise<{ id: string }> }

export async function POST(request: NextRequest, context: RouteContext) {
  const { response, dbUser, orgId } = await requireAuth()
  if (response) return response
  if (!orgId || !dbUser) return NextResponse.json({ error: "No organisation found" }, { status: 400 })

  try {
    const { id } = await context.params
    const body = await request.json()
    const updated = await submitInterviewFeedback({ orgId, userId: dbUser.id }, id, body)
    return NextResponse.json(updated)
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("Interview feedback error:", error)
    return NextResponse.json({ error: "Failed to submit interview feedback" }, { status: 500 })
  }
}
