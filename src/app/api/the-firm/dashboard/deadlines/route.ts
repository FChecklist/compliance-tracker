import { NextRequest, NextResponse } from "next/server"
import { requireAuth } from "@/lib/supabase/auth-guard"
import { getUpcomingDeadlines } from "@/lib/services/firm-practice-dashboard-service"
import { ServiceError } from "@/lib/services/compliance-service"

export async function GET(req: NextRequest) {
  const { response, dbUser, orgId } = await requireAuth()
  if (response) return response
  if (!orgId || !dbUser) return NextResponse.json({ error: "No organisation found" }, { status: 400 })

  try {
    const withinDays = Number(req.nextUrl.searchParams.get("withinDays") ?? "14")
    const deadlines = await getUpcomingDeadlines({ orgId, userId: dbUser.id, dbUser }, withinDays)
    return NextResponse.json({ deadlines })
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("Get upcoming deadlines error:", error)
    return NextResponse.json({ error: "Failed to get upcoming deadlines" }, { status: 500 })
  }
}
