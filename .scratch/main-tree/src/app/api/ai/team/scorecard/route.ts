import { NextRequest, NextResponse } from "next/server"
import { requireAuth } from "@/lib/supabase/auth-guard"
import { getModelScorecard } from "@/lib/services/model-scorecard-service"

// GAP-MODEL-SCORECARD: real dispatch count / success rate / audit-finding-
// rate per (AI model, complexity tier), sourced from activity_log (the
// same table /api/ai/team/governance-health and agent-directory-service.ts
// already read) -- see model-scorecard-service.ts's own header for the
// full investigation trail and why iteration count is honestly reported
// as not-yet-computable rather than fabricated. veridian_admin-gated,
// platform-internal governance surface, same posture as
// /api/ai/team/token-usage and /api/ai/team/governance-health.
export async function GET(request: NextRequest) {
  const { user, dbUser, response: authError } = await requireAuth()
  if (!user) return authError!
  if (!dbUser || dbUser.role !== "veridian_admin") {
    return NextResponse.json({ error: "Model performance scorecard is veridian_admin-only" }, { status: 403 })
  }

  const sinceDaysParam = request.nextUrl.searchParams.get("sinceDays")
  const sinceDays = sinceDaysParam ? Math.max(1, Math.min(365, Number(sinceDaysParam) || 30)) : undefined

  try {
    const scorecard = await getModelScorecard({ sinceDays })
    return NextResponse.json({ scorecard })
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to load model performance scorecard"
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
