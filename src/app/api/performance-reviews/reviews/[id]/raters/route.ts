import { NextRequest, NextResponse } from "next/server"
import { requireAuth } from "@/lib/supabase/auth-guard"
import { listReviewRaters, inviteReviewRater, ServiceError } from "@/lib/services/performance-service"

type RouteContext = { params: Promise<{ id: string }> }

export async function GET(request: NextRequest, { params }: RouteContext) {
  const { response, orgId } = await requireAuth()
  if (response) return response
  if (!orgId) return NextResponse.json({ raters: [] })

  try {
    const { id } = await params
    const raters = await listReviewRaters({ orgId }, id)
    return NextResponse.json({ raters })
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("Review raters list error:", error)
    return NextResponse.json({ error: "Failed to fetch review raters" }, { status: 500 })
  }
}

export async function POST(request: NextRequest, { params }: RouteContext) {
  const { response, dbUser, orgId } = await requireAuth()
  if (response) return response
  if (!orgId || !dbUser) return NextResponse.json({ error: "No organisation found" }, { status: 400 })

  try {
    const { id } = await params
    const body = await request.json()
    const result = await inviteReviewRater({ orgId, userId: dbUser.id }, id, body)
    return NextResponse.json(result, { status: 201 })
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("Review rater invite error:", error)
    return NextResponse.json({ error: "Failed to invite review rater" }, { status: 500 })
  }
}
