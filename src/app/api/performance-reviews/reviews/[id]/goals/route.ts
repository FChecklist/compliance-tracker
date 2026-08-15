import { NextRequest, NextResponse } from "next/server"
import { requireAuth } from "@/lib/supabase/auth-guard"
import { listReviewGoals, addReviewGoal, ServiceError } from "@/lib/services/performance-service"

type RouteContext = { params: Promise<{ id: string }> }

export async function GET(request: NextRequest, { params }: RouteContext) {
  const { response, orgId } = await requireAuth()
  if (response) return response
  if (!orgId) return NextResponse.json({ goals: [] })

  try {
    const { id } = await params
    const goals = await listReviewGoals({ orgId }, id)
    return NextResponse.json({ goals })
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("Review goals list error:", error)
    return NextResponse.json({ error: "Failed to fetch review goals" }, { status: 500 })
  }
}

export async function POST(request: NextRequest, { params }: RouteContext) {
  const { response, dbUser, orgId } = await requireAuth()
  if (response) return response
  if (!orgId || !dbUser) return NextResponse.json({ error: "No organisation found" }, { status: 400 })

  try {
    const { id } = await params
    const body = await request.json()
    const result = await addReviewGoal({ orgId, userId: dbUser.id }, id, body)
    return NextResponse.json(result, { status: 201 })
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("Review goal create error:", error)
    return NextResponse.json({ error: "Failed to create review goal" }, { status: 500 })
  }
}
