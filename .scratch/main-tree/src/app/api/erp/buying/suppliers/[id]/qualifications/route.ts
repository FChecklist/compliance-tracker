import { NextRequest, NextResponse } from "next/server"
import { requireAuth, requireRole } from "@/lib/supabase/auth-guard"
import { recordQualificationReview, listQualificationReviews, ServiceError } from "@/lib/services/erp-vendor-master-service"

type RouteContext = { params: Promise<{ id: string }> }

export async function GET(_request: NextRequest, { params }: RouteContext) {
  const { response, orgId } = await requireAuth()
  if (response) return response
  if (!orgId) return NextResponse.json({ qualifications: [] })

  try {
    const { id } = await params
    const qualifications = await listQualificationReviews({ orgId }, id)
    return NextResponse.json({ qualifications })
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("Supplier qualifications list error:", error)
    return NextResponse.json({ error: "Failed to fetch qualification reviews" }, { status: 500 })
  }
}

export async function POST(request: NextRequest, { params }: RouteContext) {
  const { response, dbUser, orgId } = await requireAuth()
  if (response) return response
  const roleErr = requireRole(dbUser, "member")
  if (roleErr) return roleErr
  if (!orgId || !dbUser) return NextResponse.json({ error: "No organisation found" }, { status: 400 })

  try {
    const { id } = await params
    const body = await request.json()
    const review = await recordQualificationReview({ orgId, userId: dbUser.id }, id, {
      status: body.status, criteria: body.criteria, score: body.score, notes: body.notes,
    })
    return NextResponse.json(review, { status: 201 })
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("Supplier qualification review create error:", error)
    return NextResponse.json({ error: "Failed to record qualification review" }, { status: 500 })
  }
}
