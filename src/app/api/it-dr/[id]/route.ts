import { NextResponse } from "next/server"
import { requireAuth } from "@/lib/supabase/auth-guard"
import { getDrPlanDetail, ServiceError } from "@/lib/services/it-dr-service"

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { response, orgId } = await requireAuth()
  if (response) return response
  if (!orgId) return NextResponse.json({ error: "No organisation found" }, { status: 400 })

  try {
    const { id } = await params
    const plan = await getDrPlanDetail({ orgId }, id)
    return NextResponse.json(plan)
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("DR plan fetch error:", error)
    return NextResponse.json({ error: "Failed to fetch DR plan" }, { status: 500 })
  }
}
