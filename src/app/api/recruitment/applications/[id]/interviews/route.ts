import { NextRequest, NextResponse } from "next/server"
import { requireAuth } from "@/lib/supabase/auth-guard"
import { listInterviewFeedback, scheduleInterview, ServiceError } from "@/lib/services/recruitment-service"

type RouteContext = { params: Promise<{ id: string }> }

export async function GET(request: NextRequest, context: RouteContext) {
  const { response, orgId } = await requireAuth()
  if (response) return response
  if (!orgId) return NextResponse.json({ interviews: [] })

  try {
    const { id } = await context.params
    const interviews = await listInterviewFeedback({ orgId }, id)
    return NextResponse.json({ interviews })
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("Interview list error:", error)
    return NextResponse.json({ error: "Failed to fetch interviews" }, { status: 500 })
  }
}

export async function POST(request: NextRequest, context: RouteContext) {
  const { response, dbUser, orgId } = await requireAuth()
  if (response) return response
  if (!orgId || !dbUser) return NextResponse.json({ error: "No organisation found" }, { status: 400 })

  try {
    const { id } = await context.params
    const body = await request.json()
    const interview = await scheduleInterview({ orgId, userId: dbUser.id }, { applicationId: id, ...body })
    return NextResponse.json(interview, { status: 201 })
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("Interview schedule error:", error)
    return NextResponse.json({ error: "Failed to schedule interview" }, { status: 500 })
  }
}
