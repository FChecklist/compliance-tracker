import { NextRequest, NextResponse } from "next/server"
import { requireAuth } from "@/lib/supabase/auth-guard"
import { computeStaffUtilization, ServiceError } from "@/lib/services/firm-staff-assignment-service"

export async function GET(req: NextRequest, ctx: { params: Promise<{ userId: string }> }) {
  const { response, orgId } = await requireAuth()
  if (response) return response
  if (!orgId) return NextResponse.json({ error: "No organisation found" }, { status: 400 })

  try {
    const { userId } = await ctx.params
    const periodStart = req.nextUrl.searchParams.get("periodStart")
    const periodEnd = req.nextUrl.searchParams.get("periodEnd")
    if (!periodStart || !periodEnd) return NextResponse.json({ error: "periodStart and periodEnd are required" }, { status: 400 })
    const utilization = await computeStaffUtilization({ orgId }, userId, periodStart, periodEnd)
    return NextResponse.json(utilization)
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("Compute staff utilization error:", error)
    return NextResponse.json({ error: "Failed to compute utilization" }, { status: 500 })
  }
}
