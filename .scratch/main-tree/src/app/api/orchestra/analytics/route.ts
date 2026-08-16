import { NextRequest, NextResponse } from "next/server"
import { requireAuth } from "@/lib/supabase/auth-guard"
import { getOrchestraAnalytics } from "@/lib/services/orchestra-analytics-service"

export async function GET(request: NextRequest) {
  const { response, orgId } = await requireAuth()
  if (response) return response
  if (!orgId) return NextResponse.json({ error: "No organisation found" }, { status: 400 })

  const sinceDaysParam = request.nextUrl.searchParams.get("sinceDays")
  const sinceDays = sinceDaysParam ? Number(sinceDaysParam) : 30

  try {
    const analytics = await getOrchestraAnalytics({ orgId }, sinceDays)
    return NextResponse.json(analytics)
  } catch (error) {
    console.error("Orchestra analytics fetch error:", error)
    return NextResponse.json({ error: "Failed to fetch orchestra analytics" }, { status: 500 })
  }
}
