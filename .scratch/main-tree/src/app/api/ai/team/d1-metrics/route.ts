import { NextRequest, NextResponse } from "next/server"
import { requireAuth } from "@/lib/supabase/auth-guard"
import { generateD1MetricsReport } from "@/lib/services/d1-metrics-tracker-service"

// GAP-D1-METRICS-TARGET (D1.B1.S1) -- see d1-metrics-tracker-service.ts's
// own header for the exact source quote and what's real vs. honestly
// notCovered. veridian_admin-gated, same posture as the sibling
// /api/ai/team/token-usage report (a platform-wide governance metric, not
// scoped to any one org).
export async function GET(request: NextRequest) {
  const { user, dbUser, response: authError } = await requireAuth()
  if (!user) return authError!
  if (!dbUser || dbUser.role !== "veridian_admin") {
    return NextResponse.json({ error: "D1 metrics report is veridian_admin-only" }, { status: 403 })
  }

  const sinceDaysParam = request.nextUrl.searchParams.get("sinceDays")
  const sinceDays = sinceDaysParam ? Math.max(1, Math.min(365, Number(sinceDaysParam) || 90)) : 90

  try {
    const report = await generateD1MetricsReport(sinceDays)
    return NextResponse.json(report)
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to generate D1 metrics report"
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
