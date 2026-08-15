import { NextRequest, NextResponse } from "next/server"
import { requireAuth } from "@/lib/supabase/auth-guard"
import { getCostPerQualityPoints } from "@/lib/services/cost-quality-service"

// Cost-per-quality-point per (role, model), joining token_usage_ledger
// (real cost) against role_quality_runs (real per-role eval pass rate) --
// VERIDIAN Review Framework gap-closure, "Cost-per-quality-point tracked
// per model to inform routing decisions." veridian_admin-gated, same
// posture as /api/ai/team/scorecard and /api/ai/team/token-usage.
export async function GET(request: NextRequest) {
  const { user, dbUser, response: authError } = await requireAuth()
  if (!user) return authError!
  if (!dbUser || dbUser.role !== "veridian_admin") {
    return NextResponse.json({ error: "Cost-per-quality report is veridian_admin-only" }, { status: 403 })
  }

  const sinceDaysParam = request.nextUrl.searchParams.get("sinceDays")
  const sinceDays = sinceDaysParam ? Math.max(1, Math.min(365, Number(sinceDaysParam) || 30)) : undefined

  try {
    const entries = await getCostPerQualityPoints({ sinceDays })
    return NextResponse.json({ entries })
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to load cost-per-quality report"
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
