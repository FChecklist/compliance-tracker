import { NextRequest, NextResponse } from "next/server"
import { requireAuth } from "@/lib/supabase/auth-guard"
import { listAttempts, submitAttempt, ServiceError } from "@/lib/services/training-assessment-service"

type RouteContext = { params: Promise<{ id: string }> }

// Self-service: an employee's own attempt history for this assessment.
export async function GET(_request: NextRequest, { params }: RouteContext) {
  const { response, dbUser, orgId } = await requireAuth()
  if (response) return response
  if (!orgId || !dbUser) return NextResponse.json({ error: "No organisation found" }, { status: 400 })

  try {
    const { id } = await params
    const attempts = await listAttempts({ orgId }, { assessmentId: id, employeeId: dbUser.id })
    return NextResponse.json({ attempts })
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("Training attempts list error:", error)
    return NextResponse.json({ error: "Failed to fetch attempts" }, { status: 500 })
  }
}

// Submit + score an attempt. Retake policy (maxAttempts) and enrollment
// preconditions are enforced inside submitAttempt.
export async function POST(request: NextRequest, { params }: RouteContext) {
  const { response, dbUser, orgId } = await requireAuth()
  if (response) return response
  if (!orgId || !dbUser) return NextResponse.json({ error: "No organisation found" }, { status: 400 })

  try {
    const { id } = await params
    const body = await request.json()
    const attempt = await submitAttempt({ orgId, userId: dbUser.id }, id, body.answers ?? {})
    return NextResponse.json(attempt, { status: 201 })
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("Training attempt submit error:", error)
    return NextResponse.json({ error: "Failed to submit attempt" }, { status: 500 })
  }
}
