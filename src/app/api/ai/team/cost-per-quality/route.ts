import { NextRequest, NextResponse } from "next/server"
import { requireAuth } from "@/lib/supabase/auth-guard"
import { getCostPerQualityPoint } from "@/lib/services/model-cost-quality-service"

// AI Model Lifecycle & Benchmarking gap-closure, Finding 2: cost-per-
// quality-point per model, joining token_usage_ledger (real spend) with
// role_quality_snapshots (Finding 1's real quality time series) -- see
// model-cost-quality-service.ts's own header. veridian_admin-gated, same
// posture as /api/ai/team/token-usage and /api/ai/team/scorecard.
export async function GET(request: NextRequest) {
  const { user, dbUser, response: authError } = await requireAuth()
  if (!user) return authError!
  if (!dbUser || dbUser.role !== "veridian_admin") {
    return NextResponse.json({ error: "Cost-per-quality-point tracking is veridian_admin-only" }, { status: 403 })
  }

  const sinceDaysParam = request.nextUrl.searchParams.get("sinceDays")
  const sinceDays = sinceDaysParam ? Math.max(1, Math.min(365, Number(sinceDaysParam) || 30)) : 30

  try {
    const entries = await getCostPerQualityPoint(sinceDays)
    // Infinity (a real 0-quality-score model with nonzero cost) is not
    // valid JSON -- JSON.stringify silently turns it into `null`, which
    // would collide with this same field's genuine "no quality signal yet"
    // null. Serialized explicitly as the string "infinite" so the two
    // states stay distinguishable to any real caller.
    const serializable = entries.map((e) => ({
      ...e,
      costPerQualityPoint: e.costPerQualityPoint === Infinity ? "infinite" : e.costPerQualityPoint,
    }))
    return NextResponse.json({ sinceDays, entries: serializable })
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to load cost-per-quality-point report"
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
