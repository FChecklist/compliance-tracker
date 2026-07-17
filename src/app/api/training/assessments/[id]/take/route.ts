import { NextRequest, NextResponse } from "next/server"
import { requireAuth } from "@/lib/supabase/auth-guard"
import { getAssessmentForTaking, ServiceError } from "@/lib/services/training-assessment-service"

type RouteContext = { params: Promise<{ id: string }> }

// The employee-facing view -- questions without correctAnswer.
export async function GET(_request: NextRequest, { params }: RouteContext) {
  const { response, orgId } = await requireAuth()
  if (response) return response
  if (!orgId) return NextResponse.json({ error: "No organisation found" }, { status: 400 })

  try {
    const { id } = await params
    const result = await getAssessmentForTaking({ orgId }, id)
    return NextResponse.json(result)
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("Training assessment take error:", error)
    return NextResponse.json({ error: "Failed to fetch assessment" }, { status: 500 })
  }
}
