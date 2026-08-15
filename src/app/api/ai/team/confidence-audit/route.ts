import { NextRequest, NextResponse } from "next/server"
import { requireAuth } from "@/lib/supabase/auth-guard"
import { getConfidenceOutcomeCorrelation } from "@/lib/services/confidence-correlation-service"

// VERIDIAN Review Framework gap-closure, "AI Maintainability / Change Risk
// Management" -- [Low] "AI Confidence Before Code Changes": confidence-
// banding.ts (Guardrail 9) bands a self-reported percentage into a closure
// path, but nothing previously checked whether that reported percentage
// actually correlates with real outcome quality. This route surfaces
// confidence-correlation-service.ts's periodic audit: per confidence-band
// rejection/re-audit rates, and a flag when a "safer" band (e.g.
// auto_proceed) shows a WORSE re-audit rate than a "riskier" band (e.g.
// escalation_required) -- the concrete signal that reported confidence is
// not trustworthy. veridian_admin-gated, same posture as the sibling
// /api/ai/team/scorecard governance report (also sourced from activity_log).
export async function GET(request: NextRequest) {
  const { user, dbUser, response: authError } = await requireAuth()
  if (!user) return authError!
  if (!dbUser || dbUser.role !== "veridian_admin") {
    return NextResponse.json({ error: "Confidence-correlation audit is veridian_admin-only" }, { status: 403 })
  }

  const sinceDaysParam = request.nextUrl.searchParams.get("sinceDays")
  const sinceDays = sinceDaysParam ? Math.max(1, Math.min(365, Number(sinceDaysParam) || 30)) : undefined

  try {
    const report = await getConfidenceOutcomeCorrelation({ sinceDays })
    return NextResponse.json(report)
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to compute confidence-outcome correlation"
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
