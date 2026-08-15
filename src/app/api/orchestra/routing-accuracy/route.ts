import { NextRequest, NextResponse } from "next/server"
import { requireAuth } from "@/lib/supabase/auth-guard"
import { generateRoutingAccuracyReport } from "@/lib/services/routing-accuracy-report-service"

// Platform-wide (every org's chat.ai_thread_reply rows, same posture as
// byo-model-audit.ts's own raw `db` scan) -- unlike /api/orchestra/analytics
// (org-scoped via withTenantContext), this is NOT safe to expose to an
// ordinary org user, so it's veridian_admin-gated, matching /api/ai/team/
// dispatch's own posture for platform-internal data.
export async function GET(request: NextRequest) {
  const { user, dbUser, response } = await requireAuth()
  if (!user) return response!
  if (!dbUser || dbUser.role !== "veridian_admin") {
    return NextResponse.json({ error: "Routing accuracy is veridian_admin-only" }, { status: 403 })
  }

  const daysParam = request.nextUrl.searchParams.get("days")
  const days = daysParam ? Number(daysParam) : 7

  try {
    const report = await generateRoutingAccuracyReport(days)
    return NextResponse.json(report)
  } catch (error) {
    console.error("Routing accuracy report fetch error:", error)
    return NextResponse.json({ error: "Failed to fetch routing accuracy report" }, { status: 500 })
  }
}
