import { NextRequest, NextResponse } from "next/server"
import { requireAuth } from "@/lib/supabase/auth-guard"
import { listUpcomingLimitationDates, ServiceError } from "@/lib/services/firm-tax-case-service"

export async function GET(req: NextRequest) {
  const { response, orgId } = await requireAuth()
  if (response) return response
  if (!orgId) return NextResponse.json({ error: "No organisation found" }, { status: 400 })

  try {
    const withinDays = Number(req.nextUrl.searchParams.get("withinDays") ?? "30")
    const taxCases = await listUpcomingLimitationDates({ orgId }, withinDays)
    return NextResponse.json({ taxCases })
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("List upcoming limitation dates error:", error)
    return NextResponse.json({ error: "Failed to list upcoming limitation dates" }, { status: 500 })
  }
}
