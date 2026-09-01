import { NextRequest, NextResponse } from "next/server"
import { requireAuth } from "@/lib/supabase/auth-guard"
import { getConfidenceCorrelationReport } from "@/lib/services/confidence-correlation-service"

// VERIDIAN Review Framework gap-closure, AI Maintainability / Change Risk
// Management -- [Low] "AI Confidence Before Code Changes": "Periodically
// audit whether reported confidence percentages correlate with actual
// outcome quality." See confidence-correlation-service.ts's own header for
// the full investigation trail. veridian_admin-gated, platform-internal
// governance surface, same posture as /api/ai/team/scorecard and
// /api/ai/team/token-usage.
export async function GET(request: NextRequest) {
  const { user, dbUser, response: authError } = await requireAuth()
  if (!user) return authError!
  if (!dbUser || dbUser.role !== "veridian_admin") {
    return NextResponse.json({ error: "Confidence correlation report is veridian_admin-only" }, { status: 403 })
  }

  const sinceDaysParam = request.nextUrl.searchParams.get("sinceDays")
  const sinceDays = sinceDaysParam ? Math.max(1, Math.min(365, Number(sinceDaysParam) || 30)) : undefined

  try {
    const report = await getConfidenceCorrelationReport({ sinceDays })
    return NextResponse.json({ report })
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to load confidence correlation report"
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
