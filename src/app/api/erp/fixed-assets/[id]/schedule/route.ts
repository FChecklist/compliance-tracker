import { NextResponse } from "next/server"
import { requireAuth } from "@/lib/supabase/auth-guard"
import { listDepreciationSchedule, ServiceError } from "@/lib/services/erp-fixed-assets-service"

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { response, orgId } = await requireAuth()
  if (response) return response
  if (!orgId) return NextResponse.json({ error: "No organisation found" }, { status: 400 })

  try {
    const { id } = await params
    const schedule = await listDepreciationSchedule({ orgId }, id)
    return NextResponse.json({ schedule })
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("Depreciation schedule fetch error:", error)
    return NextResponse.json({ error: "Failed to fetch depreciation schedule" }, { status: 500 })
  }
}
