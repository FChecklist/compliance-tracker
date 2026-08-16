import { NextResponse } from "next/server"
import { requireAuth } from "@/lib/supabase/auth-guard"
import { getAccessReviewCycleDetail, ServiceError } from "@/lib/services/access-review-service"

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { response, orgId } = await requireAuth()
  if (response) return response
  if (!orgId) return NextResponse.json({ error: "No organisation found" }, { status: 400 })

  try {
    const { id } = await params
    const cycle = await getAccessReviewCycleDetail({ orgId }, id)
    return NextResponse.json(cycle)
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("Access review cycle fetch error:", error)
    return NextResponse.json({ error: "Failed to fetch access review cycle" }, { status: 500 })
  }
}
