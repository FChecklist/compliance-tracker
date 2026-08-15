import { NextRequest, NextResponse } from "next/server"
import { requireAuth } from "@/lib/supabase/auth-guard"
import { getAiReductionTrend } from "@/lib/services/ai-reduction-service"

// Platform-wide (task_capabilities' own counters are mostly platform-wide,
// see that table's schema comment) -- veridian_admin-gated, same posture as
// /api/orchestra/routing-accuracy.
export async function GET(request: NextRequest) {
  const { user, dbUser, response } = await requireAuth()
  if (!user) return response!
  if (!dbUser || dbUser.role !== "veridian_admin") {
    return NextResponse.json({ error: "AI-reduction trend is veridian_admin-only" }, { status: 403 })
  }

  const limitParam = request.nextUrl.searchParams.get("limitMonths")
  const limitMonths = limitParam ? Number(limitParam) : 12

  try {
    const trend = await getAiReductionTrend(limitMonths)
    return NextResponse.json({ trend })
  } catch (error) {
    console.error("AI-reduction trend fetch error:", error)
    return NextResponse.json({ error: "Failed to fetch AI-reduction trend" }, { status: 500 })
  }
}
