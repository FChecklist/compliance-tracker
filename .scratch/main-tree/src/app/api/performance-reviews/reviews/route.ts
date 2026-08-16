import { NextRequest, NextResponse } from "next/server"
import { requireAuth } from "@/lib/supabase/auth-guard"
import { listReviews, createReview, ServiceError } from "@/lib/services/performance-service"

export async function GET(request: NextRequest) {
  const { response, orgId } = await requireAuth()
  if (response) return response
  if (!orgId) return NextResponse.json({ reviews: [] })

  try {
    const { searchParams } = new URL(request.url)
    const cycleId = searchParams.get("cycleId") || undefined
    const employeeProfileId = searchParams.get("employeeProfileId") || undefined
    const reviews = await listReviews({ orgId }, { cycleId, employeeProfileId })
    return NextResponse.json({ reviews })
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("Reviews list error:", error)
    return NextResponse.json({ error: "Failed to fetch reviews" }, { status: 500 })
  }
}

export async function POST(request: NextRequest) {
  const { response, dbUser, orgId } = await requireAuth()
  if (response) return response
  if (!orgId || !dbUser) return NextResponse.json({ error: "No organisation found" }, { status: 400 })

  try {
    const body = await request.json()
    const review = await createReview({ orgId, userId: dbUser.id }, body)
    return NextResponse.json(review, { status: 201 })
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("Review create error:", error)
    return NextResponse.json({ error: "Failed to create review" }, { status: 500 })
  }
}
