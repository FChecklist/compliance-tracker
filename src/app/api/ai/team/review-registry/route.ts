import { NextRequest, NextResponse } from "next/server"
import { requireAuth } from "@/lib/supabase/auth-guard"
import {
  runAgentReviewCycle,
  getAgentReviewHistory,
  getLatestAgentReviews,
  getRolesNeedingTrustTierReconsideration,
} from "@/lib/services/agent-review-service"

// GAP-AI-WORKFORCE-GOVERNANCE, Agent Review Registry (ARR) -- see
// agent-review-service.ts's own header for the full investigation trail
// (why this is not a duplicate of model-scorecard-service.ts/GAP-MODEL-
// SCORECARD or the AI Team Closure Review gate at POST /api/ai/team/review).
// veridian_admin-gated, platform-internal governance surface -- same posture
// as the sibling /api/ai/team/scorecard, /governance-health, /d1-metrics,
// /token-usage routes (none of which have a dedicated page either; this
// matches that established API-only convention for this class of surface).
//
// GET reads the persisted registry -- either one role's full history
// (?roleKey=...), every role's latest verdict (default), or just the roles
// currently flagged for a Rule 10 trust-tier reconsideration
// (?flagged=true). POST triggers a new review cycle and persists its
// results -- there is no automated cron trigger for this yet (honestly
// deferred, see this repo's own recent history of 3 pre-existing crons
// already hitting the Vercel Hobby plan's once-per-day limit); a
// veridian_admin (or a future scheduled job reusing this same route) runs
// it on demand.
export async function GET(request: NextRequest) {
  const { user, dbUser, response: authError } = await requireAuth()
  if (!user) return authError!
  if (!dbUser || dbUser.role !== "veridian_admin") {
    return NextResponse.json({ error: "Agent Review Registry is veridian_admin-only" }, { status: 403 })
  }

  const roleKey = request.nextUrl.searchParams.get("roleKey")
  const flaggedOnly = request.nextUrl.searchParams.get("flagged") === "true"
  const limitParam = request.nextUrl.searchParams.get("limit")
  const limit = limitParam ? Math.max(1, Math.min(200, Number(limitParam) || 50)) : 50

  try {
    if (roleKey) {
      const history = await getAgentReviewHistory(roleKey, limit)
      return NextResponse.json({ roleKey, history })
    }
    if (flaggedOnly) {
      const flagged = await getRolesNeedingTrustTierReconsideration()
      return NextResponse.json({ flagged })
    }
    const latest = await getLatestAgentReviews()
    return NextResponse.json({ latest })
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to load the Agent Review Registry"
    return NextResponse.json({ error: message }, { status: 500 })
  }
}

export async function POST(request: NextRequest) {
  const { user, dbUser, response: authError } = await requireAuth()
  if (!user) return authError!
  if (!dbUser || dbUser.role !== "veridian_admin") {
    return NextResponse.json({ error: "Triggering an Agent Review cycle is veridian_admin-only" }, { status: 403 })
  }

  const body = await request.json().catch(() => ({}))
  const sinceDaysRaw = (body as { sinceDays?: number })?.sinceDays
  const sinceDays = sinceDaysRaw ? Math.max(1, Math.min(365, Number(sinceDaysRaw) || 30)) : 30

  try {
    const created = await runAgentReviewCycle({ sinceDays })
    return NextResponse.json({ status: "recorded", reviewedRoleCount: created.length, records: created })
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to run an Agent Review cycle"
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
